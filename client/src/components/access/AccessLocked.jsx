// FILE: client/src/components/access/AccessLocked.jsx
//
// What it does: inspector access to owner-only scopes (REPORTS, HISTORY,
// PHOTOS). The owner shares each for a day, a week or a month; until then the
// inspector sees a locked state and can ask. It exports:
//   LockedState    what Gate (layout/ProjectLayout.jsx) renders for a `scope` route
//   AccessRows     lists the scopes on the inspector's More page
//   useScopeState  lets a page (report photos) check one scope inline
//
// Depends on: react hooks, sonner (toasts), lucide-react (lock icon),
// shared/permissions.js (scope labels), ProjectContext, lib/format.js,
// lib/queries.js (access-request hooks) and the UI kit.

// React hooks.
import { useEffect, useState } from 'react'
// Toast notifications.
import { toast } from 'sonner'
// Padlock icon.
import { Lock } from 'lucide-react'
// Scope definitions: { REPORTS: { label, description }, ... }.
import { ACCESS_SCOPES } from '@shared/permissions.js'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// "Ayesha" from "Ayesha Khan", and date formatting.
import { firstName, formatDate } from '../../lib/format.js'
// Data hooks for listing, cancelling and creating access requests.
import { useAccessRequests, useCancelAccess, useRequestAccess } from '../../lib/queries.js'
// UI kit components.
import { Button, Field, ListRow, Sheet, StatusChip, Textarea } from '../ui/index.js'

// Headline per scope for the locked screen.
const WHAT = {
  HISTORY: 'The history is shared on request',
  REPORTS: 'Daily reports are shared on request',
  PHOTOS: 'Site photos are shared on request',
}

/** This inspector's latest request for a scope: PENDING, ACTIVE, or nothing. */
// Custom hook.
export function useScopeState(scope) {
  // Project id and project from context.
  const { pid, project } = useProjectContext()
  // Fetch requests only for inspectors (second argument is the `enabled` flag).
  const requests = useAccessRequests(pid, project.role === 'INSPECTOR')
  // The first request for this scope that is pending or active; `?.` because data may be undefined.
  const latest = requests.data?.find((r) => r.scope === scope && ['PENDING', 'ACTIVE'].includes(r.state))
  // Return it with the loading flag.
  return { latest, loading: requests.isLoading }
}

/** What an inspector sees in place of a page the owner hasn't shared. */
export function LockedState({ scope }) {
  const { project } = useProjectContext()
  // Current request state for this scope.
  const { latest } = useScopeState(scope)
  // Is the "ask" sheet open?
  const [asking, setAsking] = useState(false)
  // Set the browser tab title whenever the scope changes.
  useEffect(() => {
    document.title = `${ACCESS_SCOPES[scope].label} · SiteCord`
  }, [scope])
  // The owner's name: find the OWNER member, take `.name`, else the fallback text.
  const owner = project.members.find((m) => m.role === 'OWNER')?.name ?? 'the owner'
  return (
    // Centred card (max width lg) with a column of content; data-reveal joins the page fade-in.
    <div data-reveal className="card mx-auto flex max-w-lg flex-col items-center px-6 py-12 text-center">
      {/* Grey circle with the padlock. */}
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-sunken text-ink">
        <Lock size={22} aria-hidden />
      </span>
      {/* Headline from the WHAT table. */}
      <h1 className="title text-title">{WHAT[scope]}</h1>
      {/* Explanation, mixing text and `{…}` expressions. */}
      <p className="mt-2 max-w-sm text-meta text-ink-3">
        Ask {owner} to share {ACCESS_SCOPES[scope].label.toLowerCase()} with you for a day, a week or a month. Money is never shown to inspectors.
      </p>
      <div className="mt-6">
        {/* Already asked: show the pending note; otherwise an "ask" button. */}
        {latest?.state === 'PENDING' ? (
          <PendingNote scope={scope} request={latest} owner={owner} />
        ) : (
          <Button variant="primary" onClick={() => setAsking(true)}>
            ask {firstName(owner)}
          </Button>
        )}
      </div>
      {/* The request sheet, controlled by `asking`; passing setAsking lets it close itself. */}
      <RequestAccessSheet scope={scope} open={asking} onOpenChange={setAsking} owner={owner} />
    </div>
  )
}

// Shown while a request is waiting; lets the inspector withdraw it.
function PendingNote({ request, owner }) {
  const { pid } = useProjectContext()
  // Mutation for cancelling.
  const cancel = useCancelAccess(pid)
  return (
    <div className="flex flex-col items-center gap-3">
      {/* "requested" status chip. */}
      <StatusChip kind="access" status="PENDING" size="md" />
      <p className="text-meta text-ink-3">
        Asked {formatDate(request.requestedAt)}. Waiting for {firstName(owner)}.
      </p>
      {/* `.then(onSuccess, onError)` takes two callbacks: one for success, one for failure. `loading` shows a spinner while pending. */}
      <Button variant="text" loading={cancel.isPending} onClick={() => cancel.mutateAsync(request.id).then(() => toast('Request withdrawn'), (err) => toast.error(err.message))}>
        withdraw the request
      </Button>
    </div>
  )
}

// The small dialog where an inspector asks for access, with an optional reason.
function RequestAccessSheet({ scope, open, onOpenChange, owner }) {
  const { pid } = useProjectContext()
  // Mutation for sending the request.
  const request = useRequestAccess(pid)
  // Controlled textarea value.
  const [reason, setReason] = useState('')
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      // Centred dialog style, small size.
      variant="center"
      size="sm"
      // Title and description built with template literals.
      title={`Ask to see ${ACCESS_SCOPES[scope].label.toLowerCase()}`}
      description={`${firstName(owner)} decides, and chooses for how long.`}
      // Footer buttons passed as a Fragment in a prop.
      footer={
        <>
          {/* Cancel just closes the sheet. */}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            cancel
          </Button>
          <Button
            variant="primary"
            // Spinner while sending.
            loading={request.isPending}
            // mutate(variables, callbacks): the variables object, then per-call onSuccess/onError.
            onClick={() =>
              request.mutate(
                // Trimmed reason, or undefined (omitted) if empty (`||`).
                { scope, reason: reason.trim() || undefined },
                {
                  // On success: toast, clear the box, close.
                  onSuccess: () => {
                    toast.success(`Asked ${firstName(owner)}`)
                    setReason('')
                    onOpenChange(false)
                  },
                  // On failure: show the error.
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            send request
          </Button>
        </>
      }
    >
      {/* Labelled, optional field with a hint. */}
      <Field label="Why do you need it?" optional hint="A line helps the owner decide.">
        {/* Controlled textarea: value comes from state; onChange stores e.target.value (the typed text). */}
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. To compare the column photos before re-checking the east side." />
      </Field>
    </Sheet>
  )
}

/** One row per scope for an inspector's More page: status and the next step. */
export function AccessRows() {
  const { project, pid } = useProjectContext()
  // All of this inspector's requests.
  const requests = useAccessRequests(pid)
  // Which scope's sheet is open (null = none).
  const [asking, setAsking] = useState(null)
  // Owner's name, with a fallback.
  const owner = project.members.find((m) => m.role === 'OWNER')?.name ?? 'the owner'
  return (
    <>
      {/* Object.entries gives [scope, definition] pairs; destructure them in the arrow's parameter. */}
      {Object.entries(ACCESS_SCOPES).map(([scope, s]) => {
        // Latest pending/active request for this scope.
        const latest = requests.data?.find((r) => r.scope === scope && ['PENDING', 'ACTIVE'].includes(r.state))
        // Its state, or NONE.
        const state = latest?.state ?? 'NONE'
        return (
          <ListRow
            key={scope}
            title={s.label}
            // Subtitle depends on the state (nested ternary).
            subtitle={state === 'ACTIVE' ? `Shared until ${formatDate(latest.expiresAt)}` : state === 'PENDING' ? 'Waiting for the owner' : s.description}
            // Only clickable when nothing is requested yet; undefined makes the row non-clickable.
            onClick={state === 'NONE' ? () => setAsking(scope) : undefined}
            // Status chip on the end of the row.
            trailing={<StatusChip kind="access" status={state} />}
          />
        )
      })}
      {/* The sheet for the chosen scope; closing (o false) resets `asking` to null. */}
      {asking && <RequestAccessSheet scope={asking} open={!!asking} onOpenChange={(o) => !o && setAsking(null)} owner={owner} />}
    </>
  )
}
