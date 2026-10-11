// Small helpers shared by the services: ids and tokens, hashing, timestamps,
// and the two transaction-scoped building blocks every write path leans on
// (advisory locks and per-project numbering). Also re-exports todayPK so
// server code has one place to get "today in Pakistan".
//
// Used by: auth/sessions.js, audit/audit.js, the services and routes.
// Depends on Node's crypto module, lib/errors.js and shared/houseConfig.js.
// Several helpers take `q` as their first argument: that is the query
// function of the CURRENT database transaction (see db/index.js), so their
// SQL runs inside the caller's transaction.

// Three named imports from Node's built-in cryptography module.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
// Shorthand that builds a 409 Conflict HttpError.
import { conflict } from './errors.js'

// Ids are UUIDs; tokens (sessions, invitations) are 256 random bits in
// base64url, and only their sha256 is ever stored.
// `() => randomUUID()`: arrow function with no parameters that returns a new
// random id like "3f2b...-...".
export const newId = () => randomUUID()
// 32 random bytes (= 256 bits) encoded as URL-safe base64 text.
export const newToken = () => randomBytes(32).toString('base64url')
// Chained calls: make a SHA-256 hasher, feed it data, output hex text.
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** ISO timestamp for "now", or for a fixed time when seeding history. */
// If `at` is null/undefined, `??` uses Date.now() instead.
export const isoAt = (at) => new Date(at ?? Date.now()).toISOString()

// Re-export: `export { name } from 'path'` makes another module's export
// available from this module too, without importing it for local use.
export { todayPK } from '../../../shared/houseConfig.js'

/** Postgres unique-violation error code. */
// Returns true when a database error is "duplicate value in a UNIQUE column".
// `err?.code` safely reads code even if err is null/undefined.
export const isUniqueViolation = (err) => err?.code === '23505'

/**
 * Serialise work on one key until the transaction ends. Advisory locks are
 * cheaper than row locks for "there is no row yet" cases (first audit event,
 * next number, first retry of a clientId) and are released automatically at
 * COMMIT/ROLLBACK, so there is nothing to unlock. Must be called with a
 * transaction's `q`; outside one it is a no-op in practice.
 */
// SQL: hashtext($1) turns the text key into a number; pg_advisory_xact_lock
// waits until no other transaction holds a lock on that number, then holds it
// until this transaction ends. `$1` is a query parameter: the value comes
// from the array [key], so it is never pasted into the SQL text (prevents
// SQL injection).
export const lock = (q, key) => q('SELECT pg_advisory_xact_lock(hashtext($1))', [key])

/**
 * Next per-project sequence number for a table with a `number` column
 * (P-12, C-3, ...). The lock makes MAX+1 safe under concurrent inserts; the
 * UNIQUE (project_id, number) constraint is the backstop.
 */
// `async function` returns a Promise; callers `await nextNumber(...)`.
export async function nextNumber(q, table, projectId) {
  // Lock key built with a template literal, e.g. "punch_items:<project id>".
  await lock(q, `${table}:${projectId}`)
  // SQL: MAX(number) = highest number so far in this project; COALESCE(x, 0)
  // returns 0 when x is NULL (no rows yet); +1 gives the next one, named n.
  // The table name is inserted with ${table} (only ever a fixed name from our
  // code, never user input); the project id is a $1 parameter.
  // `const [row] = ...` takes the first row of the result array.
  const [row] = await q(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM ${table} WHERE project_id = $1`, [projectId])
  // Hand back the number.
  return row.n
}

/**
 * Outbox retries: the record this person already created with `clientId`, or
 * null. Locked so two retries arriving together can't both create it. Checked
 * up front because any SQL error aborts the whole transaction.
 */
// ctx is the request context (project, userId, ...) built by routes/context.js.
export async function findByClientId(q, table, ownerColumn, ctx, clientId) {
  // No client id given → nothing to look up.
  if (!clientId) return null
  // Lock this specific (table, project, clientId) combination.
  await lock(q, `client:${table}:${ctx.project.id}:${clientId}`)
  // SQL: `SELECT *` = every column, plus the owner column again under the
  // alias owner_id; WHERE filters by project ($1) and client id ($2).
  const [row] = await q(`SELECT *, ${ownerColumn} AS owner_id FROM ${table} WHERE project_id = $1 AND client_id = $2`, [ctx.project.id, clientId])
  // Not found → it's a first attempt; the caller will create it.
  if (!row) return null
  // Column names come back camelCased (owner_id → ownerId, see db/index.js).
  // `!==` = strict "not equal". Someone else used this client id: refuse.
  if (row.ownerId !== ctx.userId) throw conflict('This offline item was already sent by someone else', { code: 'CLIENT_ID_CONFLICT' })
  // Same person retrying: return the existing record.
  return row
}
