// The one error type the API answers with. Services throw these; the error
// handler in app.js turns them into `{ error, code, details }` with the
// right status. `message` is written for the person using the app, `code`
// is a stable token for the client to branch on, and `details` carries
// field-level issues or extra numbers (e.g. distance from the site pin).
//
// Used by: routes, services, auth middleware and rateLimit.js (they `throw`
// these). Depends on nothing.

// `class HttpError extends Error` declares a class (a blueprint for objects)
// that inherits from JavaScript's built-in Error, so it has a message and a
// stack trace. `export` makes it importable.
export class HttpError extends Error {
  // constructor runs when you write `new HttpError(...)`. The third parameter
  // is destructured: `{ code, details } = {}` pulls those two properties out
  // of an options object, and `= {}` is a default used when none is passed.
  constructor(status, message, { code, details } = {}) {
    // super(message) calls the parent (Error) constructor, which sets this.message.
    super(message)
    // `this` is the new object being built; store the HTTP status on it.
    this.status = status
    // The machine-readable error code (may be undefined).
    this.code = code
    // Extra data for the client (may be undefined).
    this.details = details
  }
}

// Shorthands. 401/403/404 carry fixed codes; 400 and 409 take a code per
// call because the client treats e.g. EVIDENCE_REQUIRED and WRONG_STATUS differently.
// Each is an exported arrow function that RETURNS a new error (the caller
// writes `throw badRequest('...')`). `opts` is passed through as { code, details }.
export const badRequest = (message, opts) => new HttpError(400, message, opts)
// `(message = 'Please sign in')` is a default parameter value used when the caller passes nothing.
export const unauthorized = (message = 'Please sign in') => new HttpError(401, message, { code: 'UNAUTHENTICATED' })
// Double quotes are used here because the text itself contains an apostrophe.
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, message, { code: 'FORBIDDEN' })
// 404: the thing does not exist (or the user may not know it exists).
export const notFound = (message = 'Not found') => new HttpError(404, message, { code: 'NOT_FOUND' })
// 409 Conflict: the request clashes with the current state (e.g. already done).
export const conflict = (message, opts) => new HttpError(409, message, opts)
