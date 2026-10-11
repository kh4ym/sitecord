// FILE: components/ui/Bars.jsx — numbers and bars.
//
// What it does: the stat row at the top of pages (StatRow), numbers that count
// up when shown (CountUp), the rounded progress meter (Meter), the budget's
// stacked bar of parts of a whole (StackedBar), and the on/off switch (Toggle).
// Where it's used: dashboards, Money/budget pages, settings. Re-exported from
// ui/index.js.
// Depends on: React's useRef, react-router's Link, `cn`, and the GSAP-based
// hooks useCountUp (animate a number) and useGrow (grow bars in) from lib/motion.js.

// Hook to reference DOM elements for the animation hooks.
import { useRef } from 'react'
// In-app navigation link (a stat can link to its page).
import { Link } from 'react-router'
// Class-name joiner.
import { cn } from '../../lib/format.js'
// Animation hooks built on GSAP.
import { useCountUp, useGrow } from '../../lib/motion.js'

/**
 * Three numbers in a row with tiny labels ("1.14 crore spent · 4 waiting").
 *   <StatRow items={[{ value: 1.14, format, unit: 'crore', label: 'spent', to, tone }]} />
 */
// Props: `items` (array of stats), extra class, and rest `...props` for the <dl>.
export function StatRow({ items, className, ...props }) {
  return (
    // <dl> is a "description list" (term/description pairs), semantically right
    // for label/value stats. Three equal grid columns.
    <dl className={cn('grid grid-cols-3 gap-3', className)} {...props}>
      {/* Map each stat `s` to a column. Braces body, so an explicit return. */}
      {items.map((s) => {
        // The value JSX (number + unit) in a Fragment, reused in both branches below.
        const value = (
          <>
            {/* Large stat number that animates up to its value. */}
            <span className="text-stat">
              <CountUp value={s.value} format={s.format} />
            </span>
            {/* Optional unit word, e.g. "crore". */}
            {s.unit && <span className="text-meta font-semibold">{s.unit}</span>}
          </>
        )
        return (
          // Label doubles as the React list key (must be unique per row).
          <div key={s.label} className="min-w-0">
            {/* <dd> holds the value; red when tone is 'danger'. */}
            <dd className={cn('flex items-baseline gap-1 font-display font-semibold', s.tone === 'danger' ? 'text-danger-700' : 'text-ink')}>
              {/* Wrap the value in a Link only when the stat has a destination. */}
              {s.to ? (
                <Link to={s.to} className="flex items-baseline gap-1 hover:opacity-80">
                  {value}
                </Link>
              ) : (
                // No link: render the value JSX as-is.
                value
              )}
            </dd>
            {/* <dt> is the term (label) under the number. */}
            <dt className="mt-1 truncate text-2xs font-semibold text-ink-3">{s.label}</dt>
          </div>
        )
      })}
    </dl>
  )
}

// Default number formatter, an arrow function: null/undefined (`== null`
// catches both) shows an em dash; otherwise round and add Pakistani-style
// digit grouping with toLocaleString('en-PK').
const plain = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-PK'))

/** A number that counts up to its value; screen readers get the final value. */
// Props: target `value`, `format` function (defaults to `plain`), extra class.
export function CountUp({ value, format = plain, className }) {
  // Ref to the visible number span the hook animates.
  const ref = useRef(null)
  // GSAP tween rewriting the span's text from the old value to the new one.
  useCountUp(ref, value, format)
  return (
    <span className={cn('relative', className)}>
      {/* Animated visual number, hidden from screen readers (they'd hear every step). */}
      <span ref={ref} aria-hidden>
        {format(value)}
      </span>
      {/* sr-only: visually hidden but read by screen readers; the final value. */}
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}

// Tone -> class for the filled part of a bar.
const FILL = { accent: 'bg-accent-600', warn: 'bg-warn-600', danger: 'bg-danger-500', ink: 'bg-ink', onAccent: 'bg-white' }
// Tone -> class for the empty track behind it (onAccent is for use on accent backgrounds).
const TRACK = { accent: 'bg-accent-100', warn: 'bg-warn-100', danger: 'bg-danger-100', ink: 'bg-sunken', onAccent: 'bg-white/25' }

/** One rounded progress bar; grows in when first shown. */
// Props with defaults: max 100, tone 'accent', size 'md'; `label` names it for screen readers.
export function Meter({ value, max = 100, tone = 'accent', size = 'md', label, className }) {
  // Ref for the grow animation.
  const ref = useRef(null)
  // Animate [data-grow] children from zero width when first shown.
  useGrow(ref)
  // Percentage clamped between 0 and 100 (Math.max/Math.min); 0 if max isn't positive.
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div
      // Element for the animation hook.
      ref={ref}
      // ARIA progressbar role plus min/max/current values so assistive tech reads "45 percent".
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      // The track: rounded, clipped, height by size (nested ternary), tone colour.
      className={cn('overflow-hidden rounded-full', size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2', TRACK[tone], className)}
    >
      {/* The fill. `style={{ ... }}`: outer braces = JS expression, inner = an
          object of CSS properties. Width is a template literal like "45%". */}
      <div data-grow className={cn('h-full rounded-full transition-[width] duration-500', FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

/**
 * Parts of a whole side by side, with 2px gaps, a legend with values and a
 * table for screen readers. When the parts add up to more than `total`
 * (over budget), the bar scales to the parts and marks where `total` ends.
 *   <StackedBar total={budget} segments={[{ key, label, value, color }]} remainder={{ label: 'left' }} format={fmt} />
 */
// Props: `segments` array, `total`, `remainder` legend labels, formatter, accessible label.
export function StackedBar({ segments, total, remainder, format = plain, label, className }) {
  // Ref for the grow animation.
  const ref = useRef(null)
  // Grow the segments in.
  useGrow(ref)
  // .reduce adds up all segment values, starting from 0 (`n` is the running total).
  const used = segments.reduce((n, s) => n + s.value, 0)
  // The bar's 100% mark: whichever is bigger of total and used; `|| 1` avoids dividing by zero.
  const scale = Math.max(total ?? 0, used) || 1
  // How much is left (never negative).
  const left = Math.max(0, (total ?? 0) - used)
  // Over budget: a total exists and the parts exceed it.
  const over = total != null && used > total
  return (
    // <figure> with a <figcaption>: semantic pairing of a graphic and its description.
    <figure className={cn('flex flex-col gap-3', className)}>
      {/* The bar itself; hidden from screen readers (the table below covers it). */}
      <div ref={ref} className="relative flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {/* One div per segment with a positive value, width as a % of scale,
            its own colour; first/last get rounded start/end corners. */}
        {segments.map((s) =>
          s.value > 0 ? <div key={s.key} data-grow className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(s.value / scale) * 100}%`, background: s.color }} /> : null,
        )}
        {/* Grey filler for the unspent part (flex-1 takes the remaining space). */}
        {left > 0 && <div data-grow className="h-full flex-1 rounded-e-full bg-sunken" />}
        {/* Over budget: a thin black marker where the total ends. insetInlineStart
            is the "left" edge in left-to-right and "right" edge in right-to-left. */}
        {over && <span className="absolute inset-y-[-3px] w-[2px] rounded bg-ink" style={{ insetInlineStart: `${(total / scale) * 100}%` }} />}
      </div>
      <figcaption>
        {/* Legend: wrapping row of coloured dot + label + value. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-meta">
          {/* Arrow function with `( )` body: implicit return of the JSX. */}
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              {/* Colour dot matching the segment. */}
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {/* Segment name. */}
              <span className="text-ink-3">{s.label}</span>
              {/* Formatted value (`num` = tabular numerals). */}
              <span className="num font-semibold text-ink">{format(s.value)}</span>
            </li>
          ))}
          {/* Optional "left" / "over by" legend entry. */}
          {remainder && (
            <li className="flex items-center gap-1.5">
              {/* Black dot when over budget, outlined grey dot otherwise. */}
              <span className={cn('h-2.5 w-2.5 rounded-full', over ? 'bg-ink' : 'bg-sunken ring-1 ring-line-strong')} aria-hidden />
              {/* Label switches between the over and normal wording. */}
              <span className="text-ink-3">{over ? remainder.overLabel : remainder.label}</span>
              {/* Amount over (red) or amount left. */}
              <span className={cn('num font-semibold', over ? 'text-danger-700' : 'text-ink')}>{format(over ? used - total : left)}</span>
            </li>
          )}
        </ul>
        {/* Screen-reader-only data table repeating the numbers. */}
        <table className="sr-only">
          {/* Table title. */}
          <caption>{label}</caption>
          <tbody>
            {/* One row per segment. */}
            {segments.map((s) => (
              <tr key={s.key}>
                {/* scope="row": this header cell labels its row. */}
                <th scope="row">{s.label}</th>
                <td>{format(s.value)}</td>
              </tr>
            ))}
            {/* Total row, when a total was given. */}
            {total != null && (
              <tr>
                <th scope="row">Total</th>
                <td>{format(total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}

/** On/off switch (role="switch"). */
// Props: `checked` state, `onChange(newValue)`, `disabled`, accessible `label`, extra class.
export function Toggle({ checked, onChange, disabled, label, className }) {
  return (
    <button
      // Plain button, never submits forms.
      type="button"
      // ARIA switch role + aria-checked: announced as "on"/"off".
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      // Clicking reports the opposite of the current value (`!` = logical NOT).
      onClick={() => onChange(!checked)}
      // Track: 48x28 rounded pill, accent when on, white with border when off.
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-[1.5px] transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-accent-600 bg-accent-600' : 'border-line-input bg-white',
        className,
      )}
    >
      {/* The knob: vertically centred circle with a shadow that slides from the
          start to the end edge (white when on, grey when off). */}
      <span
        className={cn(
          'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-[inset-inline-start,background-color] duration-200 ease-[var(--ease-snappy)]',
          checked ? 'start-[calc(100%-1.4rem)] bg-white' : 'start-[0.15rem] bg-ink-3',
        )}
        // Decorative.
        aria-hidden
      />
    </button>
  )
}
