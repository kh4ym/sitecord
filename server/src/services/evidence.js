// FILE: server/src/services/evidence.js
//
// WHAT IT DOES
// Evidence files: photos, receipts and documents. Checks the real file type,
// stores the file after the DB row (with an undo on rollback), records GPS and
// timing data for the checks, and decides who may see which file. Also
// attaches loose uploads to records (purchases, payments, reports...), finds
// files reused across records, and recomputes distances when the site pin moves.
//
// WHY IT EXISTS
// Proof is the heart of the app: every purchase/payment/verification relies
// on files that can't be faked by renaming, reused silently, or seen by the
// wrong person. All of those rules live here.
//
// WHO USES IT
// routes (upload and file download), expenses.js, payments.js, decisions.js,
// projects.js (recomputeDistances), dashboard.js (looseEvidence) and the seed.
//
// WHAT IT DEPENDS ON
// Node's fs/promises and path modules (disk storage), shared/geo.js (GPS
// distance), shared/records.js (evidence kinds), audit, config (upload
// folder), error helpers and lib/util.js (ids, hashes, idempotency lookup).
//
// Services take (q, ctx, ...): q runs SQL in the current transaction and
// resolves to camelCased rows; ctx is who is acting on which project.

// Named imports from Node's built-in promise-based file-system module
// ('node:' prefix = built-in): make folders, delete files, write files.
import { mkdir, unlink, writeFile } from 'node:fs/promises'
// Default import (no braces): the whole `path` module, for joining file paths safely.
import path from 'node:path'
// distanceFromSite = metres from the site pin; usableFix = is a GPS fix accurate enough.
import { distanceFromSite, usableFix } from '../../../shared/geo.js'
// Labels of evidence kinds, which kinds fit which record, and document categories inspectors may see.
import { EVIDENCE_KINDS, EVIDENCE_KINDS_FOR, INSPECTOR_DOCUMENT_CATEGORIES } from '../../../shared/records.js'
// Audit trail writer.
import { audit } from '../audit/audit.js'
// Server configuration (here: config.uploadDir).
import { config } from '../config.js'
// HTTP error builders.
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
// Idempotency lookup by client id, ISO timestamps, new ids, SHA-256 hashing.
import { findByClientId, isoAt, newId, sha256 } from '../lib/util.js'

/** Real file type from the first bytes, never from the name or the browser's claim. */
// `buf` is a Node Buffer (raw bytes).
function sniff(buf) {
  // subarray(0, 12) = the first 12 bytes (without copying); toString('hex') = as hex text.
  const hex = buf.subarray(0, 12).toString('hex')
  // JPEG files start with bytes FF D8 FF. Return an object { mime, ext }.
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg' }
  // PNG files start with the 8-byte PNG signature.
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png' }
  // WebP: "RIFF" in bytes 0-3 and "WEBP" in bytes 8-11 (toString() with no arg = text).
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  // PDF files start with the text "%PDF-".
  if (buf.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  // Anything else is not accepted.
  return null
}

// Human words for how a file was captured (used in audit lines).
const CAPTURE_LABEL = { IN_APP_CAMERA: 'live camera', GALLERY: 'gallery', FILE: 'file' }

/** Where a file lives on disk. Keys are made of ids and a sniffed extension, never of user input. */
// Exported arrow function: path.join glues the upload folder and the key with the OS separator.
export const filePath = (storageKey) => path.join(config.uploadDir, storageKey)

/**
 * Store an uploaded file as evidence. `trusted` allows seed-generated SVGs,
 * which are never accepted from the network. A repeat of the same `clientId`
 * (the outbox retrying after a lost response) returns the file already stored.
 * The file is written after the row; if the transaction then rolls back, the
 * context's cleanup removes it again.
 */
export async function saveEvidence(
  // The query function and the request context.
  q,
  ctx,
  // Destructure the upload object. `type: trustedType` renames the property
  // `type` to a local variable called trustedType (only the seed passes it).
  { buffer, fileName, kind, captureMode, capturedAt, lat, lng, accuracyM, clientSentAt, clientId, caption, type: trustedType },
) {
  // `??`: use the trusted type if given, else sniff the bytes.
  const type = trustedType ?? sniff(buffer)
  // Unknown type: 400.
  if (!type) throw badRequest('Only photos (JPEG, PNG, WebP) and PDF files can be uploaded')
  // The evidence kind must be one we know (bracket lookup returns undefined otherwise).
  if (!EVIDENCE_KINDS[kind]) throw badRequest('Unknown evidence type')
  // SHA-256 fingerprint of the bytes, used to spot identical files.
  const hash = sha256(buffer)
  // Has this user already uploaded with this clientId (a retry)?
  const existing = await findByClientId(q, 'evidence', 'uploaded_by', ctx, clientId)
  if (existing) {
    // Same id but different bytes: a genuine conflict (409).
    if (existing.sha256 !== hash) throw conflict('A different file was already sent with this id', { code: 'CLIENT_ID_CONFLICT' })
    // Same file: return the stored one and flag it as a replay.
    return { id: existing.id, sha256: hash, replay: true }
  }
  // Build a GPS "fix" object only when both coordinates are present (`!= null`
  // is true for anything except null/undefined). Accuracy is capped at 100 km
  // with Math.min; nested ternaries handle missing accuracy and missing fix.
  const fix = lat != null && lng != null ? { lat, lng, accuracyM: accuracyM != null ? Math.min(accuracyM, 100000) : null } : null
  // Distance from the site pin, only for a usable fix (`fix && ...` short-circuits when fix is null).
  const distance = fix && usableFix(fix) ? distanceFromSite(ctx.project, fix) : null
  // New evidence id.
  const id = newId()
  // Disk key "projectId/evidenceId.ext" (template literal); no user text in it.
  const storageKey = `${ctx.project.id}/${id}.${type.ext}`
  // Server receive time as ISO text.
  const at = isoAt(ctx.at)
  // INSERT the evidence row with 19 placeholders.
  await q(
    `INSERT INTO evidence (id, project_id, kind, file_name, mime, size_bytes, sha256, storage_key, capture_mode, captured_at,
                           received_at, lat, lng, accuracy_m, distance_m, client_sent_at, client_id, caption, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    // Values in order. fileName.slice(0, 200) truncates long names; buffer.length
    // is the size in bytes; `fix?.lat ?? null` = the latitude or NULL; distance is
    // rounded to whole metres; caption?.slice(0, 300) truncates if a caption exists.
    [id, ctx.project.id, kind, fileName.slice(0, 200), type.mime, buffer.length, hash, storageKey, captureMode,
      capturedAt ?? null, at, fix?.lat ?? null, fix?.lng ?? null, fix?.accuracyM ?? null,
      distance != null ? Math.round(distance) : null, clientSentAt ?? null, clientId ?? null, caption?.slice(0, 300) ?? null, ctx.userId],
  )
  // Audit line for the upload.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'evidence.uploaded',
    targetType: 'EVIDENCE',
    targetId: id,
    // e.g. "Uploaded receipt (live camera)".
    summary: `Uploaded ${EVIDENCE_KINDS[kind].toLowerCase()} (${CAPTURE_LABEL[captureMode]})`,
    // Structured data: kind, hash, capture mode and size.
    payload: { kind, sha256: hash, captureMode, sizeBytes: buffer.length },
    at: ctx.at,
  })
  // Row first, file second: if the write fails the transaction rolls back
  // and no row points at a missing file. If something later in the same
  // transaction fails, routes/context.js runs the cleanup and unlinks it.
  // The one gap (crash between commit and write) leaves a row without a
  // file, which the file route answers with a plain 404.
  // Full path on disk.
  const target = filePath(storageKey)
  // Create the project's folder if needed; { recursive: true } also creates parents and doesn't fail if it exists.
  await mkdir(path.dirname(target), { recursive: true })
  // Write the bytes.
  await writeFile(target, buffer)
  // Register an undo: `ctx.cleanup?.push(...)` only runs if ctx.cleanup exists;
  // the pushed arrow function deletes the file if the transaction rolls back.
  ctx.cleanup?.push(() => unlink(target))
  // Return the new id and hash.
  return { id, sha256: hash }
}

// The evidence columns safe to send to clients (storage_key is deliberately absent).
// An array literal of strings spanning several lines.
const EVIDENCE_FIELDS = [
  'id', 'kind', 'file_name', 'mime', 'size_bytes', 'sha256', 'capture_mode', 'captured_at', 'received_at', 'client_sent_at',
  'lat', 'lng', 'accuracy_m', 'distance_m', 'caption', 'uploaded_by',
  'expense_id', 'payment_id', 'report_id', 'change_id', 'inspection_id', 'document_id', 'decision_id',
]
// The same list as one comma-separated string for SELECT clauses.
const EVIDENCE_COLUMNS = EVIDENCE_FIELDS.join(', ')

// One evidence row (including storage_key, for the server's own use).
export async function getEvidence(q, projectId, id) {
  // SQL: the public columns plus storage_key, only within this project.
  const [row] = await q(`SELECT ${EVIDENCE_COLUMNS}, storage_key FROM evidence WHERE id = $1 AND project_id = $2`, [id, projectId])
  // Not found: 404.
  if (!row) throw notFound('File not found')
  return row
}

/**
 * Whether this person may open a file: anything they uploaded; otherwise by
 * what the file is attached to. Purchase and payment proof only reaches
 * people who see the money, and a draft purchase's proof only its author.
 * Inspectors see inspection photos and drawings, and report and site photos
 * only while the owner shares PHOTOS with them.
 */
// Returns a Promise of true/false. `ev` is an evidence row (camelCased).
export async function canViewEvidence(q, ctx, ev) {
  // The uploader can always see their own file.
  if (ev.uploadedBy === ctx.userId) return true
  // Order matters: money proof is checked before the blanket viewMoney pass
  // so a draft purchase's receipt stays with its author.
  if (ev.expenseId) {
    // Purchase proof needs money visibility.
    if (!ctx.can('viewMoney')) return false
    // Look up the purchase's status.
    const [e] = await q('SELECT status FROM expenses WHERE id = $1', [ev.expenseId])
    // Visible unless the purchase is still a draft (e?. guards a missing row).
    return e?.status !== 'DRAFT'
  }
  // Payment proof: money people only.
  if (ev.paymentId) return ctx.can('viewMoney')
  // Anyone who sees the money sees everything else too.
  if (ctx.can('viewMoney')) return true
  // Inspection photos are visible to all members.
  if (ev.inspectionId) return true
  // Change-request files need viewChanges.
  if (ev.changeId) return ctx.can('viewChanges')
  // Report photos need viewPhotos (inspectors get it via a PHOTOS share).
  if (ev.reportId) return ctx.can('viewPhotos')
  // Documents.
  if (ev.documentId) {
    // Some roles see all documents.
    if (ctx.can('viewAllDocuments')) return true
    // Others only certain categories (e.g. drawings).
    const [d] = await q('SELECT category FROM documents WHERE id = $1', [ev.documentId])
    return INSPECTOR_DOCUMENT_CATEGORIES.includes(d?.category)
  }
  // Verification photos attached to a decision.
  if (ev.decisionId) {
    // What kind of record the decision was about.
    const [d] = await q('SELECT target_type FROM decisions WHERE id = $1', [ev.decisionId])
    // Only report verifications are visible, and only with viewPhotos.
    return d?.targetType === 'REPORT' && ctx.can('viewPhotos')
  }
  // A loose (unattached) photo: needs viewPhotos.
  return ev.kind === 'PHOTO' && ctx.can('viewPhotos')
}

/** When the site pin moves, every file's distance from it is worked out again. */
export async function recomputeDistances(q, project) {
  // All the project's files that have GPS coordinates.
  const rows = await q('SELECT id, lat, lng, accuracy_m FROM evidence WHERE project_id = $1 AND lat IS NOT NULL', [project.id])
  // `for (const r of rows)` loops over each array element.
  for (const r of rows) {
    // New distance (null when the fix isn't usable or there's no pin).
    const d = usableFix(r) ? distanceFromSite(project, r) : null
    // Store it, rounded, or NULL.
    await q('UPDATE evidence SET distance_m = $2 WHERE id = $1', [r.id, d != null ? Math.round(d) : null])
  }
}

// Which evidence column each record type attaches through.
const COLUMN = {
  EXPENSE: 'expense_id',
  PAYMENT: 'payment_id',
  REPORT: 'report_id',
  CHANGE: 'change_id',
  INSPECTION: 'inspection_id',
  DOCUMENT: 'document_id',
  DECISION: 'decision_id',
}
// snake_case → camelCase, e.g. 'expense_id' → 'expenseId'. The regex finds
// "_" followed by a lowercase letter; the replacer function receives the whole
// match (ignored, named `_`) and the captured letter `x`, and returns it upper-cased.
const camel = (c) => c.replace(/_([a-z])/g, (_, x) => x.toUpperCase())
// True if the evidence row is attached to any record: Object.values gives the
// column names, .some returns true if any of them has a value on the row.
const isLinked = (ev) => Object.values(COLUMN).some((c) => ev[camel(c)])

/**
 * Attach uploaded files to a record. Each file must belong to this project,
 * be of a kind that fits the record, be unattached, and have been uploaded
 * by the person attaching it. Returns the attached rows.
 */
export async function attachEvidence(q, ctx, ids, targetType, targetId) {
  // The column to set, e.g. 'expense_id'.
  const column = COLUMN[targetType]
  // Kinds of evidence allowed on this record type.
  const kinds = EVIDENCE_KINDS_FOR[targetType]
  // Collects the attached rows.
  const attached = []
  // `new Set(ids ?? [])` removes duplicate ids (and treats missing ids as an
  // empty list); `[...set]` spreads the Set back into an array to loop over.
  for (const id of [...new Set(ids ?? [])]) {
    // Load the file (404 if not in this project).
    const ev = await getEvidence(q, ctx.project.id, id)
    // Already attached to this very record: keep it and move on.
    if (ev[camel(column)] === targetId) {
      attached.push(ev)
      // `continue` skips to the next loop iteration.
      continue
    }
    // Attached somewhere else: refuse.
    if (isLinked(ev)) throw badRequest(`"${ev.fileName}" is already attached to another record`)
    // Someone else's upload: refuse.
    if (ev.uploadedBy !== ctx.userId) throw forbidden('You can only attach files you uploaded')
    // Wrong kind for this record (e.g. a receipt on a report).
    if (!kinds.includes(ev.kind)) throw badRequest(`A ${EVIDENCE_KINDS[ev.kind].toLowerCase()} can't be attached here`)
    // Set the link column (column name comes from the fixed COLUMN map, not user input).
    await q(`UPDATE evidence SET ${column} = $1 WHERE id = $2`, [targetId, id])
    // Push a copy with the link filled in. `[camel(column)]: targetId` is a
    // computed property name: the key is whatever the expression evaluates to.
    attached.push({ ...ev, [camel(column)]: targetId })
  }
  // The full list of attached rows.
  return attached
}

// All files attached to one record, oldest first.
export async function evidenceFor(q, targetType, targetId) {
  // SQL: the public evidence fields prefixed with the alias `e.` (built by
  // .map + .join), plus the uploader's name via JOIN users; WHERE uses the
  // record type's link column (from COLUMN) equal to $1.
  return q(
    `SELECT ${EVIDENCE_FIELDS.map((c) => `e.${c}`).join(', ')}, u.name AS uploaded_by_name
       FROM evidence e JOIN users u ON u.id = e.uploaded_by
      WHERE e.${COLUMN[targetType]} = $1 ORDER BY e.received_at`,
    [targetId],
  )
}

/** Same file already attached to a different record in this project? */
export async function reusedFiles(q, projectId, evidenceRows, targetType, targetId) {
  // Link column for this record type.
  const column = COLUMN[targetType]
  // Collects the files that were reused.
  const reused = []
  // Check each file.
  for (const ev of evidenceRows) {
    // SQL: another evidence row (id <> $3, "not equal") in this project with
    // the same sha256 that is attached to some record other than this one:
    //   `column IS DISTINCT FROM $4` — a NULL-safe "not equal".
    //   num_nonnulls(...) > 0 — counts non-NULL link columns: it is attached somewhere.
    //   LIMIT 1 — one match is enough.
    const [other] = await q(
      `SELECT id FROM evidence WHERE project_id = $1 AND sha256 = $2 AND id <> $3
         AND (${column} IS DISTINCT FROM $4) AND num_nonnulls(expense_id, payment_id, report_id, change_id, inspection_id, document_id, decision_id) > 0
       LIMIT 1`,
      [projectId, ev.sha256, ev.id, targetId],
    )
    // Found one: this file is a reuse.
    if (other) reused.push(ev)
  }
  return reused
}

/** Files the user uploaded since `sinceIso` that aren't attached to anything yet (quick captures from Today). */
export async function looseEvidence(q, ctx, sinceIso) {
  // SQL: this user's files in this project received since the given time,
  // with no link columns set (num_nonnulls(...) = 0), newest first.
  return q(
    `SELECT ${EVIDENCE_COLUMNS} FROM evidence
      WHERE project_id = $1 AND uploaded_by = $2 AND received_at >= $3
        AND num_nonnulls(expense_id, payment_id, report_id, change_id, inspection_id, document_id, decision_id) = 0
      ORDER BY received_at DESC`,
    [ctx.project.id, ctx.userId, sinceIso],
  )
}
