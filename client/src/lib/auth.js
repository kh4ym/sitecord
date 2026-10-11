// FILE: client/src/lib/auth.js
//
// What it does: a guard for the ?next= parameter on the sign-in and register
// pages, so a crafted link can't bounce someone to another site after they
// sign in (an "open redirect").
//
// Where it's used: the sign-in and register pages, when deciding where to go
// after a successful login.
//
// Depends on: nothing.

/** Only same-site paths are honoured as redirect targets after sign-in. */
// `export const safeNext = (next, fallback = '/') => ...` is an exported arrow
// function; `fallback = '/'` is a default parameter used when none is passed.
// The body is one ternary: if `next` exists AND starts with '/' AND does not
// start with '//' (which browsers treat as another host), return it; otherwise
// return the fallback. `&&` short-circuits, so a missing `next` stops early.
export const safeNext = (next, fallback = '/') => (next && next.startsWith('/') && !next.startsWith('//') ? next : fallback)
