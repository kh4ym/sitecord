// The project history (hash-chained audit trail) as each person may see it.
// People who can't see money (an inspector the owner shared the history with)
// get the build story only: an allowlist of actions, payloads removed, and
// any amount in a summary masked. The chain itself is never altered.
// Read-only; writing is audit/audit.js. Used by GET /audit in routes/projects.js.
// Pagination is keyset on seq (`before`), so new events never shift pages.
//
// What this file does: builds the SQL that reads audit_events for one project,
// optionally filtered by a group of actions ("money", "progress", ...), one
// page at a time, and hides money details from people not allowed to see them.
// Depends on: only the `q` query runner and `ctx` request context passed in
// (ctx.project, ctx.can(permission)).

// A constant array (list) of audit action names that are safe to show to
// people who may not see money. Each string is "area.event".
const SAFE_ACTIONS = [
  'project.created', // project set up
  'project.archived', // project archived
  'progress.updated', // build stage moved forward
  'report.submitted', // site report filed
  'inspection.recorded', // inspector recorded a visit
  'member.joined', // someone joined the project
  'member.removed', // someone was removed
  'site.pinned', // site location set on the map
  'site.cleared', // site location removed
  'access.requested', // history access requested
  'access.approved', // ...approved
  'access.denied', // ...denied
  'access.revoked', // ...revoked
  'access.cancelled', // ...cancelled
]
// A piece of SQL (a WHERE condition) stored as a template literal string.
// `${...}` inserts the allowlist: `.map` wraps each action in single quotes
// and `.join(', ')` makes "'a', 'b', ...". `IN (...)` matches any of them.
// It also allows owner decisions (verify/query) about reports.
const SAFE_SQL = `(a.action IN (${SAFE_ACTIONS.map((a) => `'${a}'`).join(', ')})
  OR (a.action IN ('decision.verify', 'decision.query') AND a.target_type = 'REPORT'))`
// Matches "Rs 1,20,000", "PKR 4.5 lakh", "-Rs 300" etc. in summaries written by formatPKR.
// This is a regular expression literal `/pattern/flags`: an optional sign,
// optional space, "Rs" or "PKR", optional dot, digits/commas/dots, and an
// optional "lakh"/"crore" word. Flags: `g` = replace every match, `i` = ignore case.
const MONEY = /[−+-]?\s?(?:Rs|PKR)\.?\s?[\d,.]+(?:\s?(?:lakh|crore))?/gi

/** Filter chips on the History page, by action prefix. */
// An object whose keys are group names and whose values are arrays of
// action-name prefixes belonging to that group.
const GROUPS = {
  // Everything about money.
  money: ['expense.', 'payment.', 'milestone.', 'budget.', 'change.', 'finding.', 'rules.', 'decision.'],
  // Everything about the build itself.
  progress: ['progress.', 'report.', 'inspection.', 'site.', 'evidence.', 'document.'],
  // People and project-level events.
  people: ['member.', 'project.', 'question.'],
  // History-sharing requests.
  access: ['access.'],
}

// An arrow function stored in a constant: takes ctx, returns true when the
// user's role has the "viewMoney" permission (then they see everything).
const seesFullHistory = (ctx) => ctx.can('viewMoney')

// Exported async function. The third parameter is destructured with a default
// value (`limit = 60` if not given) and the whole object defaults to `{}`
// (`= {}`) so calling listHistory(q, ctx) with no options still works.
export async function listHistory(q, ctx, { before, type, limit = 60 } = {}) {
  // SQL parameter values; index 0 becomes $1.
  const params = [ctx.project.id]
  // WHERE conditions collected in an array, joined with AND later.
  const where = ['a.project_id = $1']
  // Only filter by group when a type was requested.
  if (type) {
    // Look up the group's prefixes; `??` falls back to treating the type
    // itself as a single prefix (e.g. "expense" -> "expense.").
    const prefixes = GROUPS[type] ?? [`${type}.`]
    // Build "(a.action LIKE $2 OR a.action LIKE $3 ...)". Trick:
    // `params.push(x)` adds x and returns the new array length, which is
    // exactly the number of the new $n placeholder. `${p}%` is a LIKE pattern
    // ("%" = any characters), so the prefix matches any action starting with it.
    // `where.push(...)` appends the combined condition.
    where.push(`(${prefixes.map((p) => `a.action LIKE $${params.push(`${p}%`)}`).join(' OR ')})`)
  }
  // Does this user see the full history?
  const full = seesFullHistory(ctx)
  // If not, add the allowlist condition (short one-line `if`).
  if (!full) where.push(SAFE_SQL)
  // Count all matching events (before paging). `count(*)::int` counts rows and
  // `::int` casts to integer. Destructuring `[{ total }]` takes the first row
  // and pulls its `total` property into a variable.
  const [{ total }] = await q(`SELECT count(*)::int AS total FROM audit_events a WHERE ${where.join(' AND ')}`, params)
  // Keyset paging: only events with a sequence number below `before`.
  if (before) where.push(`a.seq < $${params.push(before)}`)
  // Fetch the page of events with the actor's name and role.
  // LEFT JOIN users/project_members keeps events with no actor (system events).
  // ORDER BY seq DESC = newest first. LIMIT clamps the page size to 1..200
  // using Math.max (at least 1) and Math.min (at most 200).
  const events = await q(
    `SELECT a.seq, a.action, a.summary, a.target_type, a.target_id, a.payload, a.prev_hash, a.hash, a.created_at, a.actor_id,
            u.name AS actor_name, m.role AS actor_role
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN project_members m ON m.project_id = a.project_id AND m.user_id = a.actor_id
      WHERE ${where.join(' AND ')} ORDER BY a.seq DESC LIMIT ${Math.min(200, Math.max(1, limit))}`,
    params,
  )
  // Return an object with three properties.
  return {
    // Ternary: full viewers get events unchanged; others get a copy of each
    // event (`{ ...e }` spreads all properties into a new object) whose summary
    // has amounts replaced by "Rs ···" and whose payload is emptied.
    // The arrow returns an object, so it is wrapped in parentheses `({ ... })`.
    events: full ? events : events.map((e) => ({ ...e, summary: e.summary.replace(MONEY, 'Rs ···'), payload: {} })),
    total, // shorthand for total: total
    limited: !full, // tells the page that some events are hidden
  }
}
