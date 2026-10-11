// FILE: client/vite.config.js
// Vite config for the web app: React with Tailwind 4, the `@shared` alias to
// the sibling shared/ folder (bundled into the client at build time), and a
// dev proxy so `/api` calls reach the Express server without CORS. Used by
// `npm run dev` (through scripts/dev.mjs) and `npm run build`.
// Vite is the dev server and bundler; this file runs in Node, not the browser.

// Named import: converts a file:// URL to a plain file-system path.
import { fileURLToPath } from 'node:url'
// `defineConfig` is a no-op helper that gives editors type hints for the config.
import { defineConfig } from 'vite'
// Default import of the React plugin (JSX transform, fast refresh).
import react from '@vitejs/plugin-react'
// Default import of the Tailwind CSS 4 plugin for Vite.
import tailwindcss from '@tailwindcss/vite'

// Absolute path of ../shared: `new URL(relative, base)` resolves the relative
// path against this file's URL (`import.meta.url`), then convert to a path.
const shared = fileURLToPath(new URL('../shared', import.meta.url))

// The config object is the file's default export; Vite reads it on start.
export default defineConfig({
  // Plugins are called as functions, each returning a plugin object.
  plugins: [react(), tailwindcss()],
  resolve: {
    // Domain rules shared with the server: stages, estimates, permissions, money.
    // `import x from '@shared/money.js'` will now load ../shared/money.js.
    alias: { '@shared': shared },
  },
  server: {
    port: 5173, // the dev server's port
    // shared/ sits outside the client root, so the dev server must be allowed to serve it.
    fs: { allow: ['..'] },
    // Forward any request starting with /api to the Express API on port 4000.
    proxy: { '/api': 'http://localhost:4000' },
  },
})
