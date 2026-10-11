// FILE: client/src/App.jsx
// The route table. Public auth pages, then everything behind RequireAuth:
// the home shell (houses list, new house, account) and the project area under
// /p/:projectId, where ProjectLayout loads the project and Gate checks each
// page against the viewer's permissions and the project's features.
// Every page is lazy so the first paint doesn't wait for three.js or GSAP.
// Rendered once by main.jsx inside the providers. Depends on react,
// react-router, lucide-react icons, the layout components and lib/queries.

// `lazy` loads a component only when first needed; `Suspense` shows a
// fallback while a lazy component is still loading.
import { lazy, Suspense } from 'react'
// React Router pieces: Navigate redirects, Outlet marks where child routes
// render, Route/Routes define the URL table, useLocation reads the current URL.
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
// Icon components (they render inline SVGs).
import { LoaderCircle, WifiOff } from 'lucide-react'
// Catches render errors in its children and shows a fallback instead of a blank page.
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
// Grey placeholder shown while a page loads.
import { PageSkeleton } from './components/ui/index.js'
// Header/navigation frame for pages outside a project.
import { AppShell } from './layout/AppShell.jsx'
// Mixed import: the default export (ProjectLayout) plus named exports in braces.
import ProjectLayout, { Gate, MoneyIndex, MoneyLayout, ProjectIndex } from './layout/ProjectLayout.jsx'
// Hook that fetches the signed-in user (/auth/me).
import { useMe } from './lib/queries.js'

// --- Lazy pages outside a project. `lazy(() => import(path))` takes an arrow
// function returning a dynamic import(), so each page becomes its own
// JavaScript chunk downloaded on first visit. ---
const LoginPage = lazy(() => import('./pages/auth/LoginPage.jsx'))
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage.jsx'))
const InvitePage = lazy(() => import('./pages/auth/InvitePage.jsx'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.jsx'))
const NewProjectPage = lazy(() => import('./pages/NewProjectPage.jsx'))
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

// --- Lazy pages inside a project (/p/:projectId/...). ---
const HomePage = lazy(() => import('./pages/project/HomePage.jsx'))
const TodayPage = lazy(() => import('./pages/project/TodayPage.jsx'))
const ProgressPage = lazy(() => import('./pages/project/ProgressPage.jsx'))
const BudgetPage = lazy(() => import('./pages/project/BudgetPage.jsx'))
const MaterialsPage = lazy(() => import('./pages/project/MaterialsPage.jsx'))
const ReportsPage = lazy(() => import('./pages/project/ReportsPage.jsx'))
const NewReportPage = lazy(() => import('./pages/project/NewReportPage.jsx'))
const ReportDetailPage = lazy(() => import('./pages/project/ReportDetailPage.jsx'))
const PurchasesPage = lazy(() => import('./pages/project/PurchasesPage.jsx'))
const PurchaseFormPage = lazy(() => import('./pages/project/PurchaseFormPage.jsx'))
const PurchaseDetailPage = lazy(() => import('./pages/project/PurchaseDetailPage.jsx'))
const PaymentsPage = lazy(() => import('./pages/project/PaymentsPage.jsx'))
const ApprovalsPage = lazy(() => import('./pages/project/ApprovalsPage.jsx'))
const FindingsPage = lazy(() => import('./pages/project/FindingsPage.jsx'))
const QuestionsPage = lazy(() => import('./pages/project/QuestionsPage.jsx'))
const ChangesPage = lazy(() => import('./pages/project/ChangesPage.jsx'))
const ChangePage = lazy(() => import('./pages/project/ChangePage.jsx'))
const DocumentsPage = lazy(() => import('./pages/project/DocumentsPage.jsx'))
const HistoryPage = lazy(() => import('./pages/project/HistoryPage.jsx'))
const InspectionsPage = lazy(() => import('./pages/project/InspectionsPage.jsx'))
const VerifyPage = lazy(() => import('./pages/project/VerifyPage.jsx'))
const ProjectSettingsPage = lazy(() => import('./pages/project/ProjectSettingsPage.jsx'))
const MorePage = lazy(() => import('./pages/project/MorePage.jsx'))

// A React component is a function that returns JSX. `export default` makes it
// this file's main export (imported as `App` in main.jsx).
export default function App() {
  // Parentheses let the returned JSX span several lines.
  return (
    // While any lazy page is downloading, show the full-screen spinner.
    // `fallback={<FullScreenLoader />}` passes a JSX element as a prop.
    <Suspense fallback={<FullScreenLoader />}>
      {/* <Routes> picks the first <Route> whose path matches the URL. */}
      <Routes>
        {/* Public pages. `element` is what to render for that path. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* `:token` is a URL parameter, read in the page with useParams(). */}
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* A route with no path is a layout route: RequireAuth renders first and its <Outlet /> shows the matching child. */}
        <Route element={<RequireAuth />}>
          {/* Pages framed by the home shell. */}
          <Route element={<Shell />}>
            {/* `index` = the parent's own URL ("/"); a bare attribute means true. */}
            <Route index element={<ProjectsPage />} />
            <Route path="projects/new" element={<NewProjectPage />} />
            <Route path="settings" element={<AccountPage />} />
          </Route>
          {/* Project area: ProjectLayout loads the project; child paths are relative to /p/:projectId. */}
          <Route path="p/:projectId" element={<ProjectLayout />}>
            {/* Project home; the HomePage element is handed to ProjectIndex as its `home` prop. */}
            <Route index element={<ProjectIndex home={<HomePage />} />} />
            {/* <Gate> only renders its child when the viewer has the `can` permission (or the `feature` is on). */}
            <Route path="today" element={<Gate can="submitReport"><TodayPage /></Gate>} />
            <Route path="progress" element={<ProgressPage />} />
            {/* Older links (notifications, bookmarks) still land in the right place. */}
            {/* <Navigate> redirects; `replace` swaps the history entry so Back doesn't loop. */}
            <Route path="site" element={<Navigate to="../progress" replace />} />
            <Route path="plan" element={<Navigate to="../progress" replace />} />
            {/* Money section: pages sharing the MoneyLayout tabs. */}
            <Route element={<MoneyLayout />}>
              <Route path="money" element={<MoneyIndex />} />
              <Route path="budget" element={<Gate can="viewBudget"><BudgetPage /></Gate>} />
              <Route path="purchases" element={<PurchasesPage />} />
              <Route path="payments" element={<Gate feature="payments"><PaymentsPage /></Gate>} />
              <Route path="materials" element={<MaterialsPage />} />
            </Route>
            {/* Purchase create / view / edit (the same form page creates and edits). */}
            <Route path="purchases/new" element={<Gate can="createExpense"><PurchaseFormPage /></Gate>} />
            <Route path="purchases/:expenseId" element={<Gate can="viewMoney"><PurchaseDetailPage /></Gate>} />
            <Route path="purchases/:expenseId/edit" element={<Gate can="createExpense"><PurchaseFormPage /></Gate>} />
            {/* Owner decisions and price-check findings. */}
            <Route path="approvals" element={<Gate can="decide" feature="approvals"><ApprovalsPage /></Gate>} />
            <Route path="findings" element={<Gate can="viewMoney"><FindingsPage /></Gate>} />
            {/* Daily reports; `scope` lets an inspector in when the owner shared REPORTS. */}
            <Route path="reports" element={<Gate can="viewReports" scope="REPORTS"><ReportsPage /></Gate>} />
            <Route path="reports/new" element={<Gate can="submitReport"><NewReportPage /></Gate>} />
            <Route path="reports/:reportId" element={<Gate can="viewReports" scope="REPORTS"><ReportDetailPage /></Gate>} />
            {/* Question threads (list and one thread use the same page). */}
            <Route path="questions" element={<Gate can="viewQuestions" feature="questions"><QuestionsPage /></Gate>} />
            <Route path="questions/:questionId" element={<Gate can="viewQuestions" feature="questions"><QuestionsPage /></Gate>} />
            {/* Change requests: list and detail. */}
            <Route path="changes" element={<Gate can="viewChanges" feature="changes"><ChangesPage /></Gate>} />
            <Route path="changes/:changeId" element={<Gate can="viewChanges" feature="changes"><ChangePage /></Gate>} />
            {/* Documents, history, inspections, verification, settings and the More menu. */}
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="history" element={<Gate can="viewAudit" scope="HISTORY"><HistoryPage /></Gate>} />
            <Route path="inspections" element={<Gate can="recordInspection" feature="inspections"><InspectionsPage /></Gate>} />
            {/* Two URL parameters: what kind of record and which one. */}
            <Route path="verify/:kind/:targetId" element={<Gate can="verify"><VerifyPage /></Gate>} />
            <Route path="settings" element={<Gate can="manageProject"><ProjectSettingsPage /></Gate>} />
            <Route path="more" element={<MorePage />} />
            {/* `*` matches any other path inside a project. */}
            <Route path="*" element={<NotFoundPage inProject />} />
          </Route>
        </Route>
        {/* Any unmatched URL anywhere. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

/** Signed-in area. Sends visitors to sign in, then back to where they were going. */
function RequireAuth() {
  // Destructuring with renaming: `data: me` reads `data` into a variable named `me`.
  const { data: me, isPending, error, refetch, isFetching } = useMe()
  // A hook: returns the current URL's pathname, search string, etc.
  const location = useLocation()
  // Can't tell who this is without the server: don't send them to a sign-in page that can't work either.
  if (error && !me) return <NoConnection onRetry={refetch} retrying={isFetching} />
  if (isPending) return <FullScreenLoader /> // still asking the server
  // Not signed in: redirect to /login with ?next=<where they were>.
  // encodeURIComponent escapes the path so it is safe inside a query string.
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet /> // signed in: render the matching child route
}

/** Shown instead of the app when /auth/me can't be reached at all (no cached session to fall back on). */
// Props arrive as one object; `{ onRetry, retrying }` destructures them.
function NoConnection({ onRetry, retrying }) {
  return (
    // `className` (not `class`) sets CSS classes in JSX; these are Tailwind
    // utility classes (grid layout, full screen height, centred, side padding).
    <div className="grid min-h-dvh place-items-center px-4">
      {/* Centered card with a column of content. */}
      <div className="card flex max-w-sm flex-col items-center px-6 py-10 text-center">
        {/* Round warning-coloured badge holding the icon. */}
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-warn-50 text-warn-800">
          {/* `size={22}` is a number prop; `aria-hidden` hides the decorative icon from screen readers. */}
          <WifiOff size={22} aria-hidden />
        </span>
        <h1 className="title text-title">No connection</h1>
        <p className="mt-2 text-meta text-ink-3">SiteCord can't reach the server right now. Reports and photos saved on this phone are safe and will send once you're back online.</p>
        {/* onClick passes the function to call on click; `disabled` greys it out while retrying. */}
        <button onClick={onRetry} disabled={retrying} className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-body font-semibold text-white disabled:opacity-50">
          {/* Ternary inside JSX: a spinning icon while retrying, otherwise nothing (null renders nothing). */}
          {retrying ? <LoaderCircle size={17} className="animate-spin" aria-hidden /> : null}
          try again
        </button>
      </div>
    </div>
  )
}

/** Frame for pages outside a project. The boundary resets on navigation so one crashed page doesn't stick. */
function Shell() {
  // Destructure just `pathname` from the location object.
  const { pathname } = useLocation()
  return (
    <AppShell>
      {/* When `resetKey` changes (a new URL), the boundary clears any caught error. */}
      <ErrorBoundary resetKey={pathname}>
        {/* Skeleton while the child page's code loads. */}
        <Suspense fallback={<PageSkeleton />}>
          {/* The matched child route renders here. */}
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  )
}

// Centered spinner filling the screen; used while the session or a page loads.
function FullScreenLoader() {
  return (
    // role="status" tells screen readers this area reports loading state.
    <div className="grid min-h-dvh place-items-center text-ink-3" role="status">
      {/* animate-spin is a Tailwind class that rotates the icon forever; aria-label is its spoken name. */}
      <LoaderCircle className="animate-spin" size={22} aria-label="Loading" />
    </div>
  )
}
