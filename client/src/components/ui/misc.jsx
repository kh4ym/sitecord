// FILE: components/ui/misc.jsx — page states and small pieces.
//
// What it does: EmptyState (nothing to show yet), the loading placeholders
// (Skeleton, Spinner, PageSkeleton), ErrorState (a query failed, with a
// friendlier message when offline), Avatar (initials in a coloured circle) and
// Notice (an inline coloured callout box).
// Where it's used: pages render PageSkeleton while a query loads and
// ErrorState when it fails; EmptyState, Avatar and Notice appear throughout.
// Re-exported from ui/index.js.
// Depends on: lucide-react icons and lib/format.js (`cn` class joiner,
// `initials` to turn a name into "AK").

// Several named icon imports from lucide-react in one statement.
import { CircleAlert, Info, LoaderCircle, TriangleAlert, CircleCheck, WifiOff } from 'lucide-react'
// Class-name joiner and the initials helper.
import { cn, initials } from '../../lib/format.js'

// "Nothing here yet" block. Props: `icon` (renamed to `Icon` so it can be a
// JSX tag), title, description, an `action` element (e.g. a Button), extra
// class, and `compact` for less padding.
export function EmptyState({ icon: Icon, title, description, action, className, compact }) {
  return (
    // Centred column; ternary picks tighter padding when compact.
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      {/* Optional icon in a grey circle (`&&` renders it only if Icon exists). */}
      {Icon && (
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-sunken text-ink-2">
          <Icon size={22} aria-hidden />
        </span>
      )}
      {/* Bold title. */}
      <p className="text-body font-bold text-ink">{title}</p>
      {/* Optional smaller grey explanation. */}
      {description && <p className="mt-1 max-w-sm text-meta text-ink-3">{description}</p>}
      {/* Optional action below. */}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// Arrow-function component returning a single grey shimmering block (the
// `skeleton` CSS class); size comes from the caller's classes. Hidden from screen readers.
export const Skeleton = ({ className }) => <div className={cn('skeleton', className)} aria-hidden />

// Small inline spinner with a text label (default 'Loading').
export function Spinner({ label = 'Loading', className }) {
  return (
    // role="status" lets screen readers announce the label.
    <div className={cn('flex items-center justify-center gap-2 py-16 text-meta text-ink-3', className)} role="status">
      {/* Rotating loader icon (animate-spin). */}
      <LoaderCircle size={18} className="animate-spin" aria-hidden />
      {/* The text after the icon. */}
      {label}
    </div>
  )
}

/** Loading placeholder shaped like the page that's coming: a title, then a hero, a list or a detail. */
// `variant` defaults to 'list'; also 'hero' or 'detail'.
export function PageSkeleton({ variant = 'list' }) {
  return (
    // aria-busy tells assistive tech this area is still loading.
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      {/* Fake small kicker line and big title. */}
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-9 w-64 max-w-full" />
      </div>
      {/* A tall hero block only for the 'hero' variant. */}
      {variant === 'hero' && <Skeleton className="h-64 rounded-card" />}
      {/* Three stat placeholders: an array literal mapped to elements; the index `i` is the key. */}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      {/* Main content block; a bit shorter for detail pages. */}
      <Skeleton className={variant === 'detail' ? 'h-56 rounded-card' : 'h-72 rounded-card'} />
    </div>
  )
}

// Error card for a failed data load. `error` is the request error (may carry
// an HTTP `status`); `onRetry` is an optional function to try again.
export function ErrorState({ error, onRetry }) {
  // No signal, a timeout, or the server out of reach: say so plainly.
  // Array.includes checks membership; `error?.status` is undefined if error is null.
  const offline = [0, 408, 502, 503, 504].includes(error?.status)
  return (
    // Centred card.
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      {/* Icon circle: amber when offline, red otherwise. */}
      <span className={cn('mb-3 grid h-12 w-12 place-items-center rounded-full', offline ? 'bg-warn-50 text-warn-800' : 'bg-danger-50 text-danger-700')}>
        {/* No-wifi icon when offline, alert icon otherwise. */}
        {offline ? <WifiOff size={22} aria-hidden /> : <CircleAlert size={22} aria-hidden />}
      </span>
      {/* Heading: 404 -> "Not found", offline -> "No connection", else a generic message.
          Double quotes are used for the string containing an apostrophe. */}
      <p className="font-bold">{error?.status === 404 ? 'Not found' : offline ? 'No connection' : "Couldn't load this"}</p>
      <p className="mt-1 max-w-sm text-meta text-ink-3">
        {/* Offline explanation, otherwise the error's own message or a fallback (`??`). */}
        {offline ? "This page needs a connection the first time. Anything you save meanwhile stays on this phone." : (error?.message ?? 'Something went wrong.')}
      </p>
      {/* Retry link-button, only if a handler exists and it wasn't a 404 (retrying won't help). */}
      {onRetry && error?.status !== 404 && (
        <button onClick={onRetry} className="mt-4 text-meta font-semibold text-accent-700 hover:underline">
          try again
        </button>
      )}
    </div>
  )
}

// The four avatar colour pairs to choose from.
const AVATAR_TONES = ['bg-accent-100 text-accent-800', 'bg-sunken text-ink', 'bg-warn-100 text-warn-800', 'bg-ink text-white']
/** Initials on a colour picked from the name, so the same person always gets the same one. */
// Props: person's `name`, pixel `size` (default 32), extra class.
export function Avatar({ name, size = 32, className }) {
  // `[...(name ?? '')]` spreads the string into an array of characters; reduce
  // sums their character codes; `% AVATAR_TONES.length` (remainder) turns the
  // sum into an index 0-3, so a given name always maps to the same colour.
  const tone = AVATAR_TONES[[...(name ?? '')].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span
      // Round centred bold initials in the chosen colours.
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-bold', tone, className)}
      // Inline styles: numbers are treated as pixels; the font is 36% of the size.
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      // Decorative: the person's name is shown as text nearby.
      aria-hidden
    >
      {/* e.g. "Ali Khan" -> "AK". */}
      {initials(name)}
    </span>
  )
}

/** Inline callout. Amber for "needs attention", like the design's notices. */
// Props: `tone` (default 'info'), optional title, body `children`, an
// `action` element, a custom `icon`, extra class.
export function Notice({ tone = 'info', title, children, action, icon, className }) {
  // An object literal indexed immediately with `[tone]`: each entry is an
  // array of [box classes, default icon component, icon colour class].
  const styles = {
    info: ['bg-accent-50 text-accent-900', Info, 'text-accent-700'],
    warn: ['bg-warn-50 text-warn-800', TriangleAlert, 'text-warn-600'],
    error: ['bg-danger-50 text-danger-700', CircleAlert, 'text-danger-500'],
    success: ['bg-accent-50 text-accent-900', CircleCheck, 'text-accent-700'],
    neutral: ['bg-sunken text-ink-2', Info, 'text-ink-3'],
  }[tone]
  // Custom icon if given, else the tone's default (array index 1).
  const Icon = icon ?? styles[1]
  return (
    // Coloured rounded box; error notices get role="alert" so they're announced.
    <div className={cn('flex gap-3 rounded-tile px-4 py-3.5 text-meta', styles[0], className)} role={tone === 'error' ? 'alert' : undefined}>
      {/* Leading icon in the tone's colour. */}
      <Icon size={18} className={cn('mt-px shrink-0', styles[2])} aria-hidden />
      {/* Text column. */}
      <div className="min-w-0 flex-1">
        {/* Optional bold title. */}
        {title && <p className="font-bold">{title}</p>}
        {/* Body; a little gap above it only when there's a title. */}
        {children && <div className={cn(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {/* Optional action on the right, vertically centred. */}
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
