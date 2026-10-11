// Express middleware for who is calling and what they may do: the CSRF
// origin check, loading req.user from the cookie, requiring a user, loading
// a project with the caller's role and permissions, and the allow() guard
// the project routes use. Permissions themselves come from
// shared/permissions.js so the client and server agree on them.
//
// Used by app.js (checkOrigin, attachUser) and the route files (requireUser,
// loadProject, allow). Depends on config, db, lib/errors, services/projects
// and auth/sessions. Each middleware has the Express shape (req, res, next):
// call next() to continue, or next(error) to stop with an error response.

// permissionsFor(role, project) → array of allowed action names.
import { permissionsFor } from '../../../shared/permissions.js'
import { config } from '../config.js' // clientOrigins list
import { q } from '../db/index.js' // query function
// Error builders for 409, 403, 404 and 401.
import { conflict, forbidden, notFound, unauthorized } from '../lib/errors.js'
// activeGrants: what an owner shares with an inspector; PROJECT_COLUMNS: SQL column list text.
import { activeGrants, PROJECT_COLUMNS } from '../services/projects.js'
// Reads the session cookie and returns the user (or null).
import { userFromRequest } from './sessions.js'

/** Reject state-changing requests from other origins (CSRF defence with SameSite cookies). */
export function checkOrigin(req, res, next) {
  // Array literal + .includes(x): true if x is in the array. Read-only
  // methods can't change anything, so let them through.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  // req.get(name) reads a request header; Origin = the site that sent it.
  const origin = req.get('origin')
  // Block only if an Origin is present AND it's not in our allowed list AND
  // it's not this same server. `&&` = AND, `!` = NOT.
  if (origin && !config.clientOrigins.includes(origin) && !sameHost(origin, req)) return next(forbidden('Request from an unknown origin'))
  // Allowed: continue.
  next()
}

/** The web app served by this same server (production) is always allowed. */
// Private helper (not exported).
function sameHost(origin, req) {
  // new URL(text) parses a URL and throws if it is malformed.
  try {
    // .host = "domain:port"; compare with the Host header of this request.
    return new URL(origin).host === req.get('host')
    // `catch { }` without a variable: we don't need the error itself.
  } catch {
    // Unparseable origin → not the same host.
    return false
  }
}

// attachUser runs on every /api request and never fails: public routes
// (invitation preview, demo list) just see req.user === null.
export async function attachUser(req, res, next) {
  // Adding a custom property to the request object for later handlers.
  req.user = await userFromRequest(req)
  next()
}

// Guard: only signed-in callers may pass.
export function requireUser(req, res, next) {
  // No user → 401 Unauthorized via the error handler.
  if (!req.user) return next(unauthorized())
  next()
}

/**
 * Load the project from :projectId and the caller's membership. Non-members
 * get 404, so project ids can't be probed. An archived project can still be
 * read, but nothing on it can change.
 */
export async function loadProject(req, res, next) {
  // SQL (the template literal below): select the project columns (inserted
  // with ${PROJECT_COLUMNS}) plus m.role, FROM projects aliased `p`, JOINed
  // with project_members aliased `m`. JOIN ... ON keeps only pairs matching
  // the conditions: membership of this project, for this user ($2), not
  // removed (removed_at IS NULL). WHERE p.id = $1 picks the project.
  // If the caller isn't a member, the JOIN yields no row.
  const [row] = await q(
    `SELECT ${PROJECT_COLUMNS}, m.role
       FROM projects p
       JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 AND m.removed_at IS NULL
      WHERE p.id = $1`,
    // Parameters: $1 = the :projectId part of the URL (req.params), $2 = the caller's id.
    [req.params.projectId, req.user.id],
  )
  // Not found or not a member → 404.
  if (!row) return next(notFound('Project not found'))
  // Archived projects reject any writing method with 409 ARCHIVED.
  if (row.archivedAt && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(conflict('This project is archived', { code: 'ARCHIVED' }))
  // Destructuring with rest: take `role` out, and put ALL other properties
  // into a new object called `project` (`...project` = "the rest").
  const { role, ...project } = row
  // An inspector's permissions depend on what the owner is currently
  // sharing (HISTORY / REPORTS / PHOTOS), so the active grants are loaded
  // here and permissionsFor folds them in. req.can is what services use via ctx.
  // Ternary: inspectors get their grants from the DB, everyone else an empty array.
  project.grants = role === 'INSPECTOR' ? await activeGrants(q, project.id, req.user.id) : []
  // Store results on req for the route handlers.
  req.project = project
  req.role = role
  // The list of action names this role may perform on this project.
  req.permissions = permissionsFor(role, project)
  // A helper function: req.can('decide') → true/false.
  req.can = (action) => req.permissions.includes(action)
  next()
}

/** Route guard: `allow('decide')`, or `allow('viewMoney', 'createExpense')` for any of them. */
// A function that returns a middleware (curried arrow functions).
// `(...actions)` is a rest parameter: all arguments gathered into one array.
export const allow =
  (...actions) =>
  // The returned middleware.
  (req, res, next) =>
    // .some(fn) is true if fn returns true for at least one item. If the
    // caller can do any listed action, continue; otherwise 403 Forbidden.
    actions.some((a) => req.can(a)) ? next() : next(forbidden())
