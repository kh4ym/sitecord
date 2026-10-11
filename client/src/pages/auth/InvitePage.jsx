// /invite/:token. Shows who invited you and as what, then accepts the
// invitation (signed in as the invited email) or sends you to register first.
//
// FILE OVERVIEW
// - Route: /invite/:token  (":token" is a URL parameter, the secret code from
//   the invitation link the house owner shared).
// - Who sees it: anyone with the link. Signed-out visitors get "create an
//   account" / "I already have an account" buttons; signed-in users get a
//   "join" button.
// - Data loaded: useMe() (the current user, or nothing if signed out) and
//   useInvitation(token) (project name, city, role, who invited, email).
// - Data changed: useAcceptInvitation() is a mutation that tells the server to
//   add the signed-in user to the project with the invited role, after which we
//   navigate into that project (to the role's starting page).
// - Depends on: React Router, sonner toasts, lucide icons, shared role
//   descriptions, our UI kit components, lib/queries.js hooks and AuthLayout.

// Named imports from React Router: <Link> (in-app link), useNavigate (go to a URL from code), useParams (read :token from the URL).
import { Link, useNavigate, useParams } from 'react-router'
// toast shows small pop-up notifications ("toasts") in the corner.
import { toast } from 'sonner'
// Two icon components from the lucide icon set.
import { Building2, Link2Off } from 'lucide-react'
// A shared object mapping role keys (e.g. 'CONTRACTOR') to plain-English descriptions; '@shared' is a path alias set up in Vite.
import { ROLE_DESCRIPTIONS } from '@shared/permissions.js'
// Reusable UI components from our design kit (index.js re-exports them all).
import { Button, IconTile, Notice, Spinner } from '../../components/ui/index.js'
// Custom data hooks built on TanStack Query: read the invite, accept it, read the current user.
import { useAcceptInvitation, useInvitation, useMe } from '../../lib/queries.js'
// The shared hero + form-sheet frame for auth pages.
import { AuthLayout } from './AuthLayout.jsx'

// Object literal mapping a role to the project sub-page it should land on after joining; roles not listed land on the project home.
const START = { CONTRACTOR: 'today', SUPERVISOR: 'today', INSPECTOR: 'inspections' }

// `export default` makes this the file's main export, so the router can import it without braces.
export default function InvitePage() {
  // useParams() returns an object of URL parameters; destructuring pulls out token.
  const { token } = useParams()
  // useNavigate() gives a function: navigate('/some/path') changes the page from code.
  const navigate = useNavigate()
  // Destructuring with rename: take the `data` field from useMe()'s result and call it `me` (undefined when signed out).
  const { data: me } = useMe()
  // Query hook result object: { data, isLoading, error, … } for this invitation token.
  const invite = useInvitation(token)
  // Mutation hook: gives accept.mutate(...), accept.isPending, accept.error.
  const accept = useAcceptInvitation()
  // Template literal: builds this page's own URL so login/register can send the user back here afterwards.
  const here = `/invite/${token}`

  // The JSX returned below is what appears on screen.
  return (
    // Uses AuthLayout with a tab title of "Invitation"; compactHero (no value) means true, a shorter blue hero.
    <AuthLayout title="Invitation" compactHero>
      {/* Chained ternaries (a ? b : c ? d : e): loading → spinner, error → error card, otherwise → the invite. */}
      {invite.isLoading ? (
        // While the query is still fetching, show a spinner with an accessible label.
        <Spinner label="Checking the invitation" />
      ) : invite.error ? (
        // The invite failed to load (expired, used, invalid): show a centred explanation.
        <div className="text-center">
          {/* Round grey circle holding the "broken link" icon. */}
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sunken text-ink-2">
            {/* size={22} passes a number prop (numbers go inside braces); aria-hidden hides the decorative icon from screen readers. */}
            <Link2Off size={22} aria-hidden />
          </span>
          {/* Heading for the error state. */}
          <h2 className="title mt-4 text-title">This invitation can't be used</h2>
          {/* Shows the error message the server sent back. */}
          <p className="mt-2 text-ink-2">{invite.error.message}</p>
          {/* Our Button renders as a link when given `to`; this one goes home. */}
          <Button to="/" className="mt-6">
            go to your houses
          </Button>
        </div>
      ) : (
        // <>…</> is a Fragment: groups several elements without adding an extra DOM node.
        <>
          {/* Small accent-coloured eyebrow text. */}
          <p className="text-meta font-semibold text-accent-700">You've been invited</p>
          {/* Main heading: the role label from the server, lowercased with the string method .toLowerCase(). */}
          <h2 className="title mt-2 text-display">
            Join as {invite.data.roleLabel.toLowerCase()}
          </h2>
          {/* A card describing the project you're being invited to. */}
          <div className="card mt-6 flex gap-3.5 p-4">
            {/* icon={Building2} passes the component itself (not <Building2/>) as a prop; IconTile renders it. */}
            <IconTile icon={Building2} tone="accent" />
            <div>
              {/* Project name in bold. */}
              <p className="font-bold">{invite.data.projectName}</p>
              {/* City and inviter's name, mixing plain text with {} expressions. */}
              <p className="text-meta text-ink-3">
                {invite.data.city} · invited by {invite.data.invitedBy}
              </p>
              {/* Bracket notation obj[key]: looks up the description for this role key. */}
              <p className="mt-2 text-meta text-ink-2">{ROLE_DESCRIPTIONS[invite.data.role]}</p>
            </div>
          </div>

          {/* Ternary on me: signed in → join button; signed out → register/login buttons. */}
          {me ? (
            // Fragment again, to return several siblings from one branch.
            <>
              {/* !== is strict "not equal". && shows the warning only if you're signed in with a different email than the invite's. */}
              {me.email !== invite.data.email && (
                <Notice tone="warn" className="mt-4">
                  This invitation was sent to {invite.data.email}. You're signed in as {me.email}; you can still accept it.
                </Notice>
              )}
              {/* If the accept mutation failed, show its error message in a red notice. */}
              {accept.error && (
                <Notice tone="error" className="mt-4">
                  {accept.error.message}
                </Notice>
              )}
              {/* The main "join" button. */}
              <Button
                // Visual style: primary (filled accent colour).
                variant="primary"
                // Large size.
                size="lg"
                // block (boolean prop) = full width.
                block
                className="mt-6"
                // Shows a spinner and disables the button while the mutation is in flight.
                loading={accept.isPending}
                // onClick takes a function; the arrow function runs only when clicked.
                onClick={() =>
                  // mutate(variables, callbacks): sends the token to the server; onSuccess runs if it worked, receiving the response r.
                  accept.mutate(token, {
                    onSuccess: (r) => {
                      // Green success toast, with the project name inserted by a template literal.
                      toast.success(`You've joined ${invite.data.projectName}`)
                      // Go to /p/<id>, plus "/today" etc. if START has an entry for this role (nested template literal + ternary; '' = nothing).
                      navigate(`/p/${r.projectId}${START[r.role] ? `/${START[r.role]}` : ''}`)
                    },
                  })
                }
              >
                {/* Button text with the signed-in user's name. */}
                join as {me.name}
              </Button>
            </>
          ) : (
            // Signed out: a vertical stack of two buttons.
            <div className="mt-6 flex flex-col gap-2">
              {/* Link to /register with ?next= (come back here) and ?email= (prefill). encodeURIComponent makes values safe inside a URL. */}
              <Button variant="primary" size="lg" block to={`/register?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.data.email)}`}>
                create an account to join
              </Button>
              {/* Same idea, but to the sign-in page for people who already have an account. */}
              <Button size="lg" block to={`/login?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.data.email)}`}>
                I already have an account
              </Button>
            </div>
          )}
          {/* Small footer note. */}
          <p className="mt-6 text-center text-2xs text-ink-3">
            {/* {' '} inserts a literal space, because JSX drops whitespace at line ends. */}
            Not expecting this? You can ignore it.{' '}
            <Link to="/" className="underline">
              Go to SiteCord
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}
