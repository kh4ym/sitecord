// Cookie sessions and password hashing. A session is a random token in an
// httpOnly cookie; the database holds only sha256(token), so a leaked table
// can't be replayed. Used by routes/auth.js (start/end) and
// auth/middleware.js (userFromRequest); the demo seed borrows hashPassword.
//
// Depends on bcryptjs (slow password hashing), config (session length,
// cookie security), db (sessions table) and lib/util (token + sha256).

// Default import of the bcryptjs package.
import bcrypt from 'bcryptjs'
import { config } from '../config.js' // sessionDays, secureCookies
import { q } from '../db/index.js' // query function
import { newToken, sha256 } from '../lib/util.js' // random token, hashing

// The cookie's name, exported so other files use the same string.
export const COOKIE = 'sc_session'

// bcrypt cost 11: a few hundred ms per hash, slow enough to blunt guessing
// without making sign-in feel slow.
// Returns a Promise of the hash text (includes a random salt).
export const hashPassword = (pw) => bcrypt.hash(pw, 11)
// Returns a Promise of true/false: does this password match the stored hash?
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash)

/** Opaque random token in an httpOnly cookie; only its hash is stored. */
// res: the Express response (to set the cookie); userAgent: browser description text.
export async function startSession(res, userId, userAgent) {
  // A fresh random secret for this session.
  const token = newToken()
  // Expiry time: now + days × 86,400,000 ms (one day in milliseconds).
  const expires = new Date(Date.now() + config.sessionDays * 86400000)
  // SQL: INSERT INTO table (columns) VALUES ($1..$4) adds one row; the values
  // come from the array, in order.
  await q('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [
    // $1: the id is the HASH of the token, never the token itself.
    sha256(token),
    // $2: whose session it is.
    userId,
    // $3: expiry as ISO text.
    expires.toISOString(),
    // $4: first 200 characters of the user agent, or null if there was none.
    userAgent?.slice(0, 200) ?? null,
  ])
  // SameSite=Lax is the first CSRF line; checkOrigin in middleware.js is the
  // second. `secure` follows config so local HTTP still works.
  // res.cookie(name, value, options) adds a Set-Cookie header.
  res.cookie(COOKIE, token, {
    httpOnly: true, // page JavaScript cannot read the cookie
    sameSite: 'lax', // not sent on cross-site form posts
    secure: config.secureCookies, // HTTPS-only in production
    expires, // shorthand for `expires: expires`
    path: '/', // sent for every path on this site
  })
}

// Sign-out: delete the session row and the cookie.
export async function endSession(req, res) {
  // `?.[COOKIE]`: optional chaining with bracket access — read
  // req.cookies['sc_session'] only if req.cookies exists.
  const token = req.cookies?.[COOKIE]
  // SQL: DELETE FROM sessions WHERE id = $1 removes the matching row.
  if (token) await q('DELETE FROM sessions WHERE id = $1', [sha256(token)])
  // Tell the browser to forget the cookie (path must match how it was set).
  res.clearCookie(COOKIE, { path: '/' })
}

/** The signed-in user for this request, or null. Expiry is checked in SQL so a stale row is as good as none. */
export async function userFromRequest(req) {
  // Read the session token from the cookie, if any.
  const token = req.cookies?.[COOKIE]
  // No cookie → not signed in.
  if (!token) return null
  // SQL: pick user fields FROM sessions `s` JOINed to users `u` where the
  // user's id equals the session's user_id; WHERE matches the hashed token
  // ($1) and keeps only sessions that expire in the future (> now()).
  const [row] = await q(
    `SELECT u.id, u.email, u.name, u.phone, u.locale, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    // $1: hash of the cookie token.
    [sha256(token)],
  )
  // The user row, or null if no valid session matched (row is undefined).
  return row ?? null
}
