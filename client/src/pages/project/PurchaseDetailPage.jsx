// =============================================================================
// PurchaseDetailPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/purchases/:expenseId  (":expenseId" is the purchase's id).
//
// What it shows: one purchase (an "expense" in the code): the amount and status,
// a one-line explanation of what happens next, evidence tiles (receipts and
// photos, with where they came from), the line items, automatic checks, any
// linked question shown inline, the decision history, and the actions the
// viewer's role allows (approve / ask / reject, submit, edit, copy link).
//
// Who can see it: project members who can view purchases. Only the person who
// entered the purchase can edit or submit it, and only while it is a DRAFT or
// QUERIED (the owner asked a question). The decision buttons decide for
// themselves who may approve.
//
// Data it loads: the purchase via useExpense, each linked question via
// useQuestion (inside InlineQuestion), and submitting uses the useSubmitExpense
// mutation.
//
// Depends on: React Router (useParams, useNavigate), sonner toasts,
// lucide-react, shared record labels, the expense/decision/question components,
// the UI kit, i18n, format helpers and the status helper expenseChip.
// =============================================================================

// Two React Router hooks: useNavigate returns a function to change page in code; useParams reads URL parameters.
import { useNavigate, useParams } from 'react-router'
// Pop-up notifications.
import { toast } from 'sonner'
// Icon components.
import { Link2, MessageCircleQuestion, MoreHorizontal, PencilLine, Wallet } from 'lucide-react'
// Shared lookup tables: purchase type names and the wording for missing-proof "gaps".
import { EXPENSE_TYPES, GAP_LABELS } from '@shared/records.js'
// Approve / ask / reject buttons.
import { DecisionActions } from '../../components/DecisionActions.jsx'
// History list of decisions.
import { DecisionTimeline } from '../../components/DecisionTimeline.jsx'
// Purchase sub-sections, plus openFindings() which counts unresolved check findings.
import { ExpenseChecks, ExpenseEvidence, ExpenseItems, openFindings } from '../../components/ExpenseParts.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// The conversation thread of a question.
import { QuestionThread } from '../../components/QuestionThread.jsx'
// UI kit components.
import { Button, Chip, ErrorState, IconButton, Menu, MenuItem, Notice, PageSkeleton, SectionHead, Skeleton, StatusChip } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading block.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Date and rupee formatters.
import { formatDate, formatPKR } from '../../lib/format.js'
// Query hooks (one purchase, one question) and a mutation hook (submit a purchase).
import { useExpense, useQuestion, useSubmitExpense } from '../../lib/queries.js'
// Works out which status chip to show for a purchase.
import { expenseChip } from '../../lib/status.js'

// The page component, exported as the default export so the router can lazy-load it.
export default function PurchaseDetailPage() {
  // Destructure the purchase id from the URL.
  const { expenseId } = useParams()
  // Project, signed-in user, permission checker and feature flags from context.
  const { project, me, can, features } = useProjectContext()
  // `term` translates building/trade vocabulary.
  const { term } = useI18n()
  // Fetch the purchase; `data: e` renames `data` to `e`. isLoading, error and refetch come from TanStack Query.
  const { data: e, isLoading, error, refetch } = useExpense(project.id, expenseId)
  // Mutation object for submitting (submit.mutate, submit.isPending).
  const submit = useSubmitExpense(project.id)
  // A function that moves to another route, e.g. navigate('/somewhere').
  const navigate = useNavigate()
  // Template literal for the purchases list URL, reused below.
  const base = `/p/${project.id}/purchases`

  // Early returns: show a skeleton while loading...
  if (isLoading) return <PageSkeleton variant="detail" />
  // ...or an error box with a retry button.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Did I enter this purchase? (`?.` in case `me` is missing.)
  const mine = e.createdBy === me?.id
  // Editable only if mine AND the status is in the list; .includes checks array membership.
  const editable = mine && ['DRAFT', 'QUERIED'].includes(e.status)
  // An object literal used as a lookup table, immediately indexed with [e.status] to pick one message.
  const status = {
    // Text for drafts.
    DRAFT: 'Draft. Only you can see it until you submit it.',
    // Submitted: only the creator gets a message (nested ternaries); others get null (no message).
    SUBMITTED: mine ? (can('decide') && features.approvals ? 'You entered this, so someone else approves it.' : 'Waiting for the owner to approve it.') : null,
    // Queried: creator is told to answer; others see that an answer is pending.
    QUERIED: mine ? 'The owner asked a question. Answer it below, then resubmit.' : 'Waiting for an answer.',
    // Approved wording depends on whether approvals are switched on.
    APPROVED: features.approvals ? 'Approved. A site visit can verify the delivery.' : 'Recorded. A site visit can verify the delivery.',
    // Verified.
    VERIFIED: 'Verified on site.',
    // Rejected; double quotes because the text contains an apostrophe.
    REJECTED: "Rejected. It doesn't count towards spending.",
    // Pick the entry matching the current status (undefined if none).
  }[e.status]

  // Render the page.
  return (
    <Page>
      {/* Heading with back link, kicker, title and a "more" menu. */}
      <PageTitle
        // Object prop for the back arrow.
        back={{ to: base, label: 'Back to purchases' }}
        // e.g. "P-12 · Cement"; EXPENSE_TYPES[e.type] looks up the type's label.
        kicker={`P-${e.number} · ${term(EXPENSE_TYPES[e.type])}`}
        // Supplier name as the title.
        title={e.supplierName}
        // Browser tab title.
        documentTitle={`Purchase P-${e.number}`}
        // A JSX element as a prop: a dropdown menu opened by a "..." icon button.
        actions={
          <Menu trigger={<IconButton icon={MoreHorizontal} label="More actions" />}>
            {/* Edit item only if editable. */}
            {editable && (
              // onSelect navigates to the edit page.
              <MenuItem icon={PencilLine} onSelect={() => navigate(`${base}/${e.id}/edit`)}>
                edit purchase
              </MenuItem>
            )}
            {/* Copy the current page URL; writeText returns a Promise, and .then runs the toast once copying succeeds. */}
            <MenuItem icon={Link2} onSelect={() => navigator.clipboard.writeText(window.location.href).then(() => toast.success('Link copied'))}>
              copy link
            </MenuItem>
          </Menu>
        }
      />

      {/* Top summary: amount, status chip, details line and status message. */}
      <section data-reveal className="mb-8 flex flex-col gap-2">
        {/* Row that wraps on small screens. */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Big accent-coloured amount, larger on wider screens. */}
          <p className="num font-display text-display font-semibold text-accent-700 sm:text-display-lg">{formatPKR(e.totalPaisa)}</p>
          {/* Spread syntax `{ ...e, openFindings: ... }` copies every field of e into a new object and adds/overrides openFindings. */}
          <StatusChip kind="expense" status={expenseChip({ ...e, openFindings: openFindings(e) })} size="md" />
          {/* "from advance" chip when paid out of money advanced to the contractor. */}
          {e.fromAdvance && (
            <Chip tone="neutral" icon={Wallet} size="md">
              from advance
            </Chip>
          )}
        </div>
        {/* Small grey details line. */}
        <p className="text-meta text-ink-3">
          {/* Build an array of parts; `x && 'text'` gives false when x is empty; .filter(Boolean) drops falsy parts; .join(' · ') glues the rest with dots. */}
          {[formatDate(e.purchaseDate), e.invoiceNumber && `invoice ${e.invoiceNumber}`, `entered by ${mine ? 'you' : e.createdByName}`].filter(Boolean).join(' · ')}
        </p>
        {/* Status explanation, if there is one for this status. */}
        {status && <p className="text-body text-ink-2">{status}</p>}
      </section>

      {/* Actions for the creator while the purchase can still be changed. */}
      {editable && (
        <div data-reveal className="mb-8 flex flex-col gap-3">
          {/* Warning listing missing proof, if any. */}
          {e.gaps.length > 0 && (
            <Notice tone="warn" title="Proof is missing">
              {/* Map each gap code to its label and join them into sentences (the final "." is plain text). */}
              {e.gaps.map((g) => GAP_LABELS[g]).join('. ')}.
            </Notice>
          )}
          {/* Button row. */}
          <div className="flex flex-wrap gap-2">
            {/* Ternary in JSX: if proof is missing, the main button goes to the edit page; otherwise it submits. */}
            {e.gaps.length > 0 ? (
              // A Button with `to` acts as a link.
              <Button variant="primary" to={`${base}/${e.id}/edit`}>
                add the proof
              </Button>
            ) : (
              <Button
                // Main (filled) style.
                variant="primary"
                // Spinner while the submit request is in flight.
                loading={submit.isPending}
                // mutate(id, { onSuccess, onError }): success shows a toast whose text depends on approvals; onError receives the error and shows its message.
                onClick={() => submit.mutate(e.id, { onSuccess: () => toast.success(features.approvals ? 'Sent to the owner' : 'Purchase saved'), onError: (err) => toast.error(err.message) })}
              >
                {/* Button text: "resubmit" for queried purchases, "submit for approval" for non-owners when approvals are on, otherwise "save purchase". */}
                {e.status === 'QUERIED' ? 'resubmit' : features.approvals && project.role !== 'OWNER' ? 'submit for approval' : 'save purchase'}
              </Button>
            )}
            {/* Secondary edit link. */}
            <Button variant="secondary" to={`${base}/${e.id}/edit`}>
              edit
            </Button>
          </div>
        </div>
      )}

      {/* Two columns on large screens: details left, decisions right. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        {/* Left column. */}
        <div className="flex flex-col gap-8">
          {/* Each part is wrapped in a div so it reveals separately on scroll. */}
          <div data-reveal>
            {/* Receipts/photos. */}
            <ExpenseEvidence expense={e} />
          </div>
          <div data-reveal>
            {/* Line items. */}
            <ExpenseItems expense={e} />
          </div>
          <div data-reveal>
            {/* Automatic checks (e.g. price looks high). */}
            <ExpenseChecks expense={e} />
          </div>
          {/* One inline question block per linked question; `key` goes on the outermost element returned by map. */}
          {e.questions.map((q) => (
            <div data-reveal key={q.id}>
              <InlineQuestion id={q.id} />
            </div>
          ))}
        </div>

        {/* Right sidebar, sticky on large screens. */}
        <aside className="flex flex-col gap-8 lg:sticky lg:top-8">
          {/* Hidden when DecisionActions renders nothing. */}
          <div data-reveal className="empty:hidden">
            {/* Approve / ask / reject buttons for this purchase. */}
            <DecisionActions targetType="EXPENSE" targetId={e.id} status={e.status} label={`purchase P-${e.number}`} amount={e.totalPaisa} createdBy={e.createdBy} layout="bar" />
          </div>
          {/* History. */}
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="History" />
            {/* Created (who and when), submitted time and later decisions. */}
            <DecisionTimeline created={{ by: e.createdByName, at: e.createdAt }} submitted={e.submittedAt} decisions={e.decisions} />
          </section>
        </aside>
      </div>
    </Page>
  )
}

// A small component that loads and shows one question inside the purchase page.
// `{ id }` destructures the `id` prop from the props object.
function InlineQuestion({ id }) {
  // Hooks can be used in any component; get the project here too.
  const { project } = useProjectContext()
  // Fetch the question; we only need data and error.
  const { data, error } = useQuestion(project.id, id)
  return (
    <section className="flex flex-col gap-3">
      {/* Heading with an "open" link to the full question page (action is an object prop). */}
      <SectionHead title="Question" action={{ to: `/p/${project.id}/questions/${id}`, label: 'open' }} />
      {/* Card with padding. */}
      <div className="card p-4">
        {/* Three-way ternary: data loaded -> show it; error -> show message; otherwise -> loading skeleton. */}
        {data ? (
          // `<>...</>` is a Fragment: groups elements without adding an extra HTML element.
          <>
            {/* Bold title row with an icon. */}
            <p className="mb-4 flex items-center gap-2 text-body font-bold">
              {/* Decorative icon (aria-hidden hides it from screen readers). */}
              <MessageCircleQuestion size={17} className="text-ink-3" aria-hidden />
              {/* The question title. */}
              {data.title}
            </p>
            {/* The conversation, in compact form (`compact` = compact={true}). */}
            <QuestionThread question={data} compact />
          </>
        ) : error ? (
          // Red error text.
          <p className="text-meta text-danger-700">{error.message}</p>
        ) : (
          // Grey placeholder block 24 units tall.
          <Skeleton className="h-24" />
        )}
      </div>
    </section>
  )
}
