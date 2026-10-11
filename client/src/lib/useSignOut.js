// FILE: client/src/lib/useSignOut.js
//
// What it does: the one sign-out action, as a custom React hook. Before
// signing out it checks the offline outbox and warns if this phone still
// holds reports or photos that haven't been sent.
//
// Where it's used: the sidebar user menu (AppShell), the Account page and the
// More page, so the outbox warning is never skipped.
//
// Depends on: react-router (navigation), the i18n provider (translated
// messages), lib/outbox/store.js (pending count) and lib/queries.js (current
// user and the logout mutation).

// React Router hook that returns a function for changing pages in code.
import { useNavigate } from 'react-router'
// Our translation hook; `../` goes up one folder.
import { useI18n } from '../i18n/I18nProvider.jsx'
// Counts the queued items saved by a given user.
import { pendingForUser } from './outbox/store.js'
// TanStack Query hooks: logout mutation and the current-user query.
import { useLogout, useMe } from './queries.js'

/**
 * Sign out, but first warn when this phone still holds reports or photos that
 * haven't been sent: they stay saved and go out at the next sign-in.
 */
export function useSignOut() {
  // Destructure the translate function `t` from the i18n context.
  const { t } = useI18n()
  // Destructure `data` and rename it to `me` (`data: me` is rename syntax).
  const { data: me } = useMe()
  // The logout mutation object.
  const logout = useLogout()
  // A function: navigate('/path') changes the URL and renders that page.
  const navigate = useNavigate()
  // async arrow function so we can `await` the IndexedDB count.
  const signOut = async () => {
    // How many unsent items this user has (0 if we don't know the user yet).
    const waiting = me ? await pendingForUser(me.id) : 0
    // If some are waiting, ask with the browser's OK/Cancel dialog. The ternary picks
    // the singular or plural message key; `{ n: waiting }` fills in the number.
    // If the user presses Cancel (`!confirm(...)` is true), stop here.
    if (waiting && !window.confirm(t(waiting === 1 ? 'outbox.signOutOne' : 'outbox.signOutMany', { n: waiting }))) return
    // Run the logout request. mutate(variables, options): no variables, and on
    // success go to the login page.
    logout.mutate(undefined, { onSuccess: () => navigate('/login') })
  }
  // Return what the UI needs: the user, the action, and a busy flag for the button.
  return { me, signOut, pending: logout.isPending }
}
