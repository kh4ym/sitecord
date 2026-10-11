// FILE: client/src/lib/outbox/store.js
//
// What it does: the outbox: reports, purchases and photos saved on this phone
// while the signal is weak, kept in IndexedDB (the browser's built-in
// database, files included) until they're sent. A small in-memory copy feeds
// the UI through subscribe/getSnapshot (the shape React's
// useSyncExternalStore expects).
//
// An item is { id, userId, projectId, kind: 'REPORT'|'PURCHASE'|'PHOTO',
// title, body, files: [{ key, blob, name, meta, evidenceId? }], status,
// attempts, nextAttemptAt, error, createdAt }. `id` doubles as the server's
// retry key (clientId) and `${id}:${file.key}` as each file's, so a send cut
// off half-way can be repeated without duplicates.
//
// Where it's used: pages call enqueue; flush.js sends; useOutbox.js reads;
// OutboxProvider wires the triggers; useSignOut calls pendingForUser.
//
// Depends on: the browser's IndexedDB API only.

// Database name and object store ("table") name.
const DB = 'sitecord'
const STORE = 'outbox'
// Cached Promise of the open database, so we open it only once.
let dbPromise = null

// ---------------------------------------------------------- IndexedDB
// One database, one object store keyed by item id. Blobs are stored as they
// are; IndexedDB keeps them on disk, so photos survive a reload or a crash.

// Returns a Promise of the open IDBDatabase.
function openDb() {
  // Some browsers/modes have no IndexedDB: return an already-rejected Promise.
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot save items offline'))
  // `??=` assigns only if dbPromise is still null, so the open happens once.
  dbPromise ??= new Promise((resolve, reject) => {
    // Open (or create) database version 1. IndexedDB uses request objects with
    // onsuccess/onerror callbacks instead of Promises.
    const req = indexedDB.open(DB, 1)
    // Fires when the database is new or its version increases: create the store here.
    req.onupgradeneeded = () => {
      // keyPath: 'id' means each object's own `id` field is its primary key.
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    // Opened: resolve with the database object.
    req.onsuccess = () => resolve(req.result)
    // Failed: reject with the error.
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

// Turns any IndexedDB request into a Promise, so we can `await` it.
const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

// Opens a transaction and returns the object store inside it.
// mode is 'readonly' (default parameter) or 'readwrite'.
async function store(mode = 'readonly') {
  // `(await openDb())` waits for the database, then chains: start a transaction on
  // STORE, and get the object store from it.
  return (await openDb()).transaction(STORE, mode).objectStore(STORE)
}

// ---------------------------------------------------------- In-memory state
// Mirrors the store for React (useSyncExternalStore needs a stable snapshot).
// `progress` is per item and lives only here: upload progress isn't worth a
// disk write. Every write below goes to IndexedDB first, then emits.

// The current snapshot. Replaced (never mutated) so React can tell it changed.
let state = { items: [], progress: {}, loaded: false }
// Subscribed callbacks.
const listeners = new Set()
// Merge a partial update into a NEW state object, then notify every listener.
const emit = (patch) => {
  // `{ ...state, ...patch }`: copy old keys, then overwrite with patch's keys.
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
// For useSyncExternalStore: add a listener and return an unsubscribe function.
export const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
// For useSyncExternalStore: return the current snapshot.
export const getSnapshot = () => state

// The "send now" function; a no-op `() => {}` until the provider registers one.
let kicker = () => {}
/** The provider registers how to send; enqueue calls it right away. */
// Assignment expression as the arrow's body: sets kicker and returns fn.
export const onKick = (fn) => (kicker = fn)

// Read everything saved on the phone into memory (called once at app start).
export async function loadOutbox() {
  try {
    // getAll() requests every object in the store; wrap() makes it awaitable.
    const items = await wrap((await store()).getAll())
    // Sort oldest first and mark loaded.
    emit({ items: items.sort((a, b) => a.createdAt - b.createdAt), loaded: true })
  } catch {
    // Even on failure, mark loaded so the UI stops waiting.
    emit({ loaded: true })
  }
}

/** Save an item (and its files) on this phone, then try to send it. */
export async function enqueue(item) {
  // Defaults first, then `...item` so the caller's fields override them.
  const full = { status: 'WAITING', attempts: 0, nextAttemptAt: 0, error: null, createdAt: Date.now(), files: [], ...item }
  // put() inserts or replaces by key, in a read-write transaction.
  await wrap((await store('readwrite')).put(full))
  // Add to memory: a new array with the old items plus this one.
  emit({ items: [...state.items, full] })
  // Ask the provider to try sending now.
  kicker()
  // Return the saved item.
  return full
}

// Change some fields of one item, on disk and in memory.
export async function updateItem(id, patch) {
  // Find the current version in memory.
  const current = state.items.find((i) => i.id === id)
  // Gone already (sent or discarded): nothing to do (returns undefined).
  if (!current) return
  // Merged copy.
  const next = { ...current, ...patch }
  // Write it to IndexedDB.
  await wrap((await store('readwrite')).put(next))
  // Replace it in the in-memory list.
  emit({ items: state.items.map((i) => (i.id === id ? next : i)) })
  return next
}

// Delete one item.
export async function removeItem(id) {
  // Delete from IndexedDB by key.
  await wrap((await store('readwrite')).delete(id))
  // Rest destructuring with a computed key: `[id]: _` pulls out (and ignores) the
  // entry for this id; `...progress` collects all the other entries into a new object.
  const { [id]: _, ...progress } = state.progress
  // Remove from the list and drop its progress.
  emit({ items: state.items.filter((i) => i.id !== id), progress })
}

// Record upload progress for one item (memory only). `[id]: value` is a computed property key.
export function setProgress(id, value) {
  emit({ progress: { ...state.progress, [id]: value } })
}

/** How many unsent items belong to this person (asked before signing out). */
export async function pendingForUser(userId) {
  try {
    // Read straight from disk, in case memory hasn't loaded yet.
    const items = await wrap((await store()).getAll())
    // Count this user's items.
    return items.filter((i) => i.userId === userId).length
  } catch {
    // No database: nothing pending.
    return 0
  }
}
