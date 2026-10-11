// FILE: client/src/lib/outbox/useOutbox.js
//
// What it does: React's view of the outbox store, filtered to the signed-in
// person (and a project when given), plus small counts for badges.
//
// Where it's used: OutboxList, OfflineBanner, the tab bar badge and the
// Today page.
//
// Depends on: React's useSyncExternalStore, lib/queries.js (current user),
// ./store.js (the data) and ./flush.js (retryItem).

// React hook for reading a non-React store and re-rendering when it changes.
import { useSyncExternalStore } from 'react'
// Current user query.
import { useMe } from '../queries.js'
// The store's subscribe/getSnapshot pair, plus removeItem for "discard".
import { getSnapshot, removeItem, subscribe } from './store.js'
// Put a failed item back in the queue.
import { retryItem } from './flush.js'

// Internal hook: the whole outbox state. The third argument is the snapshot used
// during server rendering (same function here).
const useStore = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

/** This person's unsent items for a project, with upload progress and actions. */
export function useOutbox(projectId) {
  // Current user.
  const { data: me } = useMe()
  // Pull items and progress out of the snapshot (object destructuring).
  const { items, progress } = useStore()
  // Keep this user's items, and only this project's when a projectId was given
  // (`!projectId ||` means "no project filter, or it matches").
  const mine = items.filter((i) => i.userId === me?.id && (!projectId || i.projectId === projectId))
  // What the hook returns.
  return {
    // Each item copied with its progress attached (null when not uploading).
    items: mine.map((i) => ({ ...i, progress: progress[i.id] ?? null })),
    // Action functions, passed through by reference.
    retry: retryItem,
    discard: removeItem,
  }
}

/** Counts for badges: how many are waiting, and whether any failed. */
export function useOutboxCounts(projectId) {
  // Reuse the hook above (hooks can call other hooks).
  const { items } = useOutbox(projectId)
  // Total pending, and how many are FAILED.
  return { pending: items.length, failed: items.filter((i) => i.status === 'FAILED').length }
}
