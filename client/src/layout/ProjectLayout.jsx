// FILE: client/src/layout/ProjectLayout.jsx
//
// What it does: the layout route for /p/:projectId. It loads the project once,
// builds the ProjectContext value (role, can(), features, nav) every project
// page reads, wraps the page in the AppShell, an ErrorBoundary and Suspense,
// and renders the matched child page through <Outlet>.
//
// It also exports the route helpers App.jsx wraps pages in:
//   Gate         permission / feature / scope check around a page
//   ProjectIndex sends each role to its landing page
//   MoneyLayout  the money section's pill tabs above its pages
//   MoneyIndex   /money redirects to budget or purchases
//
// Where it's used: App.jsx's route table.
//
// Depends on: react (Suspense, useMemo), react-router, lucide-react, the UI
// kit, the access-locked screen, the error boundary, i18n, lib/queries.js,
// AppShell, nav.js and ProjectContext.

// Suspense shows a fallback while lazily-loaded pages download; useMemo caches a computed value.
import { Suspense, useMemo } from 'react'
// <Navigate> redirects when rendered; <Outlet> renders the child route;
// useLocation gives the current URL; useParams gives the :params from the URL pattern.
import { Navigate, Outlet, useLocation, useParams } from 'react-router'
// Icon component.
import { Compass } from 'lucide-react'
// Screen shown to an inspector for a page the owner hasn't shared.
import { LockedState } from '../components/access/AccessLocked.jsx'
// Catches rendering errors below it and shows an error screen instead of a blank page.
import { ErrorBoundary } from '../components/ErrorBoundary.jsx'
// Shared UI components, imported from the kit's index file.
import { EmptyState, ErrorState, PageSkeleton, TabPills } from '../components/ui/index.js'
// Translation hook.
import { useI18n } from '../i18n/I18nProvider.jsx'
// Data hooks for the current user and the project.
import { useMe, useProject } from '../lib/queries.js'
// The app frame (sidebar, tab bar, header).
import { AppShell } from './AppShell.jsx'
// Builds tabs/more/landing for the role.
import { navFor } from './nav.js'
// The context object and its reader hook.
import { ProjectContext, useProjectContext } from './ProjectContext.jsx'

/** Loads the project once and gives every project page its role, permissions and features. */
// `export default` makes this the file's default export (imported without braces).
export default function ProjectLayout() {
  // The :projectId part of the URL, via destructuring.
  const { projectId } = useParams()
  // The project query: data renamed to `project`, plus error, loading flag and a retry function.
  const { data: project, error, isLoading, refetch } = useProject(projectId)
  // The signed-in user.
  const { data: me } = useMe()
  // The current path, used to reset the error boundary when the page changes.
  const { pathname } = useLocation()
  // `permissions` is computed server-side per role and contract type; the
  // client only asks "is this action in the list". Memoised so the context
  // value (and everything reading it) is stable between renders.
  // useMemo(fn, deps) re-runs fn only when a dependency changes; otherwise returns the cached result.
  const value = useMemo(() => {
    // Not loaded yet: no context value.
    if (!project) return null
    // The permission checker, a closure over `project`.
    const can = (action) => project.permissions.includes(action)
    // Tabs, more list and landing page for this role.
    const nav = navFor(project, can)
    // The context object. `features ?? {}` guarantees an object.
    return { project, pid: project.id, role: project.role, me, can, features: project.features ?? {}, nav, landing: nav.landing }
  }, [project, me])

  // Early return while loading: the shell with a placeholder skeleton.
  if (isLoading) {
    return (
      <AppShell>
        {/* A grey placeholder shaped like a page with a hero block. */}
        <PageSkeleton variant="hero" />
      </AppShell>
    )
  }
  // Early return on error.
  if (error) {
    return (
      <AppShell>
        <ErrorState
          // For a 404, swap in a friendlier message object; otherwise pass the error through.
          error={error.status === 404 ? { status: 404, message: "This project doesn't exist, or you're not a member of it." } : error}
          // Passing the function itself (not calling it) as the retry button's handler.
          onRetry={refetch}
        />
      </AppShell>
    )
  }
  // Normal render.
  return (
    // Provide the context value to everything inside.
    <ProjectContext.Provider value={value}>
      {/* `inProject` with no value is the boolean prop inProject={true}: shows project navigation. */}
      <AppShell inProject>
        {/* resetKey={pathname}: navigating to another page clears a previous error. */}
        <ErrorBoundary resetKey={pathname}>
          {/* While a lazily-loaded page's code downloads, show a skeleton. */}
          <Suspense fallback={<PageSkeleton />}>
            {/* React Router renders the matched child route (the actual page) here. */}
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </ProjectContext.Provider>
  )
}

/**
 * Route guard. A feature this project doesn't use goes back to the start; a
 * page the owner hasn't shared with an inspector shows how to ask; anything
 * else outside the person's role says so plainly.
 */
// Props: `can: action` renames the `can` prop to `action` (to avoid clashing with the
// can() function from context); `children` is the guarded page.
export function Gate({ can: action, feature, scope, children }) {
  // Read what we need from the project context.
  const { project, can, landing } = useProjectContext()
  // Order matters: a missing feature redirects (the page can't exist for this
  // contract type); a locked scope keeps the URL so the inspector can ask
  // from here; a missing permission is a dead end with a plain message.
  // <Navigate to=… replace /> redirects; `replace` swaps the history entry so Back doesn't return here.
  // Nested template literal adds "/<landing>" only when landing is non-empty.
  if (feature && !project.features?.[feature]) return <Navigate to={`/p/${project.id}${landing ? `/${landing}` : ''}`} replace />
  // Inspector without access to this scope: show the "ask the owner" screen.
  if (scope && project.role === 'INSPECTOR' && !can(action)) return <LockedState scope={scope} />
  // Missing permission: a plain message.
  if (action && !can(action)) {
    return (
      <div className="card">
        {/* `icon={Compass}` passes the component itself as a prop; EmptyState renders it. */}
        <EmptyState icon={Compass} title="Not part of your role" description="This page is for other people on the project." />
      </div>
    )
  }
  // All checks passed: render the page.
  return children
}

/** The project's front page: Home for owners and representatives, the role's own start page for everyone else. */
// `home` is a JSX element passed as a prop.
export function ProjectIndex({ home }) {
  const { project, landing } = useProjectContext()
  // Roles with a landing page are redirected there.
  if (landing) return <Navigate to={`/p/${project.id}/${landing}`} replace />
  // Otherwise show Home.
  return home
}

/** Money section: budget · purchases · payments · materials as pills over the page. */
export function MoneyLayout() {
  // Translation function.
  const { t } = useI18n()
  // Project, permission checker and features.
  const { project, can, features } = useProjectContext()
  // Base path for links.
  const base = `/p/${project.id}`
  // The pill list. `cond && {…}` yields false when cond is false, and `.filter(Boolean)`
  // removes those false entries, so items appear only when allowed.
  const items = [
    can('viewBudget') && { to: `${base}/budget`, label: t('nav.budget') },
    { to: `${base}/purchases`, label: t('nav.purchases') },
    features.payments && { to: `${base}/payments`, label: t('nav.payments') },
    { to: `${base}/materials`, label: t('nav.materials') },
  ].filter(Boolean)
  return (
    // Whole section requires the viewMoney permission.
    <Gate can="viewMoney">
      {/* The pill tabs, with bottom margin. */}
      <TabPills items={items} label="Money" className="mb-5" />
      {/* The money sub-page (budget, purchases...) renders in the Outlet. */}
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </Gate>
  )
}

/** /money opens the budget for owners, purchases for everyone else. */
export function MoneyIndex() {
  const { project, can } = useProjectContext()
  // Redirect, choosing the sub-page with a ternary inside the template literal.
  return <Navigate to={`/p/${project.id}/${can('viewBudget') ? 'budget' : 'purchases'}`} replace />
}
