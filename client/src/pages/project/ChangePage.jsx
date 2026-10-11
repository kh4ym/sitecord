// =============================================================================
// ChangePage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/changes/:changeId  (":changeId" is the change request's id).
//
// What it shows: one change request (a request to alter the plan): how much it
// costs or saves, how many days it adds or saves, the description and reason,
// attached drawings/photos, linked questions, the decision history, and the
// owner's approve / ask-for-details / reject actions.
//
// Who can see it: project members who can open change requests. The decision
// buttons (DecisionActions) decide for themselves who may act. If the owner
// asked for details (status QUERIED), the person who created the request sees
// an "I've answered, send it back" button. People who can view the budget get
// a note about approved changes.
//
// Data it loads: the change request via the useChange query hook; resubmitting
// uses the useResubmitChange mutation hook.
//
// Depends on: React Router (useParams), sonner toasts, lucide-react, the
// decision components, evidence tiles, the UI kit and format helpers.
// =============================================================================

// useParams reads the dynamic parts of the URL (like :changeId) from React Router.
import { useParams } from 'react-router'
// toast shows small pop-up messages.
import { toast } from 'sonner'
// An icon component used for question rows.
import { MessageCircleQuestion } from 'lucide-react'
// Approve / ask / reject buttons.
import { DecisionActions } from '../../components/DecisionActions.jsx'
// The vertical list of what happened to a request and when.
import { DecisionTimeline } from '../../components/DecisionTimeline.jsx'
// Grid of photo/drawing thumbnails.
import { EvidenceTiles } from '../../components/evidence/EvidenceGallery.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components imported together.
import { Button, ErrorState, IconTile, ListCard, ListRow, PageSkeleton, SectionHead, StatusChip } from '../../components/ui/index.js'
// Page heading block.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project, user and permission checker.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// formatPKR formats paisa as Pakistani rupees; timeAgo turns a date into "3 days ago".
import { formatPKR, timeAgo } from '../../lib/format.js'
// Query hook (fetch one change) and mutation hook (resubmit a change).
import { useChange, useResubmitChange } from '../../lib/queries.js'

/** One change request: what changes, what it costs and adds, and the decision. */
// Default-exported page component.
export default function ChangePage() {
  // Destructure `changeId` from the URL parameters object.
  const { changeId } = useParams()
  // Project, signed-in user and the `can(permission)` function.
  const { project, me, can } = useProjectContext()
  // Query result destructuring: `data: c` renames data to `c`; isLoading/error describe the request; refetch retries it.
  const { data: c, isLoading, error, refetch } = useChange(project.id, changeId)
  // A mutation object: call resubmit.mutate(...) to send; resubmit.isPending is true while sending.
  const resubmit = useResubmitChange(project.id)
  // Early return: while loading, render a grey placeholder instead of the page.
  if (isLoading) return <PageSkeleton variant="detail" />
  // If the request failed, show an error with a retry button that calls refetch.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // True when the current user created this change. `me?.id` guards against `me` being missing.
  const mine = c.createdBy === me?.id
  // Render the page.
  return (
    <Page>
      {/* Heading block. */}
      <PageTitle
        // `back` is an object prop: where the back arrow goes and its label (double braces = JSX expression containing an object literal).
        back={{ to: `/p/${project.id}/changes`, label: 'Back to changes' }}
        // e.g. "C-4 · requested by you, 2 days ago" — template literal with a ternary inside.
        kicker={`C-${c.number} · requested by ${mine ? 'you' : c.createdByName}, ${timeAgo(c.createdAt)}`}
        // The change's title.
        title={c.title}
        // Text for the browser tab title.
        documentTitle={`Change C-${c.number}`}
        // Status chip (pending, approved, ...) shown next to the title.
        meta={<StatusChip kind="change" status={c.status} size="md" />}
      />
      {/* Two columns on large screens: details on the left, decision sidebar on the right. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        {/* Left column. */}
        <div className="flex flex-col gap-8">
          {/* <dl> is an HTML description list (dt = term, dd = value); here two stat cards side by side. */}
          <dl data-reveal className="grid grid-cols-2 gap-3">
            {/* Cost card. */}
            <div className="card px-4 py-4">
              {/* Negative cost means the change saves money. */}
              <dt className="text-2xs font-semibold text-ink-3">{c.costImpactPaisa < 0 ? 'saves' : 'costs'}</dt>
              {/* Math.abs drops the minus sign; formatPKR with an options object { compact: true } gives e.g. "Rs 1.2 lakh". Large accent-coloured number. */}
              <dd className="num mt-1 font-display text-stat font-semibold text-accent-700">{formatPKR(Math.abs(c.costImpactPaisa), { compact: true })}</dd>
            </div>
            {/* Time card. */}
            <div className="card px-4 py-4">
              {/* Negative days means the change saves time. */}
              <dt className="text-2xs font-semibold text-ink-3">{c.daysImpact < 0 ? 'saves' : 'adds'}</dt>
              {/* Large number in the display font. */}
              <dd className="num mt-1 font-display text-stat font-semibold">
                {/* Number of days, then "day" or "days" depending on whether it is exactly 1. */}
                {Math.abs(c.daysImpact)} {Math.abs(c.daysImpact) === 1 ? 'day' : 'days'}
              </dd>
            </div>
          </dl>

          {/* Description section. */}
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="What changes" />
            <div className="card flex flex-col gap-3 px-5 py-4">
              {/* whitespace-pre-line keeps the line breaks the author typed. */}
              <p className="text-body leading-relaxed whitespace-pre-line">{c.description}</p>
              {/* Reason line only if a reason was given. */}
              {c.reason && <p className="text-meta text-ink-3">Why: {c.reason}</p>}
            </div>
          </section>

          {/* Attached drawings and photos, only if there are any. */}
          {c.evidence.length > 0 && (
            <section data-reveal className="flex flex-col gap-3">
              <SectionHead title="Drawings and photos" />
              {/* Thumbnails for each evidence file. */}
              <EvidenceTiles projectId={project.id} evidence={c.evidence} />
            </section>
          )}

          {/* Questions linked to this change, if any. */}
          {c.questions.length > 0 && (
            <section data-reveal className="flex flex-col gap-3">
              <SectionHead title="Questions" />
              <ListCard>
                {/* Arrow function with parentheses `(q) => ( ... )` returns the JSX directly. */}
                {c.questions.map((q) => (
                  <ListRow
                    // Unique key per row.
                    key={q.id}
                    // Link to the question's page.
                    to={`/p/${project.id}/questions/${q.id}`}
                    // Question icon on the left.
                    leading={<IconTile icon={MessageCircleQuestion} size="sm" />}
                    // The question text.
                    title={q.title}
                    // Open/answered chip on the right.
                    trailing={<StatusChip kind="question" status={q.status} />}
                    // Shows a ">" arrow.
                    chevron
                  />
                ))}
              </ListCard>
            </section>
          )}
        </div>

        {/* Right column (<aside> = side content); sticks to the top while scrolling on large screens. */}
        <aside className="flex flex-col gap-8 lg:sticky lg:top-8">
          {/* `empty:hidden` hides this box when nothing inside renders. */}
          <div data-reveal className="flex flex-col gap-3 empty:hidden">
            {/* Approve / ask / reject buttons for the owner. */}
            <DecisionActions
              // What kind of thing is being decided on.
              targetType="CHANGE"
              // Its id.
              targetId={c.id}
              // Current status, so only valid actions show.
              status={c.status}
              // Human label used in confirmations.
              label={`change request C-${c.number}`}
              // Amount shown when approving.
              amount={c.costImpactPaisa}
              // Who created it (people can't decide on their own requests).
              createdBy={c.createdBy}
              // Show the buttons as a horizontal bar.
              layout="bar"
              // Custom text for the "ask" button.
              askLabel="ask for details"
            />
            {/* If the owner asked for details and this is the creator's own request, offer to send it back. */}
            {c.status === 'QUERIED' && mine && (
              // mutate(variables, { onSuccess }) sends the request; onSuccess runs after the server replies OK and shows a toast.
              <Button variant="primary" block loading={resubmit.isPending} onClick={() => resubmit.mutate(c.id, { onSuccess: () => toast.success('Sent back to the owner') })}>
                I've answered, send it back
              </Button>
            )}
          </div>
          {/* Budget note for people who can see the budget, on approved changes. */}
          {can('viewBudget') && c.status === 'APPROVED' && (
            <p data-reveal className="text-meta text-ink-3">
              Your budget stays as you set it. Approved changes are listed next to it on the Budget page.
            </p>
          )}
          {/* History section. */}
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="History" />
            {/* `created` is an object built inline: who created it and when; `decisions` is the list of later decisions. */}
            <DecisionTimeline created={{ by: c.createdByName, at: c.createdAt }} decisions={c.decisions} />
          </section>
        </aside>
      </div>
    </Page>
  )
}
