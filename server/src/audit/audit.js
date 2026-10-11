// Tamper-evident audit trail. Every important action appends an event whose
// hash covers the previous event's hash; a database trigger blocks updates and
// deletes. verifyChain() recomputes every hash to prove nothing changed.
// Called by every service that changes something (always inside that
// service's transaction) and by POST /audit/verify. The chain is per
// project: seq restarts at 1 and prev_hash at 'GENESIS' for each one.
//
// Why a hash chain: each event's hash depends on the event's own data AND on
// the previous hash. Changing any old event would change its hash, which
// would no longer match the prev_hash stored in the next event, so tampering
// is detectable. Depends only on lib/util.js (timestamps, locks, sha256);
// the table and its trigger are defined in db/migrations/001_init.sql.

// Named imports: isoAt (timestamp text), lock (advisory lock), sha256 (hashing).
import { isoAt, lock, sha256 } from '../lib/util.js'

/** JSON with sorted keys, so the same data always hashes the same. */
// A recursive function (it calls itself for nested values).
function canonical(value) {
  // Array.isArray(x) is true for arrays. For an array, return "[a,b,c]" where
  // each item is canonicalised: .map(canonical) passes the function itself to
  // map, and .join(',') glues the results with commas inside a template literal.
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  // Non-null objects (typeof null is also 'object', so `value &&` excludes null).
  if (value && typeof value === 'object') {
    // Build "{...}" text: Object.keys(value) lists property names; .filter
    // drops keys whose value is undefined; .sort() orders the names
    // alphabetically (so key order never matters); .map turns each key into
    // `"key":<canonical value>` (JSON.stringify(k) adds the quotes); .join(',')
    // separates them with commas. The whole chain sits inside `${ }` of a
    // template literal that adds the outer braces.
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  // Plain values (string, number, boolean); null/undefined become "null".
  return JSON.stringify(value ?? null)
}

// hash = sha256(prevHash + "\n" + canonical(event fields)). The field list
// here is the contract: adding a column to audit_events without adding it
// here leaves it outside the chain. createdAt is normalised to ISO because
// the database hands it back as a Date and the seed passes a string.
// `e` is the event object (either one being written, or a row read back).
function computeHash(prevHash, e) {
  // Return the SHA-256 of one template literal: the previous hash, a newline
  // (\n), then the canonical JSON of an object literal listing exactly the
  // hashed fields. Optional fields use `?? null` (or `?? {}` for payload) so
  // "missing" and "null" hash identically. new Date(...).toISOString() turns
  // either a Date or a string into the same ISO text.
  return sha256(
    `${prevHash}\n${canonical({
      projectId: e.projectId,
      seq: e.seq,
      actorId: e.actorId ?? null,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      summary: e.summary,
      payload: e.payload ?? {},
      createdAt: new Date(e.createdAt).toISOString(),
    })}`,
  )
}

/**
 * Append an event. Call inside the same transaction as the change it records.
 * `at` back-dates the event (used only by the demo seed).
 */
// First parameter is the transaction's query function; the second is an
// object destructured into named fields; `payload = {}` is a default value.
export async function audit(q, { projectId, actorId, action, targetType, targetId, summary, payload = {}, at }) {
  // The lock serialises appends per project so two transactions can't both
  // read the same `last` and produce a fork; UNIQUE (project_id, seq) would
  // reject the loser anyway, but the lock avoids the failed transaction.
  await lock(q, `audit:${projectId}`)
  // SQL: the newest event of this project — ORDER BY seq DESC sorts from
  // highest to lowest, LIMIT 1 keeps only the first. `last` is undefined if none.
  const [last] = await q('SELECT seq, hash FROM audit_events WHERE project_id = $1 ORDER BY seq DESC LIMIT 1', [projectId])
  // Next sequence number: last.seq + 1, or 1 for the first event.
  const seq = (last?.seq ?? 0) + 1
  // The first event links to the fixed string 'GENESIS'.
  const prevHash = last?.hash ?? 'GENESIS'
  // Timestamp for this event (now, or the seed's back-dated `at`).
  const createdAt = isoAt(at)
  // Hash this event; the object uses shorthand properties (`seq` = `seq: seq`).
  const hash = computeHash(prevHash, { projectId, seq, actorId, action, targetType, targetId, summary, payload, createdAt })
  // SQL: INSERT one row with 11 columns; VALUES $1..$11 are filled from the
  // array below in order. `$8::jsonb` casts the JSON text to Postgres's
  // binary JSON type.
  await q(
    `INSERT INTO audit_events (project_id, seq, actor_id, action, target_type, target_id, summary, payload, prev_hash, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
    // Parameter values; JSON.stringify(payload) turns the object into JSON text.
    [projectId, seq, actorId ?? null, action, targetType ?? null, targetId ?? null, summary, JSON.stringify(payload), prevHash, hash, createdAt],
  )
  // Return the new event's position and hash.
  return { seq, hash }
}

/** Walk the chain from GENESIS; stops at the first event whose links don't match. */
export async function verifyChain(q, projectId) {
  // SQL: every event of the project, oldest first (ORDER BY seq ascending).
  const rows = await q('SELECT * FROM audit_events WHERE project_id = $1 ORDER BY seq', [projectId])
  // The hash the next event must point back to; starts at 'GENESIS'.
  let prev = 'GENESIS'
  // Check each event in order.
  for (const row of rows) {
    // Recompute what this event's hash should be.
    const expected = computeHash(prev, row)
    // `||` = OR: broken if the stored back-link or the stored hash is wrong.
    if (row.prevHash !== prev || row.hash !== expected) {
      // Report where the chain broke and how many events were fine before it.
      return { ok: false, total: rows.length, checked: row.seq - 1, brokenAt: row.seq, head: prev }
    }
    // Move along the chain.
    prev = row.hash
  }
  // Every event checked out; `head` is the latest hash.
  return { ok: true, total: rows.length, checked: rows.length, head: prev, checkedAt: new Date().toISOString() }
}
