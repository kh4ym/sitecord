// FILE: client/src/lib/motion.js
//
// What it does: all animation in the app, built on GSAP (GreenSock, a
// JavaScript animation library). Motion is short, purposeful, and never in the
// way. Everything here respects "reduce motion" (the OS setting, or
// localStorage sitecord.motion = 'reduce' for testing): elements simply
// appear in their final state.
//
// Why it exists: it is the single place GSAP is configured. Components import
// `gsap` and `useGSAP` from here rather than from the packages, so the
// defaults and the plugin registration apply everywhere.
//
// Where it's used (hooks): usePageReveal (Page.jsx), useStagger (ListCard),
// useSlidingPill (tab bar, sidebar, FilterChips), useCenterActive
// (FilterChips), useCountUp and useGrow (Bars.jsx).
//
// Depends on: react (useLayoutEffect, useRef), gsap, @gsap/react (useGSAP).

// Named imports of two React hooks.
import { useLayoutEffect, useRef } from 'react'
// Default import (no curly braces): the module's main export, the gsap object.
import gsap from 'gsap'
// Named import: GSAP's React hook. useGSAP is like useEffect but automatically
// reverts (cleans up) every animation created inside it when the component
// unmounts or its dependencies change.
import { useGSAP } from '@gsap/react'

// Register useGSAP with gsap (required by GSAP so the hook can hook into its internals).
gsap.registerPlugin(useGSAP)
// Set defaults for every tween: an ease-out curve and 0.45 seconds long.
gsap.defaults({ ease: 'power3.out', duration: 0.45 })

// Re-export both so components import them from here.
export { gsap, useGSAP }

/** Checked at animation time, not module load, so a settings change takes effect without a reload. */
export function reduced() {
  // localStorage can throw (e.g. in private mode with storage blocked), so wrap it.
  try {
    // A testing override stored in the browser.
    if (localStorage.getItem('sitecord.motion') === 'reduce') return true
  // Optional catch binding: ignore the error.
  } catch {
    /* storage blocked */
  }
  // matchMedia evaluates a CSS media query; `?.(...)` calls it only if it exists.
  // `!!` converts any value to a true/false boolean.
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** +1 for left-to-right, −1 when the page is right-to-left (Urdu). */
// Reads the `dir` attribute of the <html> element.
export const dirSign = () => (document.documentElement.dir === 'rtl' ? -1 : 1)

/**
 * Blocks marked [data-reveal] fade up in turn when the page mounts. Pages
 * render this once their data has loaded, so the content arrives with it.
 */
// `scope` is a React ref (an object whose .current points at a DOM element).
export function usePageReveal(scope) {
  // useGSAP(callback, config): run the callback after render; config.scope limits
  // selector text inside to that element and ties cleanup to it.
  useGSAP(
    // The animation setup function.
    () => {
      // Respect reduce-motion: do nothing, the elements are already visible.
      if (reduced()) return
      // Find all descendants with a data-reveal attribute (CSS attribute selector).
      const items = scope.current?.querySelectorAll('[data-reveal]')
      // None found (or no element yet): stop. `?.length` handles undefined items.
      if (!items?.length) return
      // Only the first 14 blocks: anything below the fold would animate unseen.
      // clearProps leaves no inline styles behind, so later CSS transitions work.
      // gsap.from(targets, vars) animates FROM these values TO the element's current state.
      // `[...items]` spreads the NodeList into a real array so `.slice` works.
      // y: 14 = start 14px lower; autoAlpha: 0 = start invisible (opacity + visibility);
      // stagger: 0.05 = each element starts 0.05 s after the previous one.
      gsap.from([...items].slice(0, 14), { y: 14, autoAlpha: 0, duration: 0.5, stagger: 0.05, clearProps: 'transform,opacity,visibility' })
    },
    // Config object: `{ scope }` is shorthand for { scope: scope }.
    { scope },
  )
}

/** List rows ease in after a filter changes (not on every refetch). */
// `key` is any value that changes when the filter changes.
export function useStagger(scope, key) {
  // useRef(initial) returns a box `{ current }` that survives re-renders without
  // causing them. Used here to skip the very first run.
  const first = useRef(true)
  useGSAP(
    () => {
      // First render: just record that it happened and don't animate.
      if (first.current) {
        first.current = false
        return
      }
      // Reduce-motion: no animation.
      if (reduced()) return
      // `:scope > li` = only the direct <li> children of the scope element.
      const rows = scope.current?.querySelectorAll(':scope > li')
      // Nothing to animate.
      if (!rows?.length) return
      // Up to 10 rows slide up 8px and fade in, 0.025 s apart.
      gsap.from([...rows].slice(0, 10), { y: 8, autoAlpha: 0, duration: 0.32, stagger: 0.025, clearProps: 'transform,opacity,visibility' })
    },
    // `dependencies: [key]` re-runs the callback only when `key` changes.
    { scope, dependencies: [key] },
  )
}

/**
 * Where `el` sits inside `container`, in the container's own coordinates
 * (the ones an absolutely positioned child at left: 0, top: 0 uses). Offsets
 * are summed up the offset-parent chain, because rows and list items between
 * the two can be positioned too (the sidebar's lists, the tab bar's cells).
 * Layout offsets ignore transforms, so mid-animation reads stay correct, and
 * they move with the container's scrolling in both writing directions.
 */
// Plain (non-exported) helper function.
function offsetWithin(el, container) {
  // Running totals, reassigned in the loop so `let`.
  let x = 0
  let y = 0
  // Current node as we walk up the tree.
  let node = el
  // Keep climbing until we run out of nodes or reach the container.
  while (node && node !== container) {
    // `+=` adds to the existing value. offsetLeft/Top are relative to offsetParent.
    x += node.offsetLeft
    y += node.offsetTop
    // The nearest positioned ancestor.
    const parent = node.offsetParent
    // Offsets start inside the parent's border; the container's own border is already outside the pill's origin.
    if (parent && parent !== container) {
      // clientLeft/Top = the parent's left/top border width.
      x += parent.clientLeft
      y += parent.clientTop
    }
    // Move up one step.
    node = parent
  }
  // We reached the container: the summed offsets are the answer.
  if (node === container) return { x, y }
  // The container isn't on the chain (not positioned): measure on screen instead.
  // getBoundingClientRect gives the box's position in the viewport.
  const a = el.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  // Difference of the two boxes, minus the container's border, plus how far it has scrolled.
  return { x: a.left - c.left - container.clientLeft + container.scrollLeft, y: a.top - c.top - container.clientTop + container.scrollTop }
}

/**
 * A highlight that slides to the active item of a group (tab bar, sidebar,
 * filter chips). The active item carries data-active="true"; the pill is an
 * absolutely positioned child of the container at left: 0, top: 0.
 */
// containerRef and pillRef are React refs; activeKey changes when the active item changes.
export function useSlidingPill(containerRef, pillRef, activeKey) {
  // Has the pill been positioned at least once?
  const placed = useRef(false)
  // A layout effect, so the pill is in place before the first paint; `placed`
  // makes the first placement a jump and every later one a slide.
  // useLayoutEffect(fn, deps) runs fn synchronously after the DOM updates but
  // before the browser paints. The function it returns is the cleanup.
  useLayoutEffect(() => {
    // Read the actual DOM elements from the refs.
    const container = containerRef.current
    const pill = pillRef.current
    // Not mounted yet: nothing to do.
    if (!container || !pill) return
    // Becomes false on cleanup, so late callbacks (fonts loading) do nothing.
    let live = true
    // Arrow function that measures and moves the pill. `animate` = slide or jump.
    const place = (animate) => {
      // The effect was cleaned up: ignore.
      if (!live) return
      // Find the active item by its attribute.
      const active = container.querySelector('[data-active="true"]')
      // No active item: hide the pill instantly.
      if (!active) {
        // gsap.set applies values immediately (a zero-length tween).
        gsap.set(pill, { autoAlpha: 0 })
        placed.current = false
        return
      }
      // Destructure the returned { x, y } into two variables.
      const { x, y } = offsetWithin(active, container)
      // Target values: position, the active item's size, fully visible.
      const to = { x, y, width: active.offsetWidth, height: active.offsetHeight, autoAlpha: 1 }
      // Jump (set) on first placement, when not animating, or under reduce-motion.
      if (!animate || !placed.current || reduced()) gsap.set(pill, to)
      // Otherwise slide: gsap.to animates from the current values TO `to`.
      // `...to` spreads the targets in; overwrite: true kills any running tween on the pill.
      else gsap.to(pill, { ...to, duration: 0.42, ease: 'power3.out', overwrite: true })
      // Remember that the pill is now placed.
      placed.current = true
    }
    // Place it now.
    place(true)
    // Re-measure when the group or the active item changes size (window
    // resize, a badge appearing, the web fonts arriving); while the pill is
    // still sliding, retarget the slide instead of jumping.
    // ResizeObserver calls its callback whenever an observed element's size changes.
    // gsap.isTweening(pill) is true while an animation is running on it.
    const ro = new ResizeObserver(() => place(gsap.isTweening(pill)))
    // Watch the container.
    ro.observe(container)
    // Also watch the active item, if any.
    const active = container.querySelector('[data-active="true"]')
    if (active) ro.observe(active)
    // document.fonts.ready is a Promise that resolves once web fonts load; `.then` runs after.
    document.fonts?.ready.then(() => place(gsap.isTweening(pill)))
    // Switching to Urdu mirrors the layout without necessarily resizing anything.
    // MutationObserver calls back when DOM attributes/children change.
    const mo = new MutationObserver(() => place(false))
    // Watch only the `dir` attribute on <html>.
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] })
    // Cleanup function: React runs it before the next effect run and on unmount.
    return () => {
      live = false
      // Stop both observers.
      ro.disconnect()
      mo.disconnect()
    }
  // Dependency array: re-run the effect when any of these change.
  }, [activeKey, containerRef, pillRef])
}

/**
 * A sideways-scrolling row of chips starts with the selected one in view
 * (horizontally only, so the page itself doesn't jump).
 */
export function useCenterActive(rowRef) {
  // Runs before paint, so the row never visibly jumps.
  useLayoutEffect(() => {
    // The scrolling row element.
    const row = rowRef.current
    // The selected chip inside it (optional chaining in case row is null).
    const active = row?.querySelector('[data-active="true"]')
    // Stop if missing, or if the row doesn't overflow (nothing to scroll).
    if (!row || !active || row.scrollWidth <= row.clientWidth) return
    // Offsets and scrollLeft share coordinates in both directions (RTL scrolls negative).
    // Scroll so the active chip sits in the middle of the visible width.
    row.scrollLeft = offsetWithin(active, row).x - (row.clientWidth - active.offsetWidth) / 2
  // Only on mount (the ref object itself never changes).
  }, [rowRef])
}

/** Count a number up from where it was to its new value. */
// `format` is a function that turns a number into display text. The last
// parameter destructures `duration` from an options object, default 0.9 s.
export function useCountUp(ref, value, format, { duration = 0.9 } = {}) {
  // Writes textContent directly: a tween driving React state would re-render
  // the page sixty times a second. The sr-only copy in CountUp stays static.
  // The value we last finished on; the next count starts here.
  const from = useRef(0)
  useGSAP(
    () => {
      // The DOM element that shows the number.
      const el = ref.current
      if (!el) return
      // No animation possible/wanted: write the final text directly.
      if (reduced() || value == null || Number.isNaN(value)) {
        el.textContent = format(value)
        from.current = value
        return
      }
      // GSAP can animate any object's numeric property; this plain object is the "counter".
      const box = { n: from.current ?? 0 }
      // Tween box.n up to `value`.
      gsap.to(box, {
        n: value,
        // Shorthand for duration: duration.
        duration,
        ease: 'power2.out',
        // Called on every animation frame; the assignment is wrapped in () so the arrow returns it.
        onUpdate: () => (el.textContent = format(box.n)),
        // Called once at the end: show the exact final value and remember it.
        onComplete: () => {
          el.textContent = format(value)
          from.current = value
        },
      })
    },
    // Re-run whenever the value changes.
    { dependencies: [value] },
  )
}

/** Bars grow from their start edge the first time they appear. */
export function useGrow(ref) {
  // No config object: runs once after the first render.
  useGSAP(() => {
    // Skip under reduce-motion or before the element exists.
    if (reduced() || !ref.current) return
    // Child elements marked data-grow, if any.
    const bars = ref.current.querySelectorAll('[data-grow]')
    // Animate those bars, or the element itself when there are none (ternary).
    gsap.from(bars.length ? bars : [ref.current], {
      // Start at zero width (horizontal scale).
      scaleX: 0,
      // Grow from the left edge in LTR, the right edge in RTL.
      transformOrigin: dirSign() > 0 ? 'left center' : 'right center',
      duration: 0.9,
      ease: 'power3.out',
      // Each bar starts 0.06 s after the previous.
      stagger: 0.06,
      // Remove the inline transform when done.
      clearProps: 'transform',
    })
  })
}
