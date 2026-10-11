// FILE: components/ui/ListCard.jsx — the list pattern used on nearly every page.
//
// What it does: `ListCard` is a white card holding rows separated by divider
// lines (rows ease in with a stagger animation). `ListRow` is one row: a
// leading tile, a title, a subtitle and trailing content, and the whole row
// becomes a link or button when it has somewhere to go. `IconTile` is the round
// icon at the start of a row. `SectionHead` is the small heading above a card.
// Where it's used: almost every list page. Re-exported from ui/index.js.
// Depends on: React's useRef, react-router's Link, a lucide-react chevron
// icon, `cn`, and lib/motion.js useStagger (GSAP).

// Hook to reference the <ul> DOM element.
import { useRef } from 'react'
// In-app navigation link.
import { Link } from 'react-router'
// The ">" arrow shown at a row's end.
import { ChevronRight } from 'lucide-react'
// Class-name joiner.
import { cn } from '../../lib/format.js'
// Animation hook that eases children in one after another.
import { useStagger } from '../../lib/motion.js'

/**
 * Rows grouped in one white card with dividers, the main list pattern.
 * Rows ease in again when `animateKey` (e.g. the active filter) changes.
 */
// Props: the rows (`children`), extra class, an `animateKey` that retriggers
// the animation, and an accessible `label`.
export function ListCard({ children, className, animateKey, label }) {
  // Ref the stagger hook uses to find the rows.
  const ref = useRef(null)
  // Run the stagger animation now and whenever animateKey changes.
  useStagger(ref, animateKey)
  return (
    // Unordered list styled as a card with dividers; overflow-hidden clips row
    // hover backgrounds to the rounded corners.
    <ul ref={ref} aria-label={label} className={cn('card divide-y divide-line overflow-hidden', className)}>
      {children}
    </ul>
  )
}

/**
 * One row: optional leading tile, a title with one line under it, and
 * something on the trailing side (an amount, a chip, a switch).
 */
// Props: `to` (link destination) or `onClick` (button action), `leading`,
// `title`, `subtitle`, `trailing` content, `chevron` flag, className, and any
// extra `children` shown under the subtitle.
export function ListRow({ to, onClick, leading, title, subtitle, trailing, chevron, className, children }) {
  // The whole row is the link or button when it has a destination; otherwise a plain div.
  // `body` is the row's inner JSX in a Fragment (<>...</>), reused in each branch below.
  const body = (
    <>
      {/* Leading element (e.g. an IconTile or avatar), if any. */}
      {leading}
      {/* Middle text column; min-w-0 + flex-1 lets it shrink so text can truncate. */}
      <span className="min-w-0 flex-1">
        {/* Title on one line, cut off with "..." if too long. */}
        <span className="block truncate text-body font-semibold text-ink">{title}</span>
        {/* Subtitle only when provided. */}
        {subtitle && <span className="mt-0.5 block truncate text-meta text-ink-3">{subtitle}</span>}
        {/* Any extra content. */}
        {children}
      </span>
      {/* Trailing column aligned to the end edge, only when given. */}
      {trailing && <span className="flex shrink-0 flex-col items-end gap-1 text-end">{trailing}</span>}
      {/* Optional ">" arrow, mirrored for right-to-left languages. */}
      {chevron && <ChevronRight size={18} className="shrink-0 text-ink-4 rtl:-scale-x-100" aria-hidden />}
    </>
  )
  // Row classes: flex row at least 64px tall; hover/press tint only when the
  // row is interactive (`(to || onClick) && '...'`).
  const classes = cn('flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors', (to || onClick) && 'hover:bg-ink/[0.025] active:bg-ink/[0.05]', className)
  return (
    // Each row is a list item inside the ListCard's <ul>.
    <li>
      {/* Chained ternary picking the element: Link if `to`, button if
          `onClick`, else a plain div. All share the same classes and body. */}
      {to ? (
        <Link to={to} className={classes}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={classes}>
          {body}
        </button>
      ) : (
        <div className={classes}>{body}</div>
      )}
    </li>
  )
}

// Lookup table: tile tone -> background and icon colour classes.
const TILE_TONES = {
  // Light accent.
  accent: 'bg-accent-50 text-accent-700',
  // Light amber.
  warn: 'bg-warn-50 text-warn-800',
  // Solid black.
  ink: 'bg-ink text-white',
  // Grey (default).
  neutral: 'bg-sunken text-ink-2',
  // Light red.
  danger: 'bg-danger-50 text-danger-700',
}

/** Round icon at the start of a row. */
// Props: `icon` renamed to `Icon` for use as a tag, `tone` default 'neutral', `size` default 'md'.
export function IconTile({ icon: Icon, tone = 'neutral', size = 'md', className }) {
  return (
    // Round centred grid, 32px or 40px, coloured by tone. Decorative (aria-hidden).
    <span className={cn('grid shrink-0 place-items-center rounded-full', size === 'sm' ? 'h-8 w-8' : 'h-10 w-10', TILE_TONES[tone], className)} aria-hidden>
      {/* The icon, sized to fit the tile. */}
      <Icon size={size === 'sm' ? 15 : 18} strokeWidth={2} />
    </span>
  )
}

/** Small wide-type section heading with an optional blue action on the right. */
// Props: `title`, `action` ({ label, to } or { label, onClick }), `meta` text,
// `as: H = 'h2'` (rename the `as` prop to `H` with default 'h2', so the caller
// can choose the heading level), className and an `id` for aria-labelledby.
export function SectionHead({ title, action, meta, as: H = 'h2', className, id }) {
  return (
    // Row with title on the left and meta/action on the right, aligned on text baseline.
    <div className={cn('flex items-baseline justify-between gap-3 px-1', className)}>
      {/* `H` holds a string like 'h2'; JSX renders it as that HTML tag. */}
      <H id={id} className="head text-ink">
        {title}
      </H>
      {/* Optional small grey text. */}
      {meta && <span className="text-meta text-ink-3">{meta}</span>}
      {/* Only when there's an action: a Link if it has `to`, else a button. */}
      {action &&
        (action.to ? (
          // Accent-coloured text link.
          <Link to={action.to} className="text-meta font-semibold text-accent-700 hover:text-accent-800">
            {action.label}
          </Link>
        ) : (
          // Same look as a button calling action.onClick.
          <button type="button" onClick={action.onClick} className="text-meta font-semibold text-accent-700 hover:text-accent-800">
            {action.label}
          </button>
        ))}
    </div>
  )
}
