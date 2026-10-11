// FILE: eslint.config.js
// One lint setup for the server, the shared rules and the web app.
// `npm run lint` catches what the build can't: undefined names, unused
// imports and variables, and misused React hooks.
// ESLint 9 flat config: three blocks with the same base rules but different
// globals, because server/ and shared/ run under Node, client/src runs in the
// browser with JSX and hooks, and the Vite config sees both.
// Depends on the dev packages @eslint/js, eslint-plugin-react,
// eslint-plugin-react-hooks and globals (installed at the repo root).

// Default imports: each package's main export bound to a local name.
import js from '@eslint/js' // ESLint's built-in "recommended" rule set
import react from 'eslint-plugin-react' // React/JSX-specific rules
import reactHooks from 'eslint-plugin-react-hooks' // rules for React hooks
import globals from 'globals' // lists of global names (window, process, ...)

// Base rules shared by every block below. Each key is a rule name; the value
// is a severity ('error') or an array [severity, options].
const rules = {
  // Spread `...obj` copies every property of the recommended rules in here.
  ...js.configs.recommended.rules,
  // Unused variables are errors, except arguments/names starting with `_`,
  // unused `catch (e)` variables, and siblings of a `...rest` destructure.
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  // Empty blocks are errors, but an empty `catch {}` is allowed.
  'no-empty': ['error', { allowEmptyCatch: true }],
  'prefer-const': 'error', // use const when a variable is never reassigned
}

// `export default` makes this array the file's main export; ESLint reads it.
// Each object in the array is one config block.
export default [
  // Block 1: folders ESLint must never look at ('**' matches any depth).
  { ignores: ['**/node_modules/**', 'client/dist/**', '.tools/**', 'server/.data/**', 'server/uploads/**'] },
  // Block 2: Node code (server, shared rules, scripts).
  {
    files: ['server/**/*.js', 'shared/**/*.js', 'scripts/**/*.mjs'],
    // Modern syntax, ES modules, and Node's global names (process, Buffer...).
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules, // shorthand for `rules: rules`
  },
  // Block 3: the React web app.
  {
    files: ['client/src/**/*.{js,jsx}'], // {js,jsx} matches either extension
    // Register plugins under the names their rules are prefixed with.
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024, // allow modern JavaScript syntax
      sourceType: 'module', // files use import/export
      parserOptions: { ecmaFeatures: { jsx: true } }, // understand JSX tags
      globals: globals.browser, // browser globals (window, document, fetch...)
    },
    // Let the React plugin detect the installed React version itself.
    settings: { react: { version: 'detect' } },
    rules: {
      ...rules, // start from the shared base rules
      'react-hooks/rules-of-hooks': 'error', // hooks only at the top of components
      'react-hooks/exhaustive-deps': 'warn', // effect dependency lists must be complete
      // A JSX tag counts as a use of the component it names.
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error', // JSX must not name an undefined component
    },
  },
  // Block 4: config files in client/ that run in Node but mention browser APIs.
  {
    files: ['client/*.js', 'client/vite.config.js'],
    // Merge both global lists with spread into one object.
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules,
  },
]
