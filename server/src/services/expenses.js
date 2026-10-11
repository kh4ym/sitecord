// FILE: server/src/services/expenses.js
//
// WHAT IT DOES
// Purchases (P-1, P-2, ...): what was bought, from whom, with what proof.
// Status: DRAFT → SUBMITTED → APPROVED | REJECTED | QUERIED (→ SUBMITTED
// again on resubmit) → VERIFIED on site. The owner's own purchases skip
// SUBMITTED and land as APPROVED. Submission runs the automatic checks
// (runRules) that produce findings for the owner. Approve/reject/query
// themselves live in decisions.js. Also lists and dismisses those findings.
//
// WHY IT EXISTS
// Purchases are where most money goes. This file makes sure totals are
// computed on the server, proof is attached before submission, and suspicious
// patterns (duplicate invoices, high prices, reused photos...) are flagged.
//
// WHO USES IT
// routes/projects.js and the seed.
//
// WHAT IT DEPENDS ON
// shared/ budget, features, geo, records and money modules; audit; error
// helpers; lib/util.js (ids, numbering, idempotency); budget.js, decisions.js,
// evidence.js and notify.js.
//
// Services take (q, ctx, ...): q runs SQL in the current transaction and
// resolves to camelCased rows; ctx is who is acting (ctx.can(...) checks a permission).

// ES module named imports.
// Upper limit for any money amount, to stop absurd numbers.
import { MAX_AMOUNT_PAISA } from '../../../shared/budget.js'
// Which features a contract type has.
import { featuresFor } from '../../../shared/features.js'
// Radius for delivery photos, distance text, photo-location classification.
import { DELIVERY_RADIUS_M, formatDistance, locationStatus } from '../../../shared/geo.js'
// Counted statuses, purchase type labels, missing-proof check, labels for gaps.
import { COUNTED_EXPENSE_STATUSES, EXPENSE_TYPES, expenseEvidenceGaps, GAP_LABELS } from '../../../shared/records.js'
// Money formatting.
import { formatPKR } from '../../../shared/money.js'
// Audit trail writer.
import { audit } from '../audit/audit.js'
// HTTP error builders.
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
// Idempotency lookup, ISO timestamps, new ids, next per-project number.
import { findByClientId, isoAt, newId, nextNumber } from '../lib/util.js'
// Re-checks the budget alert.
import { checkBudget } from './budget.js'
// Decision history of a record.
import { decisionsFor } from './decisions.js'
// Attach files, list files, find reused files.
import { attachEvidence, evidenceFor, reusedFiles } from './evidence.js'
// Members by role; notifications.
import { membersWithRoles, notify } from './notify.js'

// SQL list text "('APPROVED', 'VERIFIED', ...)" built with .map + .join inside a template literal.
const COUNTED = `(${COUNTED_EXPENSE_STATUSES.map((s) => `'${s}'`).join(', ')})`
// Arrow function: a ratio like 0.23 → "23%".
const pct = (n) => `${Math.round(n * 100)}%`

/** Someone who can't see the project's money (a site supervisor) still sees the purchases they entered. */
// Returns true when this person should only see their own purchases.
const ownOnly = (ctx) => !ctx.can('viewMoney')

// List purchases with optional filters. `{ status, type, boqItemId } = {}`
// destructures the filter object and defaults it to {} if omitted.
export async function listExpenses(q, ctx, { status, type, boqItemId } = {}) {
  // WHERE conditions, joined with AND later.
  const where = ['e.project_id = $1']
  // Parameter values; $1 is the project id.
  const params = [ctx.project.id]
  // Trick: params.push(x) returns the new array length, which is exactly the
  // next placeholder number, so `$${params.push(status)}` produces "$2", "$3"...
  // (the first `$` is literal text, `${...}` is the template substitution).
  if (status) where.push(`e.status = $${params.push(status)}`)
  // Filter by purchase type.
  if (type) where.push(`e.type = $${params.push(type)}`)
  // Filter to purchases with a line on a given BOQ item (EXISTS = "any matching row").
  if (boqItemId) where.push(`EXISTS (SELECT 1 FROM expense_lines l WHERE l.expense_id = e.id AND l.boq_item_id = $${params.push(boqItemId)})`)
  // Drafts are private to whoever is writing them.
  where.push(`(e.status <> 'DRAFT' OR e.created_by = $${params.push(ctx.userId)})`)
  // Non-money roles only see their own purchases.
  if (ownOnly(ctx)) where.push(`e.created_by = $${params.push(ctx.userId)}`)
  // SQL: every purchase column (e.*) and the creator's name, plus per-row subqueries:
  //   evidence_count — number of attached files;
  //   open_findings — number of open automatic-check flags;
  //   items — line descriptions joined with ", " in line order (string_agg).
  // WHERE ${where.join(' AND ')} splices in the conditions built above.
  // ORDER BY purchase date then number, newest first.
  return q(
    `SELECT e.*, u.name AS created_by_name,
            (SELECT count(*)::int FROM evidence v WHERE v.expense_id = e.id) AS evidence_count,
            (SELECT count(*)::int FROM findings f WHERE f.target_type = 'EXPENSE' AND f.target_id = e.id AND f.status = 'OPEN') AS open_findings,
            (SELECT string_agg(l.description, ', ' ORDER BY l.sort) FROM expense_lines l WHERE l.expense_id = e.id) AS items
       FROM expenses e JOIN users u ON u.id = e.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY e.purchase_date DESC, e.number DESC`,
    params,
  )
}

// One purchase with everything the detail page needs.
export async function getExpense(q, ctx, id) {
  // The purchase and its creator's name, within this project.
  const [e] = await q(
    `SELECT e.*, u.name AS created_by_name FROM expenses e JOIN users u ON u.id = e.created_by WHERE e.id = $1 AND e.project_id = $2`,
    [id, ctx.project.id],
  )
  // 404 if missing, if it's someone else's draft, or if this person may only see their own.
  if (!e || (e.status === 'DRAFT' && e.createdBy !== ctx.userId) || (ownOnly(ctx) && e.createdBy !== ctx.userId)) throw notFound('Purchase not found')
  // Promise.all runs the five lookups at the same time and waits for all;
  // the results come back in the same order and are destructured into five names.
  const [lines, evidence, decisions, findings, questions] = await Promise.all([
    // Lines with their BOQ code and expected unit price (LEFT JOIN: line may have no BOQ item).
    q(`SELECT l.*, b.code AS boq_code, b.est_unit_paisa AS boq_est_unit_paisa
         FROM expense_lines l LEFT JOIN boq_items b ON b.id = l.boq_item_id WHERE l.expense_id = $1 ORDER BY l.sort`, [id]),
    // Attached files.
    evidenceFor(q, 'EXPENSE', id),
    // Decision history.
    decisionsFor(q, 'EXPENSE', id),
    // Automatic-check findings.
    q(`SELECT * FROM findings WHERE target_type = 'EXPENSE' AND target_id = $1 ORDER BY created_at`, [id]),
    // Question threads on this purchase.
    q(`SELECT id, number, title, status FROM questions WHERE target_type = 'EXPENSE' AND target_id = $1 ORDER BY created_at`, [id]),
  ])
  // Spread the purchase and add the related lists; `gaps` = proof still missing for its type.
  return { ...e, lines, evidence, decisions, findings, questions, gaps: expenseEvidenceGaps(e.type, evidence.map((v) => v.kind)) }
}

/**
 * Line totals are computed here; the client's total is never trusted. The
 * route validates shape and ranges; the seed calls this directly, so the
 * checks that matter for money are repeated.
 */
function cleanLines(lines) {
  // `lines?.length` is undefined if lines is missing; `!` makes both missing and 0 true.
  if (!lines?.length) throw badRequest('Add at least one item')
  // .map((l, i) => ...) builds a new array; i is the index (0, 1, 2...).
  const out = lines.map((l, i) => {
    // Number(...) converts strings like "2.5" to numbers.
    const qty = Number(l.qty)
    // Prices are whole paisa: round to an integer.
    const unitPaisa = Math.round(Number(l.unitPaisa))
    // `!(qty > 0)` also catches NaN (not-a-number), since NaN > 0 is false.
    if (!(qty > 0)) throw badRequest(`Item ${i + 1}: quantity must be more than zero`)
    // Same NaN-safe pattern for the price.
    if (!(unitPaisa >= 0)) throw badRequest(`Item ${i + 1}: price can't be negative`)
    // Line total, rounded to whole paisa.
    const totalPaisa = Math.round(qty * unitPaisa)
    // Cap absurd amounts.
    if (totalPaisa > MAX_AMOUNT_PAISA) throw badRequest(`Item ${i + 1}: that amount is too large`)
    // Copy the line and overwrite with the cleaned numbers and its sort position.
    return { ...l, qty, unitPaisa, totalPaisa, sort: i }
  })
  // .reduce((n, l) => n + l.totalPaisa, 0) sums the totals, starting from 0; cap the whole purchase too.
  if (out.reduce((n, l) => n + l.totalPaisa, 0) > MAX_AMOUNT_PAISA) throw badRequest('The purchase total is too large')
  return out
}

// Replace a purchase's lines and return the new total.
async function writeLines(q, expenseId, lines) {
  // Remove the old lines first.
  await q('DELETE FROM expense_lines WHERE expense_id = $1', [expenseId])
  // Insert each new line, one at a time (await inside a for...of runs them in order).
  for (const l of lines) {
    await q(
      `INSERT INTO expense_lines (id, expense_id, boq_item_id, description, qty, unit, unit_paisa, total_paisa, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      // `l.boqItemId || null` stores NULL for lines not tied to a BOQ item.
      [newId(), expenseId, l.boqItemId || null, l.description, l.qty, l.unit, l.unitPaisa, l.totalPaisa, l.sort],
    )
  }
  // Sum of line totals.
  return lines.reduce((n, l) => n + l.totalPaisa, 0)
}

/** The owner pays suppliers directly; only the contractor's people can spend from an advance. */
// `!!x` converts any value to a true/false boolean.
const usesAdvance = (ctx, input) => !!input.fromAdvance && ctx.role !== 'OWNER' && featuresFor(ctx.project.contractType).payments

/** Create as DRAFT, then submit in the same transaction if asked. A retried clientId returns the existing record. */
export async function createExpense(q, ctx, input) {
  // Was this exact request already processed (offline outbox retry)?
  const replay = await findByClientId(q, 'expenses', 'created_by', ctx, input.clientId)
  // If so, return what was created the first time.
  if (replay) return { id: replay.id, number: replay.number, status: replay.status, replay: true }
  // Validate and compute line totals.
  const lines = cleanLines(input.lines)
  // New id, next P-number, and timestamp.
  const id = newId()
  const number = await nextNumber(q, 'expenses', ctx.project.id)
  const at = isoAt(ctx.at)
  // INSERT the purchase as a DRAFT with total 0 (set properly after the lines);
  // $12 is used twice (created_at and updated_at get the same time).
  await q(
    `INSERT INTO expenses (id, project_id, number, type, supplier_name, description, invoice_number, purchase_date, total_paisa,
                           from_advance, status, stage_index, created_by, created_at, updated_at, client_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 'DRAFT', $10, $11, $12, $12, $13)`,
    // Values; `?? ''` defaults a missing description to empty, `|| null` stores empty invoice numbers as NULL.
    [id, ctx.project.id, number, input.type, input.supplierName, input.description ?? '', input.invoiceNumber || null,
      input.purchaseDate, usesAdvance(ctx, input), ctx.project.stageIndex, ctx.userId, at, input.clientId ?? null],
  )
  // Write lines and get the real total.
  const total = await writeLines(q, id, lines)
  // Store the total.
  await q('UPDATE expenses SET total_paisa = $2 WHERE id = $1', [id, total])
  // Link the uploaded proof files.
  await attachEvidence(q, ctx, input.evidenceIds, 'EXPENSE', id)
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'expense.created',
    targetType: 'EXPENSE',
    targetId: id,
    summary: `Drafted purchase P-${number}: ${input.supplierName}, ${formatPKR(total)}`,
    payload: { number, type: input.type, totalPaisa: total },
    at: ctx.at,
  })
  // Submit right away if asked (await inside a ternary), else stay DRAFT.
  const status = input.submit ? await submitExpense(q, ctx, id) : 'DRAFT'
  return { id, number, status }
}

/** The purchase, locked for the rest of the transaction, if this person may change it. */
async function lockOwn(q, ctx, id) {
  // FOR UPDATE row-locks the purchase until commit/rollback, so concurrent edits wait.
  const [e] = await q('SELECT * FROM expenses WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, ctx.project.id])
  // Missing: 404.
  if (!e) throw notFound('Purchase not found')
  // Not the author: 403.
  if (e.createdBy !== ctx.userId) throw forbidden('Only the person who entered this purchase can change it')
  return e
}

// Edit a draft or queried purchase (and optionally submit it).
export async function updateExpense(q, ctx, id, input) {
  // Load, lock and check ownership.
  const e = await lockOwn(q, ctx, id)
  // Only DRAFT or QUERIED may be edited.
  if (!['DRAFT', 'QUERIED'].includes(e.status)) throw conflict('Only drafts and queried purchases can be changed', { code: 'WRONG_STATUS' })
  // Validate lines and rewrite them.
  const lines = cleanLines(input.lines)
  const total = await writeLines(q, id, lines)
  // Update the purchase's fields.
  await q(
    `UPDATE expenses SET type = $2, supplier_name = $3, description = $4, invoice_number = $5, purchase_date = $6,
            from_advance = $7, total_paisa = $8, updated_at = $9 WHERE id = $1`,
    [id, input.type, input.supplierName, input.description ?? '', input.invoiceNumber || null, input.purchaseDate, usesAdvance(ctx, input), total, isoAt(ctx.at)],
  )
  // Link any newly uploaded proof.
  await attachEvidence(q, ctx, input.evidenceIds, 'EXPENSE', id)
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'expense.updated',
    targetType: 'EXPENSE',
    targetId: id,
    // Mentions the total change only if the total actually changed (nested template in a ternary).
    summary: `Edited purchase P-${e.number}${e.totalPaisa !== total ? ` (total ${formatPKR(e.totalPaisa)} → ${formatPKR(total)})` : ''}`,
    payload: { totalPaisa: { from: e.totalPaisa, to: total } },
    at: ctx.at,
  })
  // Submit if asked.
  if (input.submit) await submitExpense(q, ctx, id)
}

/**
 * Submit a purchase. Server-side evidence rule: no proof, no submission.
 * The owner is the one who approves, so the owner's own purchases (and every
 * purchase on a self-managed project) are final when submitted; anyone
 * else's go to the owner for approval. Returns the new status.
 */
export async function submitExpense(q, ctx, id) {
  // Load, lock and check ownership.
  const e = await lockOwn(q, ctx, id)
  // Already submitted: 409.
  if (!['DRAFT', 'QUERIED'].includes(e.status)) throw conflict('This purchase has already been submitted', { code: 'ALREADY_SUBMITTED' })
  // Attached files.
  const evidence = await evidenceFor(q, 'EXPENSE', id)
  // Proof still missing for this purchase type.
  const gaps = expenseEvidenceGaps(e.type, evidence.map((v) => v.kind))
  // Any gap: 400 listing them all (mapped to labels, joined with "; ").
  if (gaps.length) {
    throw badRequest(`Evidence missing: ${gaps.map((g) => GAP_LABELS[g].toLowerCase()).join('; ')}`, { code: 'EVIDENCE_REQUIRED', details: { gaps } })
  }
  // The status transition, then the checks and the audit line that explains it.
  // Final (no approval needed) for the owner or projects without approvals.
  const final = ctx.role === 'OWNER' || !featuresFor(ctx.project.contractType).approvals
  // New status.
  const status = final ? 'APPROVED' : 'SUBMITTED'
  // Answering a query counts as a resubmission.
  const resubmit = e.status === 'QUERIED'
  // Timestamp.
  const at = isoAt(ctx.at)
  // UPDATE status and times; when final also set decided_at (fragment added by a ternary).
  await q(`UPDATE expenses SET status = $3, submitted_at = $2, updated_at = $2${final ? ', decided_at = $2' : ''} WHERE id = $1`, [id, at, status])
  // Run the automatic checks with the updated status ({ ...e, status } copies e with a new status).
  await runRules(q, ctx, { ...e, status }, evidence)
  // Reused text "Supplier, Rs 1,000".
  const amount = `${e.supplierName}, ${formatPKR(e.totalPaisa)}`
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    // Chained ternary picks the event name.
    action: final ? 'expense.recorded' : resubmit ? 'expense.resubmitted' : 'expense.submitted',
    targetType: 'EXPENSE',
    targetId: id,
    summary: final ? `Recorded purchase P-${e.number}: ${amount}` : `${resubmit ? 'Resubmitted' : 'Submitted'} purchase P-${e.number} for approval: ${amount}`,
    // Includes each file's kind, fingerprint and capture mode (map to small objects; note the ( ) around the object literal).
    payload: { totalPaisa: e.totalPaisa, final, evidence: evidence.map((v) => ({ kind: v.kind, sha256: v.sha256, captureMode: v.captureMode })) },
    at: ctx.at,
  })
  // Needs approval: tell the owner(s).
  if (!final) {
    await notify(q, {
      userIds: await membersWithRoles(q, ctx.project.id, ['OWNER']),
      projectId: ctx.project.id,
      title: `Purchase P-${e.number} needs your approval`,
      body: `${e.supplierName} · ${formatPKR(e.totalPaisa)} · ${EXPENSE_TYPES[e.type]}`,
      link: `/p/${ctx.project.id}/approvals?review=EXPENSE:${id}`,
      at: ctx.at,
      // Don't notify the submitter.
      exclude: ctx.userId,
    })
  }
  // Spending changed: re-check the budget alert.
  await checkBudget(q, ctx)
  return status
}

/**
 * Deterministic checks. They describe inconsistencies for the owner to look
 * at; they never accuse anyone. Rules: DUPLICATE_INVOICE, PRICE_ABOVE_ESTIMATE
 * (>15% over the BOQ rate; HIGH above 30%), OVER_ESTIMATE_QUANTITY (>10% over
 * the planned quantity, cumulative), REUSED_FILE (same sha256 on another
 * record), OFF_SITE_PHOTO (delivery photo beyond DELIVERY_RADIUS_M) and
 * LATE_ENTRY (>14 days after the purchase date). A rule already open on
 * the purchase is not raised twice, so a resubmit doesn't pile up findings.
 */
async function runRules(q, ctx, e, evidence) {
  // Findings collected before saving.
  const findings = []
  // Duplicate invoice check (only if there is an invoice number).
  if (e.invoiceNumber) {
    // Another non-draft, non-rejected purchase in this project with the same
    // supplier and invoice number, compared case-insensitively with lower().
    const [dup] = await q(
      `SELECT number FROM expenses WHERE project_id = $1 AND id <> $2 AND lower(supplier_name) = lower($3)
          AND lower(invoice_number) = lower($4) AND status NOT IN ('DRAFT', 'REJECTED') LIMIT 1`,
      [ctx.project.id, e.id, e.supplierName, e.invoiceNumber],
    )
    // Found: add a HIGH finding (object literal pushed onto the array).
    if (dup) findings.push({ rule: 'DUPLICATE_INVOICE', severity: 'HIGH', message: `Invoice ${e.invoiceNumber} from ${e.supplierName} was also used on purchase P-${dup.number}.` })
  }
  // This purchase's lines with their BOQ expectations, plus bought_qty: a
  // subquery summing the quantity bought so far on that BOQ item across all
  // counted purchases (JOIN expense_lines l2 to expenses e2 for the status).
  const lines = await q(
    `SELECT l.*, b.est_unit_paisa, b.est_qty, b.unit AS boq_unit, b.description AS boq_description,
            (SELECT COALESCE(sum(l2.qty), 0) FROM expense_lines l2 JOIN expenses e2 ON e2.id = l2.expense_id
              WHERE l2.boq_item_id = l.boq_item_id AND e2.status IN ${COUNTED}) AS bought_qty
       FROM expense_lines l LEFT JOIN boq_items b ON b.id = l.boq_item_id WHERE l.expense_id = $1`,
    [e.id],
  )
  for (const l of lines) {
    // Lines without a BOQ item can't be compared: skip to the next one.
    if (!l.boqItemId) continue
    // Items without an expected price or a planned quantity are not compared.
    // Ratio of paid price to expected price (0 when no expected price).
    const ratio = l.estUnitPaisa > 0 ? l.unitPaisa / l.estUnitPaisa : 0
    // More than 15% above expected.
    if (ratio > 1.15) {
      findings.push({
        rule: 'PRICE_ABOVE_ESTIMATE',
        // Over 30% is HIGH.
        severity: ratio > 1.3 ? 'HIGH' : 'MEDIUM',
        message: `${l.description}: paid ${formatPKR(l.unitPaisa)} per ${l.unit}, ${pct(ratio - 1)} above the expected price of ${formatPKR(l.estUnitPaisa)}.`,
      })
    }
    // Total bought so far is more than 10% over the plan.
    if (l.estQty > 0 && l.boughtQty > l.estQty * 1.1) {
      findings.push({
        rule: 'OVER_ESTIMATE_QUANTITY',
        severity: 'MEDIUM',
        // toLocaleString('en-PK') formats numbers with thousands separators.
        message: `${l.boqDescription}: ${Math.round(l.boughtQty).toLocaleString('en-PK')} ${l.boqUnit} bought so far, ${pct(l.boughtQty / l.estQty - 1)} more than the ${Math.round(l.estQty).toLocaleString('en-PK')} planned.`,
      })
    }
  }
  // Files identical to ones on other records.
  const reused = await reusedFiles(q, ctx.project.id, evidence, 'EXPENSE', e.id)
  for (const ev of reused) {
    findings.push({ rule: 'REUSED_FILE', severity: 'HIGH', message: `"${ev.fileName}" is identical to a file already attached to another record.` })
  }
  // Delivery photos only (.filter keeps matching elements).
  for (const ev of evidence.filter((v) => v.kind === 'DELIVERY_PHOTO')) {
    // Not clearly off-site: skip.
    if (locationStatus(ev, ctx.project, DELIVERY_RADIUS_M) !== 'OFF_SITE') continue
    findings.push({
      rule: 'OFF_SITE_PHOTO',
      severity: 'MEDIUM',
      message: `The delivery photo "${ev.fileName}" was taken about ${formatDistance(ev.distanceM)} from the site pin.`,
    })
  }
  // Days between purchase date and now: subtracting two Dates gives milliseconds; divide by ms per day.
  const ageDays = (new Date(isoAt(ctx.at)) - new Date(`${e.purchaseDate}T00:00:00Z`)) / 86400000
  // Entered more than two weeks late.
  if (ageDays > 14) {
    findings.push({ rule: 'LATE_ENTRY', severity: 'LOW', message: `Entered ${Math.floor(ageDays)} days after the purchase date.` })
  }
  // Save each finding unless the same rule is already open on this purchase.
  for (const f of findings) {
    const [exists] = await q("SELECT 1 FROM findings WHERE target_type = 'EXPENSE' AND target_id = $1 AND rule = $2 AND status = 'OPEN'", [e.id, f.rule])
    // Already open: skip.
    if (exists) continue
    // INSERT the finding (target_type fixed to 'EXPENSE' in the SQL).
    await q(
      `INSERT INTO findings (id, project_id, target_type, target_id, rule, severity, message, created_at)
       VALUES ($1, $2, 'EXPENSE', $3, $4, $5, $6, $7)`,
      [newId(), ctx.project.id, e.id, f.rule, f.severity, f.message, isoAt(ctx.at)],
    )
  }
  // One audit line summarising what was flagged.
  if (findings.length) {
    await audit(q, {
      projectId: ctx.project.id,
      // null actor = the system did it.
      actorId: null,
      action: 'rules.flagged',
      targetType: 'EXPENSE',
      targetId: e.id,
      // Rule names made readable: lower-case and replaceAll('_', ' ').
      summary: `Automatic checks flagged purchase P-${e.number}: ${findings.map((f) => f.rule.toLowerCase().replaceAll('_', ' ')).join(', ')}`,
      payload: { rules: findings.map((f) => f.rule) },
      at: ctx.at,
    })
  }
}

/** Automatic-check flags across the project, newest and most serious first. */
export async function listFindings(q, ctx, { status } = {}) {
  // SQL: findings with details of the record they're about (a purchase via one
  // LEFT JOIN, a daily report via another — each only matches its target_type)
  // and who dismissed them. The optional status filter is added by a ternary.
  // ORDER BY: open first (CASE → 0/1), then HIGH/MEDIUM/LOW, then newest; at most 200.
  return q(
    `SELECT f.*, e.number AS expense_number, e.supplier_name, e.total_paisa, r.report_date, u.name AS dismissed_by_name
       FROM findings f
       LEFT JOIN expenses e ON f.target_type = 'EXPENSE' AND e.id = f.target_id
       LEFT JOIN daily_reports r ON f.target_type = 'REPORT' AND r.id = f.target_id
       LEFT JOIN users u ON u.id = f.dismissed_by
      WHERE f.project_id = $1 ${status ? 'AND f.status = $2' : ''}
      ORDER BY CASE f.status WHEN 'OPEN' THEN 0 ELSE 1 END, CASE f.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, f.created_at DESC
      LIMIT 200`,
    // Two parameters when filtering, else one.
    status ? [ctx.project.id, status] : [ctx.project.id],
  )
}

// The owner dismisses a flag with a note.
export async function dismissFinding(q, ctx, id, note) {
  // UPDATE only an OPEN finding in this project; RETURNING * hands back the updated row.
  const [f] = await q(
    "UPDATE findings SET status = 'DISMISSED', dismissed_by = $3, dismiss_note = $4 WHERE id = $1 AND project_id = $2 AND status = 'OPEN' RETURNING *",
    [id, ctx.project.id, ctx.userId, note],
  )
  // No row changed: 404.
  if (!f) throw notFound('Finding not found')
  // Audit line against the record the finding was about.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'finding.dismissed',
    targetType: f.targetType,
    targetId: f.targetId,
    summary: `Dismissed a flag (${f.rule.toLowerCase().replaceAll('_', ' ')}): ${note}`,
    at: ctx.at,
  })
}
