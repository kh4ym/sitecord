// Builds the Express app: security headers, the /api/health probe, the three
// route groups under /api (auth, invitations, projects), the built web app in
// production, and the one error handler that turns every thrown error into a
// JSON response. Called by server.js and by scripts/smoke.js; it never
// listens or touches the database itself.
//
// Express in one paragraph: an "app" is a list of middleware functions. Each
// incoming HTTP request walks that list in the order they were added with
// app.use()/app.get(). A middleware has the signature (req, res, next): `req`
// describes the request, `res` is used to send the response, and calling
// `next()` passes the request on to the next middleware. A function with FOUR
// parameters (err, req, res, next) is an error handler and only runs when an
// earlier step failed.
//
// Depends on: express, cookie-parser, multer (file uploads), zod (input
// validation), plus our auth middleware, config, db, migrations, errors, log
// and the three route modules.

// `import { existsSync } from 'node:fs'`: named import from Node's built-in
// file-system module; the `node:` prefix marks it as a built-in.
import { existsSync } from 'node:fs'
// `import path from 'node:path'`: a DEFAULT import (no braces) takes the
// module's main export and names it `path` here. path joins file paths safely.
import path from 'node:path'
// Default import of the cookie-parser package (fills req.cookies).
import cookieParser from 'cookie-parser'
// Default import of Express itself.
import express from 'express'
// multer handles multipart/form-data uploads; imported here only for its error type.
import multer from 'multer'
// ZodError is the class zod throws when input fails a schema.
import { ZodError } from 'zod'
// Middleware: attachUser reads the session cookie; checkOrigin blocks cross-site writes.
import { attachUser, checkOrigin } from './auth/middleware.js'
import { config } from './config.js' // shared settings
import { dbKind, q } from './db/index.js' // which DB engine is used, and the query function
import { pendingMigrations } from './db/migrate.js' // lists unapplied migration files
import { HttpError } from './lib/errors.js' // our own error class with an HTTP status
import { log, requestLog } from './lib/log.js' // logger and per-request access-log middleware
import { authRoutes } from './routes/auth.js' // /api/auth/* routes
import { invitationRoutes } from './routes/invitations.js' // /api/invitations/* routes
import { projectRoutes } from './routes/projects.js' // /api/projects/* routes

// `export function` declares a function and makes it importable by other files.
export function buildApp() {
  // Calling express() creates a new, empty application object.
  const app = express()
  // Turn off the "X-Powered-By: Express" header (no need to advertise the stack).
  app.disable('x-powered-by')
  // Behind Render's (or any) HTTPS proxy: trust its forwarded headers.
  // app.set(name, value) changes an Express setting; 1 = trust one proxy hop,
  // so req.ip becomes the real client address from X-Forwarded-For.
  app.set('trust proxy', 1)
  // app.use(fn) adds middleware that runs for every request. First: access log.
  app.use(requestLog)
  // Parse JSON request bodies into req.body; reject bodies over 1 megabyte.
  app.use(express.json({ limit: '1mb' }))
  // Parse the Cookie header into the req.cookies object.
  app.use(cookieParser())
  // An inline middleware written as an arrow function (req, res, next) => { ... }.
  app.use((req, res, next) => {
    // res.set({ ... }) sets several response headers at once from an object.
    res.set({
      // Browsers must not guess content types (prevents some script injection).
      'X-Content-Type-Options': 'nosniff',
      // Only send the Referer header to our own origin.
      'Referrer-Policy': 'same-origin',
      // Our pages may never be shown inside an <iframe> (clickjacking defence).
      'X-Frame-Options': 'DENY',
      // Browser features: camera and location for our own pages only; mic and payments off.
      'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=()',
    })
    // In HTTPS deployments, tell browsers to use HTTPS only for a year (HSTS).
    if (config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    // Hand the request on to the next middleware.
    next()
  })

  // Health is unauthenticated and sits outside the /api router so it skips
  // the origin and session checks. 503 while a migration file is unapplied,
  // so a deploy that forgot to migrate fails its health check instead of
  // serving requests against the wrong schema.
  // app.get(path, handler) runs the handler only for GET requests to that path.
  // `async (req, res) => { ... }` is an async arrow function, so it can await.
  app.get('/api/health', async (req, res) => {
    // try { ... } catch (err) { ... }: if anything in try throws (or an awaited
    // Promise rejects), control jumps to catch with the error in `err`.
    try {
      // The simplest possible query, just to prove the database answers.
      await q('SELECT 1')
      // Array of migration file names not yet applied.
      const pending = await pendingMigrations()
      // A non-zero length is truthy. res.status(503) sets the status code and
      // returns res, so .json(obj) can be chained to send a JSON body.
      // `return` here also stops the handler.
      if (pending.length) return res.status(503).json({ ok: false, database: dbKind(), pendingMigrations: pending })
      // All good: status defaults to 200.
      res.json({ ok: true, database: dbKind() })
    } catch (err) {
      // Log the failure and answer 503 Service Unavailable.
      log.error('health check failed', { error: err.message })
      res.status(503).json({ ok: false, error: 'Database unavailable' })
    }
  })

  // Every /api request: CSRF origin check, then the session cookie becomes
  // req.user (or null; routes that need a user add requireUser themselves).
  // express.Router() creates a mini-app that can hold its own middleware/routes.
  const api = express.Router()
  // use() can take several middleware at once; they run in order.
  api.use(checkOrigin, attachUser)
  // Mount each group of routes onto the router.
  api.use(authRoutes)
  api.use(invitationRoutes)
  api.use(projectRoutes)
  // Mount the router at /api: a request to /api/auth/me reaches it as /auth/me.
  app.use('/api', api)

  // Anything under /api that no route answered: JSON 404 instead of HTML.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }))

  // In production the built web app is served from here too, so the app and
  // the API share one address. Hashed assets cache for a year; every other
  // path gets index.html and the app's router takes over.
  // path.join builds "<clientDir>/index.html"; existsSync checks it exists right now.
  if (existsSync(path.join(config.clientDir, 'index.html'))) {
    // express.static(dir, options) serves files from a folder. immutable +
    // maxAge '1y' lets browsers cache these fingerprinted files for a year.
    app.use('/assets', express.static(path.join(config.clientDir, 'assets'), { immutable: true, maxAge: '1y' }))
    // Serve other files in the build folder; `index: false` = do not auto-serve index.html for "/".
    app.use(express.static(config.clientDir, { index: false }))
    // `/.*/` is a regular-expression literal (between slashes) matching any
    // path. res.sendFile sends index.html with a no-cache header so new
    // deploys are picked up; the React router then handles the URL.
    app.get(/.*/, (req, res) => res.sendFile(path.join(config.clientDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }))
  }

  // Express 5 forwards rejected promises from async handlers here. Known
  // error types map to a status and a stable `code` the client can switch
  // on; anything else is logged with its stack and answered with a generic
  // 500 so internals never leak.
  // Four parameters = Express error handler.
  app.use((err, req, res, next) => {
    // If a response was already partly sent we cannot send another; let
    // Express's default handler close the connection.
    if (res.headersSent) return next(err)
    // `instanceof` checks whether an object was created from a given class.
    if (err instanceof ZodError) {
      // err.issues is an array; .map(fn) builds a new array by applying fn to
      // each item. `(i) => ({ ... })` returns an object literal; the extra
      // parentheses stop the braces being read as a function body.
      const details = err.issues.map((i) => ({ path: i.path, message: i.message }))
      // details[0]?.message: first issue's message if there is one; otherwise
      // `??` falls back to 'Invalid input'. 400 = Bad Request.
      return res.status(400).json({ error: details[0]?.message ?? 'Invalid input', code: 'VALIDATION', details })
    }
    // Our own errors already carry status, code and details.
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details })
    // multer.MulterError: an upload problem (too big, too many files, ...).
    if (err instanceof multer.MulterError) {
      // Ternary operator `cond ? a : b`: a if cond is true, else b.
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. The limit is 10 MB.' : 'Upload failed'
      return res.status(400).json({ error: message, code: err.code })
    }
    // express.json() tags its errors with a `type`: body was not valid JSON.
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON', code: 'BAD_JSON' })
    // Body was over the 1 MB limit: 413 Payload Too Large.
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large', code: 'TOO_LARGE' })
    // Unknown error: log full details on the server (req.originalUrl = full requested URL)...
    log.error('request failed', { method: req.method, path: req.originalUrl, error: err?.stack ?? String(err) })
    // ...but send only a generic message to the client.
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' })
  })
  // Give the finished app back to the caller (server.js or the smoke test).
  return app
}
