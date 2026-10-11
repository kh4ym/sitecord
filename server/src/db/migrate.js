// Forward-only SQL migrations. Files in ./migrations run in name order and
// are recorded in schema_migrations; there is no "down". Called once at
// start by server.js, seed/run.js and the smoke test; the health check uses
// pendingMigrations() to refuse traffic on an out-of-date schema.
//
// A "migration" is a .sql file that changes the database structure (creates
// tables, adds columns...). Files are named 001_..., 002_... so sorting by
// name gives the right order. Depends on db/index.js and lib/log.js.

// readdirSync lists a folder's files; readFileSync reads a file's contents.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path' // path helpers (join, dirname)
import { fileURLToPath } from 'node:url' // file:// URL → normal path
import { log } from '../lib/log.js' // logger
// exec: run a script; q: run a query; tx: run inside a transaction.
import { exec, q, tx } from './index.js'

// Absolute path of the migrations folder next to this file.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * Apply every migrations/*.sql file not yet recorded, in name order, inside
 * one transaction. An advisory lock keeps two instances starting at the
 * same time from applying the same file twice.
 */
export async function migrate() {
  // The bookkeeping table is created outside the transaction so the lock
  // below has something to key on even on a brand-new database.
  // SQL: CREATE TABLE IF NOT EXISTS makes the table only if missing; columns:
  // name (text, PRIMARY KEY = unique and required) and applied_at (timestamp
  // with time zone, NOT NULL, defaulting to the current time).
  await exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  // tx(async (run) => {...}): everything inside is one transaction; `run` is
  // that transaction's query function.
  await tx(async (run) => {
    // Transaction-scoped lock: a second instance blocks here until the first
    // commits, then reads the updated `done` set and finds nothing to apply.
    // Either every pending file applies or none does (the tx rolls back).
    // Double-quoted JS string because the SQL inside uses single quotes.
    await run("SELECT pg_advisory_xact_lock(hashtext('schema_migrations'))")
    // A Set is a collection of unique values with fast .has() lookup.
    // Read all applied names, map each row to its name, build a Set.
    const done = new Set((await run('SELECT name FROM schema_migrations')).map((r) => r.name))
    // List the folder, keep only names ending in ".sql", sort alphabetically.
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    // for...of loops over array values one by one.
    for (const file of files) {
      // `continue` skips to the next loop iteration (already applied).
      if (done.has(file)) continue
      // run.exec sends the whole file as one script, so a migration can hold
      // several statements (and $$-quoted function bodies) without splitting.
      // 'utf8' = read the file as text.
      await run.exec(readFileSync(path.join(dir, file), 'utf8'))
      // Record that the file is applied; $1 is filled from [file].
      await run('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      // Log line like "migrated file=001_init.sql".
      log.info('migrated', { file })
    }
  })
}

/** Names of migration files not yet applied (for the health check). */
export async function pendingMigrations() {
  // Same Set of applied names, read outside any transaction.
  const done = new Set((await q('SELECT name FROM schema_migrations')).map((r) => r.name))
  // .sql files whose name is NOT in the set (`!` negates).
  return readdirSync(dir).filter((f) => f.endsWith('.sql') && !done.has(f))
}
