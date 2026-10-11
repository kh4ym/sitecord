// =============================================================================
// ReportDetailPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/reports/:reportId  (":reportId" is the daily report's id).
//
// What it shows: one daily site report: the stage and its progress change
// (e.g. 40% -> 55%), the work done, number of workers, weather, problems
// reported, photos, materials used, linked questions, the history, and the
// verify / ask actions.
//
// Who can see it: members with the "viewReports" permission. Photos need
// "viewPhotos" as well; people without it (e.g. an inspector the owner hasn't
// shared photos with) see a locked card that explains how to ask for access.
//
// Data it loads: the report via the useReport query hook; the photo sharing
// state via useScopeState('PHOTOS') inside LockedPhotos.
//
// Depends on: React Router (Link, useParams), lucide-react, the shared stage
// list, access/decision/evidence components, the UI kit, i18n and the format
// helpers.
// =============================================================================

// Link renders an <a> that changes page without a full reload; useParams reads URL parameters.
import { Link, useParams } from 'react-router'
// Icon components.
import { ChevronRight, Lock, MessageCircleQuestion } from 'lucide-react'
// Returns the list of stages for a project.
import { stagesFor } from '@shared/features.js'
// Hook telling whether a kind of data (like photos) has been shared with this user.
import { useScopeState } from '../../components/access/AccessLocked.jsx'
// Verify / ask buttons.
import { DecisionActions } from '../../components/DecisionActions.jsx'
// History list.
import { DecisionTimeline } from '../../components/DecisionTimeline.jsx'
// Photo thumbnails.
import { EvidenceTiles } from '../../components/evidence/EvidenceGallery.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { ErrorState, ListCard, ListRow, Notice, PageSkeleton, SectionHead, StatusChip } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// formatDate, formatNumber, and plural(n, 'word') -> "3 words".
import { formatDate, formatNumber, plural } from '../../lib/format.js'
// Query hook for one report.
import { useReport } from '../../lib/queries.js'

// The page component (default export).
export default function ReportDetailPage() {
  // Destructure the report id from the URL.
  const { reportId } = useParams()
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Translator for building terms.
  const { term } = useI18n()
  // Fetch the report, renaming `data` to `r`.
  const { data: r, isLoading, error, refetch } = useReport(project.id, reportId)
  // Loading placeholder.
  if (isLoading) return <PageSkeleton variant="detail" />
  // Error with a retry button.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Call stagesFor(project), then index the returned array with [r.stageIndex] to get this report's stage.
  const stage = stagesFor(project)[r.stageIndex]
  // True when the user is NOT allowed to see photos.
  const photosLocked = !can('viewPhotos')
  return (
    <Page>
      {/* Heading block. */}
      <PageTitle
        // Back arrow to the reports list.
        back={{ to: `/p/${project.id}/reports`, label: 'Back to reports' }}
        // "Daily report · <author>".
        kicker={`Daily report · ${r.authorName}`}
        // The date as the title.
        title={formatDate(r.reportDate)}
        // Browser tab title.
        documentTitle={`Report ${r.reportDate}`}
        // A Fragment `<>...</>` lets us pass two elements as a single prop value.
        meta={
          <>
            {/* Report status chip. */}
            <StatusChip kind="report" status={r.status} size="md" />
            {/* e.g. "Walls 40% → 55% · stage finished"; the last part only appears when the stage was completed. */}
            <span className="text-meta text-ink-3">
              {term(stage.label)} {r.progressBefore}% → {r.progressAfter}%{r.stageCompleted ? ' · stage finished' : ''}
            </span>
          </>
        }
      />
      {/* Two columns on large screens. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        {/* Left column. */}
        <div className="flex flex-col gap-6">
          {/* Work done section. */}
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="Work done" />
            <div className="card flex flex-col gap-3 px-5 py-4">
              {/* The written summary, keeping its line breaks. */}
              <p className="text-body leading-relaxed whitespace-pre-line">{r.summary}</p>
              {/* "5 workers on site · sunny". `!= null` is true unless the value is null or undefined (so 0 workers still shows); falsy parts are filtered out. */}
              <p className="text-meta text-ink-3">{[r.workerCount != null && `${plural(r.workerCount, 'worker')} on site`, r.weather && term(r.weather)].filter(Boolean).join(' · ')}</p>
              {/* Warning box only if problems were reported. */}
              {r.issues && (
                <Notice tone="warn" title="Problems reported">
                  {r.issues}
                </Notice>
              )}
            </div>
          </section>

          {/* Photos section. */}
          <section data-reveal className="flex flex-col gap-3">
            {/* Count with singular/plural word. */}
            <SectionHead title="Photos" meta={`${r.photoCount} ${r.photoCount === 1 ? 'photo' : 'photos'}`} />
            {/* Ternary: locked card or the real thumbnails. */}
            {photosLocked ? <LockedPhotos count={r.photoCount} /> : <EvidenceTiles projectId={project.id} evidence={r.evidence} />}
          </section>

          {/* Materials used, if any. */}
          {r.materials.length > 0 && (
            <section data-reveal className="flex flex-col gap-3">
              <SectionHead title="Materials used" />
              <ListCard>
                {/* One row per material: description on the left, quantity and unit on the right; key is the bill-of-quantities item id. */}
                {r.materials.map((m) => (
                  <ListRow key={m.boqItemId} title={m.description} trailing={<span className="num font-bold">{`${formatNumber(m.qty)} ${m.unit}`}</span>} />
                ))}
              </ListCard>
            </section>
          )}

          {/* Linked questions, if any. */}
          {r.questions.length > 0 && (
            <section data-reveal className="flex flex-col gap-3">
              <SectionHead title="Questions" />
              <ListCard>
                {/* One link row per question. */}
                {r.questions.map((q) => (
                  <ListRow
                    // Unique key.
                    key={q.id}
                    // Link to the question page.
                    to={`/p/${project.id}/questions/${q.id}`}
                    // Grey icon on the left.
                    leading={<MessageCircleQuestion size={18} className="text-ink-3" aria-hidden />}
                    // Question text.
                    title={q.title}
                    // Status chip on the right.
                    trailing={<StatusChip kind="question" status={q.status} />}
                    // ">" arrow.
                    chevron
                  />
                ))}
              </ListCard>
            </section>
          )}
        </div>

        {/* Right sidebar, sticky on large screens. */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-8">
          <div data-reveal>
            {/* Verify / ask buttons for this report. */}
            <DecisionActions targetType="REPORT" targetId={r.id} status={r.status} label={`the report for ${formatDate(r.reportDate)}`} layout="bar" />
          </div>
          {/* History. */}
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="History" />
            {/* Created by the author at createdAt, then any decisions. */}
            <DecisionTimeline created={{ by: r.authorName, at: r.createdAt }} decisions={r.decisions} />
          </section>
        </aside>
      </div>
    </Page>
  )
}

/** For an inspector shown the reports but not the photos: say so, and how to ask. */
// Destructure the `count` prop.
function LockedPhotos({ count }) {
  // Current project.
  const { project } = useProjectContext()
  // Destructure the latest access request for photos (may be undefined).
  const { latest } = useScopeState('PHOTOS')
  return (
    // The whole card is a link to the More page, where access can be requested.
    <Link to={`/p/${project.id}/more`} className="card flex items-center gap-3 px-4 py-4">
      {/* Round grey circle holding a lock icon. */}
      <span className="grid h-10 w-10 place-items-center rounded-full bg-sunken">
        <Lock size={17} aria-hidden />
      </span>
      {/* Text area that takes the remaining width (min-w-0 lets long text shrink). */}
      <span className="min-w-0 flex-1">
        {/* e.g. "4 photos, shared on request". */}
        <span className="block text-body font-semibold">{plural(count, 'photo')}, shared on request</span>
        {/* If a request is pending say so, otherwise invite the user to ask. */}
        <span className="block text-meta text-ink-3">{latest?.state === 'PENDING' ? 'You asked; the owner hasn’t answered yet.' : 'Ask the owner to share site photos with you.'}</span>
      </span>
      {/* Arrow on the right; rtl:-scale-x-100 mirrors it for right-to-left languages like Urdu. */}
      <ChevronRight size={18} className="text-ink-4 rtl:-scale-x-100" aria-hidden />
    </Link>
  )
}
