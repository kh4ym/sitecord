// FILE: components/Notifications.jsx — the notification bell and its list.
//
// What it does: `NotificationsMenu` is the bell button with an unread-count
// badge; clicking it opens a popover showing `NotificationList`. The list shows
// the latest notifications, a "mark all read" button, and each row, when
// tapped, marks itself read and navigates to its link.
// Where it's used: the bell sits in the sidebar and on phone page tops; the
// More page embeds NotificationList directly. Data is polled every minute by
// useNotifications.
// Depends on: React useState, react-router's useNavigate, Radix Popover,
// lucide-react Bell icon, i18n, format helpers, the notification query hooks,
// and the ui IconButton.

// Local state hook (whether the popover is open).
import { useState } from 'react'
// Hook returning a function that changes the current route in code.
import { useNavigate } from 'react-router'
// Radix Popover namespace: Root / Trigger / Portal / Content.
import { Popover } from 'radix-ui'
// Bell icon.
import { Bell } from 'lucide-react'
// Translation hook.
import { useI18n } from '../i18n/I18nProvider.jsx'
// Class joiner and "5 min ago" formatter.
import { cn, timeAgo } from '../lib/format.js'
// Query hooks: mark notifications read (mutation) and fetch them (polled query).
import { useMarkRead, useNotifications } from '../lib/queries.js'
// Round icon button with badge support.
import { IconButton } from './ui/index.js'

/** Bell with an unread count; opens the latest notifications. */
export function NotificationsMenu() {
  // Translate function.
  const { t } = useI18n()
  // `data` is undefined until the first fetch completes.
  const { data } = useNotifications()
  // Controlled popover open state.
  const [open, setOpen] = useState(false)
  // Unread count, 0 while loading (`?.` then `??`).
  const unread = data?.unread ?? 0
  return (
    // Controlled Radix popover: we pass the state and the setter.
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Trigger with asChild: our IconButton becomes the clickable trigger
          (this is why IconButton uses forwardRef). */}
      <Popover.Trigger asChild>
        {/* Accessible label includes the count when there are unread items; badge shows the number. */}
        <IconButton icon={Bell} label={unread ? t('notifications.unread', { n: unread }) : t('common.notifications')} badge={unread} />
      </Popover.Trigger>
      {/* Render the panel at the end of <body>. */}
      <Popover.Portal>
        <Popover.Content
          // Align the panel's end edge with the bell.
          align="end"
          // 10px gap below the bell.
          sideOffset={10}
          // Keep at least 12px from the screen edges.
          collisionPadding={12}
          // White rounded column panel, capped in height and width to fit phones, with pop-in animation.
          className="z-50 flex max-h-[min(560px,80dvh)] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-card border border-line bg-white shadow-pop data-[state=open]:animate-pop-in"
        >
          {/* The list; picking an item closes the popover. */}
          <NotificationList onPick={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The list itself, also used on the More page. */
// Props: optional `onPick` callback after a tap, optional max `limit`.
export function NotificationList({ onPick, limit }) {
  // Translate function.
  const { t } = useI18n()
  // Same query as the bell (TanStack Query shares the cached data).
  const { data } = useNotifications()
  // Mutation: markRead.mutate() marks all; mutate([ids]) marks specific ones.
  const markRead = useMarkRead()
  // Function to navigate programmatically.
  const navigate = useNavigate()
  // Unread count (0 while loading).
  const unread = data?.unread ?? 0
  // Items list (empty array while loading), cut to `limit` or 40 with slice(start, end).
  const items = (data?.items ?? []).slice(0, limit ?? 40)
  return (
    // Fragment: header and scroll area as siblings.
    <>
      {/* Header row: title on the left, "mark all read" on the right. */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <p className="head">{t('common.notifications')}</p>
        {/* Only offered when something is unread. */}
        {unread > 0 && (
          <button className="text-meta font-semibold text-accent-700 hover:text-accent-800" onClick={() => markRead.mutate()}>
            {t('notifications.markAll')}
          </button>
        )}
      </div>
      {/* Scrollable area. */}
      <div className="scrollbar-thin overflow-y-auto">
        {/* Empty message, or the list. */}
        {items.length === 0 ? (
          <p className="px-4 pb-10 pt-6 text-center text-meta text-ink-3">{t('notifications.empty')}</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {/* One row per notification `n`. */}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  // Full-width row button with a faint hover tint.
                  className="flex w-full gap-3 px-4 py-3.5 text-start transition hover:bg-ink/[0.025]"
                  // On tap: mark read if not already, tell the parent (closing
                  // the popover), then go to the linked page if there is one.
                  onClick={() => {
                    if (!n.readAt) markRead.mutate([n.id])
                    onPick?.()
                    if (n.link) navigate(n.link)
                  }}
                >
                  {/* Unread dot: accent when unread, invisible (but still taking space) when read. */}
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent-600')} aria-hidden />
                  {/* Text column. */}
                  <span className="min-w-0 flex-1">
                    {/* Title: bold when unread, greyer when read. */}
                    <span className={cn('block text-body', n.readAt ? 'text-ink-2' : 'font-bold text-ink')}>{n.title}</span>
                    {/* Optional body, clamped to two lines. */}
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-meta text-ink-3">{n.body}</span>}
                    {/* Small footer line: "Project name · 5 min ago". */}
                    <span className="mt-1 block text-2xs font-semibold text-ink-3">
                      {/* Project name prefix only when present. */}
                      {n.projectName && `${n.projectName} · `}
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
