// All runtime settings in one object, read from the environment once at
// import. Everything has a development default so `npm run dev` works with
// no .env at all; production sets DATABASE_URL, CLIENT_ORIGIN and the
// directories. Imported by nearly every module; depends on nothing.
//
// Environment variables are text values given to the process by the shell or
// host (e.g. PORT=4000). Node exposes them as properties of `process.env`;
// a missing one reads as `undefined`.

// fileURLToPath turns a "file:///D:/..." URL into a normal file path.
import { fileURLToPath } from 'node:url'
// Default import of Node's path helpers.
import path from 'node:path'

// import.meta.url is this module's own URL. dirname gives its folder (src);
// path.resolve(folder, '..') goes one level up, so root = the server folder.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// true when NODE_ENV is exactly the string 'production' (strict equality ===).
const production = process.env.NODE_ENV === 'production'

// `export const` makes this object importable as `import { config } ...`.
// An object literal: `key: value` pairs separated by commas.
export const config = {
  // Shorthand property: same as `production: production`.
  production,
  // Number(...) converts text to a number. `??` uses 4000 only if PORT is
  // null/undefined (not set).
  port: Number(process.env.PORT ?? 4000),
  /** Set to use a PostgreSQL server; otherwise an embedded PGlite database is used. */
  // `||` (logical OR) falls back for ANY falsy value, so an empty string
  // DATABASE_URL= also becomes null.
  databaseUrl: process.env.DATABASE_URL || null,
  // Folder for the embedded database; path.join glues path parts with the right separator.
  dataDir: process.env.PGLITE_DIR ?? path.join(root, '.data', 'pglite'),
  // Folder where uploaded photos and files are stored.
  uploadDir: process.env.UPLOAD_DIR ?? path.join(root, 'uploads'),
  /** The built web app, served by the API in production (`npm run build` first). */
  // '..' climbs out of server/ into the sibling client/dist folder.
  clientDir: process.env.CLIENT_DIR ?? path.resolve(root, '..', 'client', 'dist'),
  /** Origins allowed to make state-changing requests (see checkOrigin); the Vite dev server by default. */
  // Method chain: .split(',') turns "a,b" into ['a','b']; .map(fn) applies fn
  // to each; (s) => s.trim() removes surrounding spaces from each string.
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  /** Cookies go over HTTPS only in production; elsewhere they follow the request (behind a trusted proxy). */
  // Ternary `cond ? a : b`: true in production, otherwise the string 'auto'.
  secureCookies: production ? true : 'auto',
  /**
   * Demo mode seeds two sample houses on first start and shows one-click
   * sign-in as the demo people. On by default in development; in production
   * it must be asked for with DEMO_MODE=true, because it lets anyone in.
   */
  // `&&` = AND, `!` = NOT, `||` = OR; parentheses group the right-hand part.
  demo: process.env.DEMO_MODE === 'true' || (process.env.DEMO_MODE !== 'false' && !production),
  // How long a sign-in session lasts, in days.
  sessionDays: 30,
  // Upload size limit in bytes: 10 × 1024 × 1024 = 10 MB.
  maxUploadBytes: 10 * 1024 * 1024,
}
