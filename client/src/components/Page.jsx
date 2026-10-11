// FILE: components/Page.jsx — the wrapper every page renders as its root.
//
// What it does: sets the content width (narrow / base / wide), centres it, and
// runs the staggered reveal of [data-reveal] blocks when a page mounts
// (lib/motion.js usePageReveal, which uses GSAP to fade/slide them in one
// after another).
// Where it's used: every page in pages/, after its loading and error returns.
// Depends on: React's useRef, `cn` (class-name joiner) and usePageReveal.

// Named import of the `useRef` hook from the React library.
import { useRef } from 'react'
// Helper that joins CSS class strings, skipping empty/false values.
import { cn } from '../lib/format.js'
// Custom hook that animates the [data-reveal] children of an element.
import { usePageReveal } from '../lib/motion.js'

/**
 * Wraps a page's content once its data has loaded; blocks marked
 * data-reveal ease in one after another. Every page renders this as its
 * root, after its loading and error returns, and picks a width: narrow for
 * forms and feeds, base for lists, wide for the 3D and card grids.
 */
// Exported component. Destructured props: `children` (whatever JSX is nested
// inside <Page>...</Page>), `width` with a default value of 'base' used when the
// caller doesn't pass one, and optional extra `className`.
export function Page({ children, width = 'base', className }) {
  // useRef(null) creates a box `{ current: null }` that survives re-renders;
  // React fills `ref.current` with the real DOM <div> once it is on screen.
  const ref = useRef(null)
  // Calling the custom hook with the ref so it can find and animate the blocks.
  usePageReveal(ref)
  // Return the JSX to render.
  return (
    // `ref={ref}` attaches the ref to this div. The className uses nested
    // ternaries (a ? b : c ? d : e): narrow -> max-w-2xl, wide -> no max width,
    // anything else -> max-w-5xl; plus centring (mx-auto) and full width.
    <div ref={ref} className={cn('mx-auto w-full', width === 'narrow' ? 'max-w-2xl' : width === 'wide' ? 'max-w-none' : 'max-w-5xl', className)}>
      {/* Curly braces in JSX insert a JavaScript value; here the nested page content. */}
      {children}
    </div>
  )
}
