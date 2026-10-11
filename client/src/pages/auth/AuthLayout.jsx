// Frame for the sign-in, register and invite pages: the blue fluted hero with
// the SplitText headline and drifting captions, and the white form sheet.
//
// FILE OVERVIEW
// - What it is: a shared layout component (not a page with its own route). It is
//   used by LoginPage (/login), RegisterPage (/register) and InvitePage
//   (/invite/:token). Each of those pages wraps its form in <AuthLayout>.
// - Who sees it: anyone, signed in or not (these are the public "auth" screens).
// - What it renders: on large screens a two-column grid (blue hero on the left,
//   form on the right); on phones the hero sits on top and the form slides up
//   over it as a rounded white "sheet".
// - Data: it loads no server data. It only sets the browser tab title and runs
//   decorative GSAP animations (glow drift, fluted light, floating captions and a
//   word-by-word headline reveal using the SplitText plugin).
// - Depends on: React hooks, React Router's <Link>, GSAP + SplitText, our
//   Wordmark logo, the cn() class-name helper and lib/motion.js (gsap instance,
//   reduced() = "user prefers reduced motion", useGSAP hook).

// ES module import: pulls the named exports useEffect and useRef out of the 'react' package.
import { useEffect, useRef } from 'react'
// Named import of <Link>, React Router's component for in-app navigation without a full page reload.
import { Link } from 'react-router'
// Imports the SplitText GSAP plugin, which cuts text into words/letters so each can be animated.
import { SplitText } from 'gsap/SplitText'
// Our logo component; the path is relative ('../../' climbs two folders up from pages/auth).
import { Wordmark } from '../../components/Logo.jsx'
// cn() joins several class-name strings together, skipping empty/false ones.
import { cn } from '../../lib/format.js'
// gsap = the animation library, reduced = function telling us if the user wants less motion, useGSAP = React hook that runs GSAP code safely.
import { gsap, reduced, useGSAP } from '../../lib/motion.js'

// Plugins must be registered with GSAP once before use; this runs when the module is first loaded.
gsap.registerPlugin(SplitText)

/**
 * Sign-in pages: the electric-blue hero with fluted light from the design,
 * and the form beside it (below it on phones).
 */
// `export function` makes this component importable by name from other files.
// ({ title, children, compactHero }) is object destructuring of the props object:
// title = text for the browser tab, children = whatever JSX is placed between
// <AuthLayout>…</AuthLayout>, compactHero = true to make the blue hero shorter.
export function AuthLayout({ title, children, compactHero }) {
  // useEffect(fn, deps) runs fn after React paints, and again whenever a value in deps changes.
  useEffect(() => {
    // Template literal (backticks) inserts the title via ${…}; this sets the browser tab text.
    document.title = `${title} · SiteCord`
    // The dependency array [title] means: re-run only when title changes.
  }, [title])
  // A component returns JSX: HTML-like syntax that compiles to React elements.
  return (
    // Outer wrapper: at least full screen height; on large screens (lg:) a two-column grid.
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Renders the Hero component below; the prop compact receives the compactHero value. */}
      <Hero compact={compactHero} />
      {/* The form "sheet": white, rounded top corners overlapping the hero on phones; centred column on large screens. */}
      <div className="relative z-[1] -mt-8 rounded-t-sheet bg-canvas px-5 pt-8 pb-12 sm:px-10 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:rounded-none lg:px-16">
        {/* <main> holds the page's own content; {children} inserts whatever the parent page passed in. */}
        <main className="mx-auto w-full max-w-[420px]">{children}</main>
      </div>
    </div>
  )
}

// A constant array of objects (array literal [] holding object literals {}), one per floating caption.
// UPPER_CASE naming is a convention for fixed module-level data.
const CAPTIONS = [
  // text uses "\n" for a line break; className positions it (start-/end- are left/right that flip for right-to-left languages).
  { text: 'evidence on\nevery purchase', className: 'start-[14%] top-[24%]' },
  // Second caption, lower left.
  { text: 'checked\non site', className: 'start-[8%] top-[58%]' },
  // Third caption, on the right side.
  { text: 'built for\noverseas owners', className: 'end-[9%] top-[46%]' },
]

// Hero is a private component (no `export`), only used by AuthLayout above. { compact } destructures the prop.
function Hero({ compact }) {
  // useRef(null) creates a box { current: null } that will point at the <section> DOM element once rendered.
  const root = useRef(null)
  // useGSAP(callback, config) runs GSAP animations after render and auto-cleans them when the component unmounts.
  useGSAP(
    // Arrow function receiving the GSAP context and contextSafe (a wrapper for code that runs later, e.g. after a promise).
    (context, contextSafe) => {
      // Early return: if the user prefers reduced motion, skip all animations.
      if (reduced()) return
      // q is a selector function limited to elements inside root, e.g. q('[data-glow]') finds them.
      const q = gsap.utils.selector(root)
      // gsap.to(targets, vars) animates towards the given values: slowly moves the gradient back and forth forever (yoyo + repeat: -1).
      gsap.to(q('[data-glow]'), { backgroundPosition: '60% 40%', duration: 9, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      // gsap.fromTo(targets, fromVars, toVars) sets a start AND end: slides the fluted light from -4% to +4% of its width, forever.
      gsap.fromTo(q('[data-flute]'), { xPercent: -4 }, { xPercent: 4, duration: 12, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      // gsap.from animates FROM these values to the element's normal state: captions fade in and rise, one after another (stagger).
      gsap.from(q('[data-caption]'), { autoAlpha: 0, y: 14, duration: 0.8, stagger: 0.15, delay: 0.5 })
      // .forEach((el, i) => …) loops over each caption with its index i; each one bobs up/down with a slightly different speed (3 + i seconds).
      q('[data-caption]').forEach((el, i) => gsap.to(el, { y: -8, duration: 3 + i, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.3 }))
      // q(...) returns an array; [0] takes its first item, the <h1> headline element.
      const headline = q('[data-headline]')[0]
      // The headline splits only once the display font is in, so the words measure right;
      // contextSafe ties that late tween to this context, and the split is undone with it.
      // `let` (not const) because split is reassigned later; null means "not split yet".
      let split = null
      // contextSafe(fn) returns a wrapped version of fn whose animations get cleaned up with this context.
      const rise = contextSafe(() => {
        // Optional chaining ?. : if headline is null/undefined this yields undefined instead of crashing.
        // isConnected is false when the element was removed from the page, so we bail out.
        if (!headline?.isConnected) return
        // Splits the headline into words, each wrapped in a "mask" so it can slide up from hidden.
        split = SplitText.create(headline, { type: 'words', mask: 'words' })
        // Each word rises from 115% below its spot, 0.07s apart, with a fast-then-slow ease.
        gsap.from(split.words, { yPercent: 115, duration: 1, stagger: 0.07, ease: 'expo.out' })
      })
      // document.fonts.ready is a Promise that resolves when web fonts have loaded; .then(rise) calls rise afterwards.
      // ?. guards older browsers where document.fonts doesn't exist.
      document.fonts?.ready.then(rise)
      // Returning a function = cleanup: when unmounting, undo the split (put the original text back) if it happened.
      return () => split?.revert()
    },
    // Config object: scope limits selector text like '[data-glow]' to elements inside root.
    { scope: root },
  )
  // The JSX the Hero renders.
  return (
    <section
      // ref={root} connects the useRef box to this DOM element (root.current = the <section>).
      ref={root}
      // cn() combines fixed classes with a ternary (condition ? a : b): shorter min-height when compact.
      className={cn('relative isolate flex flex-col overflow-hidden text-white lg:sticky lg:top-0 lg:h-dvh', compact ? 'min-h-[38svh]' : 'min-h-[62svh]')}
      // aria-label names the region for screen readers.
      aria-label="SiteCord"
    >
      {/* Background glow layer: fills the section, sits behind content (-z-10). */}
      <div
        // data-glow is a bare attribute (value true) used only as a hook for the GSAP selector above.
        data-glow
        className="absolute inset-0 -z-10"
        // style takes a JS object (double braces: outer {} = JSX expression, inner {} = object literal). CSS names are camelCase.
        style={{
          // Solid fallback colour.
          backgroundColor: '#1e3ff0',
          // An oval radial gradient from light to deep blue.
          backgroundImage: 'radial-gradient(70% 55% at 50% 42%, #6f8bff 0%, #2f50f7 34%, #1a34d6 62%, #0f1f8f 100%)',
          // Larger than the box so it can be moved around by the animation.
          backgroundSize: '160% 160%',
          // Starting position (GSAP animates it to 60% 40%).
          backgroundPosition: '40% 55%',
        }}
        // aria-hidden hides this purely decorative element from screen readers.
        aria-hidden
      />
      {/* Fluted-glass light stripes (the "fluted" class is defined in our CSS); wider than the section so it can drift sideways. */}
      <div data-flute className="fluted absolute -inset-x-[10%] inset-y-0 -z-10 opacity-80" aria-hidden />
      {/* A soft dark gradient on the top third so the logo stays readable. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-1/3 bg-gradient-to-b from-black/15 to-transparent" aria-hidden />

      {/* Top bar with the logo, padded from the edges. */}
      <div className="flex items-center justify-between px-6 pt-6 sm:px-10">
        {/* <Link to="…"> navigates inside the app; clicking the logo goes to the sign-in page. */}
        <Link to="/login" className="rounded-md">
          {/* inverse is a boolean prop (just writing it = true): white version of the logo. */}
          <Wordmark inverse />
        </Link>
      </div>

      {/* Short-circuit &&: if compact is false, render the captions; if compact is true, render nothing. */}
      {!compact &&
        // .map() turns each caption object c into a <p> element (list rendering).
        CAPTIONS.map((c) => (
          // key={c.text} gives React a stable, unique id for each list item; className merges shared styles with the caption's own position.
          <p key={c.text} data-caption className={cn('pointer-events-none absolute hidden text-meta leading-tight font-semibold whitespace-pre-line text-white/90 sm:block', c.className)}>
            {/* Curly braces insert a JS value into JSX: the caption text (whitespace-pre-line honours its \n). */}
            {c.text}
          </p>
        ))}

      {/* Bottom block: mt-auto pushes it to the bottom of the flex column. */}
      <div className="mt-auto px-6 pb-14 sm:px-10 lg:pb-16">
        {/* The headline; data-headline lets GSAP find it; text size depends on compact via a ternary. */}
        <h1 data-headline className={cn('title max-w-[13ch] text-white', compact ? 'text-display-lg' : 'text-hero lg:text-hero-lg')}>
          Your house, on the record
        </h1>
        {/* && again: the tagline paragraph only shows on the full-size hero. */}
        {!compact && (
          <p className="mt-4 max-w-md text-body text-white/85">Every purchase backed by a receipt. Every stage checked on site. Follow your build in Pakistan from anywhere.</p>
        )}
      </div>
    </section>
  )
}
