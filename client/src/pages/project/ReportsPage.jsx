// =============================================================================
// ReportsPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/reports
//
// What it shows: all daily site reports, grouped by month (newest first), one
// row per report with a little calendar tile (weekday + day number), the stage
// and its progress change, author, workers, photo count, an "issue reported"
// note, the first photo as a thumbnail (on wider screens) and a status chip.
// Each row opens the report's detail page (/p/:id/reports/:reportId).
//
// Who can see it: members with the "viewReports" permission. The "+" (new
// report) button only appears for people with "submitReport".
//
// Data it loads: the reports list via the useReports query hook. Thumbnails
// are fetched as images from the API's file URL.
//
// Depends on: lucide-react, the shared stage list, the UI kit, i18n, the API
// file URL helper, groupByMonth and the format helpers.
// =============================================================================

// Icon components.
import { ClipboardList, Plus } from 'lucide-react'
// Stage list for a project.
import { stagesFor } from '@shared/features.js'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { Button, EmptyState, ErrorState, IconButton, ListCard, ListRow, PageSkeleton, SectionHead, StatusChip } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Builds the URL of an uploaded file (used for photo thumbnails).
import { fileUrl } from '../../lib/api.js'
// Groups a list of reports into months.
import { groupByMonth } from '../../lib/derive.js'
// Weekday formatter ("Mon") and plural(n, 'word').
import { formatWeekday, plural } from '../../lib/format.js'
// Query hook for the reports list.
import { useReports } from '../../lib/queries.js'

// The page component (default export).
export default function ReportsPage() {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Translators.
  const { t, term } = useI18n()
  // Fetch reports.
  const { data, isLoading, error, refetch } = useReports(project.id)
  // The project's stage list, to name each report's stage.
  const stages = stagesFor(project)
  // Reports URL, reused for links.
  const base = `/p/${project.id}/reports`

  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Array of { key, label, items } groups, one per month.
  const months = groupByMonth(data)

  return (
    <Page>
      {/* Heading. */}
      <PageTitle
        // Translated "Reports".
        title={t('nav.reports')}
        // "+" button only for people who can submit reports (`false` from && renders nothing).
        actions={can('submitReport') && <IconButton icon={Plus} label="New daily report" to={`${base}/new`} variant="solid" />}
      />
      {/* Ternary: empty state when there are no reports, otherwise the month groups. */}
      {data.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState
            // Clipboard icon.
            icon={ClipboardList}
            // Heading.
            title="No reports yet"
            // Helper text.
            description="Daily reports from the site appear here, with photos."
            // A "write the first report" button for people who can submit.
            action={
              can('submitReport') && (
                <Button variant="primary" to={`${base}/new`}>
                  write the first report
                </Button>
              )
            }
          />
        </div>
      ) : (
        // Vertical stack of month sections.
        <div className="flex flex-col gap-8">
          {/* One section per month. */}
          {months.map((m) => (
            // aria-labelledby points screen readers at the heading with the matching id.
            <section key={m.key} data-reveal className="flex flex-col gap-3" aria-labelledby={`m-${m.key}`}>
              {/* Month name with "N reports"; the id links it to the section above. */}
              <SectionHead id={`m-${m.key}`} title={m.label} meta={plural(m.items.length, 'report')} />
              <ListCard>
                {/* Block-body map: compute the photo first, then return the row. */}
                {m.items.map((r) => {
                  // photoIds is a comma-separated string; .split(',') makes an array and [0] takes the first id. `?.` handles a missing value.
                  const photo = r.photoIds?.split(',')[0]
                  return (
                    <ListRow
                      // Unique key.
                      key={r.id}
                      // Link to the report.
                      to={`${base}/${r.id}`}
                      // Small calendar tile: grey rounded square with the weekday on top and the day number below.
                      leading={
                        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-sunken leading-none">
                          {/* Tiny upper-case weekday. */}
                          <span className="text-[10px] font-bold text-ink-3 uppercase">{formatWeekday(r.reportDate)}</span>
                          {/* Day of month: characters 8-10 of "YYYY-MM-DD", and Number() turns "03" into 3. */}
                          <span className="num mt-0.5 font-display text-title font-semibold">{Number(r.reportDate.slice(8, 10))}</span>
                        </span>
                      }
                      // "Walls 40% → 55%"; `?.label ?? ''` guards against an unknown stage.
                      title={`${term(stages[r.stageIndex]?.label ?? '')} ${r.progressBefore}% → ${r.progressAfter}%`}
                      // Author · workers · photos · issue note, skipping missing parts (filter(Boolean)) and joining with dots.
                      subtitle={[r.authorName, r.workerCount != null && plural(r.workerCount, 'worker'), plural(r.photoCount, 'photo'), r.issues && 'issue reported'].filter(Boolean).join(' · ')}
                      // Thumbnail and status chip on the right.
                      trailing={
                        <span className="flex items-center gap-2.5">
                          {/* First photo, hidden on phones (hidden sm:block). alt="" marks it decorative; loading="lazy" delays loading until it's near the screen. */}
                          {photo && <img src={fileUrl(project.id, photo)} alt="" className="hidden h-12 w-16 rounded-lg object-cover sm:block" loading="lazy" />}
                          {/* Report status. */}
                          <StatusChip kind="report" status={r.status} />
                        </span>
                      }
                    />
                  )
                })}
              </ListCard>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
