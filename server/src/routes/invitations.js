// Invitation links. Creating and revoking them is a project route
// (routes/projects.js); these two are keyed by the token in the link
// instead, because the person following it isn't a member yet and may not
// even be signed in. Logic lives in services/projects.js. Mounted under /api.
//
// Endpoints: GET /api/invitations/:token (public preview) and
// POST /api/invitations/:token/accept (signed-in user joins the project).
// Depends on express, shared/permissions.js (role labels), auth middleware,
// db, rateLimit, services/projects.js and routes/context.js.

// Router is Express's mini-app for grouping routes.
import { Router } from 'express'
// ROLE_LABELS maps a role code (e.g. 'INSPECTOR') to display text.
import { ROLE_LABELS } from '../../../shared/permissions.js'
import { requireUser } from '../auth/middleware.js' // 401 unless signed in
import { q } from '../db/index.js' // non-transaction query function
import { rateLimit } from '../lib/rateLimit.js' // per-IP throttling factory
// Service functions that hold the real logic.
import { acceptInvitation, findInvitation } from '../services/projects.js'
import { run } from './context.js' // runs a service in a transaction

// Create and export the router; app.js mounts it under /api.
export const invitationRoutes = Router()

// Tokens are long and random; the limit just makes guessing them pointless.
// 30 requests per 15 minutes (15 * 60_000 ms) per address.
const tokenLimit = rateLimit({ max: 30, windowMs: 15 * 60_000 })

/** Public: what an invitation link is for, so the page can explain it before sign-in. */
// `:token` in the path is a route parameter: its value appears as req.params.token.
// Middleware listed before the handler (tokenLimit) runs first.
invitationRoutes.get('/invitations/:token', tokenLimit, async (req, res) => {
  // Look up the invitation (throws a 404-type error if invalid/expired).
  const inv = await findInvitation(q, req.params.token)
  // Send only what the preview page needs. ROLE_LABELS[inv.role] uses bracket
  // notation to read the property named by inv.role.
  res.json({ projectName: inv.projectName, city: inv.city, role: inv.role, roleLabel: ROLE_LABELS[inv.role], invitedBy: inv.invitedByName, email: inv.email })
})

// Accept: requires a signed-in user, then rate limiting, then the handler.
invitationRoutes.post('/invitations/:token/accept', requireUser, tokenLimit, async (req, res) => {
  // run() opens a transaction and calls our arrow function with the
  // transaction's query function (named tx here) and the context.
  res.json(await run(req, (tx, ctx) => acceptInvitation(tx, ctx, req.params.token)))
})
