// FILE: components/ui/FilterChips.jsx — horizontal rows of pills.
//
// What it does: `FilterChips` is a row of pills for choosing a page's filter
// (held in React state; behaves like a radio group). `TabPills` is the same
// look used as navigation between sibling routes (the Money section: budget,
// purchases, payments, materials). Both share the sliding black "selected"
// pill animation from lib/motion.js, and scroll sideways on narrow screens,
// keeping the active pill centred.
// Where it's used: list pages (filters) and the Money section (tabs).
// Re-exported from ui/index.js.
// Depends on: React's useRef, react-router (Link, matchPath, useLocation),
// `cn`, and the motion hooks useSlidingPill / useCenterActive (GSAP based).

// Hook for holding references to DOM elements.
import { useRef } from 'react'
// Link: in-app navigation. matchPath: tests a URL against a route pattern.
// useLocation: hook returning the current URL info.
import { Link, matchPath, useLocation } from 'react-router'
// Class-name joiner.
import { cn } from '../../lib/format.js'
// Animation hooks: centre the active pill in a scrolling row; slide the black pill under the active one.
import { useCenterActive, useSlidingPill } from '../../lib/motion.js'

/**
 * A row of filter pills; the selected one is black, and the black slides
 * between them. Scrolls sideways on narrow screens.
 *   <FilterChips value={v} onChange={setV} options={[{ value, label, count }]} label="Show" />
 */
// Props: current `value`, `onChange` callback, `options` array, accessible
// `label`, `size` defaulting to 'md', extra className, and `...props` (rest).
export function FilterChips({ value, onChange, options, label, size = 'md', className, ...props }) {
  // Ref to the row container element.
  const row = useRef(null)
  // Ref to the black sliding pill element.
  const pill = useRef(null)
  // Move the pill (with GSAP) under whichever button matches `value`.
  useSlidingPill(row, pill, value)
  // Scroll the row so the active pill is in view.
  useCenterActive(row)
  return (
    // role="radiogroup" + aria-label: screen readers announce a named group of
    // single-choice options. Styling: horizontally scrollable flex row with
    // hidden scrollbar; relative so the pill can be absolutely positioned.
    <div role="radiogroup" aria-label={label} ref={row} className={cn('scrollbar-none relative -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5', className)} {...props}>
      {/* The black pill itself: starts invisible (opacity-0) at the top-left;
          the motion hook sets its size, position and opacity. Ignores clicks. */}
      <span ref={pill} className="pointer-events-none absolute left-0 top-0 rounded-full bg-ink opacity-0" aria-hidden />
      {/* Map each option to a button. This arrow function has a `{ }` body, so it needs an explicit `return`. */}
      {options.map((o) => {
        // True when this option is the selected one.
        const active = o.value === value
        return (
          <button
            // Unique key for list rendering.
            key={o.value}
            // Never submit a surrounding form.
            type="button"
            // Each button acts as one radio option...
            role="radio"
            // ...and announces whether it is checked.
            aria-checked={active}
            // data-* attribute the motion hooks read to find the active element.
            data-active={active}
            // On click, report this option's value to the parent.
            onClick={() => onChange(o.value)}
            // Pill styling above the black pill (z-[1]); size variant; white
            // text on transparent when active (black pill shows behind), else
            // white pill with border.
            className={cn(
              'relative z-[1] flex shrink-0 items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-8 px-3 text-meta' : 'h-10 px-4 text-body',
              active ? 'border-transparent text-white' : 'border-line bg-white text-ink hover:border-line-strong',
            )}
          >
            {/* Option text. */}
            {o.label}
            {/* Count bubble only when count exists (`!= null` checks for both
                null and undefined) and is above zero. */}
            {o.count != null && o.count > 0 && (
              <span className={cn('num rounded-full px-1.5 text-2xs font-bold', active ? 'bg-white/20 text-white' : 'bg-sunken text-ink-2')}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The same pills as navigation (Money: budget · purchases · payments · materials). */
// Props: `items` ([{ to, label, end }]), accessible `label`, extra className.
export function TabPills({ items, label, className }) {
  // Ref to the <nav> row.
  const row = useRef(null)
  // Ref to the sliding black pill.
  const pill = useRef(null)
  // Destructure the current URL path, e.g. "/p/12/money/purchases".
  const { pathname } = useLocation()
  // Find the first item whose route matches the current path, then take its
  // `to` with `?.` (undefined if none matched). `!!i.end` converts to a real
  // boolean: end=true means the path must match exactly, not just as a prefix.
  const active = items.find((i) => matchPath({ path: i.to, end: !!i.end }, pathname))?.to
  // Slide the pill to the active tab.
  useSlidingPill(row, pill, active)
  // Keep the active tab scrolled into view.
  useCenterActive(row)
  return (
    // <nav> landmark with an accessible name; same scrolling row styling as above.
    <nav aria-label={label} ref={row} className={cn('scrollbar-none relative -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5', className)}>
      {/* The sliding black pill (decorative). */}
      <span ref={pill} className="pointer-events-none absolute left-0 top-0 rounded-full bg-ink opacity-0" aria-hidden />
      {/* One Link per tab. */}
      {items.map((i) => {
        // Is this tab the current page?
        const on = i.to === active
        return (
          <Link
            // Route path doubles as the unique key.
            key={i.to}
            // Where the tab navigates to.
            to={i.to}
            // Read by the motion hooks.
            data-active={on}
            // aria-current="page" tells screen readers this link is the current
            // page; undefined omits the attribute on other tabs.
            aria-current={on ? 'page' : undefined}
            // Pill styling (lowercased labels); white text when active, outlined white otherwise.
            className={cn(
              'relative z-[1] flex h-10 shrink-0 items-center rounded-full border px-4 text-body font-semibold whitespace-nowrap lowercase transition-colors',
              on ? 'border-transparent text-white' : 'border-line bg-white text-ink hover:border-line-strong',
            )}
          >
            {/* Tab text. */}
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
