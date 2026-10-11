// FILE: server/src/services/access.js
//
// WHAT IT DOES
// Inspectors see inspections, progress and drawings. To see the history, the
// daily reports or the site photos they ask the owner, one kind at a time,
// and the owner shares it for a day, a week or a month (or declines).
// Status flow: PENDING → APPROVED (until expires_at) | DENIED; an approved
// share can be REVOKED by the owner; a pending one CANCELLED by the asker.
//
// WHY IT EXISTS
// The owner's history, reports and photos are private by default. This file
// is the one place that turns "an inspector asked" into a time-limited grant
// (a row in the access_requests table) and back again.
//
// WHO USES IT
// Active grants feed permissionsFor via auth/middleware.js. Used by
// routes/projects.js, dashboard.js (pending list) and projects.js
// (endAccessFor on member removal).
//
// WHAT IT DEPENDS ON
// shared/permissions.js (scope labels, allowed share lengths), the audit log
// (audit/audit.js), the error helpers (lib/errors.js), small utilities
// (lib/util.js: timestamps, advisory locks, ids) and notify.js (in-app alerts).
//
// CONVENTION USED BY EVERY FUNCTION BELOW
// `q` is the query function of the current database transaction: you call
// q(sqlText, [values]) and it returns a Promise of an array of rows, with
// column names converted from snake_case to camelCase. `ctx` describes who is
// asking (ctx.userId, ctx.userName, ctx.role, ctx.project, ctx.can(...)).

// `import { a, b } from '...'` is ES module syntax: it pulls the named exports
// `a` and `b` out of another file. The `../` parts walk up folders.
// ACCESS_DAYS = allowed share lengths in days; ACCESS_SCOPES = the kinds of thing that can be shared.
import { ACCESS_DAYS, ACCESS_SCOPES } from '../../../shared/permissions.js'
// audit() writes one line to the project's permanent audit trail.
import { audit } from '../audit/audit.js'
// Helpers that build HTTP-style errors (400, 409, 403, 404) to `throw`.
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
// isoAt = time to ISO string, lock = transaction-scoped lock by name, newId = fresh unique id.
import { isoAt, lock, newId } from '../lib/util.js'
// membersWithRoles = user ids holding given roles; notify = create in-app notifications.
import { membersWithRoles, notify } from './notify.js'

// An arrow function `(scope) => expr` is a short function that returns expr.
// It looks the scope up in the ACCESS_SCOPES object with [scope] (bracket
// access by a variable key) and lower-cases its human label, e.g. "site photos".
const label = (scope) => ACCESS_SCOPES[scope].label.toLowerCase()
// Milliseconds in one day (24 * 60 * 60 * 1000), used for date arithmetic.
const DAY = 86400000
// Formats an ISO date string as e.g. "5 Oct" in Pakistan time. `new Date(iso)`
// parses the string; toLocaleDateString takes a locale and an options object.
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })
// Object literal mapping each scope to the client page that shows it (used to build notification links).
const SCOPE_PAGE = { HISTORY: 'history', REPORTS: 'reports', PHOTOS: 'reports' }

/** The owner sees every request; an inspector sees their own. Pending first. */
// `export` makes the function importable by other files; `async` means it
// returns a Promise and may use `await` inside.
export async function listAccessRequests(q, ctx) {
  // `!` negates: `own` is true when this person can NOT decide access (an inspector).
  const own = !ctx.can('decideAccess')
  // Return the Promise from q() directly; the caller awaits it.
  // The SQL (a template literal in backticks, so ${...} can splice in text):
  //   SELECT a.id, ... — the columns to return; `AS user_name` renames a column.
  //   CASE WHEN ... THEN ... ELSE ... END — an if/else inside SQL computing a
  //     derived `state`: ACTIVE if approved and not yet expired, EXPIRED if
  //     approved but past expires_at, otherwise the raw status. now() = current time.
  //   FROM access_requests a JOIN users u ON u.id = a.user_id — combine each
  //     request with the user who asked (`a` and `u` are short table aliases).
  //   LEFT JOIN users d ON d.id = a.decided_by — also the owner who decided;
  //     LEFT keeps the request even when nobody has decided yet (d.* is NULL).
  //   WHERE a.project_id = $1 — $1, $2 are placeholders filled from the values
  //     array (safe from SQL injection). ${own ? ... : ''} is a JS ternary
  //     (cond ? ifTrue : ifFalse) that adds the "only my own" filter for inspectors.
  //   ORDER BY CASE ... — pending rows sort first, then newest request first.
  //   LIMIT 50 — at most 50 rows.
  return q(
    `SELECT a.id, a.scope, a.status, a.reason, a.requested_at, a.decided_at, a.expires_at, a.note, a.user_id,
            u.name AS user_name, d.name AS decided_by_name,
            CASE WHEN a.status = 'APPROVED' AND a.expires_at > now() THEN 'ACTIVE'
                 WHEN a.status = 'APPROVED' THEN 'EXPIRED' ELSE a.status END AS state
       FROM access_requests a JOIN users u ON u.id = a.user_id LEFT JOIN users d ON d.id = a.decided_by
      WHERE a.project_id = $1 ${own ? 'AND a.user_id = $2' : ''}
      ORDER BY CASE a.status WHEN 'PENDING' THEN 0 ELSE 1 END, a.requested_at DESC
      LIMIT 50`,
    // The parameter values: two of them when filtering by user, else one.
    own ? [ctx.project.id, ctx.userId] : [ctx.project.id],
  )
}

// An inspector asks to see one scope. The third parameter `{ scope, reason }`
// is object destructuring: it unpacks those two properties of the passed object
// into local variables of the same names.
export async function requestAccess(q, ctx, { scope, reason }) {
  // Short local name for the project id.
  const pid = ctx.project.id
  // Lock per (user, scope) so a double-tap can't create two pending rows;
  // the partial unique index access_requests_pending is the backstop.
  // `await` pauses until the Promise resolves. The backtick string is a
  // template literal: ${pid} etc. are replaced by the variable values.
  await lock(q, `access:${pid}:${ctx.userId}:${scope}`)
  // Is there already an unexpired approved share? `const [active] = ...` is
  // array destructuring: take the first row (or undefined if none).
  // SQL: pick the latest expires_at among APPROVED rows for this project/user/scope
  // whose expires_at is still in the future; ORDER BY ... DESC LIMIT 1 = the latest one.
  const [active] = await q(
    `SELECT expires_at FROM access_requests WHERE project_id = $1 AND user_id = $2 AND scope = $3
        AND status = 'APPROVED' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`,
    [pid, ctx.userId, scope],
  )
  // `throw` stops the function and sends the error up; the transaction rolls back.
  // conflict(message, { code }) builds a 409 error with a machine-readable code.
  if (active) throw conflict(`You can already see the ${label(scope)} until ${shortDate(active.expiresAt)}`, { code: 'ACCESS_ACTIVE' })
  // Is there already a pending request? `SELECT 1` just checks a row exists.
  const [pending] = await q("SELECT 1 FROM access_requests WHERE project_id = $1 AND user_id = $2 AND scope = $3 AND status = 'PENDING'", [pid, ctx.userId, scope])
  // If so, refuse with a friendly 409.
  if (pending) throw conflict(`You already asked to see the ${label(scope)}. The owner hasn't answered yet.`, { code: 'ACCESS_PENDING' })

  // A new unique id for the request row.
  const id = newId()
  // Optional chaining `reason?.trim()` calls trim only if reason is not
  // null/undefined. `|| null` turns an empty string (falsy) into null.
  const note = reason?.trim() || null
  // INSERT INTO table (columns) VALUES ($1..$6) adds one row; status defaults to PENDING in the schema.
  await q('INSERT INTO access_requests (id, project_id, user_id, scope, reason, requested_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    // The six values in the same order as the placeholders.
    id, pid, ctx.userId, scope, note, isoAt(ctx.at),
  ])
  // Record the request in the audit trail. The object literal's properties
  // are the audit fields.
  await audit(q, {
    // Which project the event belongs to.
    projectId: pid,
    // Who did it.
    actorId: ctx.userId,
    // Machine-readable event name.
    action: 'access.requested',
    // Kind of record affected and its id.
    targetType: 'ACCESS',
    targetId: id,
    // Human sentence; the nested template `${note ? ` — "${note}"` : ''}` adds the reason only if there is one.
    summary: `${ctx.userName} asked to see the ${label(scope)}${note ? ` — "${note}"` : ''}`,
    // Extra structured data; `{ scope }` is shorthand for `{ scope: scope }`.
    payload: { scope },
    // Timestamp of the action.
    at: ctx.at,
  })
  // Tell the owner(s) about the request.
  await notify(q, {
    // `await` inside an object literal: look up the owner user ids first.
    userIds: await membersWithRoles(q, pid, ['OWNER']),
    projectId: pid,
    // Notification headline.
    title: `${ctx.userName} asks to see the ${label(scope)}`,
    // Nullish coalescing `??`: use note unless it is null/undefined, then the fallback text.
    body: note ?? 'Share it for a day, a week or a month, or decline.',
    // Where tapping the notification goes in the client.
    link: `/p/${pid}/approvals?filter=access`,
    at: ctx.at,
  })
  // Return an object with the new id (shorthand for { id: id }).
  return { id }
}

// The three decisions below all load the row FOR UPDATE and check its status
// under the lock, so two owners (or owner and inspector) acting at once get
// a clean "already answered" instead of a double transition.
// `{ forUpdate = false } = {}` destructures an options object with a default
// value for forUpdate, and defaults the whole object to {} if it is omitted.
async function loadRequest(q, ctx, id, { forUpdate = false } = {}) {
  // SQL: the request plus the asker's name, restricted to this project.
  // `FOR UPDATE OF a` (added only when forUpdate is true) row-locks the
  // access_requests row until the transaction ends, so concurrent decisions wait.
  const [r] = await q(
    `SELECT a.*, u.name AS user_name FROM access_requests a JOIN users u ON u.id = a.user_id WHERE a.id = $1 AND a.project_id = $2${forUpdate ? ' FOR UPDATE OF a' : ''}`,
    [id, ctx.project.id],
  )
  // No row: 404.
  if (!r) throw notFound('Request not found')
  // Give the row back to the caller.
  return r
}

// The owner approves (for N days) or declines a pending request.
export async function decideAccess(q, ctx, id, { decision, days, note }) {
  // Load and lock the request.
  const r = await loadRequest(q, ctx, id, { forUpdate: true })
  // `!==` is strict "not equal". Only pending requests can be decided.
  if (r.status !== 'PENDING') throw conflict('This request has already been answered', { code: 'WRONG_STATUS' })
  // Check the asker is still an active inspector on the project
  // (removed_at IS NULL means not removed).
  const [member] = await q(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'INSPECTOR' AND removed_at IS NULL",
    [ctx.project.id, r.userId],
  )
  // If not, refuse with a 400.
  if (!member) throw badRequest(`${r.userName} is no longer on this project`)
  // `===` is strict equality; approve is a boolean.
  const approve = decision === 'APPROVE'
  // `&&` = and. Approving needs a valid length; `.includes(x)` tests array membership.
  if (approve && !ACCESS_DAYS.includes(days)) throw badRequest('Choose how long to share it for')

  // The decision time as an ISO string.
  const at = isoAt(ctx.at)
  // Expiry = decision time + days; getTime() gives milliseconds since 1970. Ternary gives null when declining.
  const expiresAt = approve ? isoAt(new Date(at).getTime() + days * DAY) : null
  // UPDATE ... SET col = $n ... WHERE id = $1 changes that one row.
  await q('UPDATE access_requests SET status = $2, decided_by = $3, decided_at = $4, expires_at = $5, note = $6 WHERE id = $1', [
    // Values for $1..$6; the note is trimmed or null.
    id, approve ? 'APPROVED' : 'DENIED', ctx.userId, at, expiresAt, note?.trim() || null,
  ])
  // A chained ternary (a ? b : c ? d : ...) reads like if / else-if: the share length in words.
  const span = !approve ? '' : days === 1 ? 'a day' : days === 7 ? 'a week' : `${days} days`
  // Audit line for the decision.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    // Different event names for approve vs decline.
    action: approve ? 'access.approved' : 'access.denied',
    targetType: 'ACCESS',
    targetId: id,
    // Human sentence describing what happened.
    summary: approve ? `Shared the ${label(r.scope)} with ${r.userName} for ${span}` : `Declined ${r.userName}'s request to see the ${label(r.scope)}`,
    // Structured data: the scope, and the days only when approved.
    payload: { scope: r.scope, days: approve ? days : null },
    at: ctx.at,
  })
  // Tell the inspector the answer.
  await notify(q, {
    // An array with one user id.
    userIds: [r.userId],
    projectId: ctx.project.id,
    // Headline depends on the outcome.
    title: approve ? `You can now see the ${label(r.scope)}` : `Your request to see the ${label(r.scope)} was declined`,
    // Body: the expiry when approved; else the owner's note, or a default line.
    body: approve ? `Shared by ${ctx.userName} until ${shortDate(expiresAt)}.` : note?.trim() || `Declined by ${ctx.userName}.`,
    // Link to the page that now shows the shared data (or the "more" page if declined).
    link: `/p/${ctx.project.id}/${approve ? SCOPE_PAGE[r.scope] : 'more'}`,
    at: ctx.at,
  })
  // Report the new status and expiry to the route.
  return { status: approve ? 'APPROVED' : 'DENIED', expiresAt }
}

/** The owner ends a share before it runs out. */
export async function revokeAccess(q, ctx, id) {
  // Load and lock.
  const r = await loadRequest(q, ctx, id, { forUpdate: true })
  // `||` = or. Refuse if not approved, or already expired (Date objects compare by time).
  if (r.status !== 'APPROVED' || new Date(r.expiresAt) <= new Date()) throw badRequest('This is no longer shared')
  // Mark it REVOKED and make it expire right now.
  await q("UPDATE access_requests SET status = 'REVOKED', expires_at = $2 WHERE id = $1", [id, isoAt(ctx.at)])
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'access.revoked',
    targetType: 'ACCESS',
    targetId: id,
    summary: `Stopped sharing the ${label(r.scope)} with ${r.userName}`,
    payload: { scope: r.scope },
    at: ctx.at,
  })
  // Tell the inspector.
  await notify(q, {
    userIds: [r.userId],
    projectId: ctx.project.id,
    title: `The ${label(r.scope)} is no longer shared with you`,
    body: `${ctx.userName} stopped sharing it.`,
    link: `/p/${ctx.project.id}/more`,
    at: ctx.at,
  })
}

/** The inspector takes back a request the owner hasn't answered. */
export async function cancelAccess(q, ctx, id) {
  // Load and lock.
  const r = await loadRequest(q, ctx, id, { forUpdate: true })
  // Only the asker may cancel (403 otherwise).
  if (r.userId !== ctx.userId) throw forbidden('Only the person who asked can cancel this')
  // Only while still pending.
  if (r.status !== 'PENDING') throw badRequest('This request has already been answered')
  // Mark it CANCELLED.
  await q("UPDATE access_requests SET status = 'CANCELLED' WHERE id = $1", [id])
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'access.cancelled',
    targetType: 'ACCESS',
    targetId: id,
    summary: `${ctx.userName} withdrew the request to see the ${label(r.scope)}`,
    payload: { scope: r.scope },
    at: ctx.at,
  })
}

/** When someone leaves the project, their pending requests and shares end with them. */
export async function endAccessFor(q, ctx, userId) {
  // One UPDATE closes everything open for this user:
  //   SET status = CASE ... — pending rows become CANCELLED, approved ones REVOKED.
  //   expires_at = CASE ... — approved shares expire now ($3, cast with ::timestamptz
  //     to a timestamp-with-time-zone); other rows keep their expires_at.
  //   WHERE ... — only this project's rows for this user that are pending or
  //     approved-and-still-active.
  //   RETURNING id — UPDATE hands back the id of each changed row.
  const ended = await q(
    `UPDATE access_requests SET status = CASE WHEN status = 'PENDING' THEN 'CANCELLED' ELSE 'REVOKED' END,
            expires_at = CASE WHEN status = 'APPROVED' THEN $3::timestamptz ELSE expires_at END
      WHERE project_id = $1 AND user_id = $2 AND (status = 'PENDING' OR (status = 'APPROVED' AND expires_at > now()))
      RETURNING id`,
    [ctx.project.id, userId, isoAt(ctx.at)],
  )
  // How many requests/shares were ended (array length).
  return ended.length
}

/** Pending requests waiting for the owner, for the approvals inbox. */
export async function pendingAccess(q, projectId) {
  // SQL: pending requests with the asker's name, oldest first.
  return q(
    `SELECT a.id, a.scope, a.reason, a.requested_at, a.user_id, u.name AS user_name
       FROM access_requests a JOIN users u ON u.id = a.user_id
      WHERE a.project_id = $1 AND a.status = 'PENDING' ORDER BY a.requested_at`,
    [projectId],
  )
}
