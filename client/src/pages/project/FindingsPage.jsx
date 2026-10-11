// =============================================================================
// FindingsPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/findings  (optionally ?show=DISMISSED to see resolved ones).
//
// What it shows: everything the server's automatic checks noticed — duplicate
// invoices, unusually high prices, photos taken away from the site, entries
// made late — each with a link to the purchase or report it is about. Open
// findings are listed by default; a filter switches to resolved ones.
//
// Who can see it: project members who can open findings. Only people with the
// "decide" permission (normally the owner) see the "dismiss" button, which
// asks for a note explaining why the flag is fine.
//
// Data it loads: the findings list via the useFindings query hook; dismissing
// uses the useDismissFinding mutation hook.
//
// Depends on: React (useState), React Router (Link, useSearchParams),
// lucide-react, the UI kit, i18n and the format helpers.
// =============================================================================

// useState keeps a value between renders and re-renders when it changes.
import { useState } from 'react'
// Link for in-app navigation; useSearchParams for the "?show=" part of the URL.
import { Link, useSearchParams } from 'react-router'
// Icon components.
import { CircleCheck, ShieldCheck, TriangleAlert } from 'lucide-react'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { ConfirmDialog, EmptyState, ErrorState, FilterChips, IconTile, PageSkeleton, StatusChip } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Date, rupee and "time ago" formatters.
import { formatDate, formatPKR, timeAgo } from '../../lib/format.js'
// Mutation hook (dismiss) and query hook (list findings).
import { useDismissFinding, useFindings } from '../../lib/queries.js'

/** Everything the automatic checks noticed, open ones first. */
// The page component (default export).
export default function FindingsPage() {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Translate function.
  const { t } = useI18n()
  // Query-string params and their setter (array destructuring).
  const [params, setParams] = useSearchParams()
  // Which list to show: ?show= value, defaulting to 'OPEN'.
  const show = params.get('show') ?? 'OPEN'
  // Fetch all findings.
  const { data, isLoading, error, refetch } = useFindings(project.id)
  // Mutation object for dismissing (dismiss.mutate, isPending, error).
  const dismiss = useDismissFinding(project.id)
  // The finding being dismissed (null = dialog closed).
  const [target, setTarget] = useState(null)

  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Only the open findings (used for the count on the filter chip).
  const open = data.filter((f) => f.status === 'OPEN')
  // Rows to show: open ones, or everything that isn't open, depending on the filter.
  const rows = data.filter((f) => (show === 'OPEN' ? f.status === 'OPEN' : f.status !== 'OPEN'))
  // Arrow function returning a { to, label } link description for what the finding is about, or null.
  // The chained ternary checks EXPENSE first, then REPORT, else null.
  const targetOf = (f) =>
    f.targetType === 'EXPENSE'
      // Purchase link, e.g. "P-12 · Ali Traders · Rs 45k".
      ? { to: `/p/${project.id}/purchases/${f.targetId}`, label: `P-${f.expenseNumber} · ${f.supplierName} · ${formatPKR(f.totalPaisa, { compact: true })}` }
      : f.targetType === 'REPORT'
        // Report link, e.g. "Daily report · 3 Oct 2026".
        ? { to: `/p/${project.id}/reports/${f.targetId}`, label: `Daily report · ${formatDate(f.reportDate)}` }
        // Anything else has no link.
        : null

  return (
    <Page width="narrow">
      {/* Heading with a short explanation of what findings are. */}
      <PageTitle title={t('nav.findings')} description="Automatic checks on prices, duplicates, timing and photo locations. Worth a look, not an accusation." />
      {/* Open / resolved switch. */}
      <FilterChips
        // Reveal animation marker.
        data-reveal
        // Margin below.
        className="mb-5"
        // Accessible label.
        label="Show"
        // Selected option.
        value={show}
        // Choosing OPEN clears the query string ({}); otherwise sets ?show=v. replace avoids extra history entries.
        onChange={(v) => setParams(v === 'OPEN' ? {} : { show: v }, { replace: true })}
        // The two options; the first shows a count badge.
        options={[
          { value: 'OPEN', label: 'to look at', count: open.length },
          { value: 'DISMISSED', label: 'resolved' },
        ]}
      />
      {/* Ternary: empty state or the list. */}
      {rows.length === 0 ? (
        <div data-reveal className="card">
          {/* Wording depends on which filter is active; no description for the resolved list (undefined). */}
          <EmptyState icon={ShieldCheck} title={show === 'OPEN' ? 'Nothing to look at' : 'Nothing resolved yet'} description={show === 'OPEN' ? 'New flags appear here when a purchase or report looks unusual.' : undefined} />
        </div>
      ) : (
        // A card-styled <ul> (unordered list) with divider lines between items.
        <ul data-reveal className="card divide-y divide-line">
          {/* .map with a block body so we can compute `where` before returning the JSX. */}
          {rows.map((f) => {
            // Link description for this finding (or null).
            const where = targetOf(f)
            return (
              // One list item per finding; key is required on the outermost element.
              <li key={f.id} className="flex gap-3 px-4 py-4">
                {/* Warning icon for open findings, check icon for resolved ones. */}
                <IconTile icon={f.status === 'OPEN' ? TriangleAlert : CircleCheck} tone={f.status === 'OPEN' ? 'warn' : 'neutral'} size="sm" />
                {/* Middle text column that can shrink (min-w-0) and grows to fill space (flex-1). */}
                <div className="min-w-0 flex-1">
                  {/* What was noticed. */}
                  <p className="text-body leading-snug font-semibold">{f.message}</p>
                  {/* Link to the purchase/report, if there is one; `truncate` cuts long text with "...". */}
                  {where && (
                    <Link to={where.to} className="mt-1 block truncate text-meta font-semibold text-accent-700 hover:text-accent-800">
                      {where.label}
                    </Link>
                  )}
                  {/* For resolved ones: who resolved it and why; otherwise how long ago it was found. */}
                  <p className="mt-1 text-meta text-ink-3">{f.status === 'DISMISSED' ? `Resolved by ${f.dismissedByName}: ${f.dismissNote}` : timeAgo(f.createdAt)}</p>
                </div>
                {/* Right column: status chip and dismiss button; shrink-0 stops it from shrinking. */}
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {/* Open findings show their severity; resolved show DISMISSED. */}
                  <StatusChip kind="finding" status={f.status === 'OPEN' ? f.severity : 'DISMISSED'} />
                  {/* Dismiss link-button for open findings, for people who can decide. */}
                  {f.status === 'OPEN' && can('decide') && (
                    // type="button" stops it acting as a form submit; clicking remembers this finding, which opens the dialog.
                    <button type="button" onClick={() => setTarget(f)} className="text-meta font-semibold text-accent-700 hover:text-accent-800">
                      dismiss
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {/* Confirmation dialog that asks for a note. */}
      <ConfirmDialog
        // `!!target` is true when a finding is chosen.
        open={!!target}
        // When the dialog closes (o is false), clear the target; `!o && ...` only runs setTarget when o is false.
        onOpenChange={(o) => !o && setTarget(null)}
        // Dialog title.
        title="Dismiss this flag?"
        // Show the finding's message (`?.` because target may be null).
        description={target?.message}
        // Label for the note text box.
        noteLabel="Why is it fine?"
        // Example text shown inside the empty note box.
        notePlaceholder="e.g. Steel prices went up across the market this month."
        // Boolean prop: a note must be written before confirming.
        requireNote
        // Confirm button text.
        confirmLabel="dismiss flag"
        // Spinner while the request runs.
        loading={dismiss.isPending}
        // Server error message, if the last attempt failed.
        error={dismiss.error?.message}
        // The dialog passes the typed note; mutate sends { id, note } (shorthand `note` = `note: note`) and closes the dialog on success.
        onConfirm={(note) => dismiss.mutate({ id: target.id, note }, { onSuccess: () => setTarget(null) })}
      />
    </Page>
  )
}
