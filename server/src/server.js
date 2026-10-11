// Process entry point (`npm start` / `npm run dev`). Connects the database,
// applies migrations, seeds demo data on a first start in demo mode, then
// listens. Also owns the things only a long-lived process needs: the hourly
// session sweep and a graceful shutdown on SIGTERM/SIGINT. The HTTP app
// itself is built in app.js so the smoke test can run it without this file.
//
// Who runs it: Node runs this file directly (package.json "start"/"dev").
// Nothing imports it. Depends on app.js (the Express app), config.js
// (settings), db/index.js (database connection and queries), db/migrate.js
// (schema upgrades) and lib/log.js (logging). Order of work, top to bottom:
//   1. connect to the database   2. migrate the schema
//   3. seed demo data if needed  4. start listening for HTTP requests
//   5. register background timer and shutdown handlers.

// `import { a, b } from './file.js'` is an ES module "named import": it pulls
// the exported names `a` and `b` out of another file. The curly braces pick
// names; the path in quotes is relative to this file and must include `.js`.
import { buildApp } from './app.js' // the function that builds the Express app
import { config } from './config.js' // the shared settings object
// Several named imports from one module, separated by commas.
import { close, connect, dbKind, q } from './db/index.js'
import { migrate } from './db/migrate.js' // runs pending .sql migration files
import { log } from './lib/log.js' // the logger object (log.info / log.warn / log.error)

// Top-level `await`: in an ES module you may await at the top of the file
// (outside any function). `await` pauses until the Promise that connect()
// returns has finished, so nothing below runs before the database is ready.
await connect()
// Same pattern: wait until every pending migration has been applied.
await migrate()

// Only an empty database is seeded, so a restart never duplicates the demo.
// `if (condition) { ... }` runs the block only when the condition is truthy.
if (config.demo) {
  // q(sql) runs a SQL query and resolves to an array of row objects.
  // SQL: count(*) counts rows in "users"; `::int` is a Postgres cast to integer;
  // `AS n` names the result column "n".
  // `const [{ n }] = ...` is destructuring: take the first array element, then
  // pull its property `n` into a constant named n. `const` = cannot be reassigned.
  const [{ n }] = await q('SELECT count(*)::int AS n FROM users')
  // `===` is strict equality (same type and value, no conversion).
  if (n === 0) {
    // `import('...')` (with parentheses) is a dynamic import: it loads a module
    // at runtime and returns a Promise of its exports, so demo code is loaded
    // only when actually needed. Destructuring picks the seedDemo export.
    const { seedDemo } = await import('./seed/demo.js')
    // Insert the demo users/projects and wait until done.
    await seedDemo()
  }
}

// buildApp() returns an Express app; `.listen(port, callback)` starts the HTTP
// server on that port and calls the callback once it is accepting connections.
// `() => { ... }` is an arrow function: a short way to write a function.
// The returned Node http.Server is kept in `server` so we can close it later.
const server = buildApp().listen(config.port, () => {
  // log.info(message, fields): the second argument is an object literal
  // `{ key: value }`. `??` is the nullish-coalescing operator: use the left
  // value unless it is null/undefined, otherwise the right one.
  log.info('listening', { port: config.port, database: dbKind(), demo: config.demo, env: process.env.NODE_ENV ?? 'development' })
})
// Assigning a property on the server object. `65_000` is just 65000; the
// underscore is a numeric separator for readability. Unit: milliseconds.
server.keepAliveTimeout = 65_000 // longer than typical load-balancer idle timeouts

// Expired sessions are useless rows; sweep them hourly.
// setInterval(fn, ms) calls fn every ms milliseconds (3600_000 ms = 1 hour) and
// returns a timer handle. The arrow function runs a DELETE query (SQL: remove
// rows from "sessions" whose expires_at is earlier than the current time,
// now()). `.catch(fn)` attaches a handler for a rejected Promise, so a failed
// sweep is only logged (err.message is the error's text) instead of crashing.
const sweep = setInterval(() => q('DELETE FROM sessions WHERE expires_at < now()').catch((err) => log.warn('session sweep failed', { error: err.message })), 3600_000)
// unref() tells Node this timer alone should not keep the process running.
sweep.unref()

// Finish in-flight requests, then close the database, on a stop signal.
// The forced exit is a backstop for a request that never ends; unref'd so it
// can't keep an otherwise finished process alive.
// `let` declares a variable that CAN be reassigned (unlike const).
let stopping = false
// `async function name(param) { ... }` declares a function that may use
// `await` inside and always returns a Promise. `signal` is its parameter.
async function shutdown(signal) {
  // Guard clause: if already shutting down, `return` leaves the function early.
  if (stopping) return
  // Remember that shutdown has started so a second signal is ignored.
  stopping = true
  // Shorthand property `{ signal }` means `{ signal: signal }`.
  log.info('shutting down', { signal })
  // Stop the hourly session sweep timer.
  clearInterval(sweep)
  // setTimeout(fn, ms) runs fn once after ms (10 s). process.exit(1) ends the
  // process with exit code 1 (= failure) if shutdown takes too long.
  const forced = setTimeout(() => process.exit(1), 10_000)
  // Do not let this backstop timer keep the process alive by itself.
  forced.unref()
  // server.close(callback) stops accepting new connections and calls the
  // callback after open requests finish. The callback is an async arrow
  // function so it can await.
  server.close(async () => {
    // Close the database pool; `.catch(() => {})` swallows any error with an
    // empty function so shutdown always continues.
    await close().catch(() => {})
    // Exit code 0 = clean exit.
    process.exit(0)
  })
}
// process.on(eventName, handler) subscribes to a Node process event.
// SIGTERM is what hosts (Render, Docker) send to stop a process.
process.on('SIGTERM', () => shutdown('SIGTERM'))
// SIGINT is sent when you press Ctrl+C in the terminal.
process.on('SIGINT', () => shutdown('SIGINT'))
// A Promise rejected with nobody catching it: log it. `err?.stack` is optional
// chaining: read .stack only if err is not null/undefined (else undefined).
// String(err) converts any value to text as the fallback.
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { error: err?.stack ?? String(err) }))
// A thrown error nobody caught: the process state is unknown, so log and shut down.
process.on('uncaughtException', (err) => {
  // Log the stack trace (or the error as text).
  log.error('uncaught exception', { error: err?.stack ?? String(err) })
  // Begin the graceful shutdown described above.
  shutdown('uncaughtException')
})
