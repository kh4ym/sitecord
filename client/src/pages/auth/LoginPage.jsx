// /login. Email + password sign-in, plus one-click "explore as" buttons for the
// demo people when the server runs in demo mode. Honours ?next= (same-site only).
//
// FILE OVERVIEW
// - Route: /login  (optional query string: ?next=/where/to/go and ?email=prefill).
// - Who sees it: signed-out visitors. If you are already signed in, the page
//   immediately redirects you to ?next= (or the default home).
// - Data loaded: useMe() (am I signed in?) and useDemoInfo() (is demo mode on,
//   and which demo people can be explored).
// - Data changed: useLogin() posts { email, password } to the server;
//   useDemoLogin() signs in as a demo person by role. Both navigate to `next`
//   on success. Server field errors (e.g. "wrong email") are shown under the
//   matching input.
// - Depends on: React state, React Router, lucide icons, our UI kit, safeNext()
//   from lib/auth.js (rejects off-site ?next= URLs) and AuthLayout.

// useState lets a component remember values between renders.
import { useState } from 'react'
// React Router: <Link> link, <Navigate> redirect-on-render, useNavigate redirect-from-code, useSearchParams read ?query values.
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
// Icon components from lucide-react.
import { ArrowRight, Eye, EyeOff, HardHat, House, ShieldCheck, UserRoundSearch } from 'lucide-react'
// UI kit components: Button, Field (label + error wrapper), IconTile, Input, Notice (coloured message box).
import { Button, Field, IconTile, Input, Notice } from '../../components/ui/index.js'
// safeNext(url) returns url only if it is a same-site path, otherwise a safe default.
import { safeNext } from '../../lib/auth.js'
// TanStack Query hooks for demo info, demo sign-in, real sign-in and the current user.
import { useDemoInfo, useDemoLogin, useLogin, useMe } from '../../lib/queries.js'
// Shared auth page frame.
import { AuthLayout } from './AuthLayout.jsx'

// Maps each demo role key to the icon component to show next to that person.
const ROLE_ICONS = { OWNER: House, CONTRACTOR: HardHat, LOCAL_REP: UserRoundSearch, INSPECTOR: ShieldCheck }

// Default export: the page component the router renders at /login.
export default function LoginPage() {
  // useSearchParams() returns [params, setParams]; array destructuring keeps just the first item.
  const [params] = useSearchParams()
  // params.get('next') reads ?next= from the URL (null if missing); safeNext makes sure it's a safe in-app path.
  const next = safeNext(params.get('next'))
  // Function for navigating from code.
  const navigate = useNavigate()
  // Destructure data and rename it to me: the signed-in user, or undefined.
  const { data: me } = useMe()
  // Mutation for email/password sign-in: login.mutate, login.isPending, login.error.
  const login = useLogin()
  // Mutation for one-click demo sign-in.
  const demoLogin = useDemoLogin()
  // Query: demo.data is { enabled, people } once loaded.
  const demo = useDemoInfo()
  // useState(initial) returns [value, setter]. The form starts with email from ?email= — `??` (nullish coalescing) uses '' when get() gives null.
  const [form, setForm] = useState({ email: params.get('email') ?? '', password: '' })
  // show = whether the password is visible as plain text; starts false.
  const [show, setShow] = useState(false)
  // ?. stops if login.error is null; ?? falls back to an empty object, so errors.email is always safe to read.
  const errors = login.error?.fieldErrors ?? {}

  // Already signed in (and not in the middle of signing in)? Render <Navigate>, which redirects to next; replace = don't add a history entry.
  if (me && !login.isPending && !demoLogin.isPending) return <Navigate to={next} replace />

  // Form submit handler; e is the browser's submit event.
  const submit = (e) => {
    // Stops the browser's default full-page form submission.
    e.preventDefault()
    // Sends the form object to the server; on success, go to next and replace the /login entry in history.
    login.mutate(form, { onSuccess: () => navigate(next, { replace: true }) })
  }

  // The page's JSX.
  return (
    // Full-height hero version (no compactHero), tab title "Sign in".
    <AuthLayout title="Sign in">
      {/* Page heading and subtitle. */}
      <h2 className="title text-display">Sign in</h2>
      <p className="mt-2 text-ink-2">Pick up where your site left off.</p>

      {/* onSubmit={submit} passes the function (not calling it); noValidate turns off the browser's built-in validation bubbles so the server's errors show instead. */}
      <form onSubmit={submit} className="mt-7 flex flex-col gap-4" noValidate>
        {/* Object.keys(errors).length counts field errors; a general error (none tied to a field) shows as a red notice at the top. */}
        {login.error && !Object.keys(errors).length && <Notice tone="error">{login.error.message}</Notice>}
        {/* Field shows the label and, if present, the error message for this input. */}
        <Field label="Email" error={errors.email}>
          {/* Controlled input: value comes from state, and onChange copies the typed text back with spread ({ ...form, email: … } = copy of form with email replaced). */}
          <Input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Password" error={errors.password}>
          {/* relative positioning so the eye button can be placed inside the input's right edge. */}
          <div className="relative">
            <Input
              // Ternary picks the input type: plain text when show is true, hidden dots otherwise.
              type={show ? 'text' : 'password'}
              // Hints the browser/password manager to fill the saved password.
              autoComplete="current-password"
              // Controlled value from state.
              value={form.password}
              // Copy form, replacing password with what was typed.
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              // Extra padding at the end so text doesn't run under the eye button.
              className="pe-12"
              required
            />
            {/* type="button" so clicking it doesn't submit the form. setShow((s) => !s) uses the updater form: flip the previous value. aria-label describes the action for screen readers. */}
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute end-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
              {/* Ternary chooses which icon to render. */}
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        {/* type="submit" triggers the form's onSubmit; loading shows a spinner while signing in. */}
        <Button type="submit" variant="primary" size="lg" block loading={login.isPending} className="mt-1">
          sign in
        </Button>
        {/* Link to /register, carrying ?next= along only if one was given (ternary inside a template literal; '' adds nothing). */}
        <Button variant="secondary" size="lg" block to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`}>
          create your record
        </Button>
      </form>

      {/* Only when demo info has loaded and demo mode is enabled (?. guards demo.data being undefined while loading). */}
      {demo.data?.enabled && (
        // aria-labelledby points at the heading's id so screen readers name this section.
        <section className="mt-10" aria-labelledby="demo-heading">
          <h3 id="demo-heading" className="head">
            Explore with demo data
          </h3>
          <p className="mt-1.5 text-meta text-ink-3">A 10 Marla house in Lahore, six months in. Each person sees it differently.</p>
          {/* Error from a failed demo sign-in, if any. */}
          {demoLogin.error && (
            <Notice tone="error" className="mt-3">
              {demoLogin.error.message}
            </Notice>
          )}
          {/* A card-styled list with dividers between rows. */}
          <ul className="card mt-3 divide-y divide-line overflow-hidden">
            {/* .map over demo people; this arrow function has a { } body, so it needs an explicit return. */}
            {demo.data.people.map((p) => {
              // busy is true only for the row that's currently signing in (mutation.variables holds the role we passed to mutate).
              const busy = demoLogin.isPending && demoLogin.variables === p.role
              return (
                // key={p.role}: each list item needs a unique key.
                <li key={p.role}>
                  <button
                    // On click, sign in as this role, then go to next.
                    onClick={() => demoLogin.mutate(p.role, { onSuccess: () => navigate(next, { replace: true }) })}
                    // Disable every row while any demo sign-in is running.
                    disabled={demoLogin.isPending}
                    // Template literal for a descriptive screen-reader label.
                    aria-label={`Explore as ${p.name}, ${p.title}`}
                    // Full-width row layout with a subtle hover tint and dimmed look when disabled.
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-ink/[0.025] disabled:opacity-60"
                  >
                    {/* Icon for the role (?? falls back to House if the role isn't in ROLE_ICONS); owner gets the accent colour. */}
                    <IconTile icon={ROLE_ICONS[p.role] ?? House} tone={p.role === 'OWNER' ? 'accent' : 'neutral'} />
                    {/* min-w-0 + flex-1 let this middle column shrink so truncate works. */}
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-bold">{p.name}</span>
                      <span className="block truncate text-meta text-ink-3">{p.title}</span>
                    </span>
                    {/* Shows "opening…" while busy, otherwise an arrow icon (mirrored for right-to-left with rtl:-scale-x-100). */}
                    <span className="text-meta font-semibold text-accent-700">{busy ? 'opening…' : <ArrowRight size={17} className="rtl:-scale-x-100" aria-hidden />}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {/* Footer help text with a link to registration. */}
      <p className="mt-8 text-center text-2xs text-ink-3">
        Contractor or family member? Open the invitation link the owner sent you. <Link to="/register" className="underline">Need an account?</Link>
      </p>
    </AuthLayout>
  )
}
