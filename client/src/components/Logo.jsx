// FILE: components/Logo.jsx — the SITECORD wordmark (the brand name set in type).
//
// What it does: renders the word "SiteCord" in the wide display font, uppercase
// and letter-spaced, in dark ink or (with `inverse`) in white.
// Where it's used: the desktop sidebar, the top of phone pages and the sign-in
// hero (inverse, on a dark background).
// Depends on: `cn` from lib/format.js, a helper that joins CSS class names.

// ES module import: pull the named export `cn` out of another file.
// The curly braces mean "named import" (not the file's default export).
import { cn } from '../lib/format.js'

/** SITECORD in the wide display face. Sidebar, phone page tops and the sign-in hero (inverse). */
// `export function` declares a React component (a function that returns JSX) and
// exports it by name. `({ inverse, className })` destructures the props object:
// it pulls the `inverse` and `className` properties into local variables.
export function Wordmark({ inverse, className }) {
  // A component returns JSX, the HTML-like syntax React turns into real elements.
  // The parentheses just let the JSX span several lines.
  return (
    // <span> element. `className` is JSX's name for the HTML `class` attribute.
    // cn(...) joins: the base styling (display font, 15px, semibold, wide letter
    // spacing, uppercase), then a ternary `cond ? a : b` picking white text when
    // `inverse` is truthy or the normal ink colour otherwise, then any extra
    // classes the caller passed in.
    <span className={cn('font-display text-[15px] font-semibold tracking-[0.12em] uppercase', inverse ? 'text-white' : 'text-ink', className)}>
      {/* Plain text child of the span; CSS uppercases it on screen. */}
      SiteCord
    </span>
  )
}
