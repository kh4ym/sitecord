// FILE: client/src/lib/queries.js
//
// What it does: TanStack Query hooks for every API resource. TanStack Query
// (React Query) fetches server data, caches it under a "query key" (an array),
// shares it between components, and refetches when told the data is stale.
// "Queries" read data (useQuery); "mutations" change data (useMutation).
//
// Conventions: project data lives under the key ['p', projectId, ...], so any
// change on a project refreshes all of it ("invalidates" every key that starts
// with ['p', projectId]). One hook per endpoint, named use<Resource> for reads
// and use<Verb><Resource> for writes. Mutations return the raw TanStack
// mutation, so pages pick between mutate (fire and forget) and mutateAsync
// (returns a Promise).
//
// Where it's used: this is the only place pages get server data from.
//
// Depends on: @tanstack/react-query, lib/api.js (the fetch wrapper) and
// lib/net.js (isRetryable: which errors mean "no signal").

// Named imports; `useQuery as useBaseQuery` renames the import, because this
// file defines its own wrapper called useQuery below.
import { useMutation, useQuery as useBaseQuery, useQueryClient } from '@tanstack/react-query'
// The error class and the request function.
import { ApiError, api } from './api.js'
// Decides whether an error is a connection problem.
import { isRetryable } from './net.js'

// Builds a project-scoped query key. `...rest` (rest parameter) gathers any extra
// arguments into an array; `...rest` inside the array literal spreads them back out.
// P(5, 'boq') -> ['p', 5, 'boq'].
const P = (pid, ...rest) => ['p', pid, ...rest]
// One shared "no connection" error object (status 0).
const OFFLINE = new ApiError(0)

/**
 * The query result with a few fields overridden; the rest stay lazily tracked, so unrelated flags don't re-render pages.
 * A Proxy rather than a spread: TanStack's result object tracks which fields a
 * component reads and only re-renders for those. Spreading would read them all.
 */
// `new Proxy(target, handler)` creates an object that intercepts operations on target.
// The `get` trap runs on every property read: `key in fields` checks whether we
// override that key; if so return our value, otherwise the original's.
const override = (q, fields) => new Proxy(q, { get: (target, key) => (key in fields ? fields[key] : target[key]) })

/**
 * Queries as the pages expect them when the signal comes and goes:
 * - a refresh that fails for lack of signal keeps showing what was loaded
 *   before (the offline banner says why) instead of an error page;
 * - a first load that can't start (the phone says it's offline, or retries
 *   are on hold) reports "no connection" instead of an empty, loaded-looking page.
 */
// Our wrapper around TanStack's useQuery; takes the same options object.
function useQuery(options) {
  // Run the real query hook; `q` holds data, error, isLoading, etc.
  const q = useBaseQuery(options)
  // We already have data (`!== undefined`). If the latest error is a connection error,
  // hide it (keep showing old data); otherwise return q unchanged.
  if (q.data !== undefined) return q.error && isRetryable(q.error) ? override(q, { error: null, isError: false }) : q
  // No data and the query is paused (offline): report it as a "no connection" error.
  if (q.isPaused) return override(q, { isLoading: false, isError: true, error: q.error ?? OFFLINE })
  // Normal case.
  return q
}

/**
 * Mutation that refreshes the project (and the projects list) afterwards.
 * Invalidation is awaited before onSuccess resolves, so a page that navigates
 * after mutateAsync lands on fresh data rather than a stale cache entry.
 */
// pid = project id; fn = the function that sends the request; extra = optional callback.
function useProjectMutation(pid, fn, extra) {
  // The QueryClient is the cache; useQueryClient reads it from React context.
  const qc = useQueryClient()
  // useMutation(options) returns an object with mutate/mutateAsync/isPending...
  return useMutation({
    // The function that does the work when mutate(vars) is called.
    mutationFn: fn,
    // Runs after a successful request. (data = server reply, vars = what was sent.)
    onSuccess: async (data, vars) => {
      // Promise.all waits for every Promise in the array to finish (in parallel).
      await Promise.all([
        // invalidateQueries marks matching cached data stale and refetches active ones.
        // Matches every key starting with ['p', pid].
        qc.invalidateQueries({ queryKey: P(pid) }),
        // The project list (names, progress on cards).
        qc.invalidateQueries({ queryKey: ['projects'] }),
        // The notifications bell.
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      ])
      // Call the extra callback if one was given (`?.()` optional call).
      extra?.(data, vars)
    },
  })
}

// ---------- Session ----------
// The signed-in user, or null when signed out.
export function useMe() {
  return useQuery({
    // The cache key for this data.
    queryKey: ['me'],
    // The function that fetches it; must return a Promise (async does that).
    queryFn: async () => {
      try {
        // `return await` so that an error is caught by this try/catch.
        return await api('/auth/me')
      } catch (err) {
        // 401 Unauthorized just means "not signed in": not an error for us.
        if (err.status === 401) return null
        // Anything else is a real error; re-throw it.
        throw err
      }
    },
    // Consider the data fresh for 5 minutes. `60_000`: underscores are digit separators.
    staleTime: 5 * 60_000,
  })
}

/** Sign-in style mutations: wipe every cached query (it belonged to someone else) and seed ['me'] with the new user. */
function useSessionMutation(fn) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    // `user` is what the server returned.
    onSuccess: (user) => {
      // Empty the whole cache.
      qc.clear()
      // Write data straight into the cache under ['me'] (no request needed).
      qc.setQueryData(['me'], user)
    },
  })
}
// Each line: an exported arrow function that returns a mutation hook. `body` is the form data.
export const useLogin = () => useSessionMutation((body) => api('/auth/login', { method: 'POST', body }))
export const useRegister = () => useSessionMutation((body) => api('/auth/register', { method: 'POST', body }))
// Demo sign-in by role; `{ role }` is shorthand for { role: role }.
export const useDemoLogin = () => useSessionMutation((role) => api('/auth/demo', { method: 'POST', body: { role } }))
// Demo accounts info; staleTime: Infinity means never refetch automatically.
export const useDemoInfo = () => useQuery({ queryKey: ['demo'], queryFn: () => api('/auth/demo'), staleTime: Infinity })

// Sign out.
export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    // No variables needed.
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      // Forget everything cached, then record "no user".
      qc.clear()
      qc.setQueryData(['me'], null)
    },
  })
}

// Edit the current user's profile; the reply (updated user) replaces the cached ['me'].
export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (body) => api('/me', { method: 'PATCH', body }), onSuccess: (user) => qc.setQueryData(['me'], user) })
}
// Change password; nothing cached needs refreshing.
export const useChangePassword = () => useMutation({ mutationFn: (body) => api('/me/password', { method: 'POST', body }) })

// ---------- Notifications ----------
// Poll the server every 60 seconds (refetchInterval).
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api('/notifications'), refetchInterval: 60_000 })
// Mark some notifications read, then refresh the list.
export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    // `ids` is an array of notification ids sent as { ids: [...] }.
    mutationFn: (ids) => api('/notifications/read', { method: 'POST', body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ---------- Projects ----------
// All projects the user can see.
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api('/projects') })
// Create a project, then refresh the list.
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => api('/projects', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}
// One project. `enabled: !!pid` waits until there's an id. `retry` is a function:
// (attempt count, error) -> retry? Don't retry a 404; otherwise at most 2 retries.
export const useProject = (pid) => useQuery({ queryKey: P(pid), queryFn: () => api(`/projects/${pid}`), enabled: !!pid, retry: (n, err) => err.status !== 404 && n < 2 })
// The rest of this file follows one pattern: a hook taking the project id and
// returning useProjectMutation(pid, requestFunction). The template literals build URLs.
// Edit project details.
export const useUpdateProject = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}`, { method: 'PATCH', body }))
// Archive the project.
export const useArchiveProject = (pid) => useProjectMutation(pid, () => api(`/projects/${pid}/archive`, { method: 'POST' }))
// Change stage / progress (used by useProgressEditor).
export const useUpdateProgress = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/progress`, { method: 'PATCH', body }))
// Save the site's GPS pin.
export const useSetSitePin = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/site`, { method: 'PUT', body }))
// Remove the site's GPS pin.
export const useClearSitePin = (pid) => useProjectMutation(pid, () => api(`/projects/${pid}/site`, { method: 'DELETE' }))

// ---------- Inspector access ----------
// Access requests list; `enabled = true` default param lets callers switch it off.
export const useAccessRequests = (pid, enabled = true) => useQuery({ queryKey: P(pid, 'access'), queryFn: () => api(`/projects/${pid}/access-requests`), enabled })
// Ask for access.
export const useRequestAccess = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/access-requests`, { method: 'POST', body }))
// Approve/deny a request. `({ id, ...body })` destructures `id` and collects the rest into `body`.
export const useDecideAccess = (pid) => useProjectMutation(pid, ({ id, ...body }) => api(`/projects/${pid}/access-requests/${id}/decide`, { method: 'POST', body }))
// End someone's access.
export const useRevokeAccess = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/access-requests/${id}/revoke`, { method: 'POST' }))
// Withdraw your own pending request.
export const useCancelAccess = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/access-requests/${id}/cancel`, { method: 'POST' }))

// Dashboard summary for the Home page.
export const useOverview = (pid) => useQuery({ queryKey: P(pid, 'overview'), queryFn: () => api(`/projects/${pid}/overview`) })
// Today's site data.
export const useToday = (pid) => useQuery({ queryKey: P(pid, 'today'), queryFn: () => api(`/projects/${pid}/today`) })
// The build plan / schedule.
export const usePlan = (pid) => useQuery({ queryKey: P(pid, 'plan'), queryFn: () => api(`/projects/${pid}/plan`) })
// Items waiting for approval.
export const useApprovals = (pid) => useQuery({ queryKey: P(pid, 'approvals'), queryFn: () => api(`/projects/${pid}/approvals`) })

// ---------- Members ----------
// Pending invitations (optional enabled flag).
export const useInvitations = (pid, enabled = true) => useQuery({ queryKey: P(pid, 'invitations'), queryFn: () => api(`/projects/${pid}/invitations`), enabled })
// Send an invitation.
export const useInvite = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/invitations`, { method: 'POST', body }))
// Cancel an invitation.
export const useRevokeInvite = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/invitations/${id}`, { method: 'DELETE' }))
// Remove a member from the project.
export const useRemoveMember = (pid) => useProjectMutation(pid, (userId) => api(`/projects/${pid}/members/${userId}`, { method: 'DELETE' }))
// Look up an invitation by its link token; retry: false so a bad link fails fast.
export const useInvitation = (token) => useQuery({ queryKey: ['invitation', token], queryFn: () => api(`/invitations/${token}`), retry: false })
// Accept an invitation, then refresh the project list (a new project appears).
export function useAcceptInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token) => api(`/invitations/${token}/accept`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

// ---------- Materials ----------
// Bill of quantities (planned materials).
export const useBoq = (pid) => useQuery({ queryKey: P(pid, 'boq'), queryFn: () => api(`/projects/${pid}/boq`) })
// Create or update one item: with an id PATCH that item, without one POST a new item (ternaries).
export const useSaveBoqItem = (pid) =>
  useProjectMutation(pid, ({ id, ...body }) => api(id ? `/projects/${pid}/boq/${id}` : `/projects/${pid}/boq`, { method: id ? 'PATCH' : 'POST', body }))
// Import a CSV text.
export const useImportBoq = (pid) => useProjectMutation(pid, (csv) => api(`/projects/${pid}/boq/import`, { method: 'POST', body: { csv } }))

// ---------- Purchases ----------
// Expenses list with optional filters and extra TanStack options (both default to {}).
export function useExpenses(pid, filters = {}, options = {}) {
  // Build a query string: Object.entries -> [key, value] pairs; `.filter(([, v]) => v)`
  // skips the key (the leading comma) and keeps pairs with a truthy value;
  // URLSearchParams encodes them as "a=1&b=2".
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
  // The filters object is part of the key, so each filter combination is cached separately.
  // Nested template literal adds "?..." only when qs is non-empty. `...options` spreads extras in.
  return useQuery({ queryKey: P(pid, 'expenses', filters), queryFn: () => api(`/projects/${pid}/expenses${qs ? `?${qs}` : ''}`), ...options })
}
// One expense (only once an id exists).
export const useExpense = (pid, id) => useQuery({ queryKey: P(pid, 'expense', id), queryFn: () => api(`/projects/${pid}/expenses/${id}`), enabled: !!id })
// Create an expense.
export const useCreateExpense = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/expenses`, { method: 'POST', body }))
// Replace an expense's fields.
export const useUpdateExpense = (pid, id) => useProjectMutation(pid, (body) => api(`/projects/${pid}/expenses/${id}`, { method: 'PUT', body }))
// Submit a draft expense for review.
export const useSubmitExpense = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/expenses/${id}/submit`, { method: 'POST' }))
// Dismiss an automated finding with a note.
export const useDismissFinding = (pid) => useProjectMutation(pid, ({ id, note }) => api(`/projects/${pid}/findings/${id}/dismiss`, { method: 'POST', body: { note } }))
// All findings.
export const useFindings = (pid) => useQuery({ queryKey: P(pid, 'findings'), queryFn: () => api(`/projects/${pid}/findings`) })

/** Approve / reject / ask a question / verify, on any record. */
export const useDecide = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/decisions`, { method: 'POST', body }))

// ---------- Payments and milestones ----------
// Payment list.
export const usePayments = (pid) => useQuery({ queryKey: P(pid, 'payments'), queryFn: () => api(`/projects/${pid}/payments`) })
// Record a payment.
export const useCreatePayment = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/payments`, { method: 'POST', body }))
// Confirm a payment was received.
export const useConfirmPayment = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/payments/${id}/confirm`, { method: 'POST' }))
// Request payment for a milestone.
export const useRequestMilestone = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/milestones/${id}/request`, { method: 'POST' }))
// Record an inspection result.
export const useRecordInspection = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/inspections`, { method: 'POST', body }))

// ---------- Reports ----------
// Daily report list.
export const useReports = (pid) => useQuery({ queryKey: P(pid, 'reports'), queryFn: () => api(`/projects/${pid}/reports`) })
// One report.
export const useReport = (pid, id) => useQuery({ queryKey: P(pid, 'report', id), queryFn: () => api(`/projects/${pid}/reports/${id}`), enabled: !!id })
// File a new report.
export const useCreateReport = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/reports`, { method: 'POST', body }))

// ---------- Change requests ----------
// Change request list.
export const useChanges = (pid) => useQuery({ queryKey: P(pid, 'changes'), queryFn: () => api(`/projects/${pid}/changes`) })
// One change request.
export const useChange = (pid, id) => useQuery({ queryKey: P(pid, 'change', id), queryFn: () => api(`/projects/${pid}/changes/${id}`), enabled: !!id })
// Create a change request.
export const useCreateChange = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/changes`, { method: 'POST', body }))
// Send a queried change request back for review.
export const useResubmitChange = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/changes/${id}/resubmit`, { method: 'POST' }))

// ---------- Questions ----------
// Question list.
export const useQuestions = (pid) => useQuery({ queryKey: P(pid, 'questions'), queryFn: () => api(`/projects/${pid}/questions`) })
// One question thread.
export const useQuestion = (pid, id) => useQuery({ queryKey: P(pid, 'question', id), queryFn: () => api(`/projects/${pid}/questions/${id}`), enabled: !!id })
// Ask a new question.
export const useAskQuestion = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/questions`, { method: 'POST', body }))
// Reply in a thread: the variables object `{ id, body }` is destructured; `body: { body }` sends the text.
export const useReply = (pid) => useProjectMutation(pid, ({ id, body }) => api(`/projects/${pid}/questions/${id}/messages`, { method: 'POST', body: { body } }))
// Mark a question resolved.
export const useResolveQuestion = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/questions/${id}/resolve`, { method: 'POST' }))

// ---------- Documents ----------
// Document list.
export const useDocuments = (pid) => useQuery({ queryKey: P(pid, 'documents'), queryFn: () => api(`/projects/${pid}/documents`) })
// Add a document.
export const useCreateDocument = (pid) => useProjectMutation(pid, (body) => api(`/projects/${pid}/documents`, { method: 'POST', body }))
// Archive (soft-delete) a document.
export const useArchiveDocument = (pid) => useProjectMutation(pid, (id) => api(`/projects/${pid}/documents/${id}`, { method: 'DELETE' }))

// ---------- History ----------
// Audit log, optionally filtered by type. `type ?? 'all'` keeps the key stable when no type.
export const useAudit = (pid, type) =>
  useQuery({ queryKey: P(pid, 'audit', type ?? 'all'), queryFn: () => api(`/projects/${pid}/audit${type ? `?type=${type}` : ''}`) })
// Ask the server to verify the audit hash chain; a plain mutation (nothing to refresh).
export const useVerifyChain = (pid) => useMutation({ mutationFn: () => api(`/projects/${pid}/audit/verify`, { method: 'POST' }) })
