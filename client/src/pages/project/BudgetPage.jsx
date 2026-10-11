// =============================================================================
// BudgetPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/budget
//
// What it shows: the owner's own typed budget against committed spending
// (approved purchases plus purchases still waiting for approval): a big
// counted-up "spent" figure, how much of the budget is used, an "over budget"
// chip when relevant, a stacked bar (approved / waiting / left or over), a
// per-stage split (each stage's share of the budget, worked out in
// shared/budget.js on the server) and approved change requests shown
// separately beside it (they don't alter the budget).
//
// Who can see it: members with the "viewBudget" permission. The pencil button
// that links to the budget setting needs "manageProject".
//
// Data it loads: the project overview's `money` block via the useOverview
// query hook (the same data the home page uses).
//
// Depends on: lucide-react, the UI kit (CountUp, Meter, StackedBar, ...), i18n
// and the money format helpers.
// =============================================================================

// Icon components.
import { Flag, Pencil } from 'lucide-react'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit: CountUp animates a number, Meter is a progress bar, StackedBar shows several parts of a total.
import { Chip, CountUp, ErrorState, IconButton, ListCard, Meter, PageSkeleton, SectionHead, StackedBar } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Money helpers: amount() short money text, fixed() number formatter, formatPKR() rupees, moneyParts() number + unit.
import { amount, fixed, formatPKR, moneyParts } from '../../lib/format.js'
// Query hook for the project overview.
import { useOverview } from '../../lib/queries.js'

/** The owner's own budget against what has been spent, overall and by stage. */
// The page component (default export).
export default function BudgetPage() {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Building-term translator.
  const { term } = useI18n()
  // Fetch the overview.
  const { data, isLoading, error, refetch } = useOverview(project.id)
  // Loading placeholder.
  if (isLoading) return <PageSkeleton variant="detail" />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />
  // Short name for the money block.
  const m = data.money
  // Spent split into { n, digits, unit } for display.
  const spent = moneyParts(m.spent)

  return (
    <Page>
      {/* Heading. */}
      <PageTitle
        // Plain string title.
        title="Budget"
        // Pencil button to the settings page's #budget section, only for people who manage the project.
        actions={can('manageProject') && <IconButton icon={Pencil} label="Change the budget" to={`/p/${project.id}/settings#budget`} />}
      />
      {/* Main budget card. */}
      <section data-reveal className="card flex flex-col gap-5 p-5 sm:p-6">
        <div>
          {/* Big number and its unit side by side, aligned on the text baseline. */}
          <p className="flex items-baseline gap-2 font-display font-semibold">
            {/* Very large text, even larger on wider screens. */}
            <span className="text-display-lg sm:text-hero">
              {/* Animated count up to the spent number, formatted with the right decimals. */}
              <CountUp value={spent.n} format={fixed(spent.digits)} />
            </span>
            {/* Unit such as "lakh" or "crore". */}
            <span className="title text-title">{spent.unit}</span>
          </p>
          {/* "spent of Rs 50 lakh budget · 42% used". */}
          <p className="mt-1.5 text-body text-ink-2">
            spent of {formatPKR(m.budget, { compact: true })} budget · {m.usedPct}% used
          </p>
          {/* Red chip when spending is over budget. */}
          {m.over > 0 && (
            <Chip tone="danger" size="md" className="mt-3">
              {formatPKR(m.over, { compact: true })} over budget
            </Chip>
          )}
        </div>
        {/* A horizontal bar split into approved, waiting and the remainder. */}
        <StackedBar
          // Accessible label.
          label="Budget"
          // The full width of the bar represents the budget.
          total={m.budget}
          // Function used to format numbers in the legend (passed, not called).
          format={amount}
          // Array of coloured segments (colours as hex strings).
          segments={[
            { key: 'approved', label: 'approved', value: m.approved, color: '#2447f5' },
            { key: 'waiting', label: 'waiting', value: m.waiting, color: '#c98500' },
          ]}
          // Label for the rest of the bar: "left", or "over" if spending exceeds the total.
          remainder={{ label: 'left', overLabel: 'over' }}
        />
      </section>

      {/* Per-stage split. */}
      <section data-reveal className="mt-8 flex flex-col gap-3">
        <SectionHead title="By stage" meta="spent of each stage's share" />
        <ListCard>
          {/* Block-body map: work out `over` first, then return the row. */}
          {m.byStage.map((s) => {
            // Has this stage spent more than its share?
            const over = s.spent > s.budget
            return (
              // A plain list item, keyed by stage index.
              <li key={s.index} className="px-4 py-3.5">
                {/* Stage name left, "spent of share" right. */}
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body font-semibold">{term(s.label)}</span>
                  {/* Ternary picks the whole class string: bold red when over, grey otherwise. */}
                  <span className={over ? 'num text-meta font-bold text-danger-700' : 'num text-meta text-ink-3'}>
                    {amount(s.spent)} of {amount(s.budget)}
                  </span>
                </div>
                {/* Progress bar for this stage; red when over; label is read by screen readers. */}
                <Meter value={s.spent} max={s.budget} tone={over ? 'danger' : 'accent'} size="sm" className="mt-2" label={`${s.label}: ${amount(s.spent)} of ${amount(s.budget)}`} />
              </li>
            )
          })}
        </ListCard>
      </section>

      {/* Approved change requests card, only if there are any. */}
      {m.approvedChanges.count > 0 && (
        <section data-reveal className="mt-6">
          <div className="card flex items-center gap-3 px-4 py-4">
            {/* Round grey circle with a flag icon. */}
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sunken">
              <Flag size={17} aria-hidden />
            </span>
            {/* Two lines of text filling the middle. */}
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">Approved changes</span>
              <span className="block text-meta text-ink-3">Shown separately, budget unchanged</span>
            </span>
            {/* Total of approved changes; sign: true adds a + or - in front. */}
            <span className="num text-body font-bold">{formatPKR(m.approvedChanges.total, { compact: true, sign: true })}</span>
          </div>
        </section>
      )}
    </Page>
  )
}
