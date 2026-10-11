// =============================================================================
// InspectionsPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/inspections  (the inspector's start page for a project).
//
// What it shows: three headline figures (to inspect / passed / needed fixes),
// the steps waiting for an inspection (new ones and re-checks after fixes),
// and every inspection already recorded with its result, newest first. Each
// waiting step opens /p/:id/verify/inspection/<stageIndex>:<step>, where the
// inspector records the result.
//
// Who can see it: the inspector (engineer) on projects with inspections turned
// on.
//
// Data it loads: the project plan via the usePlan query hook; it contains the
// inspection queue and, for every stage and step, the inspections recorded.
//
// Depends on: React (useMemo), lucide-react, the UI kit, i18n and the date
// formatter.
// =============================================================================

// useMemo caches a computed value until its dependencies change.
import { useMemo } from 'react'
// Icon components.
import { ClipboardCheck, RotateCcw } from 'lucide-react'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { EmptyState, ErrorState, IconTile, ListCard, ListRow, PageSkeleton, SectionHead, StatRow, StatusChip } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Short date formatter ("3 Oct").
import { formatShortDate } from '../../lib/format.js'
// Query hook for the project plan.
import { usePlan } from '../../lib/queries.js'

/** The inspector's start page: steps waiting for a check, then what's been checked. */
// The page component (default export).
export default function InspectionsPage() {
  // Destructure the project from context.
  const { project } = useProjectContext()
  // Translators.
  const { t, term } = useI18n()
  // Fetch the plan.
  const { data, isLoading, error, refetch } = usePlan(project.id)

  // All recorded inspections in one flat list, newest first. useMemo(fn, [data]) recomputes only when data changes.
  // (This hook runs before the early returns below, because hooks must be called in the same order on every render.)
  const done = useMemo(
    () =>
      // Start from the stages (or an empty array while loading).
      (data?.stages ?? [])
        // For each stage, for each step, copy each inspection and add the stage label (spread `...i` copies its fields).
        // The nested flatMaps flatten "stages -> steps -> inspections" into one list.
        .flatMap((s) => s.steps.flatMap((step) => step.inspections.map((i) => ({ ...i, stage: s.label }))))
        // .sort with a compare function: subtracting dates gives a number; b - a puts the newest first.
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    // Dependency array.
    [data],
  )
  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Steps waiting for inspection.
  const queue = data.inspectionQueue
  // Arrow function building the record-inspection URL; encodeURIComponent escapes spaces and symbols in the step name.
  const verifyLink = (item) => `/p/${project.id}/verify/inspection/${item.stageIndex}:${encodeURIComponent(item.step)}`
  return (
    <Page width="narrow">
      {/* Title plus "name, area, city"; a nested template literal adds "area, " only when there is an area. */}
      <PageTitle title={t('nav.inspections')} kicker={`${project.name}, ${project.area ? `${project.area}, ` : ''}${project.city}`} />
      {/* Headline figures. */}
      <StatRow
        // Reveal animation marker.
        data-reveal
        // Margin below.
        className="mb-7"
        // Array of stats.
        items={[
          // Waiting count, red when above zero.
          { value: queue.length, label: 'to inspect', tone: queue.length ? 'danger' : undefined },
          // How many passed.
          { value: done.filter((i) => i.result === 'PASS').length, label: 'passed' },
          // How many did not pass.
          { value: done.filter((i) => i.result !== 'PASS').length, label: 'needed fixes' },
        ]}
      />

      {/* Waiting steps. */}
      <section data-reveal className="flex flex-col gap-3">
        <SectionHead title="To inspect" />
        {/* Ternary: compact empty state, or the list. */}
        {queue.length === 0 ? (
          <div className="card">
            <EmptyState icon={ClipboardCheck} compact title="Nothing to inspect right now" description="Steps that need an engineer appear here once the site team marks them done." />
          </div>
        ) : (
          <ListCard>
            {/* One row per waiting step. */}
            {queue.map((item) => (
              <ListRow
                // Unique key built from stage index and step name.
                key={`${item.stageIndex}:${item.step}`}
                // Link to record the inspection.
                to={verifyLink(item)}
                // Re-check icon (orange) if inspected before, otherwise a clipboard (accent).
                leading={<IconTile icon={item.last ? RotateCcw : ClipboardCheck} tone={item.last ? 'warn' : 'accent'} />}
                // Step name.
                title={term(item.step)}
                // Re-checks show the previous notes (or "after fixes"); new ones say "done, not inspected yet".
                subtitle={item.last ? `${term(item.stage)} · re-check: ${item.last.notes ?? 'after fixes'}` : `${term(item.stage)} · done, not inspected yet`}
                // Last result or 'NONE'.
                trailing={<StatusChip kind="inspection" status={item.last?.result ?? 'NONE'} />}
                // ">" arrow.
                chevron
              />
            ))}
          </ListCard>
        )}
      </section>

      {/* Already-checked list, only if there is anything. */}
      {done.length > 0 && (
        <section data-reveal className="mt-8 flex flex-col gap-3">
          {/* `${done.length}` turns the number into a string. */}
          <SectionHead title="Checked" meta={`${done.length}`} />
          <ListCard>
            {/* One row per recorded inspection (no link). */}
            {done.map((i) => (
              <ListRow
                // Unique key.
                key={i.id}
                // Step name.
                title={term(i.step)}
                // "Stage · date · inspector" plus the notes in quotes if any; `??` uses createdAt when inspectedOn is missing.
                subtitle={`${term(i.stage)} · ${formatShortDate(i.inspectedOn ?? i.createdAt)} · ${i.inspectorName}${i.notes ? ` · “${i.notes}”` : ''}`}
                // Pass / fail chip.
                trailing={<StatusChip kind="inspection" status={i.result} />}
              />
            ))}
          </ListCard>
        </section>
      )}
    </Page>
  )
}
