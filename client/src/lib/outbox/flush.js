// FILE: client/src/lib/outbox/flush.js
//
// What it does: sends the outbox (items saved on the phone while offline).
// For each item: files first (each with its own retry key), then the record
// (report or purchase) with all their ids and its retry key. The server
// recognises retry keys, so a send that was cut off half-way never creates
// anything twice. Failed sends wait longer each time (back-off).
//
// Where it's used: only OutboxProvider calls flushOutbox; OutboxList calls
// retryItem (via useOutbox).
//
// Depends on: lib/api.js (requests and uploads), lib/net.js (isRetryable)
// and ./store.js (reading and updating queued items).

// Named imports from the parent folder (`../`).
import { api, uploadEvidence } from '../api.js'
import { isRetryable } from '../net.js'
// Named imports from the sibling store module.
import { getSnapshot, removeItem, setProgress, updateItem } from './store.js'

// Wait between attempts grows with each failure and caps at five minutes;
// `force` (app opened, back online) ignores it. `running` keeps the many
// triggers in OutboxProvider from starting two flushes at once.
const BACKOFF = [5, 15, 30, 60, 120, 300] // seconds
// Module-level lock flag.
let running = false

// PHOTO items have no record: their files are the whole item.
// Lookup table from item kind to the API path segment.
const ENDPOINT = { REPORT: 'reports', PURCHASE: 'expenses' }

/**
 * Send whatever is due for this person. Stops at the first sign of no
 * connection. `force` skips the back-off wait, for moments when the
 * connection has probably just come back (app opened, back online).
 */
// The second parameter destructures callbacks and a flag, defaulting to {}.
export async function flushOutbox(userId, { onSent, onFailed, force = false } = {}) {
  // Only the browser's own offline flag stops a try: a weak signal is tested by trying.
  // Also skip if a flush is already running or nobody is signed in.
  if (running || !userId || navigator.onLine === false) return
  // Take the lock.
  running = true
  // try/finally: the `finally` block always runs, even if something throws, so the lock is released.
  try {
    // Build the list of items to send now (method chain across lines):
    const due = getSnapshot()
      // keep this user's items that aren't FAILED and whose wait is over (or force is set).
      // `(i.nextAttemptAt ?? 0) <= Date.now()` treats a missing time as "due".
      .items.filter((i) => i.userId === userId && i.status !== 'FAILED' && (force || (i.nextAttemptAt ?? 0) <= Date.now()))
      // Oldest first. A sort comparator returns negative/zero/positive to order a before/with/after b.
      .sort((a, b) => a.createdAt - b.createdAt)
    // `for...of` with `await` inside sends items one at a time, in order.
    for (const item of due) {
      // Wait for this item to finish; result is 'sent', 'failed' or 'later'.
      const result = await sendOne(item)
      // Call the matching callback if provided (`?.()`).
      if (result === 'sent') onSent?.(item)
      else if (result === 'failed') onFailed?.(item)
      else break // no connection: try again later, in order
    }
  } finally {
    // Release the lock.
    running = false
  }
}

/**
 * One item, start to finish. Each uploaded file's evidenceId is written back
 * to the store (and its blob dropped) straight away, so a retry after a
 * dropped connection only sends what's still missing.
 */
// Not exported: internal helper.
async function sendOne(original) {
  // Mark it SENDING; updateItem returns the updated item. `let` because we replace it later.
  let item = await updateItem(original.id, { status: 'SENDING' })
  // Number of files in the item.
  const total = item.files.length
  // A closure that counts files already uploaded (those with an evidenceId). It reads
  // the current `item` variable each time it's called.
  const done = () => item.files.filter((f) => f.evidenceId).length
  // Publish initial progress for the UI.
  setProgress(item.id, { sent: done(), total, fraction: 0 })
  try {
    // Upload each file in turn.
    for (const f of item.files) {
      // `continue` skips to the next loop iteration: this file was sent on an earlier try.
      if (f.evidenceId) continue
      // Re-wrap the stored Blob as a File with a name and MIME type (fallbacks via `||`).
      const file = new File([f.blob], f.name || 'photo.jpg', { type: f.blob.type || 'image/jpeg' })
      // Upload it. Meta is the file's meta plus a retry key "<itemId>:<fileKey>".
      // The last argument is the progress callback (0..1 for this file).
      const ev = await uploadEvidence(item.projectId, file, { ...f.meta, clientId: `${item.id}:${f.key}` }, (fraction) =>
        setProgress(item.id, { sent: done(), total, fraction }),
      )
      // Save the new evidence id onto this file and drop the blob to free disk space.
      // `.map` copies the list, replacing only the matching file with `{ ...x, ...changes }`.
      item = await updateItem(item.id, { files: item.files.map((x) => (x.key === f.key ? { ...x, evidenceId: ev.id, blob: null } : x)) })
      // Progress: one more file sent, next file at 0%.
      setProgress(item.id, { sent: done(), total, fraction: 0 })
    }
    // Reports and purchases also need their record created (photos don't).
    if (ENDPOINT[item.kind]) {
      // Combine any evidence ids already in the body with the ones just uploaded.
      // `[...a, ...b]` spreads two arrays into one new array.
      const evidenceIds = [...(item.body.evidenceIds ?? []), ...item.files.map((f) => f.evidenceId)]
      // POST the record; `clientId: item.id` is its retry key so a repeat isn't duplicated.
      await api(`/projects/${item.projectId}/${ENDPOINT[item.kind]}`, { method: 'POST', body: { ...item.body, evidenceIds, clientId: item.id } })
    }
    // Everything sent: delete it from the outbox.
    await removeItem(item.id)
    return 'sent'
  } catch (err) {
    // Connection trouble, or signed out (401): keep it and try later. Anything
    // else (validation, 403) won't fix itself, so it's FAILED until the person retries.
    if (isRetryable(err) || err.status === 401) {
      // One more failed attempt.
      const attempts = (item.attempts ?? 0) + 1
      // Back to WAITING, with the next try scheduled using the back-off table
      // (index capped at the last entry), converted from seconds to milliseconds.
      await updateItem(item.id, { status: 'WAITING', attempts, nextAttemptAt: Date.now() + BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] * 1000 })
      // Clear the progress bar.
      setProgress(item.id, null)
      return 'later'
    }
    // Permanent failure: store the message so the UI can show why.
    await updateItem(item.id, { status: 'FAILED', error: err.message })
    setProgress(item.id, null)
    return 'failed'
  }
}

/** Put a failed item back in line (after the person fixed what was wrong elsewhere). */
// Resets status and counters; returns the Promise from updateItem.
export const retryItem = (id) => updateItem(id, { status: 'WAITING', error: null, nextAttemptAt: 0, attempts: 0 })
