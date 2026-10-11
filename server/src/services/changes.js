// Change requests (C-1, C-2, ...): the contractor proposes work outside the
// agreed scope with a cost and time impact; the owner approves, rejects or
// queries it through decisions.js. Approved cost impacts are shown beside
// the budget, never added to it. Status: SUBMITTED → APPROVED | REJECTED |
// QUERIED, and QUERIED → SUBMITTED again via resubmitChange.
//
// What this file does: list change requests, fetch one with its files,
// decisions and questions, create a new one (with audit + owner notification)
// and resubmit a queried one. Used by routes/projects.js and the demo seed.
// Depends on: shared/money.js (formatting rupees), audit/audit.js, lib/errors.js,
// lib/util.js, decisions.js, evidence.js and notify.js.
// `q` runs SQL in the current transaction (rows come back camelCase);
// `ctx` holds the project, the user id and the request time.

// Named import of the rupee formatter shared with the client.
import { formatPKR } from '../../../shared/money.js'
// Audit log writer.
import { audit } from '../audit/audit.js'
// HTTP error builders: 409 conflict, 403 forbidden, 404 not found.
import { conflict, forbidden, notFound } from '../lib/errors.js'
// Timestamp formatter, id generator, and "next number in this project" helper.
import { isoAt, newId, nextNumber } from '../lib/util.js'
// Loads the owner decisions recorded on a record.
import { decisionsFor } from './decisions.js'
// Link uploaded files to a record / load a record's files.
import { attachEvidence, evidenceFor } from './evidence.js'
// Find members by role / send in-app notifications.
import { membersWithRoles, notify } from './notify.js'

// List every change request of the project.
export async function listChanges(q, ctx) {
  // Template-literal SQL: all change columns (`c.*`), the creator's name, and
  // a subquery `(SELECT count(*) ...)` counting attached files per change.
  // JOIN users links each change to its creator; newest first.
  return q(
    `SELECT c.*, u.name AS created_by_name,
            (SELECT count(*)::int FROM evidence v WHERE v.change_id = c.id) AS evidence_count
       FROM change_requests c JOIN users u ON u.id = c.created_by
      WHERE c.project_id = $1 ORDER BY c.created_at DESC`,
    [ctx.project.id],
  )
}

// Fetch one change request with its related data.
export async function getChange(q, ctx, id) {
  // Array destructuring `const [c] = rows` takes the first row (or undefined).
  // The project_id check ($2) stops reading another project's change by id.
  const [c] = await q(
    'SELECT c.*, u.name AS created_by_name FROM change_requests c JOIN users u ON u.id = c.created_by WHERE c.id = $1 AND c.project_id = $2',
    [id, ctx.project.id],
  )
  // `throw` stops here and the router answers 404.
  if (!c) throw notFound('Change request not found')
  // `Promise.all([...])` runs the three queries at the same time and waits for
  // all; the results array is destructured into three variables in order.
  const [evidence, decisions, questions] = await Promise.all([
    evidenceFor(q, 'CHANGE', id), // attached files
    decisionsFor(q, 'CHANGE', id), // owner decisions
    // Questions raised about this change.
    q(`SELECT id, number, title, status FROM questions WHERE target_type = 'CHANGE' AND target_id = $1`, [id]),
  ])
  // New object: all change fields (spread `...c`) plus the three lists.
  return { ...c, evidence, decisions, questions }
}

// Create a change request from the validated request body `input`.
export async function createChange(q, ctx, input) {
  const id = newId() // new unique id
  // Next per-project number (C-1, C-2, ...).
  const number = await nextNumber(q, 'change_requests', ctx.project.id)
  // Cost in paisa (1/100 rupee); `?? 0` defaults a missing value to 0.
  const cost = input.costImpactPaisa ?? 0
  // Extra days; default 0.
  const days = input.daysImpact ?? 0
  // Insert the row; ten $n placeholders matching ten values. `input.reason ||
  // null` uses null when reason is empty ('' is falsy, so `||` picks null).
  await q(
    `INSERT INTO change_requests (id, project_id, number, title, description, reason, cost_impact_paisa, days_impact, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, ctx.project.id, number, input.title, input.description, input.reason || null, cost, days, ctx.userId, isoAt(ctx.at)],
  )
  // Link the uploaded supporting files to this change.
  await attachEvidence(q, ctx, input.evidenceIds, 'CHANGE', id)
  // Audit log entry.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'change.submitted',
    targetType: 'CHANGE',
    targetId: id,
    // `{ sign: true }` asks formatPKR to show "+" or "-" in front of the amount.
    summary: `Requested change C-${number}: ${input.title} (${formatPKR(cost, { sign: true })}, ${days} days)`,
    payload: { number, costImpactPaisa: cost, daysImpact: days },
    at: ctx.at,
  })
  // Notify the owners. `await` inside the object literal waits for the list
  // of owner ids before building the object.
  await notify(q, {
    userIds: await membersWithRoles(q, ctx.project.id, ['OWNER']),
    projectId: ctx.project.id,
    title: `Change request C-${number}: ${input.title}`,
    body: `${formatPKR(cost, { sign: true })} · ${days} days`,
    link: `/p/${ctx.project.id}/changes/${id}`, // client URL to open it
    at: ctx.at,
  })
  // Give the caller the new id and number.
  return { id, number }
}

/** After answering the owner's question, the contractor sends it back for a decision. */
export async function resubmitChange(q, ctx, id) {
  // `FOR UPDATE` locks the selected row until the transaction ends, so two
  // simultaneous requests cannot both change it.
  const [c] = await q('SELECT * FROM change_requests WHERE id = $1 AND project_id = $2 FOR UPDATE', [id, ctx.project.id])
  if (!c) throw notFound('Change request not found') // 404
  // Only the person who created it may resubmit (403 otherwise).
  if (c.createdBy !== ctx.userId) throw forbidden()
  // Only QUERIED requests can go back; the second argument adds a machine code.
  if (c.status !== 'QUERIED') throw conflict('Only queried change requests can be resubmitted', { code: 'WRONG_STATUS' })
  // Set the status back to SUBMITTED. Double quotes are used for the JS string
  // because the SQL inside contains single quotes.
  await q("UPDATE change_requests SET status = 'SUBMITTED' WHERE id = $1", [id])
  // Audit entry on one line.
  await audit(q, { projectId: ctx.project.id, actorId: ctx.userId, action: 'change.resubmitted', targetType: 'CHANGE', targetId: id, summary: `Resubmitted change request C-${c.number}`, at: ctx.at })
}
