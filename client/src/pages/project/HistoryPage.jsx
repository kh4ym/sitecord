// /p/:id/history (viewAudit; inspectors on request). The hash-chained audit
// log grouped by day with filters, and a one-tap integrity check that walks the
// chain on the server.
//
// FILE OVERVIEW
// What it does: shows the project's audit log, the permanent record of
//   everything that happened (purchases, approvals, progress, people, access).
//   Each entry stores a "seal" (a hash) that includes the previous entry's seal,
//   so changing any old entry would break every seal after it ("hash chain").
//   The page shows:
//     - IntegrityCheck: a card with a button that asks the server to re-check
//       the whole chain, and then shows the result and the latest seal.
//     - filter chips (all / money / progress / people / access), kept in the
//       URL as ?type=..., so the filter survives a reload or a shared link;
//     - the entries grouped by day; tapping an entry (Event) expands its
//       details (sequence number, action, time, seal, previous seal, payload).
// Route: /p/:id/history (optionally ?type=money|progress|people|access).
// Who can see it: people with the viewAudit permission; inspectors only when
//   the owner has shared it, in which case the server returns a "limited" log
//   without money entries.
// Data it loads: useAudit (entries, total, limited flag) and the
//   useVerifyChain mutation from lib/queries.js.
// Depends on: React hooks, React Router search params, sonner toasts, lucide
//   icons, role labels, the UI kit, i18n, project context, groupByDay from
//   lib/derive.js and format helpers.

// React hooks.
import { useMemo, useState } from 'react'
// useSearchParams reads/writes the "?type=..." part of the URL, like useState but stored in the address bar.
import { useSearchParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icon components.
import { Bot, ChevronDown, Copy, Fingerprint, ShieldAlert, ShieldCheck } from 'lucide-react'
// Role key -> readable label.
import { ROLE_LABELS } from '@shared/permissions.js'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { Avatar, Button, EmptyState, ErrorState, FilterChips, Notice, PageSkeleton, SectionHead } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// groupByDay(events) -> [{ key, label, items }] one group per calendar day.
import { groupByDay } from '../../lib/derive.js'
// Formatting helpers: class joiner, date+time, time, and a shortened hash.
import { cn, formatDateTime, formatTime, shortHash } from '../../lib/format.js'
// Query (the audit log) and mutation (verify the chain).
import { useAudit, useVerifyChain } from '../../lib/queries.js'

/** The hash-chained record of everything that happened, with a one-tap integrity check. */
// The page component.
export default function HistoryPage() {
  // Current project.
  const { project } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Like useState: `params` is the current query string, `setParams` replaces it.
  const [params, setParams] = useSearchParams()
  // Current filter from ?type=..., or '' when absent (params.get returns null, `??` replaces it).
  const type = params.get('type') ?? ''
  // Load the log; '' becomes undefined (= no filter) using `||`.
  const { data, isLoading, error, refetch } = useAudit(project.id, type || undefined)

  // Group entries by day; recomputed only when data changes. `data?.events ?? []` is safe while loading.
  const days = useMemo(() => groupByDay(data?.events ?? []), [data])

  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  return (
    <Page width="narrow">
      {/* Heading; toLocaleString('en-PK') adds thousands separators to the total. */}
      <PageTitle title={t('nav.history')} kicker={`${data.total.toLocaleString('en-PK')} entries. Old ones can't be edited or deleted.`} />
      {/* The chain-check card (component below), given the total as a prop. */}
      <IntegrityCheck total={data.total} />
      {/* Explain the limited view to inspectors. */}
      {data.limited && (
        <Notice tone="neutral" className="mb-5">
          Shared with you by the owner: the build story. Money and payment details stay private.
        </Notice>
      )}
      {/* Filter chips. */}
      <FilterChips
        // Reveal animation marker.
        data-reveal
        className="mb-6"
        label="Show"
        // Current filter.
        value={type}
        // Write the filter into the URL: ?type=v, or no query at all for "all". replace:true swaps the history entry instead of adding one (Back button skips filter changes).
        onChange={(v) => setParams(v ? { type: v } : {}, { replace: true })}
        // Options array. The money option is `false` in the limited view; .filter(Boolean) then removes it.
        options={[
          { value: '', label: 'all' },
          !data.limited && { value: 'money', label: 'money' },
          { value: 'progress', label: 'progress' },
          { value: 'people', label: 'people' },
          { value: 'access', label: 'access' },
        ].filter(Boolean)}
      />
      {/* Empty state or the list of days. */}
      {days.length === 0 ? (
        <div data-reveal className="card">
          {/* `compact` = smaller empty state (boolean prop). */}
          <EmptyState title="Nothing here yet" compact />
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {/* One section per day. */}
          {days.map((d) => (
            <section key={d.key} data-reveal className="flex flex-col gap-3">
              {/* Day heading, e.g. "Today". */}
              <SectionHead title={d.label} />
              {/* <ol> = ordered list; divide-y draws lines between entries. */}
              <ol className="card divide-y divide-line">
                {/* One Event per entry, keyed by its sequence number. The prop is named `e`. */}
                {d.items.map((e) => (
                  <Event key={e.seq} e={e} />
                ))}
              </ol>
            </section>
          ))}
          {/* The server sends at most 60 entries; say so when the limit is reached. */}
          {data.events.length >= 60 && <p className="px-1 text-meta text-ink-3">Showing the latest 60 entries. Use the filters to narrow it down.</p>}
        </div>
      )}
    </Page>
  )
}

// Card that checks the hash chain on the server. `{ total }` destructures the prop.
function IntegrityCheck({ total }) {
  // Current project.
  const { project } = useProjectContext()
  // Mutation: verify.mutate() starts the check; verify.data holds the result.
  const verify = useVerifyChain(project.id)
  // Result object (undefined until checked): { ok, total, checkedAt, brokenAt, checked, head }.
  const result = verify.data
  // True only when there is a result and it is not ok.
  const broken = result && !result.ok
  return (
    // aria-live="polite": screen readers announce the result when it appears.
    <section data-reveal className="card mb-6 px-4 py-4" aria-live="polite">
      {/* Icon, text and button in a row. */}
      <div className="flex items-center gap-3">
        {/* Round icon badge; its colours depend on the state (broken = red, checked = dark, not checked = grey) via a nested ternary inside cn(). */}
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', broken ? 'bg-danger-50 text-danger-700' : result ? 'bg-ink text-white' : 'bg-sunken text-ink-2')}>
          {/* Same three states choose the icon. */}
          {broken ? <ShieldAlert size={18} aria-hidden /> : result ? <ShieldCheck size={18} aria-hidden /> : <Fingerprint size={18} aria-hidden />}
        </span>
        {/* Explanation text, three versions. */}
        <p className="min-w-0 flex-1 text-body">
          {/* Not checked yet: explain the idea. Fragments <>...</> group two spans. */}
          {!result ? (
            <>
              <span className="block font-semibold">Each entry seals the one before it</span>
              <span className="block text-meta text-ink-3">Changing an old entry would break every seal after it.</span>
            </>
          ) : result.ok ? (
            // All good: how many were checked and when.
            <>
              <span className="block font-semibold">All {result.total} entries check out</span>
              <span className="block text-meta text-ink-3">Checked {formatDateTime(result.checkedAt)}</span>
            </>
          ) : (
            // Broken: which entry failed and how many before it are fine.
            <>
              <span className="block font-semibold text-danger-700">Entry {result.brokenAt} doesn't match its seal</span>
              <span className="block text-meta text-ink-3">Entries 1 to {result.checked} are intact. Contact support.</span>
            </>
          )}
        </p>
        {/* "check N" button, only before a result exists. mutate() with no variables. */}
        {!result && (
          <Button size="sm" variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
            check {total}
          </Button>
        )}
      </div>
      {/* The latest seal, once the server returned one (`result?.head`). */}
      {result?.head && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-sunken px-3 py-2">
          <span className="shrink-0 text-2xs font-semibold text-ink-3">latest seal</span>
          {/* <code> shows the hash in a monospace font, cut with "…" if too long. */}
          <code className="min-w-0 flex-1 truncate font-mono text-meta">{result.head}</code>
          <button
            // Not a form submit.
            type="button"
            // Small round icon button.
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-ink/5"
            // Label for screen readers (the button only shows an icon).
            aria-label="Copy the latest seal"
            // Copy the hash; .then shows the toast once the Promise resolves.
            onClick={() => navigator.clipboard.writeText(result.head).then(() => toast.success('Copied'))}
          >
            <Copy size={14} />
          </button>
        </div>
      )}
    </section>
  )
}

// One audit entry that expands when tapped. `{ e }` destructures the entry prop.
function Event({ e }) {
  // Whether the details are showing.
  const [open, setOpen] = useState(false)
  return (
    <li>
      {/* Tapping flips open (o => !o). aria-expanded tells screen readers whether it is expanded. */}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3.5 text-start transition hover:bg-ink/[0.025]">
        {/* A person's avatar, or a robot icon for automatic (system) entries. */}
        {e.actorName ? (
          <Avatar name={e.actorName} size={32} />
        ) : (
          // `title` shows a tooltip on hover.
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-3" title="Automatic check">
            <Bot size={15} aria-hidden />
          </span>
        )}
        {/* Summary and who/when. */}
        <span className="min-w-0 flex-1">
          <span className="block text-body leading-snug text-ink">{e.summary}</span>
          {/* "Ali · contractor · 14:05": name (or 'Automatic check' via `??`), the role only if there is one (`&&`), then the time. */}
          <span className="mt-0.5 block text-meta text-ink-3">
            {e.actorName ?? 'Automatic check'}
            {e.actorRole && ` · ${ROLE_LABELS[e.actorRole]?.toLowerCase()}`} · {formatTime(e.createdAt)}
          </span>
        </span>
        {/* Arrow that rotates 180° when open (`open && 'rotate-180'` adds the class only when open). */}
        <ChevronDown size={16} className={cn('mt-1 shrink-0 text-ink-4 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {/* Details panel, a description list (<dl>) of term (<dt>) / value (<dd>) pairs laid out in two columns. */}
      {open && (
        <dl className="mx-4 mb-3.5 grid gap-x-4 gap-y-1.5 rounded-xl bg-sunken p-3.5 text-meta sm:grid-cols-[100px_minmax(0,1fr)]">
          {/* Sequence number and action code. */}
          <dt className="text-ink-3">Entry</dt>
          <dd className="font-semibold">
            {e.seq} · {e.action}
          </dd>
          {/* When it was recorded. */}
          <dt className="text-ink-3">Recorded</dt>
          <dd>{formatDateTime(e.createdAt)}</dd>
          {/* This entry's seal (shortened; the full hash is in the tooltip). */}
          <dt className="text-ink-3">Seal</dt>
          <dd className="font-mono break-all" title={e.hash}>
            {shortHash(e.hash)}
          </dd>
          {/* The previous entry's seal. */}
          <dt className="text-ink-3">Previous</dt>
          <dd className="font-mono break-all text-ink-3" title={e.prevHash}>
            {shortHash(e.prevHash)}
          </dd>
          {/* Extra data, only if the payload has any keys. */}
          {Object.keys(e.payload ?? {}).length > 0 && (
            <>
              <dt className="text-ink-3">Details</dt>
              <dd>
                {/* JSON.stringify(value, null, 2) turns the object into pretty-printed text with 2-space indentation; <pre> keeps the line breaks. */}
                <pre className="overflow-x-auto font-mono text-2xs whitespace-pre-wrap text-ink-2">{JSON.stringify(e.payload, null, 2)}</pre>
              </dd>
            </>
          )}
        </dl>
      )}
    </li>
  )
}
