// FILE: components/ExpenseParts.jsx — the parts of a purchase a reviewer looks at.
//
// What it does: three sections of a purchase (an "expense" record): its
// evidence photos (ExpenseEvidence), its line items with the total
// (ExpenseItems), and the automatic checks/flags with a way for the owner to
// dismiss them with a note (ExpenseChecks). Plus `openFindings`, a helper that
// counts a purchase's open flags.
// Where it's used: shared by the purchase page and the review sheet in
// Approvals so both show exactly the same thing.
// Depends on: React useState, lucide-react icons, the project context, format
// helpers, the useDismissFinding mutation, the evidence gallery, and ui parts.

// Local state hook.
import { useState } from 'react'
// Tick and warning icons.
import { CircleCheck, TriangleAlert } from 'lucide-react'
// Current project and permission checker.
import { useProjectContext } from '../layout/ProjectContext.jsx'
// Number and rupee formatters.
import { formatNumber, formatPKR } from '../lib/format.js'
// Mutation hook that dismisses an automatic-check finding.
import { useDismissFinding } from '../lib/queries.js'
// Photo tiles component, and a function describing where a photo came from.
import { EvidenceTiles, provenance } from './evidence/EvidenceGallery.jsx'
// Design-system pieces from the ui barrel.
import { ConfirmDialog, IconTile, ListCard, ListRow, SectionHead } from './ui/index.js'

// Severity code -> display word.
const SEVERITY = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }

/** Photo tiles, how many of the required proofs are there, and where the key photo came from. */
// `{ expense: e }` destructures the `expense` prop and renames it to the short name `e`.
export function ExpenseEvidence({ expense: e }) {
  // Current project (needed for photo URLs and provenance text).
  const { project } = useProjectContext()
  // Materials need two proofs (e.g. receipt + delivery photo); others need one.
  const needed = e.type === 'MATERIAL' ? 2 : 1
  // The "key" photo: the delivery photo if there is one, else the first piece of evidence.
  const key = e.evidence.find((v) => v.kind === 'DELIVERY_PHOTO') ?? e.evidence[0]
  return (
    // <section> groups related content; flex column with gaps.
    <section className="flex flex-col gap-3">
      {/* Heading with "1 of 2" style meta: proofs present = needed minus gaps. */}
      <SectionHead title="Evidence" meta={`${needed - e.gaps.length} of ${needed}`} />
      {/* The photo tiles. */}
      <EvidenceTiles projectId={project.id} evidence={e.evidence} />
      {/* Where/when the key photo was taken, if there is one. */}
      {key && <p className="px-1 text-meta leading-relaxed text-ink-3">{provenance(key, project)}</p>}
    </section>
  )
}

// The purchase's line items and total.
export function ExpenseItems({ expense: e }) {
  return (
    <section className="flex flex-col gap-3">
      {/* Section heading. */}
      <SectionHead title="Items" />
      {/* Card of rows. */}
      <ListCard>
        {/* One ListRow per line `l`, keyed by its id. */}
        {e.lines.map((l) => (
          <ListRow
            key={l.id}
            // Item name.
            title={l.description}
            // e.g. "50 bags × Rs 1,450".
            subtitle={`${formatNumber(l.qty)} ${l.unit} × ${formatPKR(l.unitPaisa)}`}
            // Line total on the right; a prop can be a JSX element.
            trailing={<span className="num text-body font-bold">{formatPKR(l.totalPaisa)}</span>}
          />
        ))}
        {/* Total row, with a light grey background. */}
        <li className="flex items-center justify-between gap-3 bg-sunken/60 px-4 py-3.5">
          <span className="text-body font-bold">Total</span>
          <span className="num text-body font-bold">{formatPKR(e.totalPaisa)}</span>
        </li>
      </ListCard>
      {/* Free-text description, if any. */}
      {e.description && <p className="px-1 text-meta text-ink-2">{e.description}</p>}
    </section>
  )
}

/** Automatic checks: open flags first, each dismissible with a note by the owner. */
export function ExpenseChecks({ expense: e }) {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Mutation for dismissing a finding.
  const dismiss = useDismissFinding(project.id)
  // The finding currently being dismissed (null = dialog closed).
  const [target, setTarget] = useState(null)
  // Count of findings still open: filter, then take the array's length.
  const open = e.findings.filter((f) => f.status === 'OPEN').length
  return (
    <section className="flex flex-col gap-3">
      {/* Meta shows "2 to look at" only when something's open (0 is falsy -> undefined). */}
      <SectionHead title="Checks" meta={open ? `${open} to look at` : undefined} />
      {/* Card-styled list with dividers. */}
      <ul className="card divide-y divide-line">
        {/* No findings at all: a reassuring single row. */}
        {e.findings.length === 0 && (
          <li className="flex items-center gap-3 px-4 py-3.5">
            <IconTile icon={CircleCheck} size="sm" />
            <span className="text-body font-semibold">Nothing unusual found</span>
          </li>
        )}
        {/* One row per finding `f`. */}
        {e.findings.map((f) => (
          <li key={f.id} className="flex gap-3 px-4 py-3.5">
            {/* Warning icon (amber) if open, tick (grey) if resolved. */}
            <IconTile icon={f.status === 'OPEN' ? TriangleAlert : CircleCheck} tone={f.status === 'OPEN' ? 'warn' : 'neutral'} size="sm" />
            <div className="min-w-0 flex-1">
              {/* What the check found. */}
              <p className="text-body leading-snug font-semibold">{f.message}</p>
              {/* Dismissed: show the reason; otherwise the severity with a neutral framing. */}
              <p className="mt-1 text-meta text-ink-3">{f.status === 'DISMISSED' ? `Resolved: ${f.dismissNote}` : `${SEVERITY[f.severity]}. Worth a look, not an accusation.`}</p>
            </div>
            {/* Dismiss button for open findings, only for people who can decide. */}
            {f.status === 'OPEN' && can('decide') && (
              <button type="button" onClick={() => setTarget(f)} className="self-center text-meta font-semibold text-accent-700 hover:text-accent-800">
                dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
      {/* One shared dialog for whichever finding is targeted. */}
      <ConfirmDialog
        // `!!target` converts the object/null to true/false.
        open={!!target}
        // Closing clears the target.
        onOpenChange={(o) => !o && setTarget(null)}
        title="Dismiss this flag?"
        // `?.` because target is null while closed.
        description={target?.message}
        noteLabel="Why is it fine?"
        notePlaceholder="e.g. Steel prices went up across the market this month."
        requireNote
        confirmLabel="dismiss flag"
        loading={dismiss.isPending}
        error={dismiss.error?.message}
        // mutate(variables, options): send id + note; on success close the dialog.
        onConfirm={(note) => dismiss.mutate({ id: target.id, note }, { onSuccess: () => setTarget(null) })}
      />
    </section>
  )
}

/** The chip for a loaded purchase (open flags show as "price check" while it waits). */
// Exported arrow-function helper (not a component): counts open findings from
// the full `findings` list if loaded; otherwise falls back (`??`) to the
// server's precomputed `openFindings` count, then to 0.
export const openFindings = (e) => e.findings?.filter((f) => f.status === 'OPEN').length ?? e.openFindings ?? 0
