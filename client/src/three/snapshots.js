// snapshots.js - still pictures of the real textured 3D house.
//
// Still pictures of the real textured 3D house, for project cards and the
// home hero. One hidden canvas draws them one at a time; pictures are kept
// on the device, keyed by floors, plot size, framing and how far the build
// has got, so a house is only drawn again when it changes.
// This file is tiny: three.js only loads when a picture is actually needed.
//
// How it works: requestSnapshot(spec) first looks in an in-memory Map, then in
// the browser's localStorage; only on a miss does it dynamically import
// SnapshotRenderer.jsx (which pulls in three.js) and ask it to draw a PNG data URL.
// Concurrent requests for the same picture share one promise via `pending`.
// Where it's used: project card / home hero components that show a house image.
// Dependencies: ./SnapshotRenderer.jsx (loaded lazily), window.localStorage.

// A Map is a key -> value store; this one holds key -> image data URL for this page session.
const cache = new Map()
// Pictures currently being drawn: key -> Promise, so duplicate requests reuse the same work.
const pending = new Map()
// Prefix for localStorage keys so this app's entries can be told apart from others.
const STORAGE = 'sitecord.snap.'
// At most this many pictures are kept in localStorage (it only holds a few MB).
const MAX_STORED = 24
// Will hold a promise of the render function once SnapshotRenderer has loaded; `let` so it can be set later.
let renderer = null

// Builds a text key describing a picture. Backtick strings are template literals; `${...}` inserts values.
// toFixed(1) formats the build position with one decimal; `??` (nullish coalescing) uses '' when
// distance is null/undefined. The 'v3' prefix lets old cached pictures be ignored after changes.
export const snapshotKey = (spec) => `v3:${spec.floors}:${spec.widthFt}x${spec.depthFt}:${spec.position.toFixed(1)}:${spec.distance ?? ''}`

// Returns localStorage, or null if the browser blocks it (e.g. privacy mode throws on access).
const storage = () => {
  // try/catch: run the code in `try`; if it throws an error, run `catch` instead of crashing.
  try {
    return window.localStorage
  } catch {
    // `catch` without `(err)` is allowed when the error itself isn't needed.
    return null
  }
}

// Looks a picture up by key: memory first, then localStorage. Returns the URL or null.
export function cachedSnapshot(key) {
  // Map.has checks for a key; Map.get reads its value.
  if (cache.has(key)) return cache.get(key)
  try {
    // `?.` optional chaining: if storage() returned null, skip getItem and yield undefined.
    const stored = storage()?.getItem(STORAGE + key)
    // A non-empty string is "truthy", so this runs only when something was found.
    if (stored) {
      // Copy it into memory so the next lookup is faster.
      cache.set(key, stored)
      return stored
    }
  } catch {
    /* storage blocked */
  }
  // Not found anywhere.
  return null
}

/** Keep the newest pictures; drop the oldest when the store fills up. */
function remember(key, url) {
  // Get localStorage (or null).
  const s = storage()
  // No storage available: nothing to do. `!s` is true when s is null.
  if (!s) return
  try {
    // Object.keys lists stored keys; .filter keeps only ones starting with our prefix.
    const keys = Object.keys(s).filter((k) => k.startsWith(STORAGE))
    // While full, remove the first (oldest-inserted) key; keys.shift() removes and returns the first array item.
    while (keys.length >= MAX_STORED) s.removeItem(keys.shift())
    // Save the new picture under the prefixed key.
    s.setItem(STORAGE + key, url)
  } catch {
    /* full or blocked: the memory copy still works */
  }
}

/** Resolves to an image URL, or null when this device can't draw 3D. */
export function requestSnapshot(spec) {
  // Work out the cache key for this house/framing.
  const key = snapshotKey(spec)
  // Try memory and localStorage first.
  const hit = cachedSnapshot(key)
  // Promise.resolve wraps a ready value in an already-finished promise, so callers always get a promise.
  if (hit) return Promise.resolve(hit)
  // Already being drawn: hand back the same in-progress promise.
  if (pending.has(key)) return pending.get(key)
  // `??=` assigns only if `renderer` is null/undefined, so the import happens once.
  // import() loads SnapshotRenderer.jsx on demand; .then calls its startRenderer() once loaded.
  renderer ??= import('./SnapshotRenderer.jsx').then((m) => m.startRenderer())
  // Chain of promise steps; each .then runs after the previous step finishes.
  const job = renderer
    // Once the renderer is ready, ask it to draw this spec (gives a URL or null).
    .then((render) => render(spec))
    // Store a successful result in memory and localStorage, then pass it on.
    .then((url) => {
      if (url) {
        cache.set(key, url)
        remember(key, url)
      }
      return url
    })
    // Any error along the way becomes null (no picture) instead of an unhandled rejection.
    .catch(() => null)
    // .finally runs either way: the job is no longer pending.
    .finally(() => pending.delete(key))
  // Record the job so simultaneous requests share it.
  pending.set(key, job)
  return job
}
