// Per-address request throttling for the endpoints an attacker would hammer:
// sign-in, sign-up, password change and invitation-token lookups. Used only
// by routes/auth.js and routes/invitations.js. Keyed on req.ip, which is the
// proxy's forwarded address because app.js sets `trust proxy`.
//
// How it works: rateLimit(options) is a "factory" — a function that returns
// a new Express middleware. That middleware counts requests per IP address in
// a fixed time window and fails with HTTP 429 (Too Many Requests) once the
// count passes `max`. Depends on lib/errors.js.

// Named import of our error class.
import { HttpError } from './errors.js'

/**
 * Fixed-window rate limit kept in memory, per client address. Enough for a
 * single server; a multi-instance deployment would move the counters to the
 * database or a shared cache.
 *   rateLimit({ max: 10, windowMs: 15 * 60_000, message })
 */
// The single parameter is an options object, destructured into max,
// windowMs and message; `message = '...'` gives message a default value.
export function rateLimit({ max, windowMs, message = 'Too many attempts. Please wait a few minutes and try again.' }) {
  // Each rateLimit() call gets its own map and timer, so the login and
  // register limits are counted separately.
  // A Map is a key → value store; here IP address → { count, resetAt }.
  const hits = new Map() // key → { count, resetAt }
  // An arrow function stored in a constant: removes windows that have ended.
  const sweep = () => {
    // Date.now() = current time in milliseconds since 1970.
    const now = Date.now()
    // for...of loops over the Map; each entry is destructured into [key, hit].
    // A loop body that is a single statement needs no braces.
    for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key)
  }
  // Run the cleanup once per window so the Map doesn't grow forever.
  const timer = setInterval(sweep, windowMs)
  // `?.()` optional call: call unref only if it exists (it does in Node).
  // unref = don't keep the process alive just for this timer.
  timer.unref?.()

  // Return the actual middleware. It "closes over" hits/max/windowMs/message,
  // i.e. it can still use those variables after rateLimit() has returned.
  return (req, res, next) => {
    // Current time for this request.
    const now = Date.now()
    // The client's address; `??` chain falls back to the raw socket address,
    // then to the string 'unknown'. `req.socket?.` = optional chaining.
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    // Look up this address's counter (undefined if not seen yet). `let` because
    // it may be replaced below.
    let hit = hits.get(key)
    // `!hit` is true when hit is undefined. Start a fresh window if there is
    // no counter or the old window has expired.
    if (!hit || hit.resetAt <= now) {
      // New counter that ends windowMs milliseconds from now.
      hit = { count: 0, resetAt: now + windowMs }
      // Store it in the Map under this address.
      hits.set(key, hit)
    }
    // `+= 1` adds one to the existing value.
    hit.count += 1
    // Standard RateLimit-* headers on every response, and Retry-After once
    // over the limit; the 429 goes through the normal error handler.
    // Header values must be strings, hence String(...).
    res.set('RateLimit-Limit', String(max))
    // Math.max(0, x) never lets "remaining" go below zero.
    res.set('RateLimit-Remaining', String(Math.max(0, max - hit.count)))
    // Over the limit?
    if (hit.count > max) {
      // Seconds until the window resets, rounded UP with Math.ceil.
      res.set('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)))
      // next(error) skips normal handlers and jumps to the error handler in app.js.
      return next(new HttpError(429, message, { code: 'RATE_LIMITED' }))
    }
    // Under the limit: carry on to the route.
    next()
  }
}
