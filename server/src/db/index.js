// PostgreSQL access. With DATABASE_URL set, connects to a PostgreSQL server
// through node-postgres. Without it, runs PGlite: PostgreSQL compiled to
// WebAssembly, in-process, persisted to server/.data — no install needed.
//
// Either way the API is the same:
//   q(sql, params)  → rows, with snake_case columns converted to camelCase
//   tx(fn)          → runs fn(q) inside a transaction; q.exec(sql) runs a script
//   exec(sql)       → runs a multi-statement script outside a transaction
//
// Used by nearly every server module (server.js, app.js, migrate.js, auth,
// routes, services). Depends on config.js and, loaded on demand, either the
// `pg` package (real PostgreSQL) or `@electric-sql/pglite` (embedded).
// A "transaction" groups several SQL statements so they all succeed together
// (COMMIT) or all are undone (ROLLBACK).

// mkdirSync creates a folder synchronously (blocking until done).
import { mkdirSync } from 'node:fs'
// Shared settings: databaseUrl and dataDir are used below.
import { config } from '../config.js'

// int8 and numeric as JS numbers (amounts are paisa, well inside 2^53),
// dates as plain 'YYYY-MM-DD' strings so they never shift across time zones.
// Object whose keys are Postgres type ids (20 = int8, 1700 = numeric,
// 1082 = date) and whose values are functions converting the raw text value.
// `(v) => v` returns the value unchanged.
const PARSERS = { 20: (v) => Number(v), 1700: (v) => Number(v), 1082: (v) => v }

// Converts "created_at" → "createdAt". `/_([a-z])/g` is a regex literal:
// an underscore followed by one lowercase letter (captured in parentheses);
// the `g` flag means "every match". The replacer function receives the whole
// match (ignored, named `_`) and the captured letter `c`, and returns it
// upper-cased.
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
// Converts every key of one result row with camel(). Multi-line arrow function body in braces.
const camelRow = (row) => {
  // Start with an empty object.
  const out = {}
  // for...in loops over an object's property NAMES. `out[expr] = value` sets
  // a property whose name is computed at runtime (bracket notation).
  for (const k in row) out[camel(k)] = row[k]
  // Return the converted row.
  return out
}

// The chosen backend, filled in by connect(). `let` because it changes once.
let impl = null

// Connects (once) and returns the backend object.
export async function connect() {
  // Already connected? Return the existing one.
  if (impl) return impl
  // Real PostgreSQL server branch.
  if (config.databaseUrl) {
    // Dynamic import of the `pg` package; `(await import('pg')).default`
    // waits for the module and takes its default export.
    const pg = (await import('pg')).default
    // Register our PARSERS with pg: Object.entries gives [key, fn] pairs; keys
    // are strings so Number(oid) converts them back to numbers.
    for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn)
    // `new pg.Pool({...})` creates a pool of up to 10 reusable connections.
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
    // An idle client dropping its connection must not take the process down.
    // pool.on('error', fn) handles the event; we just write it to stderr.
    pool.on('error', (err) => process.stderr.write(`database pool error: ${err.message}\n`))
    // runner(client) builds our `q`-style function around a pool or a single client.
    const runner = (client) => {
      // Run a query, wait for the result, take .rows and camelCase each row.
      // `(await x).rows` — parentheses make the await happen before reading .rows.
      const run = async (text, params) => (await client.query(text, params)).rows.map(camelRow)
      // Functions are objects, so we can attach an extra method `exec` to run.
      run.exec = (sql) => client.query(sql) // no params: the simple protocol accepts several statements
      // Give back the function (with its .exec).
      return run
    }
    // Assign the backend object.
    impl = {
      kind: 'postgres', // reported by dbKind() and the health check
      q: runner(pool), // non-transaction queries use any free pool connection
      exec: (sql) => pool.query(sql), // multi-statement scripts
      // One dedicated client per transaction: pool.query would spread the
      // statements across connections and BEGIN/COMMIT would mean nothing.
      // `async tx(fn) { ... }` is method shorthand inside an object literal.
      async tx(fn) {
        // Borrow one connection from the pool.
        const client = await pool.connect()
        // try/catch/finally: finally runs whether try succeeded or threw.
        try {
          // Start the transaction.
          await client.query('BEGIN')
          // Run the caller's work, giving it a q bound to this one connection.
          const out = await fn(runner(client))
          // Everything worked: make the changes permanent.
          await client.query('COMMIT')
          // Return whatever the caller's function returned.
          return out
        } catch (err) {
          // Undo everything; ignore a failure of the rollback itself.
          await client.query('ROLLBACK').catch(() => {})
          // Re-throw so the caller still sees the original error.
          throw err
        } finally {
          // Always give the connection back to the pool.
          client.release()
        }
      },
      // Close all pool connections (used at shutdown).
      close: () => pool.end(),
    }
  } else {
    // PGlite is single-connection, so its own transaction() serialises
    // callers; the runner shape is kept identical so services never know.
    // Dynamic import + destructuring of the named export PGlite.
    const { PGlite } = await import('@electric-sql/pglite')
    // Make sure the data folder exists; `recursive: true` also creates parents.
    mkdirSync(config.dataDir, { recursive: true })
    // Open (or create) the embedded database in that folder with our type parsers.
    const pglite = await PGlite.create(config.dataDir, { parsers: PARSERS })
    // Same runner idea as above, for PGlite or one of its transactions `c`.
    const runner = (c) => {
      // Query and camelCase rows.
      const run = async (text, params) => (await c.query(text, params)).rows.map(camelRow)
      // PGlite's exec runs a multi-statement script.
      run.exec = (sql) => c.exec(sql)
      return run
    }
    // The PGlite backend object; same shape as the postgres one.
    impl = {
      kind: 'pglite',
      q: runner(pglite),
      exec: (sql) => pglite.exec(sql),
      // pglite.transaction(cb) does BEGIN/COMMIT/ROLLBACK itself and passes a
      // transaction handle `t`; we wrap it with runner so fn gets a normal q.
      tx: (fn) => pglite.transaction((t) => fn(runner(t))),
      close: () => pglite.close(),
    }
  }
  // Return the backend that was just created.
  return impl
}

// Module-level handles that forward to whichever backend connect() picked.
// Services take `q` as a parameter instead of importing it, so the same code
// runs inside a transaction (routes/context.js run) or outside one.
/** Run a query outside a transaction. */
export const q = (text, params) => impl.q(text, params)
// Run fn(q) inside a transaction (see tx above).
export const tx = (fn) => impl.tx(fn)
// Run a multi-statement SQL script.
export const exec = (sql) => impl.exec(sql)
// `impl?.close()`: only call close if connected (impl not null).
export const close = () => impl?.close()
// 'postgres', 'pglite', or undefined before connect().
export const dbKind = () => impl?.kind
