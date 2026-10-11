// /p/:id/approvals (owner). One inbox of everything waiting on the owner:
// purchases, change requests, milestone requests and inspector access requests.
// Each row opens a review sheet with evidence, checks and approve / ask / reject;
// access requests are granted for 1, 7 or 30 days.
//
// FILE OVERVIEW
// - Route: /p/:projectId/approvals, wrapped in <Gate can="decide"
//   feature="approvals"> in App.jsx, so only people allowed to decide (the
//   owner) see it, and only on project types that have approvals (not
//   self-managed builds).
// - URL state (query string, so links/notifications can open it directly):
//   ?filter=purchases|payments|changes|access   which group to list
//   ?review=KIND:id                             which item's review sheet is open
//   ?show=decided                               show the "already decided" list
// - Data loaded: useApprovals(projectId) returns { expenses, milestones,
//   changes, access, decided }. The review sheet also loads the full purchase
//   (useExpense) or change request (useChange) being reviewed.
// - Data changed: approve / ask / reject buttons live in <DecisionActions>;
//   inspector access requests are decided here with useDecideAccess.
// - Components in this file: ApprovalsPage (the list), WaitingRow (one row per
//   kind), ReviewSheet + ReviewFooter (the slide-up sheet and its buttons),
//   ExpenseReview / ChangeReview / MilestoneReview / AccessReview (sheet
//   bodies), AccessDecision (share-for-N-days / decline) and Decided (history).

// useState hook for local state.
import { useState } from 'react'
// useSearchParams reads and writes the ?query part of the URL.
import { useSearchParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icon components from lucide-react.
import { Check, Flag, HandCoins, Inbox, KeyRound, MessageCircleQuestion, Receipt, X } from 'lucide-react'
// ACCESS_DAYS = allowed sharing durations; ACCESS_SCOPES = what an inspector can ask to see (with labels/descriptions).
import { ACCESS_DAYS, ACCESS_SCOPES } from '@shared/permissions.js'
// The shared approve / ask / reject button bar.
import { DecisionActions } from '../../components/DecisionActions.jsx'
// Thumbnail tiles for photos/PDF evidence.
import { EvidenceTiles } from '../../components/evidence/EvidenceGallery.jsx'
// Building blocks for showing a purchase (evidence, automatic checks, line items) and a helper counting open findings.
import { ExpenseChecks, ExpenseEvidence, ExpenseItems, openFindings } from '../../components/ExpenseParts.jsx'
// Standard page container.
import { Page } from '../../components/Page.jsx'
// A multi-line import: the braces can span several lines; each name is a UI kit component.
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  IconTile,
  ListCard,
  ListRow,
  PageSkeleton,
  Segmented,
  Sheet,
  Skeleton,
  StatusChip,
  Textarea,
} from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading component.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Gives the current project (loaded by the project layout) to any page inside it.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Builds the URL for an uploaded file (photo/PDF).
import { fileUrl } from '../../lib/api.js'
// Formatting helpers: dates, rupees and "3 days ago".
import { formatDate, formatPKR, timeAgo } from '../../lib/format.js'
// Data hooks: approvals inbox, one change request, the access-decision mutation, one purchase.
import { useApprovals, useChange, useDecideAccess, useExpense } from '../../lib/queries.js'
// Works out which status chip to show for a purchase.
import { expenseChip } from '../../lib/status.js'

// Arrow function returning the lowercase label of an access scope; ?. guards unknown scopes and ?? falls back to the raw scope key.
const scopeLabel = (scope) => ACCESS_SCOPES[scope]?.label.toLowerCase() ?? scope
// Number keys in an object literal (1, 7, 30) become property names; maps days to friendly text.
const DAYS_LABEL = { 1: 'a day', 7: 'a week', 30: 'a month' }

/** The owner's inbox: everything waiting for a decision, oldest first. Tap a row to review it in a sheet. */
// Default export: the page component.
export default function ApprovalsPage() {
  // Destructure the project from the project context.
  const { project } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Array destructuring: params = current query values, setParams = function to change them.
  const [params, setParams] = useSearchParams()
  // Current filter, or '' (all) when ?filter= is absent (?? nullish fallback).
  const filter = params.get('filter') ?? ''
  // The open review, e.g. 'EXPENSE:abc123', or null.
  const review = params.get('review')
  // true when ?show=decided.
  const showDecided = params.get('show') === 'decided'
  // Query result destructured: data, isLoading, error, and refetch (try again).
  const { data, isLoading, error, refetch } = useApprovals(project.id)

  // Early returns: a placeholder skeleton while loading…
  if (isLoading) return <PageSkeleton />
  // …or an error card with a retry button.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Helper that sets (or removes) one query parameter.
  const setParam = (key, value) => {
    // `new URLSearchParams(params)` makes an editable copy of the current params.
    const next = new URLSearchParams(params)
    // Ternary used as a statement: set the key if value is truthy, otherwise delete it.
    value ? next.set(key, value) : next.delete(key)
    // Write the URL. replace (no new history entry) for everything except opening a review, so the Back button closes the sheet.
    setParams(next, { replace: key !== 'review' })
  }
  // Build one combined list: spread (...) each mapped array into a single array literal, then sort it.
  const items = [
    // Each purchase becomes a common shape { kind, group, id, at, e } (shorthand `e` = e: e).
    ...data.expenses.map((e) => ({ kind: 'EXPENSE', group: 'purchases', id: e.id, at: e.submittedAt, e })),
    // Milestone payment requests.
    ...data.milestones.map((m) => ({ kind: 'MILESTONE', group: 'payments', id: m.id, at: m.requestedAt, m })),
    // Change requests.
    ...data.changes.map((c) => ({ kind: 'CHANGE', group: 'changes', id: c.id, at: c.createdAt, c })),
    // Inspector access requests.
    ...data.access.map((a) => ({ kind: 'ACCESS', group: 'access', id: a.id, at: a.requestedAt, a })),
    // .sort with a compare function: subtracting dates gives milliseconds; negative puts x first → oldest first.
  ].sort((x, y) => new Date(x.at) - new Date(y.at))
  // How many items are in group g (.filter keeps matching items, .length counts them).
  const count = (g) => items.filter((i) => i.group === g).length
  // Items visible under the current filter (no filter → everything).
  const shown = items.filter((i) => !filter || i.group === filter)
  // Total money waiting: .reduce((sum, item) => …, 0) adds up a field over an array. Math.max(0, …) ignores changes that save money.
  const total = data.expenses.reduce((n, e) => n + e.totalPaisa, 0) + data.milestones.reduce((n, m) => n + m.amountPaisa, 0) + data.changes.reduce((n, c) => n + Math.max(0, c.costImpactPaisa), 0)

  return (
    <Page>
      <PageTitle
        // Translated "Approvals".
        title={t('nav.approvals')}
        // Small text above the title, e.g. "3 waiting · Rs 4.2 lakh"; nested template literals + ternaries; undefined = no kicker when empty.
        kicker={items.length ? `${items.length} waiting${total ? ` · ${formatPKR(total, { compact: true })}` : ''}` : undefined}
      />
      {/* Filter chips only when there's something waiting. */}
      {items.length > 0 && (
        <FilterChips
          // Marks it for the reveal animation.
          data-reveal
          className="mb-5"
          // Accessible label for the chip group.
          label="Show"
          // Currently selected filter.
          value={filter}
          // Store the chosen filter in the URL.
          onChange={(v) => setParam('filter', v)}
          // Chip options with counts; .filter keeps "all", groups with items, and the currently active one.
          options={[
            { value: '', label: 'all' },
            { value: 'purchases', label: 'purchases', count: count('purchases') },
            { value: 'payments', label: 'payments', count: count('payments') },
            { value: 'changes', label: 'changes', count: count('changes') },
            { value: 'access', label: 'access', count: count('access') },
          ].filter((o) => !o.value || o.count > 0 || o.value === filter)}
        />
      )}

      {/* Ternary: empty state when nothing to show, otherwise the list. */}
      {shown.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState
            icon={Inbox}
            // Different wording depending on whether the filter or the whole inbox is empty.
            title={items.length ? 'Nothing here' : 'Nothing is waiting for you'}
            description={items.length ? 'Try another filter.' : 'New purchases and requests appear here, oldest first.'}
          />
        </div>
      ) : (
        <div data-reveal>
          {/* ListCard re-animates its rows when animateKey (the filter) changes. */}
          <ListCard animateKey={filter}>
            {/* One row per item; the key combines kind and id (template literal) so it's unique across kinds; clicking opens the review. */}
            {shown.map((i) => (
              <WaitingRow key={`${i.kind}:${i.id}`} item={i} onOpen={() => setParam('review', `${i.kind}:${i.id}`)} />
            ))}
          </ListCard>
        </div>
      )}

      {/* History area below the inbox. */}
      <div data-reveal className="mt-8">
        {/* Show the decided list, or (if there is any history) a button to reveal it. */}
        {showDecided ? (
          // onHide removes ?show= from the URL (null → delete).
          <Decided decided={data.decided} onHide={() => setParam('show', null)} />
        ) : (
          // && renders the button only when there are decided items.
          data.decided.length > 0 && (
            <button type="button" onClick={() => setParam('show', 'decided')} className="px-1 text-meta font-semibold text-accent-700 hover:text-accent-800">
              see what was decided
            </button>
          )
        )}
      </div>

      {/* The review sheet is always mounted; it opens when ?review= is set. Closing removes the param. */}
      <ReviewSheet review={review} data={data} onClose={() => setParam('review', null)} />
    </Page>
  )
}

// One inbox row; picks a layout based on item.kind.
function WaitingRow({ item, onOpen }) {
  // Current project (for building file URLs).
  const { project } = useProjectContext()
  // Purchase row.
  if (item.kind === 'EXPENSE') {
    // Destructure the purchase object e from the item.
    const { e } = item
    // .find returns the first evidence file that isn't a PDF (a photo), or undefined.
    const photo = e.evidence.find((v) => v.mime !== 'application/pdf')
    return (
      <ListRow
        // Clicking the row opens the review sheet.
        onClick={onOpen}
        // leading = left-side visual: the receipt photo if there is one, else an icon tile.
        leading={
          photo ? (
            // alt="" marks the image as decorative; loading="lazy" defers loading until near the viewport.
            <img src={fileUrl(project.id, photo.id)} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />
          ) : (
            <IconTile icon={Receipt} tone="accent" />
          )
        }
        // Title: the item description, or the supplier name if empty (||).
        title={e.items || e.supplierName}
        // Subtitle: purchase number, supplier and how long ago it was submitted.
        subtitle={`P-${e.number} · ${e.supplierName} · ${timeAgo(e.submittedAt)}`}
        // trailing = right side; a Fragment holds two elements.
        trailing={
          <>
            {/* Amount without the "Rs " prefix (.replace swaps the first match for ''). */}
            <span className="num text-body font-bold">{formatPKR(e.totalPaisa).replace('Rs ', '')}</span>
            {/* Status chip; { ...e, openFindings: … } copies e and adds/overrides openFindings. */}
            <StatusChip kind="expense" status={expenseChip({ ...e, openFindings: e.findings.length })} />
          </>
        }
      />
    )
  }
  // Milestone payment row.
  if (item.kind === 'MILESTONE') {
    // Destructure the milestone m.
    const { m } = item
    return (
      <ListRow
        onClick={onOpen}
        // Coins icon on the left.
        leading={<IconTile icon={HandCoins} tone="accent" />}
        title={m.name}
        subtitle={`Milestone payment · requested ${timeAgo(m.requestedAt)}`}
        // Amount on the right.
        trailing={<span className="num text-body font-bold">{formatPKR(m.amountPaisa).replace('Rs ', '')}</span>}
      />
    )
  }
  // Change request row.
  if (item.kind === 'CHANGE') {
    // Destructure the change c.
    const { c } = item
    return (
      <ListRow
        onClick={onOpen}
        // Flag icon.
        leading={<IconTile icon={Flag} tone="accent" />}
        title={c.title}
        // "C-12 · +5 days · Name": the days part only appears when daysImpact is non-zero; a '+' is added for positive numbers.
        subtitle={`C-${c.number} · ${c.daysImpact ? `${c.daysImpact > 0 ? '+' : ''}${c.daysImpact} days · ` : ''}${c.createdByName}`}
        // Cost change with a +/− sign ({ sign: true }).
        trailing={<span className="num text-body font-bold">{formatPKR(c.costImpactPaisa, { sign: true }).replace('Rs ', '')}</span>}
      />
    )
  }
  // Otherwise it's an inspector access request; destructure a.
  const { a } = item
  return (
    <ListRow
      onClick={onOpen}
      // Key icon in warning colour.
      leading={<IconTile icon={KeyRound} tone="warn" />}
      title={`${a.userName} asks to see the ${scopeLabel(a.scope)}`}
      // Show the inspector's reason in quotes if given, else who/when.
      subtitle={a.reason ? `“${a.reason}”` : `Inspector · ${timeAgo(a.requestedAt)}`}
      // Always "pending" here.
      trailing={<StatusChip kind="access" status="PENDING" />}
    />
  )
}

/** One sheet for every kind of request, opened from a row or a notification (?review=KIND:id). */
// Props: review string, the approvals data, and onClose callback.
function ReviewSheet({ review, data, onClose }) {
  // 'EXPENSE:abc'.split(':') → ['EXPENSE', 'abc']; ?? [] gives an empty array when review is null, so both become undefined.
  const [kind, id] = review?.split(':') ?? []
  // Remember the last opened review so the sheet keeps its content while it animates closed.
  const [last, setLast] = useState(review)
  // Update `last` during render when a new review opens (derived-state pattern).
  if (review && review !== last) setLast(review)
  // What to display: the current review, or the last one while closing.
  const [shownKind, shownId] = (review ?? last)?.split(':') ?? []
  // Sheet titles per kind.
  const titles = { EXPENSE: 'Review purchase', MILESTONE: 'Payment request', CHANGE: 'Change request', ACCESS: 'Sharing request' }
  return (
    // open: !! converts a value to true/false; onOpenChange closes via onClose when o is false; footer gets the action buttons.
    <Sheet open={!!kind && !!id} onOpenChange={(o) => !o && onClose()} title={titles[shownKind] ?? 'Review'} size="lg" footer={<ReviewFooter kind={shownKind} id={shownId} data={data} onDone={onClose} />}>
      {/* Exactly one of these renders, chosen by the kind. */}
      {shownKind === 'EXPENSE' && <ExpenseReview id={shownId} />}
      {shownKind === 'CHANGE' && <ChangeReview id={shownId} />}
      {/* Milestone and access bodies get the matching object found in the already-loaded data. */}
      {shownKind === 'MILESTONE' && <MilestoneReview m={data.milestones.find((m) => m.id === shownId)} />}
      {shownKind === 'ACCESS' && <AccessReview a={data.access.find((a) => a.id === shownId)} />}
    </Sheet>
  )
}

// The sheet's bottom bar with the decision buttons.
function ReviewFooter({ kind, id, data, onDone }) {
  // Current project.
  const { project } = useProjectContext()
  // Load the purchase only for EXPENSE (passing null disables the query).
  const expense = useExpense(project.id, kind === 'EXPENSE' ? id : null)
  // Load the change only for CHANGE.
  const change = useChange(project.id, kind === 'CHANGE' ? id : null)
  // Access requests use their own decision UI.
  if (kind === 'ACCESS') {
    // Find the request in the inbox data.
    const a = data.access.find((x) => x.id === id)
    // Render the decision panel, or nothing (null) if it's gone.
    return a ? <AccessDecision a={a} onDone={onDone} /> : null
  }
  // target describes what's being decided. A chain of ternaries picks per kind; `x.data && {…}` yields the object only once data has loaded.
  // The MILESTONE branch uses an IIFE — (() => { … })() — an arrow function called immediately, so it can use statements inside an expression.
  const target =
    kind === 'EXPENSE'
      ? expense.data && { status: expense.data.status, label: `purchase P-${expense.data.number}`, amount: expense.data.totalPaisa, createdBy: expense.data.createdBy, page: `/p/${project.id}/purchases/${id}` }
      : kind === 'CHANGE'
        ? change.data && { status: change.data.status, label: `change request C-${change.data.number}`, amount: change.data.costImpactPaisa, createdBy: change.data.createdBy, page: `/p/${project.id}/changes/${id}` }
        : kind === 'MILESTONE'
          ? (() => {
              // Look up the milestone.
              const m = data.milestones.find((x) => x.id === id)
              // Return the target object if found (no `page` for milestones).
              return m && { status: m.status, label: `the milestone “${m.name}”`, amount: m.amountPaisa }
            })()
          : null
  // Nothing to decide yet (loading or missing) → render nothing.
  if (!target) return null
  return (
    <div className="flex w-full flex-col gap-2">
      {/* Approve / ask / reject buttons; layout="bar" fits them in the sheet footer; onDone closes the sheet. */}
      <DecisionActions targetType={kind} targetId={id} status={target.status} label={target.label} amount={target.amount} createdBy={target.createdBy} layout="bar" onDone={onDone} />
      {/* Link to the item's full page, if it has one. */}
      {target.page && (
        <Button variant="text" to={target.page} className="self-center">
          open the full page
        </Button>
      )}
    </div>
  )
}

// Sheet body for a purchase.
function ExpenseReview({ id }) {
  // Current project.
  const { project } = useProjectContext()
  // Load the purchase; rename data to e.
  const { data: e, isLoading, error } = useExpense(project.id, id)
  // Loading placeholder.
  if (isLoading) return <Skeleton className="h-72 rounded-card" />
  // Error text in red.
  if (error) return <p className="text-meta text-danger-700">{error.message}</p>
  return (
    <div className="flex flex-col gap-7">
      <div>
        {/* Purchase number, supplier and purchase date. */}
        <p className="text-meta font-semibold text-ink-3">
          P-{e.number} · {e.supplierName} · {formatDate(e.purchaseDate)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {/* Big total amount. */}
          <p className="num font-display text-display font-semibold text-accent-700">{formatPKR(e.totalPaisa)}</p>
          {/* Status chip, counting open findings with the helper. */}
          <StatusChip kind="expense" status={expenseChip({ ...e, openFindings: openFindings(e) })} size="md" />
        </div>
        {/* Who entered it, plus ", paid from the advance" when fromAdvance is true (ternary with '' for nothing). */}
        <p className="mt-1 text-meta text-ink-3">
          Entered by {e.createdByName}
          {e.fromAdvance ? ', paid from the advance' : ''}
        </p>
      </div>
      {/* Receipt photos, automatic checks and line items, each a shared component taking the expense as a prop. */}
      <ExpenseEvidence expense={e} />
      <ExpenseChecks expense={e} />
      <ExpenseItems expense={e} />
    </div>
  )
}

// Sheet body for a change request.
function ChangeReview({ id }) {
  // Current project.
  const { project } = useProjectContext()
  // Load the change; rename data to c.
  const { data: c, isLoading, error } = useChange(project.id, id)
  // Loading placeholder.
  if (isLoading) return <Skeleton className="h-60 rounded-card" />
  // Error message.
  if (error) return <p className="text-meta text-danger-700">{error.message}</p>
  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* Number, requester and how long ago. */}
        <p className="text-meta font-semibold text-ink-3">
          C-{c.number} · requested by {c.createdByName}, {timeAgo(c.createdAt)}
        </p>
        <h3 className="mt-1.5 text-title font-bold">{c.title}</h3>
      </div>
      {/* <dl> = description list: <dt> is the term, <dd> its value. Two stat cards side by side. */}
      <dl className="grid grid-cols-2 gap-3">
        <div className="card px-4 py-3">
          <dt className="text-2xs font-semibold text-ink-3">cost</dt>
          {/* Cost impact with sign, in short form. */}
          <dd className="num mt-1 font-display text-stat font-semibold">{formatPKR(c.costImpactPaisa, { compact: true, sign: true })}</dd>
        </div>
        <div className="card px-4 py-3">
          <dt className="text-2xs font-semibold text-ink-3">time</dt>
          {/* Days impact: a '+' for positive numbers, then the number and "days". */}
          <dd className="num mt-1 font-display text-stat font-semibold">
            {c.daysImpact > 0 ? '+' : ''}
            {c.daysImpact} days
          </dd>
        </div>
      </dl>
      {/* Description; whitespace-pre-line keeps the line breaks the author typed. */}
      <p className="text-body leading-relaxed whitespace-pre-line text-ink-2">{c.description}</p>
      {/* Optional reason. */}
      {c.reason && <p className="text-meta text-ink-3">Why: {c.reason}</p>}
      {/* Evidence thumbnails if any were attached. */}
      {c.evidence.length > 0 && <EvidenceTiles projectId={project.id} evidence={c.evidence} />}
      <p className="text-meta text-ink-3">Approving doesn't change your budget. Approved changes are shown next to it.</p>
    </div>
  )
}

// Sheet body for a milestone payment request; m comes from the inbox data (undefined once decided).
function MilestoneReview({ m }) {
  // Already decided (no longer in the pending list).
  if (!m) return <p className="text-body text-ink-2">This request has already been decided.</p>
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta font-semibold text-ink-3">Requested {timeAgo(m.requestedAt)}</p>
      <h3 className="text-title font-bold">{m.name}</h3>
      {/* Requested amount. */}
      <p className="num font-display text-display font-semibold text-accent-700">{formatPKR(m.amountPaisa)}</p>
      <p className="text-body text-ink-2">The contractor says this stage is complete. Approve it, then record the payment with its proof.</p>
    </div>
  )
}

// Sheet body for an inspector's access request.
function AccessReview({ a }) {
  // Already answered.
  if (!a) return <p className="text-body text-ink-2">This request has already been answered.</p>
  return (
    <div className="flex flex-col gap-4">
      {/* Who asked and when. */}
      <p className="text-meta font-semibold text-ink-3">
        {a.userName}, inspector · {timeAgo(a.requestedAt)}
      </p>
      {/* What they want to see. */}
      <h3 className="text-title font-bold">Share the {scopeLabel(a.scope)}?</h3>
      {/* Their reason, in a bordered quote box, if given. */}
      {a.reason && <p className="rounded-tile border border-line bg-white px-4 py-3 text-body text-ink-2">“{a.reason}”</p>}
      {/* Scope description (?. in case the scope is unknown) plus a reassurance note. */}
      <p className="text-meta text-ink-3">
        {ACCESS_SCOPES[a.scope]?.description}. Money is never shown to inspectors, and you can stop sharing at any time from Settings.
      </p>
    </div>
  )
}

// Footer for access requests: choose a duration and share, or decline with a note.
function AccessDecision({ a, onDone }) {
  // Current project.
  const { project } = useProjectContext()
  // Mutation for deciding access requests.
  const decide = useDecideAccess(project.id)
  // Chosen sharing length in days (default a week).
  const [days, setDays] = useState(7)
  // true while showing the "decline" form.
  const [declining, setDeclining] = useState(false)
  // Optional note for the inspector.
  const [note, setNote] = useState('')
  // Awaited: once answered, the request leaves the pending list and this footer unmounts.
  // `async` function: inside it, `await` pauses until a Promise settles. decision is 'APPROVE' or 'DENY'.
  const run = async (decision) => {
    // try/catch: if the awaited call throws (request failed), jump to catch.
    try {
      // mutateAsync is the Promise-returning version of mutate. days only for approvals; empty note → undefined.
      await decide.mutateAsync({ id: a.id, decision, days: decision === 'APPROVE' ? days : undefined, note: note.trim() || undefined })
    } catch (err) {
      // Show the error and stop (return ends the function).
      return toast.error(err.message)
    }
    // Success message depends on the decision.
    toast.success(decision === 'APPROVE' ? `Shared with ${a.userName} for ${DAYS_LABEL[days]}` : 'Request declined')
    // Close the sheet.
    onDone()
  }
  // Decline mode: note field plus back / decline buttons.
  if (declining) {
    return (
      <div className="flex w-full flex-col gap-3">
        <Field label="Note for the inspector" optional>
          {/* Controlled multi-line text box, 2 rows tall. */}
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          {/* Leave decline mode. */}
          <Button variant="secondary" className="flex-1" onClick={() => setDeclining(false)}>
            back
          </Button>
          {/* Send the denial. */}
          <Button variant="danger" className="flex-1" loading={decide.isPending} onClick={() => run('DENY')}>
            decline
          </Button>
        </div>
      </div>
    )
  }
  // Default mode: duration picker, share button, decline link.
  return (
    <div className="flex w-full flex-col gap-3">
      {/* onChange={setDays} passes the state setter directly; options are built from ACCESS_DAYS with .map. */}
      <Segmented label="Share for" value={days} onChange={setDays} className="self-center" options={ACCESS_DAYS.map((d) => ({ value: d, label: DAYS_LABEL[d] }))} />
      {/* Approve for the chosen duration. */}
      <Button variant="primary" block loading={decide.isPending} onClick={() => run('APPROVE')}>
        share for {DAYS_LABEL[days]}
      </Button>
      {/* Switch to decline mode. */}
      <Button variant="danger-text" block onClick={() => setDeclining(true)}>
        decline
      </Button>
    </div>
  )
}

// History list of past decisions.
function Decided({ decided, onHide }) {
  // Per decision: a two-item array [IconComponent, tone].
  const ICON = { APPROVE: [Check, 'ink'], REJECT: [X, 'danger'], QUERY: [MessageCircleQuestion, 'warn'] }
  // Per decision: readable label.
  const LABEL = { APPROVE: 'Approved', REJECT: 'Rejected', QUERY: 'Question asked' }
  return (
    <section className="flex flex-col gap-3">
      {/* Header row with a "hide" button. */}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="head">Decided</h2>
        <button type="button" onClick={onHide} className="text-meta font-semibold text-accent-700 hover:text-accent-800">
          hide
        </button>
      </div>
      <ListCard>
        {/* One row per decision; block-bodied arrow function with an explicit return. */}
        {decided.map((d) => {
          // Array destructuring into Icon (capitalised so JSX treats it as a component) and tone, with a fallback pair.
          const [Icon, tone] = ICON[d.decision] ?? [Check, 'neutral']
          return (
            <ListRow
              // Unique key.
              key={d.id}
              // Small icon tile using the chosen component.
              leading={<IconTile icon={Icon} tone={tone} size="sm" />}
              // What was decided, or just the label.
              title={d.targetLabel ?? LABEL[d.decision]}
              // "Approved by Name, 2 days ago · “note”" (note part only if present).
              subtitle={`${LABEL[d.decision]} by ${d.decidedByName}, ${timeAgo(d.createdAt)}${d.note ? ` · “${d.note}”` : ''}`}
              // Amount if there is one; != null (loose) is true for anything except null and undefined.
              trailing={d.amountPaisa != null ? <span className="num text-meta font-bold">{formatPKR(d.amountPaisa, { compact: true })}</span> : null}
            />
          )
        })}
      </ListCard>
    </section>
  )
}
