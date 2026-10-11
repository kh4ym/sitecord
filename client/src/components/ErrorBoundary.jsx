// FILE: components/ErrorBoundary.jsx — the app's last line of defence.
//
// What it does: if a render error happens inside a page, React would normally
// unmount everything and leave a blank screen. This "error boundary" catches
// the error and shows a calm "reload" card instead, while the navigation
// around it keeps working. It resets itself when `resetKey` (the route) changes.
// Where it's used: wrapped around every routed page by ProjectLayout and App.jsx.
// Depends on: React's `Component` base class and two lucide-react icons.
// Note: error boundaries must be class components; there is no hook version.

// Import the base class that class components extend.
import { Component } from 'react'
// Two icon components from the lucide-react icon set.
import { RefreshCw, TriangleAlert } from 'lucide-react'

/**
 * Keeps one broken page from blanking the whole app. Resets when `resetKey`
 * changes (the route), so navigating away recovers. Wrapped around the page
 * outlet in App.jsx (Shell) and ProjectLayout, inside the AppShell so the
 * navigation stays usable.
 */
// `class X extends Component` declares a class component: it inherits React's
// machinery (this.props, this.state, this.setState, lifecycle methods).
export class ErrorBoundary extends Component {
  // Class field: initial state, with no error yet.
  state = { error: null }

  // `static` means the method belongs to the class itself, not instances.
  // React calls getDerivedStateFromError when a child throws during render;
  // the object returned is merged into state, so `error` becomes set and the
  // next render shows the fallback card.
  static getDerivedStateFromError(error) {
    // `{ error }` is shorthand for `{ error: error }`.
    return { error }
  }

  // Lifecycle method called after the error is caught; used for side effects
  // like logging. `info.componentStack` lists which components were rendering.
  componentDidCatch(error, info) {
    // Print the error to the browser's developer console.
    console.error('Page crashed:', error, info.componentStack)
  }

  // Called after every re-render with the previous props as `prev`.
  componentDidUpdate(prev) {
    // If the route key changed and we are showing an error, clear it so the
    // new page gets a fresh try. setState updates state and re-renders.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  // render() returns what the class component shows.
  render() {
    // No error: just render the wrapped page (`this.props.children`) as normal.
    if (!this.state.error) return this.props.children
    // Otherwise render the fallback card.
    return (
      // role="alert" makes screen readers announce this immediately.
      // Styling: centred card, column layout, padded, centred text.
      <div className="card mx-auto flex max-w-lg flex-col items-center px-6 py-12 text-center" role="alert">
        {/* Round red-tinted circle holding the warning icon. */}
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-danger-50 text-danger-700">
          {/* Decorative icon, hidden from screen readers. */}
          <TriangleAlert size={22} aria-hidden />
        </span>
        {/* Heading text. */}
        <p className="text-body font-bold">This page ran into a problem</p>
        {/* Reassuring explanation in smaller grey text. */}
        <p className="mt-1 max-w-sm text-meta text-ink-3">Your data is safe. Reload to try again; if it keeps happening, tell us what you were doing.</p>
        {/* Plain HTML button. */}
        <button
          // onClick takes a function; this arrow function reloads the browser page.
          onClick={() => window.location.reload()}
          // Outlined pill button with a faint hover background.
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-full border border-ink/80 px-5 text-body font-semibold text-ink transition hover:bg-ink/[0.04]"
        >
          {/* Refresh icon followed by the button's label text. */}
          <RefreshCw size={16} aria-hidden /> reload the page
        </button>
      </div>
    )
  }
}
