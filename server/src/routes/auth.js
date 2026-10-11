// Account routes: register, sign in and out, demo sign-in, the signed-in
// profile (/auth/me, /me, /me/password) and the notification inbox. Nothing
// here is project-scoped, so these talk to the database directly with `q`
// rather than through a service. Mounted under /api by app.js.
//
// Endpoints (all under /api): POST /auth/register, POST /auth/login,
// POST /auth/demo, GET /auth/demo, POST /auth/logout, GET /auth/me,
// PATCH /me, POST /me/password, GET /notifications, POST /notifications/read.
// Depends on express, zod (input validation), config, db, auth/sessions,
// auth/middleware, lib/errors, lib/rateLimit, lib/util, seed/people.js and
// routes/context.js. Route handler shape: `router.METHOD(path, ...middleware,
// async (req, res) => {...})`; throwing inside an async handler sends the
// error to app.js's error handler (Express 5 behaviour).

// Express's Router factory.
import { Router } from 'express'
// `z` is zod's namespace object: z.string(), z.object() ... build schemas
// that describe and check the shape of input data.
import { z } from 'zod'
import { config } from '../config.js' // `demo` flag
import { q } from '../db/index.js' // query function
// Session and password helpers, plus the cookie name.
import { checkPassword, COOKIE, endSession, hashPassword, startSession } from '../auth/sessions.js'
import { requireUser } from '../auth/middleware.js' // 401 guard
// Error builders: 400, 409, 404, 401.
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js'
import { rateLimit } from '../lib/rateLimit.js' // per-IP throttling
import { isUniqueViolation, newId, sha256 } from '../lib/util.js' // helpers
// The demo personas: an object keyed by role.
import { DEMO_PEOPLE } from '../seed/people.js'
// body(schema, req) validates req.body.
import { body } from './context.js'

// Router() creates the group; exported so app.js can mount it.
export const authRoutes = Router()

// Reusable zod schemas. Chained methods add rules in order: must be a
// string, trim spaces, lower-case it, must look like an email (custom error
// text as argument), at most 200 characters.
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200)
// A new password: string of 8 to 200 characters.
const password = z.string().min(8, 'Use at least 8 characters').max(200)

// Password guessing and sign-up floods are slowed per address.
// 20 attempts per 15 minutes for sign-in.
const loginLimit = rateLimit({ max: 20, windowMs: 15 * 60_000, message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' })
// 10 sign-ups per hour (60 * 60_000 ms).
const registerLimit = rateLimit({ max: 10, windowMs: 60 * 60_000, message: 'Too many accounts created from here. Please try again later.' })

// Compared against when no account matches, so a wrong email takes as long as a wrong password.
// Top-level await: computed once when this module loads.
const DUMMY_HASH = await hashPassword('not-a-real-password')

// POST /auth/register: create an account. registerLimit runs before the handler.
authRoutes.post('/auth/register', registerLimit, async (req, res) => {
  // Validate the body with an inline object schema. `email, password` are
  // shorthand for `email: email, password: password` (the schemas above).
  // .optional() means the field may be missing.
  const input = body(z.object({ name: z.string().trim().min(2, 'Enter your name').max(80), email, password, phone: z.string().trim().max(30).optional() }), req)
  // New random user id.
  const id = newId()
  // Let the UNIQUE constraint decide: a SELECT-then-INSERT would race.
  try {
    // SQL: insert one users row with five values $1..$5. `input.phone || null`
    // turns an empty string into null. The password is hashed (awaited) right
    // inside the array; only the hash is stored.
    await q('INSERT INTO users (id, email, name, phone, password_hash) VALUES ($1, $2, $3, $4, $5)', [id, input.email, input.name, input.phone || null, await hashPassword(input.password)])
  } catch (err) {
    // Duplicate email → friendly 409 with a code the client recognises.
    if (isUniqueViolation(err)) throw conflict('An account with this email already exists. Sign in instead.', { code: 'EMAIL_TAKEN' })
    // Any other error: re-throw unchanged.
    throw err
  }
  // Sign the new user in (sets the cookie). req.get reads the User-Agent header.
  await startSession(res, id, req.get('user-agent'))
  // 201 Created with the new profile.
  res.status(201).json({ id, email: input.email, name: input.name, phone: input.phone || null, locale: 'en' })
})

// POST /auth/login: sign in with email and password.
authRoutes.post('/auth/login', loginLimit, async (req, res) => {
  // Here any non-empty password is accepted for checking (min 1).
  const input = body(z.object({ email, password: z.string().min(1, 'Enter your password').max(200) }), req)
  // SQL: find the user by email; `[user]` is undefined when none matches.
  const [user] = await q('SELECT id, email, name, phone, locale, password_hash FROM users WHERE email = $1', [input.email])
  // Same message and the same bcrypt work either way, so emails can't be probed.
  // If there's no user, compare against DUMMY_HASH instead (always false).
  const ok = await checkPassword(input.password, user?.passwordHash ?? DUMMY_HASH)
  // Either no such user or wrong password → identical 401.
  if (!user || !ok) throw unauthorized('Email or password is incorrect')
  // Success: create the session cookie.
  await startSession(res, user.id, req.get('user-agent'))
  // Rest destructuring: pull passwordHash out (unused) and keep everything
  // else in `safe`, so the hash is never sent to the browser.
  const { passwordHash, ...safe } = user
  // Send the profile.
  res.json(safe)
})

/** One-click sign-in as a demo persona. Only while DEMO_MODE is on; 404 otherwise so the route is invisible in production. */
authRoutes.post('/auth/demo', loginLimit, async (req, res) => {
  // Pretend the route doesn't exist when demo mode is off.
  if (!config.demo) throw notFound()
  // z.enum([...]) accepts only one of the listed strings; Object.keys gives
  // the persona role names. Destructure `role` from the parsed body.
  const { role } = body(z.object({ role: z.enum(Object.keys(DEMO_PEOPLE)) }), req)
  // Find the demo user by that persona's email.
  const [user] = await q('SELECT id, email, name, phone, locale FROM users WHERE email = $1', [DEMO_PEOPLE[role].email])
  // Database wasn't seeded → explain how to fix it.
  if (!user) throw badRequest('Demo data is not loaded. Run "npm run reset" in the server folder.')
  // Sign in as that user.
  await startSession(res, user.id, req.get('user-agent'))
  res.json(user)
})

// GET /auth/demo: tells the sign-in page whether demo mode is on and who the personas are.
// Not async: nothing to await.
authRoutes.get('/auth/demo', (req, res) => {
  // If demo: turn each [role, person] pair into { role, name, title }; else an empty list.
  res.json({ enabled: config.demo, people: config.demo ? Object.entries(DEMO_PEOPLE).map(([role, p]) => ({ role, name: p.name, title: p.title })) : [] })
})

// POST /auth/logout: end the session.
authRoutes.post('/auth/logout', async (req, res) => {
  // Delete the session row and clear the cookie.
  await endSession(req, res)
  // 204 No Content; .end() finishes the response without a body.
  res.status(204).end()
})

// GET /auth/me: the signed-in profile (attachUser already loaded it).
authRoutes.get('/auth/me', requireUser, (req, res) => res.json(req.user))

// Partial update: a missing field is left alone, but `phone: null` clears it,
// which is why the SQL takes a separate "was phone given" flag ($3).
authRoutes.patch('/me', requireUser, async (req, res) => {
  // .nullable() allows null; z.enum(['en','ur']) allows only those values;
  // .partial() at the end makes EVERY field of the object optional.
  const input = body(z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).nullable().optional(), locale: z.enum(['en', 'ur']) }).partial(), req)
  // SQL: UPDATE users SET col = ... changes the row WHERE id = $1.
  // COALESCE($2, name) keeps the old name when $2 is NULL. CASE WHEN $3 THEN
  // $4 ELSE phone END sets phone only if the flag is true ($3::boolean casts
  // to boolean). RETURNING lists columns to send back from the updated row.
  const [user] = await q(
    `UPDATE users SET name = COALESCE($2, name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END, locale = COALESCE($5, locale)
      WHERE id = $1 RETURNING id, email, name, phone, locale, created_at`,
    // `'phone' in input` is true if the key exists in the object (even if null).
    [req.user.id, input.name ?? null, 'phone' in input, input.phone || null, input.locale ?? null],
  )
  // Send the updated profile.
  res.json(user)
})

// POST /me/password: change password (signed in, and rate limited).
authRoutes.post('/me/password', requireUser, loginLimit, async (req, res) => {
  // `next: password` reuses the 8..200 character schema for the new one.
  const input = body(z.object({ current: z.string().min(1, 'Enter your current password').max(200), next: password }), req)
  // Load the stored hash.
  const [user] = await q('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  // `!(await ...)`: await the check first, then negate. Wrong current
  // password → 400 with a field-level detail for the form.
  if (!(await checkPassword(input.current, user.passwordHash))) throw badRequest('Your current password is incorrect', { details: [{ path: ['current'], message: 'Incorrect password' }] })
  // SQL: store the new hash.
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPassword(input.next)])
  // Sign out every other device; keep this one.
  // SQL: `<>` means "not equal"; deletes this user's sessions except the current one.
  await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, sha256(req.cookies[COOKIE])])
  res.status(204).end()
})

// GET /notifications: latest 40 notifications and the unread count.
authRoutes.get('/notifications', requireUser, async (req, res) => {
  // SQL: n.* = all notification columns plus the project's name. LEFT JOIN
  // keeps notifications even when no project matches (project_name is then
  // NULL). Newest first (ORDER BY ... DESC), at most 40 (LIMIT).
  const items = await q(
    `SELECT n.*, p.name AS project_name FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 40`,
    // $1 = current user.
    [req.user.id],
  )
  // SQL: count unread ones (read_at IS NULL); destructure `unread` from the single row.
  const [{ unread }] = await q('SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])
  // Shorthand object: { items: items, unread: unread }.
  res.json({ items, unread })
})

// POST /notifications/read: mark some (given ids) or all as read.
authRoutes.post('/notifications/read', requireUser, async (req, res) => {
  // Optional array of up to 100 id strings.
  const { ids } = body(z.object({ ids: z.array(z.string().max(80)).max(100).optional() }), req)
  // `ids?.length` is undefined (falsy) when ids is missing, 0 (falsy) when empty.
  if (ids?.length) {
    // SQL: set read_at to now for unread rows whose id is in the array.
    // `= ANY($2::text[])` means "equals any element of the text array $2".
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::text[])', [req.user.id, ids])
  } else {
    // No ids → mark all of this user's unread notifications as read.
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id])
  }
  res.status(204).end()
})
