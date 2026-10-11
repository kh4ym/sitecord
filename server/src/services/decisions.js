// FILE: server/src/services/decisions.js
//
// WHAT IT DOES
// Approve, reject, ask a question, or verify on site — for purchases, change
// requests, payment milestones and daily reports. Every decision is logged,
// audited and sent to the person who submitted the record. One entry point,
// decide(), handles all four record types; which transitions are legal from
// which status is the DECISION_RULES table in shared/records.js, shared with
// the client so buttons match what the server accepts.
//
// WHY IT EXISTS
// Decisions are where money is released, so every rule lives in one place:
// legal status transitions, who may decide, separation of duties (you never
// approve your own submission), and photo proof for on-site verification.
//
// WHO USES IT
// routes/projects.js (POST /decisions), expenses.js (decisionsFor, to show a
// purchase's history) and the demo seed.
//
// WHAT IT DEPENDS ON
// shared/ features, geo, money and records modules; audit; error helpers;
// lib/util.js; budget.js (checkBudget), evidence.js (photo files),
// notify.js and questions.js (a QUERY opens a question thread).
//
// Every service takes (q, ctx, ...): q runs SQL in the current transaction
// and resolves to camelCased rows; ctx is who is acting and on which project.

// ES module named imports (`import { x } from 'file'`).
// Which features a contract type uses.
import { featuresFor } from '../../../shared/features.js'
// Distance text, photo location classification, and the verify radius in metres.
import { formatDistance, locationStatus, VERIFY_RADIUS_M } from '../../../shared/geo.js'
// Money formatting.
import { formatPKR } from '../../../shared/money.js'
// Table of legal decisions per record type and status.
import { DECISION_RULES } from '../../../shared/records.js'
// Audit trail writer.
import { audit } from '../audit/audit.js'
// HTTP error builders.
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
// ISO timestamps and new ids.
import { isoAt, newId } from '../lib/util.js'
// Re-checks the budget alert after spending changes.
import { checkBudget } from './budget.js'
// Attach a file to a record; load one evidence row.
import { attachEvidence, getEvidence } from './evidence.js'
// In-app notifications.
import { notify } from './notify.js'
// Opens a question thread (used for QUERY).
import { createQuestion } from './questions.js'

// Decision → status the record moves to, and the table that holds it.
// VERB: past-tense wording for audit lines and notifications (object literal: key: value).
const VERB = { APPROVE: 'Approved', REJECT: 'Rejected', QUERY: 'Asked a question about', VERIFY: 'Verified on site' }
// NEXT: the status a record gets after each decision.
const NEXT = { APPROVE: 'APPROVED', REJECT: 'REJECTED', QUERY: 'QUERIED', VERIFY: 'VERIFIED' }
// TABLE: which database table stores each record type.
const TABLE = { EXPENSE: 'expenses', CHANGE: 'change_requests', MILESTONE: 'milestones', REPORT: 'daily_reports' }

/** The decisions made on one record, with the photo (if any) each was made with. */
// `export async function` = importable, Promise-returning function.
export async function decisionsFor(q, targetType, targetId) {
  // SQL:
  //   SELECT d.id, ... u.name AS decided_by_name — each decision and its decider's name.
  //   v.id AS evidence_id, v.lat ... — fields of the attached photo, if any.
  //   FROM decisions d JOIN users u ON u.id = d.decided_by — pair decision with user.
  //   LEFT JOIN LATERAL (SELECT ... WHERE decision_id = d.id LIMIT 1) v ON true —
  //     LATERAL lets the subquery refer to d from the outer row; for each decision
  //     it fetches at most one evidence row. LEFT ... ON true keeps decisions without a photo.
  //   WHERE d.target_type = $1 AND d.target_id = $2 — just this record; oldest first.
  return q(
    `SELECT d.id, d.decision, d.note, d.live_photo, d.created_at, d.decided_by, u.name AS decided_by_name,
            v.id AS evidence_id, v.lat, v.lng, v.accuracy_m, v.distance_m
       FROM decisions d JOIN users u ON u.id = d.decided_by
       LEFT JOIN LATERAL (SELECT id, lat, lng, accuracy_m, distance_m FROM evidence WHERE decision_id = d.id LIMIT 1) v ON true
      WHERE d.target_type = $1 AND d.target_id = $2 ORDER BY d.created_at`,
    [targetType, targetId],
  )
}

/**
 * The record being decided, locked for the rest of the transaction (FOR
 * UPDATE), normalised to the few fields decide() needs: status, who owns it
 * (gets the notification), a label for the audit line and an amount.
 */
// Not exported: a private helper of this file.
async function loadTarget(q, ctx, targetType, targetId) {
  // Short name for the project id.
  const pid = ctx.project.id
  // Purchases.
  if (targetType === 'EXPENSE') {
    // Load the purchase row and lock it (FOR UPDATE) until the transaction ends;
    // `const [r]` takes the first row via array destructuring.
    const [r] = await q('SELECT id, number, status, created_by, supplier_name, total_paisa FROM expenses WHERE id = $1 AND project_id = $2 FOR UPDATE', [targetId, pid])
    // `r && {...}`: if r is missing (undefined) return it as-is; otherwise build
    // a new object: spread `...r` copies its fields, then add the normalised ones.
    return r && { ...r, noun: 'purchase', label: `purchase P-${r.number}`, title: `Purchase P-${r.number}`, href: `/p/${pid}/purchases/${r.id}`, ownerId: r.createdBy, amount: r.totalPaisa }
  }
  // Change requests.
  if (targetType === 'CHANGE') {
    // Load and lock the change request.
    const [r] = await q('SELECT id, number, status, created_by, title, cost_impact_paisa FROM change_requests WHERE id = $1 AND project_id = $2 FOR UPDATE', [targetId, pid])
    // Normalised form; the amount is the change's cost impact.
    return r && { ...r, noun: 'change request', label: `change request C-${r.number}`, title: `Change request C-${r.number}`, href: `/p/${pid}/changes/${r.id}`, ownerId: r.createdBy, amount: r.costImpactPaisa }
  }
  // Payment milestones.
  if (targetType === 'MILESTONE') {
    // Load and lock the milestone.
    const [r] = await q('SELECT id, name, status, amount_paisa, stage_index FROM milestones WHERE id = $1 AND project_id = $2 FOR UPDATE', [targetId, pid])
    // Milestones have no creator column; the active contractor "owns" them and gets notified.
    const [contractor] = await q("SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'CONTRACTOR' AND removed_at IS NULL LIMIT 1", [pid])
    // `contractor?.userId` is optional chaining: undefined if there is no contractor.
    return r && { ...r, noun: 'milestone', label: `the milestone "${r.name}"`, title: r.name, href: `/p/${pid}/payments`, ownerId: contractor?.userId, amount: r.amountPaisa }
  }
  // Daily reports.
  if (targetType === 'REPORT') {
    // Load and lock the report.
    const [r] = await q('SELECT id, report_date, status, author_id FROM daily_reports WHERE id = $1 AND project_id = $2 FOR UPDATE', [targetId, pid])
    // Reports have author_id instead of created_by, so map it to both ownerId and createdBy.
    return r && { ...r, noun: 'report', label: `the daily report for ${r.reportDate}`, title: `Daily report, ${r.reportDate}`, href: `/p/${pid}/reports/${r.id}`, ownerId: r.authorId, createdBy: r.authorId }
  }
  // Unknown type.
  return null
}

// The single entry point for all decisions. The third parameter is destructured
// from the request body: { targetType, targetId, decision, note, evidenceId }.
export async function decide(q, ctx, { targetType, targetId, decision, note, evidenceId }) {
  // Load and lock the record.
  const target = await loadTarget(q, ctx, targetType, targetId)
  // Missing: 404.
  if (!target) throw notFound('Record not found')
  // Look up the list of statuses this decision is legal from.
  // `?.[decision]` is optional chaining with bracket access: undefined if the
  // type has no rules, instead of crashing.
  const allowed = DECISION_RULES[targetType]?.[decision]
  // No rule at all for this pair: 400.
  if (!allowed) throw badRequest(`${decision.toLowerCase()} doesn't apply to this kind of record`)
  // Rule exists but the record's current status isn't one of the allowed ones: 409.
  if (!allowed.includes(target.status)) {
    // throw ends the function; the transaction is rolled back by the caller.
    throw conflict(`This ${target.noun} is ${target.status.toLowerCase()} and can't be ${NEXT[decision].toLowerCase()} now`, { code: 'WRONG_STATUS' })
  }

  // What this person may see at all, and what this kind of project uses.
  const features = featuresFor(ctx.project.contractType)
  // Purchases need money visibility; forbidden() with no message = generic 403.
  if (targetType === 'EXPENSE' && !ctx.can('viewMoney')) throw forbidden()
  // Reports need report visibility.
  if (targetType === 'REPORT' && !ctx.can('viewReports')) throw forbidden()
  // Changes/milestones only on contract types that use them (parentheses group the && pairs, joined by ||).
  if ((targetType === 'CHANGE' && !features.changes) || (targetType === 'MILESTONE' && !features.milestones)) {
    throw badRequest("This project doesn't use these")
  }
  // Queries open question threads, so questions must be enabled.
  if (decision === 'QUERY' && !features.questions) throw badRequest("This project doesn't use questions")

  // Who may decide what.
  // if / else if / else chain: exactly one branch runs.
  if (decision === 'VERIFY') {
    // Verifying needs the 'verify' permission.
    if (!ctx.can('verify')) throw forbidden('Only the owner, local representative or inspector can verify')
  } else if (decision === 'QUERY' && targetType === 'REPORT') {
    // Questioning a report needs 'raiseQuestion'.
    if (!ctx.can('raiseQuestion')) throw forbidden()
  } else if (!ctx.can('decide')) {
    // Everything else (approve/reject/query money records) needs 'decide'.
    throw forbidden('Only the owner can approve or reject')
  }
  // Separation of duties: the person who submits is never the one who approves.
  // (Self-managed projects are exempt: the owner is the only person.)
  if (decision === 'APPROVE' && target.createdBy === ctx.userId && ctx.project.contractType !== 'SELF_MANAGED') {
    throw forbidden("You can't approve something you submitted yourself")
  }
  // Reject and query must say why; `!note?.trim()` is true for missing, empty or whitespace-only notes.
  if ((decision === 'REJECT' || decision === 'QUERY') && !note?.trim()) throw badRequest('Add a short note explaining why')

  // On-site verification needs a photo; a live camera capture is the strong
  // form, and a photo clearly taken away from the site pin doesn't count.
  // `let` = reassignable variables, filled in only for VERIFY.
  let livePhoto = null
  let where = null
  if (decision === 'VERIFY') {
    // A photo id is required.
    if (!evidenceId) throw badRequest('Take a photo at the site to verify')
    // Load it (404s if it isn't in this project).
    const ev = await getEvidence(q, ctx.project.id, evidenceId)
    // Must be a site photo, not e.g. a receipt.
    if (ev.kind !== 'PHOTO') throw badRequest('Verification needs a site photo')
    // true if taken with the in-app camera (not picked from the gallery).
    livePhoto = ev.captureMode === 'IN_APP_CAMERA'
    // Classify the photo position: 'ON_SITE', 'OFF_SITE', 'NO_PIN' or unknown.
    where = locationStatus(ev, ctx.project, VERIFY_RADIUS_M)
    // Clearly off-site: refuse, with the distance in `details` for the client.
    if (where === 'OFF_SITE') {
      throw badRequest(`This photo was taken about ${formatDistance(ev.distanceM)} from the site pin. Verify from the site, or ask the owner to check the pin.`, {
        code: 'OFF_SITE',
        details: { distanceM: ev.distanceM, accuracyM: ev.accuracyM },
      })
    }
    // Turn the classification into words for the audit line.
    if (where === 'ON_SITE') where = `${formatDistance(ev.distanceM)} from the site pin`
    // Otherwise: no pin set, or no usable GPS (ternary picks the wording).
    else where = where === 'NO_PIN' ? 'site not pinned' : 'location unknown'
  }

  // New decision id and timestamp.
  const id = newId()
  const at = isoAt(ctx.at)
  // INSERT the decision row (9 placeholders, values in the same order).
  await q(
    `INSERT INTO decisions (id, project_id, target_type, target_id, decision, note, live_photo, decided_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    // The note is trimmed, or NULL when empty (`|| null`).
    [id, ctx.project.id, targetType, targetId, decision, note?.trim() || null, livePhoto, ctx.userId, at],
  )
  // Link the verification photo to this decision.
  if (decision === 'VERIFY') await attachEvidence(q, ctx, [evidenceId], 'DECISION', id)

  // Reports have no decided_at column; VERIFY is a check, not a decision.
  // The record's new status.
  const status = NEXT[decision]
  // Extra SQL fragment to also set decided_at, or '' when not applicable.
  const decided = ['EXPENSE', 'CHANGE', 'MILESTONE'].includes(targetType) && decision !== 'VERIFY' ? ', decided_at = $3' : ''
  // UPDATE the right table (spliced in from TABLE, a fixed list, never user input);
  // the values array has a third entry only when the decided_at fragment uses $3.
  await q(`UPDATE ${TABLE[targetType]} SET status = $2${decided} WHERE id = $1`, decided ? [targetId, status, at] : [targetId, status])

  // The budget is the owner's own number: approved changes are shown next to
  // it, never added to it, so going over budget stays visible.
  // " (Rs 12,000)" when the record has an amount, else ''.
  const amount = target.amount ? ` (${formatPKR(target.amount)})` : ''
  // " with a live photo (12 m from the site pin)" for VERIFY, else ''.
  const how = decision === 'VERIFY' ? ` with a ${livePhoto ? 'live' : 'gallery'} photo (${where})` : ''
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    // e.g. 'decision.approve'.
    action: `decision.${decision.toLowerCase()}`,
    // Shorthand properties: same as targetType: targetType, targetId: targetId.
    targetType,
    targetId,
    // Built from several pieces; the note is quoted only if present.
    summary: `${VERB[decision]} ${target.label}${amount}${note?.trim() ? ` — "${note.trim()}"` : ''}${how}`,
    // Structured data: the transition and verification details.
    payload: { decision, decisionId: id, fromStatus: target.status, toStatus: status, livePhoto, where },
    at: ctx.at,
  })
  // Purchase decisions change approved spend: re-check the budget alert.
  if (targetType === 'EXPENSE') await checkBudget(q, ctx)

  // A query opens a question thread on the record (which notifies its owner
  // itself); every other decision notifies the owner of the record directly.
  if (decision === 'QUERY') {
    // The note is the question body (it is guaranteed non-empty by the check above).
    await createQuestion(q, ctx, { title: `About ${target.label}`, body: note.trim(), targetType, targetId })
  } else {
    await notify(q, {
      // The record's owner.
      userIds: [target.ownerId],
      projectId: ctx.project.id,
      // e.g. "Purchase P-4 approved".
      title: `${target.title} ${status.toLowerCase()}`,
      // The note, or "Approved by Name".
      body: note?.trim() || `${VERB[decision]} by ${ctx.userName}`,
      link: target.href,
      at: ctx.at,
      // Don't notify the decider themselves.
      exclude: ctx.userId,
    })
  }
  // The route returns the decision id and the record's new status.
  return { id, status }
}
