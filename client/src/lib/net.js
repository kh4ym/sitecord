// FILE: client/src/lib/net.js
//
// What it does: tracks whether the app can reach the server, as a tiny
// "external store" React components can subscribe to.
//
// Why it exists: `navigator.onLine` alone is too optimistic on weak mobile
// signal, so a failed request also counts as offline until the next one
// succeeds.
//
// Where it's used: fed by lib/api.js (reportNetwork after every request);
// read by the OfflineBanner, the progress switches (disabled offline), the
// queries wrapper (isRetryable) and the outbox provider (flushes on reconnect
// via onReconnect).
//
// Depends on: React's useSyncExternalStore hook.

// Named import of a React hook that lets components read data kept outside React.
import { useSyncExternalStore } from 'react'

// Module-level flag: true after a request failed to reach the server.
let failing = false
// A Set (a collection with no duplicates) of callback functions to notify on changes.
const listeners = new Set()
// Call every listener. `forEach` runs the arrow function for each item; `l()` calls it.
const emit = () => listeners.forEach((l) => l())

// Only touch `window` in a browser (guards against running in Node during tests/builds).
if (typeof window !== 'undefined') {
  // The browser fires 'online'/'offline' events when its connection changes; notify listeners.
  window.addEventListener('online', emit)
  window.addEventListener('offline', emit)
}

// A separate set of callbacks to run when the server becomes reachable again.
const reconnected = new Set()

/** Called by the API client after every request. */
// `ok` is a boolean: did the server answer?
export function reportNetwork(ok) {
  // No change in state (`===` strict equality): nothing to do.
  if (failing === !ok) return
  // Flip the flag.
  failing = !ok
  // Tell subscribed components to re-read the snapshot.
  emit()
  // If we just recovered, run every "on reconnect" callback (e.g. flush the outbox).
  if (ok) reconnected.forEach((l) => l())
}

/** Runs `listener` whenever a request gets through again after failing. */
export function onReconnect(listener) {
  // Register the callback.
  reconnected.add(listener)
  // Return an "unsubscribe" function (a closure that remembers `listener`).
  // Useful as a useEffect cleanup.
  return () => reconnected.delete(listener)
}

// The current value React reads: online if the browser thinks so AND no recent failure.
// Outside a browser (`navigator` undefined) assume online.
const snapshot = () => (typeof navigator === 'undefined' ? true : navigator.onLine && !failing)
// React calls subscribe(l) with its own re-render callback, and calls the
// returned function to unsubscribe when the component unmounts.
const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** true while the app can reach the server. */
// A custom hook (name starts with "use"). useSyncExternalStore(subscribe,
// getSnapshot, getServerSnapshot) re-renders the component whenever the
// snapshot changes. The third argument is used during server rendering.
export const useOnline = () => useSyncExternalStore(subscribe, snapshot, () => true)

/** Errors worth retrying later: no connection, timeouts, an unreachable or overloaded server. */
// `err?.status` is safe even if err is undefined; `.includes` checks the list.
export const isRetryable = (err) => [0, 408, 425, 429, 502, 503, 504].includes(err?.status)
