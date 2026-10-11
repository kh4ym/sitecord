// In-app notifications, one row per recipient, written inside the calling
// service's transaction so they roll back with it. Used by almost every
// service; read back by GET /notifications in routes/auth.js. `exclude`
// keeps the actor from being told about their own action.
//
// What this file does: it offers two helpers. `membersWithRoles` looks up
// which users on a project hold certain roles (e.g. "OWNER"), and `notify`
// writes one row into the `notifications` table for each recipient.
// Why it exists: so every service (questions, changes, reports, ...) can tell
// people about events in one consistent way.
// Depends on: lib/util.js (id + timestamp helpers) and the `q` query function
// that every service receives (it runs SQL inside the current transaction and
// returns rows with camelCase keys, e.g. user_id becomes userId).

// ES module import: `import { a, b } from 'path'` pulls the named exports
// `isoAt` (formats a timestamp) and `newId` (makes a unique id) out of util.js.
import { isoAt, newId } from '../lib/util.js'

/** Members of a project with any of the given roles. */
// `export` makes the function importable by other files; `async function`
// declares a function that returns a Promise and may use `await` inside.
// Parameters: q = query runner, projectId = which project, roles = array of role names.
export async function membersWithRoles(q, projectId, roles) {
  // `const` declares a variable that is never reassigned. `await` pauses until
  // the database answers. The SQL selects user and role for active members
  // (removed_at IS NULL means "not removed"); `$1` is a placeholder filled
  // safely from the array that follows ([projectId]) to avoid SQL injection.
  const rows = await q(
    'SELECT user_id, role FROM project_members WHERE project_id = $1 AND removed_at IS NULL',
    [projectId],
  )
  // `.filter(fn)` keeps only rows where fn returns true; `(r) => ...` is an
  // arrow function (a short function). `roles.includes(x)` checks membership.
  // `.map(fn)` then turns each kept row into just its userId.
  return rows.filter((r) => roles.includes(r.role)).map((r) => r.userId)
}

/** In-app notification for each user (email/WhatsApp delivery comes later). */
// The second parameter uses object destructuring: `{ userIds, projectId, ... }`
// unpacks those named properties from the object the caller passes in.
export async function notify(q, { userIds, projectId, title, body, link, at, exclude }) {
  // `new Set(userIds)` drops duplicates; `[...set]` (spread) turns it back into
  // an array. The filter removes empty ids (`id &&` is falsy for null/'' etc.)
  // and the actor themself (`id !== exclude`, strict not-equal).
  const unique = [...new Set(userIds)].filter((id) => id && id !== exclude)
  // `for (const x of list)` loops over each element of the array in order.
  for (const userId of unique) {
    // Insert one notification row; $1..$7 match the 7 values in the array.
    // `??` (nullish coalescing) uses the right side only when the left is
    // null or undefined, so missing values are stored as SQL NULL.
    await q(
      'INSERT INTO notifications (id, user_id, project_id, title, body, link, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [newId(), userId, projectId ?? null, title, body ?? null, link ?? null, isoAt(at)],
    )
  }
}
