// FILE: components/OutboxList.jsx — the OUTBOX section.
//
// What it does: lists records (reports, purchases, photos) saved on this phone
// while offline and how sending each one is going: waiting, sending (with a
// progress meter), or failed (with retry and discard buttons). Renders
// nothing when the outbox is empty.
// Where it's used: the Today and Home pages.
// Depends on: lucide-react icons, i18n, formatTime, the useOutbox hook (the
// offline queue stored on the device), and ui pieces.

// Icons for each kind of item plus retry and discard.
import { ClipboardList, Image, Receipt, RotateCw, Trash2 } from 'lucide-react'
// Translation hook.
import { useI18n } from '../i18n/I18nProvider.jsx'
// Formats a timestamp as a clock time.
import { formatTime } from '../lib/format.js'
// Hook exposing the queued items and retry/discard actions.
import { useOutbox } from '../lib/outbox/useOutbox.js'
// Design-system pieces.
import { IconTile, ListCard, Meter, SectionHead, StatusChip } from './ui/index.js'

// Item kind -> icon component.
const ICON = { REPORT: ClipboardList, PURCHASE: Receipt, PHOTO: Image }

/** OUTBOX: what's saved on this phone and how sending is going. Hidden when empty. On the Today and Home pages. */
// Prop: the project whose queued items to show.
export function OutboxList({ projectId }) {
  // Translate function.
  const { t } = useI18n()
  // Items plus two action functions, destructured from the hook's result.
  const { items, retry, discard } = useOutbox(projectId)
  // Nothing queued: render nothing (`!0` is true).
  if (!items.length) return null
  return (
    // data-reveal opts this section into the Page's staggered reveal animation.
    <section data-reveal className="flex flex-col gap-3">
      {/* Heading with an item count. */}
      <SectionHead title={t('today.outbox')} meta={t('today.outboxCount', { n: items.length })} />
      <ListCard>
        {/* One row per queued item; braces body so we can compute values first. */}
        {items.map((item) => {
          // Shown status comes from progress, not the stored SENDING flag, so a
          // send that was interrupted mid-way reads as waiting again.
          // Short alias for the live progress object (undefined when not sending).
          const p = item.progress
          // FAILED stays failed; live progress means SENDING; anything else is WAITING.
          const status = item.status === 'FAILED' ? 'FAILED' : p ? 'SENDING' : 'WAITING'
          return (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3.5">
              {/* Kind icon (photo icon as fallback); red tile when failed. */}
              <IconTile icon={ICON[item.kind] ?? Image} tone={status === 'FAILED' ? 'danger' : 'neutral'} />
              {/* Text column. */}
              <div className="min-w-0 flex-1">
                {/* Item title, truncated. */}
                <p className="truncate text-body font-semibold">{item.title}</p>
                {/* Three-way ternary chain for the status line. */}
                {status === 'SENDING' ? (
                  // Sending: text plus a progress bar, grouped in a Fragment.
                  <>
                    <p className="text-meta text-ink-3">
                      {/* "Sending 2 of 5 photos" when counts are known, else a generic message. */}
                      {p.total ? t('outbox.sending', { sent: p.sent, total: p.total }) : t('outbox.sendingRecord')}
                    </p>
                    {/* Progress: files sent plus the fraction of the current one;
                        a full bar (1 of 1) when no total is known. */}
                    <Meter value={p.total ? p.sent + (p.fraction ?? 0) : 1} max={p.total || 1} size="sm" className="mt-1.5" label={t('outbox.sendingRecord')} />
                  </>
                ) : status === 'FAILED' ? (
                  // Failed: red message including the error text.
                  <p className="text-meta text-danger-700">{t('outbox.failed', { error: item.error })}</p>
                ) : (
                  // Waiting: "Saved 3:42 pm · waiting for signal".
                  <p className="text-meta text-ink-3">
                    {t('outbox.saved', { time: formatTime(item.createdAt) })} · {t('outbox.waiting')}
                  </p>
                )}
              </div>
              {/* Trailing actions or chip. */}
              <div className="flex shrink-0 items-center gap-1">
                {status === 'FAILED' ? (
                  // Failed: retry and discard icon buttons.
                  <>
                    {/* Retry re-queues the item. aria-label names the icon-only button. */}
                    <button onClick={() => retry(item.id)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-ink/5" aria-label={t('common.retry')}>
                      <RotateCw size={17} />
                    </button>
                    <button
                      // window.confirm shows the browser's OK/Cancel box and returns
                      // true/false; `&&` only discards if the user pressed OK.
                      onClick={() => window.confirm(t('outbox.discardConfirm')) && discard(item.id)}
                      // Red round icon button.
                      className="grid h-10 w-10 place-items-center rounded-full text-danger-700 hover:bg-danger-50"
                      aria-label={t('common.discard')}
                    >
                      <Trash2 size={17} />
                    </button>
                  </>
                ) : (
                  // Otherwise a status chip ("waiting" / "sending").
                  <StatusChip kind="outbox" status={status} />
                )}
              </div>
            </li>
          )
        })}
      </ListCard>
    </section>
  )
}
