// Project documents (drawings, approvals, contracts, ...). A document is a
// title and category wrapped around one evidence file uploaded first via
// POST /evidence; the file itself is served and access-checked by
// evidence.js. Inspectors see only drawings and approvals plus their own
// uploads. Used by routes/projects.js and the demo seed.
//
// What this file does: list, create and archive (soft-delete) documents.
// Every change is written to the audit log so the history stays tamper-evident.
// Depends on: shared/records.js (category names), audit/audit.js (audit log),
// lib/errors.js (HTTP error helpers), lib/util.js (ids, timestamps) and
// evidence.js (links an uploaded file to this document).
// `q` is the query runner (SQL inside the current transaction, camelCase rows);
// `ctx` is the request context: the project, the user id, permission checks
// (`ctx.can(...)`) and the current time (`ctx.at`).

// Named imports: two constant tables of document categories shared with the client.
import { DOCUMENT_CATEGORIES, INSPECTOR_DOCUMENT_CATEGORIES } from '../../../shared/records.js'
// The function that appends an entry to the audit log.
import { audit } from '../audit/audit.js'
// Helpers that build HTTP 400 ("bad request") and 404 ("not found") errors.
import { badRequest, notFound } from '../lib/errors.js'
// Timestamp formatter and unique-id generator.
import { isoAt, newId } from '../lib/util.js'
// Links already-uploaded evidence files to a record.
import { attachEvidence } from './evidence.js'

/** Documents on the project; an inspector sees drawings, approvals and what they uploaded. */
// `export async function` = an importable function that returns a Promise.
export async function listDocuments(q, ctx) {
  // true when this user's role may see every document.
  const all = ctx.can('viewAllDocuments')
  // Return the query's Promise directly (the caller awaits it).
  // The SQL is a template literal (backticks), which may span lines and embed
  // `${expression}` values. It selects every document column (`d.*`) plus the
  // uploader's name (JOIN users) and the attached file's details (LEFT JOIN
  // keeps documents even with no evidence row). `AS` renames a column.
  // WHERE limits to this project ($1) and not-archived rows. The embedded
  // `${all ? '' : ...}` is a ternary (condition ? ifTrue : ifFalse): for
  // limited users it adds "category IN ('A', 'B') OR uploaded by me ($2)".
  // The IN list is built by `.map` wrapping each category in quotes and
  // `.join(', ')` gluing them with commas. ORDER BY ... DESC = newest first.
  // The second argument picks the parameter array to match: one value or two.
  return q(
    `SELECT d.*, u.name AS uploaded_by_name, v.id AS evidence_id, v.mime, v.size_bytes, v.file_name, v.sha256
       FROM documents d JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN evidence v ON v.document_id = d.id
      WHERE d.project_id = $1 AND d.archived_at IS NULL
        ${all ? '' : `AND (d.category IN (${INSPECTOR_DOCUMENT_CATEGORIES.map((c) => `'${c}'`).join(', ')}) OR d.uploaded_by = $2)`}
      ORDER BY d.created_at DESC`,
    all ? [ctx.project.id] : [ctx.project.id, ctx.userId],
  )
}

// Create a document. The third parameter is destructured from the request body.
export async function createDocument(q, ctx, { title, category, evidenceId }) {
  // `!x` is "not x": if the category is unknown, `throw` an error, which stops
  // this function and is turned into an HTTP 400 response by the router.
  if (!DOCUMENT_CATEGORIES[category]) throw badRequest('Choose a category')
  // Generate the new document's id.
  const id = newId()
  // Insert the document row; the six $n placeholders match the six array values.
  await q('INSERT INTO documents (id, project_id, title, category, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    id, ctx.project.id, title, category, ctx.userId, isoAt(ctx.at),
  ])
  // Attach the uploaded file. Array destructuring `const [file] = array`
  // takes the first element of the returned array.
  const [file] = await attachEvidence(q, ctx, [evidenceId], 'DOCUMENT', id)
  // Record the action in the audit log; the object literal names each field.
  await audit(q, {
    projectId: ctx.project.id, // which project
    actorId: ctx.userId, // who did it
    action: 'document.added', // machine-readable action name
    targetType: 'DOCUMENT', // kind of record affected
    targetId: id, // which record
    // Human-readable summary; `${...}` inserts values into the template literal.
    summary: `Added the document "${title}" (${DOCUMENT_CATEGORIES[category].toLowerCase()})`,
    // Extra data: the file's fingerprint and category. `{ category }` is
    // shorthand for `{ category: category }`.
    payload: { sha256: file.sha256, category },
    at: ctx.at, // when it happened
  })
  // Return the new id to the caller (shorthand property again).
  return { id }
}

// Archive (soft-delete) a document by id.
export async function archiveDocument(q, ctx, id) {
  // UPDATE sets archived_at to the database's current time, only for an
  // active document in this project; `RETURNING title` makes the UPDATE give
  // back the changed row's title. `const [d]` takes the first (only) row.
  const [d] = await q('UPDATE documents SET archived_at = now() WHERE id = $1 AND project_id = $2 AND archived_at IS NULL RETURNING title', [id, ctx.project.id])
  // No row came back means nothing matched: respond 404.
  if (!d) throw notFound('Document not found')
  // Write the audit entry for the archive, all fields on one line.
  await audit(q, { projectId: ctx.project.id, actorId: ctx.userId, action: 'document.archived', targetType: 'DOCUMENT', targetId: id, summary: `Archived the document "${d.title}"`, at: ctx.at })
}
