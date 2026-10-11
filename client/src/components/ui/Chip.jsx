// FILE: components/ui/Chip.jsx — status pills (small rounded labels).
//
// What it does: `Chip` is the primitive pill (a coloured background, an
// optional dot or icon, and a short label). `StatusChip` looks the tone and
// label up in lib/status.js (and the i18n translations) so pages pass a record
// kind and a status rather than choosing colours themselves. `RoleTag` is a
// neutral outlined pill showing a person's role on the project.
// Where it's used: lists, record pages and cards everywhere status is shown.
// Re-exported from ui/index.js.
// Depends on: shared/permissions.js (role names), the i18n provider, `cn`
// (class-name joiner) and lib/status.js (status -> tone + English label).

// `@shared` is a path alias (configured in Vite) pointing at the shared folder
// used by both server and client. ROLE_LABELS maps role codes to readable names.
import { ROLE_LABELS } from '@shared/permissions.js'
// Hook giving the translation function `t`.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Helper that joins CSS class strings, skipping falsy values.
import { cn } from '../../lib/format.js'
// Function returning [tone, englishLabel] for a (kind, status) pair.
import { statusOf } from '../../lib/status.js'

// Tone names match lib/status.js. Every tone has a dot colour that reads on it.
// An object literal used as a lookup table: tone name -> Tailwind classes for
// background and text colour.
const TONES = {
  // Light accent (green/blue brand colour) background, dark accent text.
  evidence: 'bg-accent-50 text-accent-800',
  // Amber: waiting on someone.
  waiting: 'bg-warn-50 text-warn-800',
  // Solid dark pill with white text.
  verified: 'bg-ink text-white',
  // Solid accent pill with white text.
  approved: 'bg-accent-600 text-white',
  // Grey, for anything without a special meaning.
  neutral: 'bg-sunken text-ink-2',
  // Red for rejected/problem states.
  danger: 'bg-danger-50 text-danger-700',
  // Translucent white with blurred backdrop.
  glass: 'bg-white/90 text-ink backdrop-blur', // on top of photos
}
// Second lookup table: tone name -> background class for the little dot.
const DOTS = {
  // Accent dot on the glass pill.
  glass: 'bg-accent-600',
  // Accent dot on the evidence pill.
  evidence: 'bg-accent-600',
  // Amber dot.
  waiting: 'bg-warn-500',
  // White dot so it shows on the dark pill.
  verified: 'bg-white',
  // White dot so it shows on the accent pill.
  approved: 'bg-white',
  // Mid-grey dot.
  neutral: 'bg-ink-4',
  // Red dot.
  danger: 'bg-danger-500',
}

/** Small pill with a dot: the one way status is shown. */
// Exported component. Destructured props with defaults: tone 'neutral', dot
// shown (true), size 'sm'. `icon: Icon` renames the prop to a capitalised
// variable so it can be used as a JSX component tag.
export function Chip({ tone = 'neutral', children, dot = true, icon: Icon, size = 'sm', className }) {
  return (
    // The pill is an inline <span>.
    <span
      // cn() joins: base pill styling (inline flex, rounded-full, bold, no
      // wrapping); a ternary for size md (taller, bigger text) vs sm; the tone's
      // colours, where `??` (nullish coalescing) falls back to neutral if
      // TONES[tone] is undefined/null; then caller's extra classes.
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-bold whitespace-nowrap',
        size === 'md' ? 'h-7 px-3 text-meta' : 'h-6 px-2.5 text-2xs',
        TONES[tone] ?? TONES.neutral,
        className,
      )}
    >
      {/* Ternary: if an icon was given, render it; otherwise `dot && <span/>`
          renders the small round dot only when `dot` is true. DOTS[tone] is
          bracket notation: look up the property named by the variable `tone`. */}
      {Icon ? <Icon size={12} strokeWidth={2.6} aria-hidden /> : dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone])} aria-hidden />}
      {/* The label text passed between <Chip> and </Chip>. */}
      {children}
    </span>
  )
}

/** Status chip from the shared vocabulary in lib/status.js. */
// Props: `kind` (e.g. purchase, report), `status` (e.g. WAITING), optional size and class.
export function StatusChip({ kind, status, size, className }) {
  // Get the translate function.
  const { t } = useI18n()
  // Array destructuring: statusOf returns a two-item array; take item 0 as
  // `tone` and item 1 as `english`.
  const [tone, english] = statusOf(kind, status)
  // Template literal (backticks): `${...}` inserts values, building e.g. "chip.purchase.WAITING".
  const key = `chip.${kind}.${status}`
  // Look the key up in the current language.
  const translated = t(key)
  return (
    // Reuse the Chip primitive, passing props through.
    <Chip tone={tone} size={size} className={className}>
      {/* The translator returns the key itself when no translation exists, so
          fall back to the English label in that case. */}
      {translated === key ? english : translated}
    </Chip>
  )
}

/** Neutral pill for a person's role on the project. */
// Props: the role code and optional extra classes.
export function RoleTag({ role, className }) {
  return (
    // Outlined white pill, small bold grey text, no wrapping.
    <span className={cn('inline-flex h-6 items-center rounded-full border border-line bg-white px-2.5 text-2xs font-bold whitespace-nowrap text-ink-2', className)}>
      {/* `?.` (optional chaining): call toLowerCase only if a label exists,
          otherwise the expression is undefined and `??` falls back to the raw role code. */}
      {ROLE_LABELS[role]?.toLowerCase() ?? role}
    </span>
  )
}
