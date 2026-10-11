// FILE: client/src/lib/outbox/OutboxProvider.jsx
//
// What it does: a React component that keeps the offline outbox moving. It
// renders nothing itself (it just returns its children); it owns the timing
// of outbox sends and the toasts that follow them.
//
// Where it's used: mounted once in main.jsx, inside the Query and i18n
// providers, wrapping the whole app.
//
// Depends on: react hooks, TanStack Query (to refresh data after a send),
// sonner (toasts), lib/net.js (onReconnect), lib/queries.js (current user),
// ./flush.js (sending) and ./store.js (loading, kick registration).

// React hooks for side effects and persistent mutable values.
import { useEffect, useRef } from 'react'
// Access to the TanStack Query cache.
import { useQueryClient } from '@tanstack/react-query'
// Toast notifications.
import { toast } from 'sonner'
// Subscribe to "server reachable again".
import { onReconnect } from '../net.js'
// The signed-in user.
import { useMe } from '../queries.js'
// The send routine.
import { flushOutbox } from './flush.js'
// Store helpers.
import { getSnapshot, loadOutbox, onKick } from './store.js'

// Success messages per item kind.
const SENT = { REPORT: 'Daily report sent', PURCHASE: 'Purchase sent', PHOTO: 'Photo sent' }

/**
 * Keeps the outbox moving: sends on start, as soon as the connection comes back,
 * when the app comes back to the front, every 30 seconds while anything is
 * waiting, and straight after something is saved.
 */
// A function component. Props arrive as one object; `{ children }` destructures the
// special `children` prop (whatever JSX is nested inside <OutboxProvider>...</OutboxProvider>).
export function OutboxProvider({ children }) {
  // Current user (renamed from `data` to `me`).
  const { data: me } = useMe()
  // The query cache.
  const qc = useQueryClient()
  // User id, or undefined while signed out (optional chaining).
  const userId = me?.id
  // Kept in a ref so the effect below doesn't re-subscribe on every render.
  const handlers = useRef(null)
  // Refresh the callbacks on every render so they always see the latest `qc`.
  handlers.current = {
    // After an item is sent: refresh that project's data and the project list, then toast.
    onSent: (item) => {
      qc.invalidateQueries({ queryKey: ['p', item.projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      // `?? 'Sent'` is the fallback for an unknown kind; description is the second line.
      toast.success(SENT[item.kind] ?? 'Sent', { description: item.title })
    },
    // Permanent failure: red toast with the item's title (template literal).
    onFailed: (item) => toast.error(`Couldn't send: ${item.title}`, { description: 'Open Today to see why.' }),
  }

  // Effect with an empty dependency array: runs once after the first render.
  useEffect(() => {
    // Read saved items from IndexedDB into memory.
    loadOutbox()
  }, [])

  // Effect that (re)runs whenever userId changes (sign-in, sign-out, switching user).
  useEffect(() => {
    // Nobody signed in: set nothing up.
    if (!userId) return
    // `now`: the connection has probably just come back, so don't wait out the back-off.
    // Spread the current handlers into the options and add `force`.
    // `now === true` matters because event listeners pass an Event object, not true.
    const run = (now) => flushOutbox(userId, { ...handlers.current, force: now === true })
    // Shortcut: send now, ignoring back-off.
    const soon = () => run(true)
    // Let enqueue() trigger an immediate send.
    onKick(soon)
    // Send once right away (app opened).
    soon()
    // When the tab becomes visible again, send (`&&` runs soon only if visible).
    const visible = () => document.visibilityState === 'visible' && soon()
    // Browser says we're online again.
    window.addEventListener('online', soon)
    // The page was hidden/shown (switching apps on a phone).
    document.addEventListener('visibilitychange', visible)
    // A request got through after failing; keep the unsubscribe function.
    const offReconnect = onReconnect(soon)
    // Every 30 s, if anything is queued (length is truthy), try a normal (back-off respecting) send.
    const timer = setInterval(() => getSnapshot().items.length && run(false), 30000)
    // Cleanup: undo everything above when userId changes or the component unmounts.
    return () => {
      // Replace the kicker with a function that does nothing.
      onKick(() => {})
      window.removeEventListener('online', soon)
      document.removeEventListener('visibilitychange', visible)
      offReconnect()
      // Stop the 30-second timer.
      clearInterval(timer)
    }
  }, [userId])

  // Render the wrapped app unchanged.
  return children
}
