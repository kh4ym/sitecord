// /register. Creates an account, then continues to ?next= or the new-project
// wizard.
//
// FILE OVERVIEW
// - Route: /register  (optional ?next=/path to return to, ?email= to prefill).
// - Who sees it: signed-out visitors; signed-in users are redirected to `next`.
// - Data loaded: useMe() to know whether someone is already signed in.
// - Data changed: useRegister() posts { name, email, phone?, password } to the
//   server. On success the user is signed in and sent to ?next= (for example
//   back to an invitation) or, by default, /projects/new to add their house.
// - Errors: server field errors appear under each input; a general error shows
//   in a notice, with a "sign in" link when the email is already taken.
// - Depends on: React state, React Router, lucide icons, our UI kit,
//   lib/queries.js, AuthLayout and safeNext() from lib/auth.js.

// useState hook for local component state.
import { useState } from 'react'
// React Router pieces: link component, redirect component, navigate function, query-string reader.
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
// Eye icons for the show/hide password toggle.
import { Eye, EyeOff } from 'lucide-react'
// UI kit components.
import { Button, Field, Input, Notice } from '../../components/ui/index.js'
// Hooks: who is signed in, and the register mutation.
import { useMe, useRegister } from '../../lib/queries.js'
// Shared auth page frame.
import { AuthLayout } from './AuthLayout.jsx'
// Validates ?next= so we never redirect to another website.
import { safeNext } from '../../lib/auth.js'

// Default export: the page component for /register.
export default function RegisterPage() {
  // Array destructuring: take only the first item (the params object) from useSearchParams().
  const [params] = useSearchParams()
  // Where to go after registering; second argument is the default when ?next= is missing or unsafe.
  const next = safeNext(params.get('next'), '/projects/new')
  // navigate(path) changes page from code.
  const navigate = useNavigate()
  // Rename destructured `data` to `me`.
  const { data: me } = useMe()
  // Mutation object: register.mutate, register.isPending, register.error.
  const register = useRegister()
  // Form state object; email prefilled from ?email= (?? gives '' when it's null).
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', phone: '', password: '' })
  // Whether the password is shown as plain text.
  const [show, setShow] = useState(false)
  // Field errors from the server, or {} if none (optional chaining + nullish coalescing).
  const errors = register.error?.fieldErrors ?? {}
  // A function that returns a function ("curried"): set('name') gives an onChange handler that updates form.name.
  // [k] in an object literal is a computed key: the property name comes from the variable k.
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Already signed in and not mid-registration? Redirect straight to next.
  if (me && !register.isPending) return <Navigate to={next} replace />

  // The page's JSX.
  return (
    // compactHero = shorter blue hero so the longer form fits better.
    <AuthLayout title="Create your record" compactHero>
      <h2 className="title text-display">Create your record</h2>
      <p className="mt-2 text-ink-2">Owners add their house. Everyone else joins with an invitation link.</p>
      <form
        // Vertical stack of fields with gaps.
        className="mt-7 flex flex-col gap-4"
        // Skip browser validation popups; the server validates and returns field errors.
        noValidate
        // Inline arrow function as the submit handler.
        onSubmit={(e) => {
          // Prevent the default full page reload.
          e.preventDefault()
          // Send the form, but turn an empty phone into undefined (|| picks the right side when the left is falsy, like '') so it's omitted. On success go to next.
          register.mutate({ ...form, phone: form.phone || undefined }, { onSuccess: () => navigate(next, { replace: true }) })
        }}
      >
        {/* A general (not field-specific) error shows in a notice at the top. */}
        {register.error && !Object.keys(errors).length && (
          <Notice
            tone="error"
            // action is a prop that receives JSX: a "sign in" link, but only when the error code says the email is taken (otherwise false = nothing).
            action={
              register.error.code === 'EMAIL_TAKEN' && (
                <Link to={`/login?email=${encodeURIComponent(form.email)}`} className="font-bold underline">
                  sign in
                </Link>
              )
            }
          >
            {register.error.message}
          </Notice>
        )}
        {/* Each Field wraps a controlled Input; onChange={set('name')} calls set now, which returns the actual handler. */}
        <Field label="Full name" error={errors.name}>
          <Input autoComplete="name" value={form.name} onChange={set('name')} />
        </Field>
        {/* Email input bound to form.email. */}
        <Field label="Email" error={errors.email}>
          <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        {/* optional (boolean prop) adds an "optional" tag to the label; inputMode="tel" opens a number keypad on phones. */}
        <Field label="Mobile number" optional error={errors.phone}>
          <Input type="tel" autoComplete="tel" inputMode="tel" placeholder="03xx xxxxxxx" value={form.phone} onChange={set('phone')} />
        </Field>
        {/* hint shows helper text under the label. */}
        <Field label="Password" hint="At least 8 characters." error={errors.password}>
          <div className="relative">
            {/* Ternary switches between visible text and hidden password; autoComplete="new-password" lets managers suggest a strong one. */}
            <Input type={show ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={set('password')} className="pe-12" />
            {/* Toggle button (type="button" so it doesn't submit); updater function flips show. */}
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute end-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>
        {/* Submit button; shows a spinner while the request is pending. */}
        <Button type="submit" variant="primary" size="lg" block loading={register.isPending} className="mt-1">
          create account
        </Button>
      </form>
      {/* Footer link to sign in instead. */}
      <p className="mt-6 text-center text-meta text-ink-2">
        {/* {' '} keeps a space before the link. */}
        Already have one?{' '}
        {/* Carries ?next= over to the login page if it was present. */}
        <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`} className="font-bold text-accent-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
