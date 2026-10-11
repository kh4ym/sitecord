// FILE: server/src/services/payments.js
//
// WHAT IT DOES
// Money from the owner to the contractor: advances, milestone releases and
// other payments, plus the milestone request flow. Milestone status:
// PLANNED → REQUESTED (contractor, once the stage is done) → APPROVED |
// REJECTED (owner, via decisions.js) → PAID (when a payment references it).
// The payee confirms receipt. Not available on self-managed projects, which
// record spending as purchases only.
//
// WHY IT EXISTS
// Payments are the other half of the money picture (purchases are in
// expenses.js). Keeping them here means one place enforces "proof required",
// "only approved milestones can be paid" and "only the payee confirms".
//
// WHO USES IT
// routes/projects.js, dashboard.js (paymentSummary, milestoneDue) and the seed.
//
// WHAT IT DEPENDS ON
// shared/features.js (does this contract type use payments/milestones),
// shared/money.js (formatting), shared/records.js (labels, evidence rules),
// audit, error helpers, lib/util.js, evidence.js and notify.js.
//
// Every service takes (q, ctx, ...): q runs SQL inside the current
// transaction and returns rows (camelCased), ctx says who is acting.

// ES module named imports: `import { name } from 'path'`.
// featuresFor(contractType) returns which features a contract type has.
import { featuresFor } from '../../../shared/features.js'
// formatPKR(paisa) turns an integer amount in paisa into "Rs 1,234" style text.
import { formatPKR } from '../../../shared/money.js'
// Status list, payment type labels, the evidence-gap check and gap labels.
import { COUNTED_EXPENSE_STATUSES, PAYMENT_TYPES, paymentEvidenceGaps, GAP_LABELS } from '../../../shared/records.js'
// Writes audit-trail lines.
import { audit } from '../audit/audit.js'
// Error builders for 400 / 409 / 403 / 404 responses.
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
// Timestamp formatting, new ids, and per-project sequential numbers.
import { isoAt, newId, nextNumber } from '../lib/util.js'
// Attach uploaded files to a record; list files on a record.
import { attachEvidence, evidenceFor } from './evidence.js'
// Find members by role; send in-app notifications.
import { membersWithRoles, notify } from './notify.js'

// Builds the SQL text "('APPROVED', 'VERIFIED')" from the status list:
// .map turns each status s into a quoted string (arrow fn + template literal),
// .join(', ') glues them with commas, and the outer template adds parentheses.
const COUNTED = `(${COUNTED_EXPENSE_STATUSES.map((s) => `'${s}'`).join(', ')})`

/** Totals for the dashboard: paid, advance given, advance drawn down by purchases, unconfirmed. */
// `export async function` = an importable function that returns a Promise.
export async function paymentSummary(q, projectId) {
  // `const [s] = await q(...)` takes the single result row (array destructuring).
  // SQL: aggregate all of this project's payments in one row:
  //   sum(amount_paisa) — total paid; COALESCE(x, 0) turns NULL (no rows) into 0.
  //   sum(...) FILTER (WHERE type = 'ADVANCE') — sum only advance payments.
  //   FILTER (WHERE confirmed_at IS NULL) — sum only not-yet-confirmed payments.
  const [s] = await q(
    `SELECT COALESCE(sum(amount_paisa), 0) AS paid,
            COALESCE(sum(amount_paisa) FILTER (WHERE type = 'ADVANCE'), 0) AS advance_given,
            COALESCE(sum(amount_paisa) FILTER (WHERE confirmed_at IS NULL), 0) AS unconfirmed
       FROM payments WHERE project_id = $1`,
    // $1 is filled with projectId.
    [projectId],
  )
  // Advances are drawn down by purchases the contractor paid from the advance.
  // SQL: total of counted purchases flagged from_advance (a boolean column used directly as a condition);
  // `status IN (...)` splices in the COUNTED list built above.
  const [used] = await q(`SELECT COALESCE(sum(total_paisa), 0) AS used FROM expenses WHERE project_id = $1 AND from_advance AND status IN ${COUNTED}`, [projectId])
  // Spread `...s` copies all of s's properties into the new object, then two computed fields are added.
  return { ...s, advanceUsed: used.used, advanceBalance: s.advanceGiven - used.used }
}

// All payments and milestones for the payments page.
export async function listPayments(q, ctx) {
  // SQL:
  //   SELECT p.*, ... — every payment column plus names from joined tables.
  //   (SELECT count(*)::int FROM evidence v WHERE v.payment_id = p.id) — a
  //     subquery counting attached files per payment; ::int casts to integer.
  //   JOIN users u — who recorded it (always present).
  //   LEFT JOIN milestones m / users cu — optional milestone and confirmer;
  //     LEFT keeps payments that have neither.
  //   ORDER BY p.paid_on DESC, p.number DESC — newest first.
  const payments = await q(
    `SELECT p.*, u.name AS created_by_name, m.name AS milestone_name, cu.name AS confirmed_by_name,
            (SELECT count(*)::int FROM evidence v WHERE v.payment_id = p.id) AS evidence_count
       FROM payments p JOIN users u ON u.id = p.created_by
       LEFT JOIN milestones m ON m.id = p.milestone_id
       LEFT JOIN users cu ON cu.id = p.confirmed_by
      WHERE p.project_id = $1 ORDER BY p.paid_on DESC, p.number DESC`,
    [ctx.project.id],
  )
  // All milestones of the project in their planned order.
  const milestones = await q('SELECT * FROM milestones WHERE project_id = $1 ORDER BY sort', [ctx.project.id])
  // Shorthand properties { payments } = { payments: payments }; summary awaited inline.
  return { payments, milestones, summary: await paymentSummary(q, ctx.project.id) }
}

// One payment with its proof files.
export async function getPayment(q, ctx, id) {
  // SQL: the payment, its recorder's name and its milestone name (if any),
  // only if it belongs to this project ($2) so ids from other projects 404.
  const [p] = await q(
    `SELECT p.*, u.name AS created_by_name, m.name AS milestone_name FROM payments p JOIN users u ON u.id = p.created_by
       LEFT JOIN milestones m ON m.id = p.milestone_id WHERE p.id = $1 AND p.project_id = $2`,
    [id, ctx.project.id],
  )
  // No row: 404.
  if (!p) throw notFound('Payment not found')
  // The payment's fields plus an `evidence` array.
  return { ...p, evidence: await evidenceFor(q, 'PAYMENT', id) }
}

// The owner records a payment (with proof). `input` is the validated request body.
export async function createPayment(q, ctx, input) {
  // Self-managed projects have no payments feature: refuse with 400.
  if (!featuresFor(ctx.project.contractType).payments) throw badRequest('Self-managed projects record spending as purchases, not payments')
  // New row id.
  const id = newId()
  // Next human number for this project's payments (1, 2, 3...).
  const number = await nextNumber(q, 'payments', ctx.project.id)
  // A milestone payment releases an approved milestone. An advance may too
  // (the mobilisation advance), so it still counts towards the advance balance.
  // `let` declares a variable that can be reassigned later (unlike const).
  let milestone = null
  // A MILESTONE-type payment must name its milestone.
  if (input.type === 'MILESTONE' && !input.milestoneId) throw badRequest('Choose the milestone this payment releases')
  // If a milestone was named, load it.
  if (input.milestoneId) {
    // Destructuring assignment into an existing variable: `[milestone] = rows`.
    // The leading `;` protects against the previous line being joined with
    // this `[` (a no-semicolon style safeguard). FOR UPDATE row-locks the
    // milestone so two payments can't release it at once.
    ;[milestone] = await q('SELECT * FROM milestones WHERE id = $1 AND project_id = $2 FOR UPDATE', [input.milestoneId, ctx.project.id])
    // Not found in this project.
    if (!milestone) throw badRequest('That milestone does not exist')
    // Only APPROVED milestones can be paid.
    if (milestone.status !== 'APPROVED') throw conflict('Approve the milestone before paying it', { code: 'WRONG_STATUS' })
  }
  // Start with the free-text payee name from the form.
  let payeeName = input.payeeName
  // If a project member was chosen as payee, use their real name instead.
  if (input.payeeUserId) {
    // SQL: the member's name, only if they are an active member of this project.
    const [m] = await q(
      'SELECT u.name FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.removed_at IS NULL',
      [ctx.project.id, input.payeeUserId],
    )
    // Not a member: 400.
    if (!m) throw badRequest('That person is not a member of this project')
    // Reassign the let variable.
    payeeName = m.name
  }
  // Someone must have been paid.
  if (!payeeName) throw badRequest('Who was paid?')
  // INSERT the payment row with 14 placeholders.
  await q(
    `INSERT INTO payments (id, project_id, number, type, method, payee_name, payee_user_id, amount_paisa, paid_on, reference, note,
                           milestone_id, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    // Values in placeholder order. `?? null` turns undefined into SQL NULL;
    // `|| null` also turns empty strings into NULL; `milestone?.id` is
    // optional chaining (undefined if milestone is null).
    [id, ctx.project.id, number, input.type, input.method, payeeName, input.payeeUserId ?? null, input.amountPaisa, input.paidOn,
      input.reference || null, input.note || null, milestone?.id ?? null, ctx.userId, isoAt(ctx.at)],
  )
  // Proof is checked after the insert so attachEvidence can validate the
  // files against a real row; the throw rolls the whole thing back.
  const evidence = await attachEvidence(q, ctx, input.evidenceIds, 'PAYMENT', id)
  // Which required proof is missing, given the kinds of the attached files (.map extracts e.kind).
  const gaps = paymentEvidenceGaps(evidence.map((e) => e.kind))
  // Any gap: 400 naming the first missing item; `details` carries the full list for the client.
  if (gaps.length) throw badRequest(`Evidence missing: ${GAP_LABELS[gaps[0]].toLowerCase()}`, { code: 'EVIDENCE_REQUIRED', details: { gaps } })
  // Releasing a milestone marks it PAID.
  if (milestone) await q("UPDATE milestones SET status = 'PAID' WHERE id = $1", [milestone.id])
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'payment.recorded',
    targetType: 'PAYMENT',
    targetId: id,
    // Sentence like "Recorded payment 3: Rs 50,000 to Ali (advance, Foundation)"; nested template adds the milestone name only if any.
    summary: `Recorded payment ${number}: ${formatPKR(input.amountPaisa)} to ${payeeName} (${PAYMENT_TYPES[input.type].toLowerCase()}${milestone ? `, ${milestone.name}` : ''})`,
    // Structured data including the sha256 fingerprints of the proof files.
    payload: { amountPaisa: input.amountPaisa, type: input.type, method: input.method, proof: evidence.map((e) => e.sha256) },
    at: ctx.at,
  })
  // If the payee is a member, ask them to confirm receipt.
  if (input.payeeUserId) {
    await notify(q, {
      userIds: [input.payeeUserId],
      projectId: ctx.project.id,
      title: `Payment of ${formatPKR(input.amountPaisa)} recorded`,
      body: 'Please confirm you received it.',
      link: `/p/${ctx.project.id}/payments`,
      at: ctx.at,
    })
  }
  // The route returns these to the client.
  return { id, number }
}

/** The recipient confirms the money arrived. */
export async function confirmPayment(q, ctx, id) {
  // Load and row-lock the payment (FOR UPDATE) so two confirms don't race.
  const [p] = await q('SELECT * FROM payments WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, ctx.project.id])
  // Not found: 404.
  if (!p) throw notFound('Payment not found')
  // Only the payee may confirm: 403 otherwise.
  if (p.payeeUserId !== ctx.userId) throw forbidden('Only the person who was paid can confirm it')
  // Already confirmed: nothing to do (a bare `return` ends the function with undefined).
  if (p.confirmedAt) return
  // Store when and by whom.
  await q('UPDATE payments SET confirmed_at = $2, confirmed_by = $3 WHERE id = $1', [id, isoAt(ctx.at), ctx.userId])
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'payment.confirmed',
    targetType: 'PAYMENT',
    targetId: id,
    summary: `Confirmed receiving payment ${p.number} (${formatPKR(p.amountPaisa)})`,
    at: ctx.at,
  })
  // Tell whoever recorded the payment that it was confirmed.
  await notify(q, { userIds: [p.createdBy], projectId: ctx.project.id, title: `Payment ${p.number} confirmed`, body: `${ctx.userName} confirmed receiving ${formatPKR(p.amountPaisa)}`, link: `/p/${ctx.project.id}/payments`, at: ctx.at })
}

/** Whether the stage a milestone depends on is finished. */
// An exported arrow function returning a boolean. `== null` (loose equality)
// is true for both null and undefined: milestones with no stage are always due.
// Otherwise due when the project is past that stage, or on it at 100%.
export const milestoneDue = (project, m) =>
  m.stageIndex == null || project.stageIndex > m.stageIndex || (project.stageIndex === m.stageIndex && project.stageProgress === 100)

/** Contractor asks for a milestone payment once its stage is complete. */
export async function requestMilestone(q, ctx, id) {
  // Only contract types with milestones.
  if (!featuresFor(ctx.project.contractType).milestones) throw badRequest("This project doesn't have payment milestones")
  // Load and lock the milestone.
  const [m] = await q('SELECT * FROM milestones WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, ctx.project.id])
  // Not found: 404.
  if (!m) throw notFound('Milestone not found')
  // Only from PLANNED or (after a rejection) REJECTED; array literal + .includes.
  if (!['PLANNED', 'REJECTED'].includes(m.status)) throw conflict('This milestone has already been requested', { code: 'WRONG_STATUS' })
  // Short name for the project.
  const p = ctx.project
  // The stage must be finished.
  if (!milestoneDue(p, m)) throw badRequest('Request this payment once the stage is complete')
  // Move it to REQUESTED with a timestamp.
  await q("UPDATE milestones SET status = 'REQUESTED', requested_at = $2 WHERE id = $1", [id, isoAt(ctx.at)])
  // Audit line.
  await audit(q, {
    projectId: p.id,
    actorId: ctx.userId,
    action: 'milestone.requested',
    targetType: 'MILESTONE',
    targetId: id,
    summary: `Requested the milestone payment "${m.name}" (${formatPKR(m.amountPaisa)})`,
    at: ctx.at,
  })
  // Notify the owner(s), linking straight to the review dialog.
  await notify(q, {
    userIds: await membersWithRoles(q, p.id, ['OWNER']),
    projectId: p.id,
    title: `Payment requested: ${m.name}`,
    body: formatPKR(m.amountPaisa),
    link: `/p/${p.id}/approvals?review=MILESTONE:${m.id}`,
    at: ctx.at,
  })
}
