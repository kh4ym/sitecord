// FILE: client/src/layout/PageHeader.jsx
//
// What it does: exports <PageTitle>, the header every page starts with: an
// optional back button, a small "kicker" line, the big title, optional action
// buttons on the right, a description, a row of meta chips and any extra
// children. It also sets the browser tab's title (document.title).
//
// Where it's used: every page renders it inside <Page>, so it takes part in
// the reveal animation (data-reveal, see lib/motion.js usePageReveal) like
// any other block.
//
// Depends on: react (useEffect), react-router (<Link>), lucide-react (the
// arrow icon) and lib/format.js (`cn` for class names).

// React hook for side effects after render.
import { useEffect } from 'react'
// <Link> renders an <a> that changes pages without a full browser reload.
import { Link } from 'react-router'
// An SVG icon component from the lucide icon set.
import { ArrowLeft } from 'lucide-react'
// Joins class names, skipping falsy ones.
import { cn } from '../lib/format.js'

// Arrow function with a block body; sets the browser tab title if `t` is given.
const setTitle = (t) => {
  // Template literal: e.g. "Approvals · SiteCord".
  if (t) document.title = `${t} · SiteCord`
}

/**
 * Page title in the wide display face, with an optional small line above it
 * (`kicker`), a back link, and actions on the right. Sets the browser tab title.
 *   <PageTitle kicker="DHA Phase 6, Lahore" title="Approvals" actions={…} />
 */
// A React function component. Its single argument is the props object, destructured
// into named props. `back` is an object { to, label }; `actions`, `meta`, `children` are JSX.
export function PageTitle({ title, kicker, description, actions, back, meta, className, documentTitle, children }) {
  // After render, set the tab title: prefer documentTitle; otherwise use `title` only if it's
  // plain text (it could be JSX). The dependency array re-runs this when either changes.
  // The arrow's body is the setTitle call (no cleanup is returned since setTitle returns undefined).
  useEffect(() => setTitle(documentTitle ?? (typeof title === 'string' ? title : null)), [title, documentTitle])
  // A component returns JSX: HTML-like syntax that compiles to React.createElement calls.
  return (
    // <header> element. `data-reveal` with no value means true (picked up by the reveal animation).
    // `className` is JSX's name for the HTML class attribute; cn() merges base classes
    // (bottom margin, vertical flex column with gaps) with any passed-in className.
    <header data-reveal className={cn('mb-6 flex flex-col gap-4', className)}>
      {/* Conditional rendering: `back && <Link…>` renders the link only when `back` is truthy. */}
      {back && (
        <Link
          // `to` is the destination path; curly braces embed a JS expression in JSX.
          to={back.to}
          // Accessible name for screen readers, since the button only shows an icon.
          aria-label={back.label}
          // Styling: a 44px round white button with a border, centred icon, hover border and press shrink.
          className="inline-flex h-11 w-11 items-center justify-center self-start rounded-full border border-line bg-white text-ink transition hover:border-line-strong active:scale-95"
        >
          {/* The icon; `rtl:-scale-x-100` mirrors it in right-to-left (Urdu). `aria-hidden` with no value = true: hidden from screen readers. */}
          <ArrowLeft size={19} className="rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
      {/* Row: title block on one side, actions on the other, aligned to the bottom. */}
      <div className="flex items-end justify-between gap-4">
        {/* min-w-0 lets long titles wrap instead of pushing the actions off-screen. */}
        <div className="min-w-0">
          {/* Optional small line above the title; `{kicker}` inserts its value as text. */}
          {kicker && <p className="mb-2 text-meta font-semibold text-ink-3">{kicker}</p>}
          {/* The main heading: large display type, bigger on small-and-up screens (sm:). */}
          <h1 className="title text-display break-words text-ink sm:text-display-lg">{title}</h1>
        </div>
        {/* Optional action buttons, kept from shrinking. */}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {/* Optional description paragraph, limited width for readability. */}
      {description && <p className="max-w-2xl text-body text-ink-2">{description}</p>}
      {/* Optional wrapping row of meta items (chips, dates). */}
      {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
      {/* Anything nested inside <PageTitle>…</PageTitle> renders here. */}
      {children}
    </header>
  )
}
