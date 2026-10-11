// LazyHouseScene.jsx - code-split entry for the 3D view.
//
// What it does: loads HouseScene (and with it the large three.js library) only
// when a 3D view is first shown, displays a simple fallback card while that
// download happens, and catches WebGL failures so the rest of the page still works.
// Why it exists: three.js is several hundred kilobytes; keeping it out of the main
// bundle makes the first page load fast.
// Where it's used: pages that show the 3D house import this component instead of
// HouseScene directly. It forwards a `ref` so parents can still call HouseScene's
// imperative methods.
// Dependencies: React (Component, lazy, Suspense), lucide-react (Box icon),
// and ./HouseScene.jsx (loaded on demand).

// ES module import: pulls named exports out of the 'react' package. The curly braces
// are "destructuring" - take just these three things from the module.
import { Component, lazy, Suspense } from 'react'
// The Box icon component from the lucide-react icon library.
import { Box } from 'lucide-react'

// three.js is large; it loads only when a 3D view is first shown.
// lazy() takes a function returning a dynamic `import()` promise; React downloads the
// file the first time <HouseScene> is rendered. Vite turns this into a separate JS chunk.
const HouseScene = lazy(() => import('./HouseScene.jsx'))

/** What shows while the 3D loads, or if this device can't draw it. */
// A function component. `{ message = '...' }` destructures the props object and gives
// `message` a default value when the parent doesn't pass one.
function HouseFallback({ message = 'Preparing the 3D view…' }) {
  // The parentheses let the JSX span several lines after `return`.
  return (
    // JSX: HTML-like syntax compiled to React.createElement calls. `className` is the JSX
    // name for the HTML `class` attribute; these are Tailwind utility classes (a full-size
    // grid centring its child, with a sky-blue-to-canvas gradient background).
    <div className="grid h-full w-full place-items-center bg-gradient-to-b from-[#dce6f0] to-canvas text-meta font-semibold text-ink-3">
      {/* A flex row with a small gap between the icon and the text. */}
      <span className="flex items-center gap-2">
        {/* `size={16}` passes a number prop (braces = JavaScript expression); `aria-hidden` with no
            value means true, hiding the decorative icon from screen readers. `{message}` inserts the text. */}
        <Box size={16} aria-hidden /> {message}
      </span>
    </div>
  )
}

/** A device without WebGL shouldn't take the whole page down with it. */
// A class component (`class X extends Component`). Only class components can be React
// "error boundaries" that catch errors thrown while rendering their children.
class SceneBoundary extends Component {
  // Class field syntax: sets the initial state object on each instance.
  state = { failed: false }
  // A static lifecycle method React calls when a child throws; the returned object
  // is merged into state, so the next render shows the fallback instead.
  static getDerivedStateFromError() {
    return { failed: true }
  }
  // render() returns what to draw. `cond ? a : b` is the ternary operator:
  // the fallback message if something failed, otherwise the wrapped children as-is.
  render() {
    return this.state.failed ? <HouseFallback message="3D isn't available on this device" /> : this.props.children
  }
}

// `export default` makes this the file's main export (imported without braces).
// `{ ref, ...props }` destructures: pull `ref` out, gather every other prop into `props`
// (rest syntax). In React 19 `ref` can be passed as a normal prop to function components.
export default function LazyHouseScene({ ref, ...props }) {
  return (
    // The error boundary wraps everything so a WebGL crash shows the fallback card.
    <SceneBoundary>
      {/* Suspense shows `fallback` while the lazy HouseScene chunk is still downloading. */}
      <Suspense fallback={<HouseFallback />}>
        {/* `{...props}` is spread syntax: passes every remaining prop through unchanged. */}
        <HouseScene ref={ref} {...props} />
      </Suspense>
    </SceneBoundary>
  )
}
