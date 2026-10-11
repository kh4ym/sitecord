// FILE: client/src/main.jsx
// Browser entry point (index.html → #root). Sets up the providers every page
// relies on, outermost first: TanStack Query (server cache), the router,
// i18n (needs the session from Query), the outbox (needs i18n for toasts),
// then App with its routes. The Toaster sits beside App so toasts outlive pages.
// The .jsx extension means the file contains JSX: HTML-like tags inside
// JavaScript that Vite compiles into React function calls.
// Depends on: react, react-dom, react-router, @tanstack/react-query, sonner,
// plus App.jsx, i18n/I18nProvider.jsx, lib/outbox/OutboxProvider.jsx and index.css.

// Named import of StrictMode: a wrapper that runs extra checks in development.
import { StrictMode } from 'react'
// createRoot attaches React to a real DOM element.
import { createRoot } from 'react-dom/client'
// BrowserRouter keeps the URL in the address bar in sync with the shown page.
import { BrowserRouter } from 'react-router'
// QueryClient stores fetched server data; QueryClientProvider shares it with every component.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Toaster renders pop-up notifications (toasts) from the sonner library.
import { Toaster } from 'sonner'
// Default import: App.jsx's `export default` component (the route table).
import App from './App.jsx'
// Provides the current language and translate function to all pages.
import { I18nProvider } from './i18n/I18nProvider.jsx'
// Provides the offline outbox (queued uploads sent once back online).
import { OutboxProvider } from './lib/outbox/OutboxProvider.jsx'
// Side-effect import: no names, just loads the global stylesheet into the page.
import './index.css'

// One shared cache for all server data. `new` constructs it with options.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data counts as fresh for 20 seconds (underscores in 20_000 are just
      // digit separators for readability) before a background refetch.
      staleTime: 20_000,
      // Retry network hiccups and server errors, never 4xx.
      // status 0 = no network; >= 500 = server error; at most 2 retries.
      retry: (count, err) => (err?.status === 0 || err?.status >= 500) && count < 2,
    },
  },
})

// Find <div id="root"> in index.html, make it a React root and render the
// JSX tree below into it. Each tag wraps (provides context to) everything inside it.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* `client={queryClient}` is a prop: curly braces pass a JavaScript value. */}
    <QueryClientProvider client={queryClient}>
      {/* Enables <Routes>, links and URL hooks everywhere below. */}
      <BrowserRouter>
        {/* Language and translations for every page. */}
        <I18nProvider>
          {/* Offline upload queue, wrapped around the app itself. */}
          <OutboxProvider>
            {/* The app's pages; a self-closing tag has no children. */}
            <App />
          </OutboxProvider>
          {/* Toast area: a sibling of the outbox so toasts survive page changes. */}
          <Toaster
            // A string prop: toasts appear at the top centre.
            position="top-center"
            // A prop with no value means `true`: show a close button.
            closeButton
            // Double braces: the outer {} switches to JavaScript, the inner {} is an object literal.
            toastOptions={{
              // Inline style object; CSS property names are camelCase, and var(--x) reads a CSS custom property from index.css.
              style: { fontFamily: 'inherit', borderRadius: '1rem', border: '1px solid var(--color-line)', boxShadow: 'var(--shadow-pop)' },
            }}
          />
        </I18nProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
