// FILE: components/OfflineBanner.jsx — the amber "no signal" strip.
//
// What it does: while the browser is offline it shows an amber notice at the
// top of every page, saying how many items are saved on this phone waiting to
// be sent (the "outbox"). When online it renders nothing.
// Where it's used: rendered once by AppShell above every page.
// Depends on: lucide-react (icon), the i18n provider (translated text),
// lib/net.js (online/offline state) and the outbox hook (queued items).

// Named import of the WifiOff icon component from the lucide-react icon library.
import { WifiOff } from 'lucide-react'
// Hook giving access to the translation function `t`.
import { useI18n } from '../i18n/I18nProvider.jsx'
// Hook returning true/false for whether the browser has a network connection.
import { useOnline } from '../lib/net.js'
// Hook returning the list of actions queued while offline.
import { useOutbox } from '../lib/outbox/useOutbox.js'

/** Amber notice when the phone has no signal, saying what's waiting to send. Rendered once by AppShell above every page. */
// Exported component with no props (empty parentheses).
export function OfflineBanner() {
  // Object destructuring: take the `t` property from the object useI18n() returns.
  const { t } = useI18n()
  // `const` declares a variable that can't be reassigned; holds true when online.
  const online = useOnline()
  // Destructure the `items` array out of the outbox hook's result.
  const { items } = useOutbox()
  // Early return: a component that returns null renders nothing at all.
  if (online) return null
  return (
    // role="status" is an ARIA attribute: screen readers announce changes politely.
    // Styling: flex row, amber (warn) background, rounded, padded, small text.
    <div role="status" className="mb-5 flex items-start gap-3 rounded-tile bg-warn-50 px-4 py-3.5 text-meta text-warn-800">
      {/* Icon component with props; `aria-hidden` (true when written bare) hides it from screen readers as it's decorative. */}
      <WifiOff size={18} className="mt-px shrink-0 text-warn-600" aria-hidden />
      {/* Chained ternary picking the message: exactly 1 item, more than 0 items
          (0 is "falsy" so it falls through) with `n` passed into the translation,
          or the plain message when nothing is queued. */}
      <p>{items.length === 1 ? t('offline.withItem') : items.length ? t('offline.withItems', { n: items.length }) : t('offline.plain')}</p>
    </div>
  )
}
