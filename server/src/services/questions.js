// Question threads, general or about one record (purchase, payment, report,
// change). Status: OPEN (waiting on the record's owner or the field team)
// → ANSWERED (someone other than the asker replied) → RESOLVED (asker or
// owner closes it); a reply from the asker reopens it. A QUERY decision in
// decisions.js opens one of these. Used by routes/projects.js, decisions.js
// and the seed.
//
// What this file does: list questions, load one thread with its messages,
// ask a new question, reply to one and resolve one. Each action writes an
// audit entry and notifies the right people.
// Depends on: audit/audit.js, lib/errors.js, lib/util.js and notify.js.
// `q` runs SQL in the current transaction (rows come back camelCase);
// `ctx` holds the project, the user id, the user's role and the request time.

// Audit log writer.
import { audit } from '../audit/audit.js'
// HTTP 409 / 403 / 404 error builders.
import { conflict, forbidden, notFound } from '../lib/errors.js'
// Timestamp formatter, id generator, per-project number counter.
import { isoAt, newId, nextNumber } from '../lib/util.js'
// Member lookup by role and notification sender.
import { membersWithRoles, notify } from './notify.js'

/** Human label, link and who should answer, for whatever a question is about. */
// Private helper (not exported). Returns { label, href, ownerId } or null.
async function targetInfo(q, projectId, targetType, targetId) {
  // A general question has no target.
  if (!targetType) return null
  // Questions about a daily report go to the report's author.
  if (targetType === 'REPORT') {
    // Look up the report in this project; take the first row.
    const [r] = await q('SELECT report_date, author_id FROM daily_reports WHERE id = $1 AND project_id = $2', [targetId, projectId])
    if (!r) throw notFound('Report not found')
    // Template literals build the label and the client link.
    return { label: `Daily report, ${r.reportDate}`, href: `/p/${projectId}/reports/${targetId}`, ownerId: r.authorId }
  }
  if (targetType === 'PAYMENT') {
    // The owner records payments, so questions about one go to whoever was paid.
    const [r] = await q('SELECT number, payee_user_id, created_by FROM payments WHERE id = $1 AND project_id = $2', [targetId, projectId])
    if (!r) throw notFound('Record not found')
    // `??` falls back to the creator when no payee user is set.
    return { label: `Payment ${r.number}`, href: `/p/${projectId}/payments`, ownerId: r.payeeUserId ?? r.createdBy }
  }
  // Remaining types: pick the table name by indexing an object literal.
  const table = { EXPENSE: 'expenses', CHANGE: 'change_requests' }[targetType]
  // The table name is inserted with `${table}`; it comes from the fixed map
  // above (not user text), while the values still use $1/$2 parameters.
  const [r] = await q(`SELECT number, created_by FROM ${table} WHERE id = $1 AND project_id = $2`, [targetId, projectId])
  if (!r) throw notFound('Record not found')
  // Ternary returning one of two objects: purchase or change.
  return targetType === 'EXPENSE'
    ? { label: `Purchase P-${r.number}`, href: `/p/${projectId}/purchases/${targetId}`, ownerId: r.createdBy }
    : { label: `Change C-${r.number}`, href: `/p/${projectId}/changes/${targetId}`, ownerId: r.createdBy }
}

// List questions, optionally only those with one status. The options object
// is destructured and defaults to `{}` when omitted.
export async function listQuestions(q, ctx, { status } = {}) {
  const params = [ctx.project.id] // $1
  // Optional extra condition. `params.push(status)` adds the value and returns
  // the new length (2), giving "$2"; `$$` prints a literal "$" before `${...}`.
  const filter = status ? `AND qq.status = $${params.push(status)}` : ''
  // Each question with its asker's name plus three subqueries: number of
  // messages, the newest message's text and its time (ORDER BY ... DESC LIMIT 1
  // picks the newest). ORDER BY (qq.status = 'RESOLVED') sorts false before
  // true, so open threads come first, then most recently updated.
  const rows = await q(
    `SELECT qq.*, u.name AS created_by_name,
            (SELECT count(*)::int FROM question_messages m WHERE m.question_id = qq.id) AS message_count,
            (SELECT m.body FROM question_messages m WHERE m.question_id = qq.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT m.created_at FROM question_messages m WHERE m.question_id = qq.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
       FROM questions qq JOIN users u ON u.id = qq.created_by
      WHERE qq.project_id = $1 ${filter}
      ORDER BY (qq.status = 'RESOLVED'), qq.updated_at DESC`,
    params,
  )
  // Add a `target` property to each row (one lookup per row, awaited in turn).
  for (const r of rows) r.target = r.targetType ? await targetInfo(q, ctx.project.id, r.targetType, r.targetId) : null
  return rows
}

// Load one question thread. `{ forUpdate = false } = {}` is a destructured
// option with a default value.
export async function getQuestion(q, ctx, id, { forUpdate = false } = {}) {
  // When forUpdate is true, append " FOR UPDATE OF qq" to lock just the
  // question row for the rest of the transaction.
  const [qq] = await q(
    `SELECT qq.*, u.name AS created_by_name FROM questions qq JOIN users u ON u.id = qq.created_by WHERE qq.id = $1 AND qq.project_id = $2${forUpdate ? ' FOR UPDATE OF qq' : ''}`,
    [id, ctx.project.id],
  )
  if (!qq) throw notFound('Question not found')
  // All messages, oldest first, with author name and project role (LEFT JOIN
  // keeps messages from people who have since left the project).
  const messages = await q(
    `SELECT m.id, m.body, m.created_at, m.author_id, u.name AS author_name, pm.role AS author_role
       FROM question_messages m JOIN users u ON u.id = m.author_id
       LEFT JOIN project_members pm ON pm.project_id = $2 AND pm.user_id = m.author_id
      WHERE m.question_id = $1 ORDER BY m.created_at`,
    [id, ctx.project.id],
  )
  // Combine question fields, messages and the target description.
  return { ...qq, messages, target: qq.targetType ? await targetInfo(q, ctx.project.id, qq.targetType, qq.targetId) : null }
}

// Ask a new question (the body becomes the first message).
export async function createQuestion(q, ctx, { title, body, targetType, targetId }) {
  // Validate the target and find who should answer (null for general questions).
  const target = targetType ? await targetInfo(q, ctx.project.id, targetType, targetId) : null
  const id = newId()
  const number = await nextNumber(q, 'questions', ctx.project.id)
  const at = isoAt(ctx.at) // one timestamp reused below
  // Insert the question; `$8` is used twice (created_at and updated_at).
  await q(
    `INSERT INTO questions (id, project_id, number, target_type, target_id, title, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, ctx.project.id, number, targetType ?? null, targetId ?? null, title, ctx.userId, at],
  )
  // Insert the first message.
  await q('INSERT INTO question_messages (id, question_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)', [newId(), id, ctx.userId, body, at])
  // Audit entry, filed against the target record when there is one.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'question.asked',
    targetType: targetType ?? 'QUESTION',
    targetId: targetId ?? id,
    // Lower-cases the label's first letter: `label[0]` is the first
    // character, `.slice(1)` is the rest of the string.
    summary: `Asked: "${title}"${target ? ` about ${target.label[0].toLowerCase()}${target.label.slice(1)}` : ''}`,
    payload: { questionId: id, number },
    at: ctx.at,
  })
  // Who answers: the record's owner, or else the contractor/supervisor team.
  const answerers = target?.ownerId ? [target.ownerId] : await membersWithRoles(q, ctx.project.id, ['CONTRACTOR', 'SUPERVISOR'])
  // Notify them (not the asker).
  await notify(q, { userIds: answerers, projectId: ctx.project.id, title: `Question: ${title}`, body, link: `/p/${ctx.project.id}/questions/${id}`, at: ctx.at, exclude: ctx.userId })
  return { id, number }
}

// Reply and resolve lock the question row (FOR UPDATE via getQuestion) so a
// reply and a resolve arriving together can't leave a message on a closed thread.
export async function replyToQuestion(q, ctx, id, body) {
  // Load and lock the thread.
  const qq = await getQuestion(q, ctx, id, { forUpdate: true })
  // Resolved threads take no more replies (HTTP 409).
  if (qq.status === 'RESOLVED') throw conflict('This question is resolved. Ask a new one instead.', { code: 'WRONG_STATUS' })
  const at = isoAt(ctx.at)
  // Store the reply.
  await q('INSERT INTO question_messages (id, question_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)', [newId(), id, ctx.userId, body, at])
  // Asker replying reopens; anyone else replying answers it.
  const status = ctx.userId === qq.createdBy ? 'OPEN' : 'ANSWERED'
  // Save the new status and bump updated_at.
  await q('UPDATE questions SET status = $2, updated_at = $3 WHERE id = $1', [id, status, at])
  // A report the owner queried goes back in line for verification once its author answers.
  if (status === 'ANSWERED' && qq.targetType === 'REPORT') {
    // Only changes a QUERIED report written by the replier.
    await q("UPDATE daily_reports SET status = 'SUBMITTED' WHERE id = $1 AND status = 'QUERIED' AND author_id = $2", [qq.targetId, ctx.userId])
  }
  // Audit entry.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'question.replied',
    targetType: qq.targetType ?? 'QUESTION',
    targetId: qq.targetId ?? id,
    summary: `Replied to "${qq.title}"`,
    payload: { questionId: id },
    at: ctx.at,
  })
  // Everyone in the thread: the asker plus every message author (spread
  // `...array` inserts the mapped ids into the new array). notify() dedupes.
  const others = [qq.createdBy, ...qq.messages.map((m) => m.authorId)]
  await notify(q, { userIds: others, projectId: ctx.project.id, title: `New reply: ${qq.title}`, body, link: `/p/${ctx.project.id}/questions/${id}`, at: ctx.at, exclude: ctx.userId })
}

// Close a question thread.
export async function resolveQuestion(q, ctx, id) {
  const qq = await getQuestion(q, ctx, id, { forUpdate: true }) // load + lock
  // Only the asker or an owner may resolve (`&&` = both must be true to refuse).
  if (ctx.userId !== qq.createdBy && ctx.role !== 'OWNER') throw forbidden('Only the person who asked, or the owner, can resolve this')
  // Already resolved: nothing to do (`return` with no value).
  if (qq.status === 'RESOLVED') return
  // Mark resolved; $2 (the time) fills both resolved_at and updated_at.
  await q("UPDATE questions SET status = 'RESOLVED', resolved_at = $2, updated_at = $2 WHERE id = $1", [id, isoAt(ctx.at)])
  // Audit entry.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'question.resolved',
    targetType: qq.targetType ?? 'QUESTION',
    targetId: qq.targetId ?? id,
    summary: `Resolved the question "${qq.title}"`,
    payload: { questionId: id },
    at: ctx.at,
  })
}
