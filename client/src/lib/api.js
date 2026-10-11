// FILE: client/src/lib/api.js
//
// What it does: a thin wrapper around the browser's `fetch` for talking to the
// SiteCord API (every URL starts with /api). It turns JSON in and out, turns
// HTTP errors into a single `ApiError` class, and has a separate upload helper
// (`uploadEvidence`) that uses XMLHttpRequest so it can report upload progress.
//
// Why it exists: so no page has to remember headers, cookies, JSON parsing or
// error shapes. The session is an httpOnly cookie, so JavaScript never sees a
// token; the browser sends the cookie automatically.
//
// Where it's used: lib/queries.js (every data hook) and lib/outbox/flush.js
// (the offline queue). Pages never call fetch directly.
//
// Depends on: lib/net.js. Every request tells net.js whether the server
// answered, which drives the "you are offline" banner.

// ES module import: pull the named export `reportNetwork` out of net.js.
// Curly braces = "named import" (must match the exported name exactly).
import { reportNetwork } from './net.js'

// `export` makes this class importable by other files.
// `class ApiError extends Error` declares a new class that inherits from the
// built-in Error class, so it has .message, a stack trace, and works with `throw`.
export class ApiError extends Error {
  // `constructor` runs when someone writes `new ApiError(status, body)`.
  constructor(status, body) {
    // `super(...)` calls the parent (Error) constructor with the message text.
    // `body?.error` is optional chaining: read .error only if body isn't null/undefined.
    // `??` (nullish coalescing) uses the right side only if the left is null/undefined.
    // `cond ? a : b` is the ternary operator; status 0 means "never reached the server".
    // The backtick string is a template literal; `${status}` inserts the value.
    super(body?.error ?? (status === 0 ? "Can't reach the server. Check your connection." : `Request failed (${status})`))
    // `this` is the new error object; store the HTTP status code on it.
    this.status = status
    // A machine-readable error code from the server, if any (optional chaining again).
    this.code = body?.code
    // Validation details from the server (an array of { path, message }), if any.
    this.details = body?.details
  }

  /** Field-level messages keyed by the first path segment, for forms. */
  // `get fieldErrors()` is a getter: callers read `err.fieldErrors` like a
  // property, but this function runs each time to compute the value.
  get fieldErrors() {
    // `const` declares a variable that can't be reassigned; `{}` is an empty object.
    const out = {}
    // Only loop if details is really an array. `for (const d of ...)` iterates each item.
    // `d.path?.[0]` safely reads the first element of path; `?? '_'` falls back to '_'.
    // `out[key] ??= value` assigns only if out[key] is still null/undefined (keeps the first message).
    if (Array.isArray(this.details)) for (const d of this.details) out[d.path?.[0] ?? '_'] ??= d.message
    // Hand back e.g. { name: 'Required', phone: 'Too short' }.
    return out
  }
}

// `async function` always returns a Promise and may use `await` inside.
// Parameters: `path` (e.g. '/projects'), then an options object that is
// destructured in place: `{ method = 'GET', body, signal }` pulls those keys
// out, `= 'GET'` is a default value, and the trailing `= {}` lets callers omit
// the options object entirely.
export async function api(path, { method = 'GET', body, signal } = {}) {
  // `let` declares a variable that can be reassigned later (filled inside try).
  let res
  // try/catch: if anything inside `try` throws, control jumps to `catch`.
  try {
    // `await` pauses until fetch's Promise settles, then gives the Response.
    // `/api${path}` is a template literal building the URL.
    res = await fetch(`/api${path}`, {
      // Shorthand property: `method` means `method: method`.
      method,
      // An AbortSignal lets the caller (e.g. TanStack Query) cancel the request.
      signal,
      // Send the session cookie, but only to our own origin.
      credentials: 'same-origin',
      // Only send a JSON Content-Type header when there is a body (ternary).
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      // JSON.stringify turns a JS object into a JSON text string for the request body.
      body: body ? JSON.stringify(body) : undefined,
    })
  // `err` is whatever was thrown: fetch only throws on network failure or abort.
  } catch (err) {
    // A deliberate cancel isn't an outage; re-throw it unchanged.
    if (err.name === 'AbortError') throw err
    // Tell net.js the server couldn't be reached (shows the offline banner).
    reportNetwork(false)
    // Throw our own error with status 0 = "no connection".
    throw new ApiError(0)
  }
  // A proxy answering for an unreachable API counts as no connection.
  // `[...].includes(x)` checks membership; `!` negates, so true means "server answered".
  reportNetwork(![502, 503, 504].includes(res.status))
  // 204 No Content has no body to parse, so return null early.
  if (res.status === 204) return null
  // res.json() returns a Promise of the parsed body; `.catch(() => null)` turns
  // a parse failure (non-JSON body) into null instead of an exception.
  const data = await res.json().catch(() => null)
  // res.ok is true for 200-299. Anything else becomes an ApiError.
  if (!res.ok) throw new ApiError(res.status, data)
  // Success: the parsed JSON is the resolved value of this async function.
  return data
}

/**
 * Upload one file as evidence, reporting progress (0–1). `meta` carries the
 * kind, capture mode, GPS fix and the outbox's retry key (clientId).
 */
// A regular (non-async) function that builds and returns a Promise by hand,
// because XMLHttpRequest uses callbacks, not Promises. `onProgress` is an
// optional callback called with a number from 0 to 1.
export function uploadEvidence(projectId, file, meta, onProgress) {
  // `new Promise((resolve, reject) => {...})`: call resolve(value) for success
  // or reject(error) for failure; whoever awaits this Promise gets that result.
  return new Promise((resolve, reject) => {
    // FormData builds a multipart/form-data body, the format used for file uploads.
    const form = new FormData()
    // `{ ...meta, clientSentAt: ... }` is object spread: copy meta's keys and add one more.
    // `new Date().toISOString()` gives the current time like "2026-10-03T09:00:00.000Z".
    // Object.entries turns an object into [key, value] pairs; `const [k, v]` destructures each pair.
    // `v != null` (loose !=) skips both null and undefined; empty strings are skipped too.
    for (const [k, v] of Object.entries({ ...meta, clientSentAt: new Date().toISOString() })) if (v != null && v !== '') form.append(k, v)
    // Add the file itself under the field name 'file'; `||` falls back when name is empty.
    form.append('file', file, file.name || 'photo.jpg')
    // XMLHttpRequest is the older request API; unlike fetch it reports upload progress.
    const xhr = new XMLHttpRequest()
    // Configure the request: HTTP method and URL (template literal inserts projectId).
    xhr.open('POST', `/api/projects/${projectId}/evidence`)
    // Give up after 120000 ms (2 minutes).
    xhr.timeout = 120000
    // Assign an arrow function as the progress handler. `e` is a ProgressEvent.
    // `a && b()` runs b only if a is truthy; `onProgress?.(x)` calls it only if it exists.
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    // onload fires when the server has replied (any status code).
    xhr.onload = () => {
      // Start with null in case the reply isn't JSON.
      let data = null
      // Try to parse the reply text as JSON.
      try {
        // JSON.parse turns JSON text into a JS value.
        data = JSON.parse(xhr.responseText)
      // `catch {` without a variable (optional catch binding): we don't need the error.
      } catch {
        /* not JSON */
      }
      // Same offline rule as `api()` above: gateway errors mean the API is unreachable.
      reportNetwork(![502, 503, 504].includes(xhr.status))
      // 2xx means success: settle the Promise with the parsed data.
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      // Otherwise settle it as a failure with an ApiError.
      else reject(new ApiError(xhr.status, data))
    }
    // A small arrow function reused for both network error and timeout.
    const offline = () => {
      // Show the offline banner.
      reportNetwork(false)
      // Fail with status 0 ("no connection").
      reject(new ApiError(0))
    }
    // Network failure handler (assigning a function reference, not calling it).
    xhr.onerror = offline
    // Timeout handler.
    xhr.ontimeout = offline
    // Actually start the request, sending the form data as the body.
    xhr.send(form)
  })
}

/** URL of an evidence file (image or PDF); the cookie session authorises it, so it works in <img> and <iframe>. */
// `export const name = (args) => expression` is an exported arrow function that
// returns the expression directly. `{ download } = {}` destructures an optional
// options object. The template literal adds `?download=1` only when download is truthy.
export const fileUrl = (projectId, evidenceId, { download } = {}) =>
  `/api/projects/${projectId}/evidence/${evidenceId}/file${download ? '?download=1' : ''}`
