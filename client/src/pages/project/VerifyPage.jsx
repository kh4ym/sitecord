// /p/:id/verify/:kind/:targetId. Checking something at the site: a live photo
// near the pin, a clock check, three switches and a result. Used for
// inspections (inspector), purchases and reports (owner, local rep).
//
// FILE OVERVIEW
// What it does: the "verify on site" screen. The person stands at the building
//   site, takes a live photo (the app shows how far the photo was taken from the
//   site pin and whether the phone's clock agrees with the server), ticks three
//   quick checks and, for inspections, picks a result (pass / needs fixes /
//   fail). Submitting either records an inspection or marks a purchase/report as
//   VERIFIED.
// Route: /p/:id/verify/:kind/:targetId where :kind is 'inspection', 'purchase'
//   or 'report'. For inspections :targetId is "<stageIndex>:<step label>"; for
//   the others it is the purchase or report id.
// Who can see it: inspections need the recordInspection permission (the
//   project's inspector); purchases and reports are verified by the owner or
//   the local representative. Purchases must be APPROVED first; reports must be
//   SUBMITTED or QUERIED.
// Data it loads: usePlan (stage plan and past inspections), useExpense or
//   useReport for the thing being verified, and the mutations useRecordInspection
//   and useDecide, all from lib/queries.js.
// Depends on: React, React Router, sonner toasts, lucide icons, shared stage,
//   geo (distance) and records (timing) helpers, EvidenceUploader, the UI kit,
//   i18n, the project context and format helpers.

// useState hook for local state.
import { useState } from 'react'
// useNavigate (go to a page from code), useParams (read :kind and :targetId from the URL).
import { useNavigate, useParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icons.
import { Clock, MapPin } from 'lucide-react'
// The project's building stages.
import { stagesFor } from '@shared/features.js'
// formatDistance(m) -> "120 m"; locationStatus(evidence, project) -> 'NO_PIN' | 'UNKNOWN' | 'OFF_SITE' | on-site.
import { formatDistance, locationStatus } from '@shared/geo.js'
// evidenceTiming(evidence) -> info such as whether the phone clock was right.
import { evidenceTiming } from '@shared/records.js'
// Photo uploader.
import { EvidenceUploader } from '../../components/evidence/EvidenceUploader.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { Button, EmptyState, ErrorState, Field, Notice, PageSkeleton, SectionHead, Segmented, Textarea, Toggle } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Formatting helpers: class joiner, date, money, today's date.
import { cn, formatDate, formatPKR, today } from '../../lib/format.js'
// Query/mutation hooks.
import { useDecide, useExpense, usePlan, useRecordInspection, useReport } from '../../lib/queries.js'

// The three checklist labels for each kind, as an object of arrays (look up with CHECKS[kind]).
const CHECKS = {
  inspection: ['Matches the approved drawing', 'No visible defects', 'Complete as reported'],
  purchase: ['The delivery is at the site', 'Quantity matches the receipt', 'Quality looks right'],
  report: ['The work matches the report', 'No visible defects', 'The photos match the site'],
}
// Inspection results as { value, label } objects (the shape the Segmented control expects).
const RESULTS = [
  { value: 'PASS', label: 'pass' },
  { value: 'PARTIAL', label: 'needs fixes' },
  { value: 'FAIL', label: 'fail' },
]

/**
 * Checking something at the site: a live photo (with its distance from the
 * site pin and a clock check), three quick checks, then the result. Used for
 * inspections (/verify/inspection/<stage>:<step>), purchases and reports.
 */
// The page component: works out what is being verified and passes the details to VerifyForm.
export default function VerifyPage() {
  // Read the URL parameters.
  const { kind, targetId } = useParams()
  // Project and the permission check function.
  const { project, can } = useProjectContext()
  // Translate a construction term.
  const { term } = useI18n()
  // Stage plan.
  const plan = usePlan(project.id)
  // Only load the purchase when verifying a purchase (passing null tells the hook to do nothing).
  const expense = useExpense(project.id, kind === 'purchase' ? targetId : null)
  // Only load the report when verifying a report.
  const report = useReport(project.id, kind === 'report' ? targetId : null)

  // Inspections.
  if (kind === 'inspection') {
    // Not the inspector: show a "not your role" message.
    if (!can('recordInspection')) return <NotForYou />
    // Split "2:Pour slab" at ':'. Array destructuring with a rest element: index = first piece, rest = all the others.
    const [index, ...rest] = targetId.split(':')
    // Turn the index string into a number and pick that stage.
    const stage = stagesFor(project)[Number(index)]
    // Re-join the rest in case the step label itself contained ':'.
    const step = rest.join(':')
    // If the stage does not exist or does not have this step, show a 404 error (the error prop is an inline object).
    if (!stage?.steps.some((s) => s.label === step)) return <ErrorState error={{ status: 404, message: 'This step is not part of the plan.' }} />
    // Wait for the plan.
    if (plan.isLoading) return <PageSkeleton variant="detail" />
    // The most recent inspection of this step: chain of `?.` lookups; .at(-1) takes the last array element.
    const last = plan.data?.stages[stage.index]?.steps.find((s) => s.label === step)?.inspections.at(-1)
    return (
      <VerifyForm
        // What kind of verification.
        kind="inspection"
        // Where "Back" and "done" go.
        back={`/p/${project.id}/inspections`}
        // Small text above the title: the stage name.
        kicker={term(stage.label)}
        // The step name.
        title={term(step)}
        // If the last inspection did not pass, explain it, e.g. 'Last check: failed on 2 Oct, "cracks"'. Nested ternaries and template literals; `??` falls back to createdAt.
        context={last && last.result !== 'PASS' ? `Last check: ${last.result === 'FAIL' ? 'failed' : 'needed fixes'} on ${formatDate(last.inspectedOn ?? last.createdAt)}${last.notes ? `, “${last.notes}”` : ''}` : null}
        // What to record: stage and step. `step` alone is shorthand for step: step.
        target={{ stageIndex: stage.index, step }}
      />
    )
  }
  // Purchases and reports: pick the matching query result (null for an unknown kind).
  const query = kind === 'purchase' ? expense : kind === 'report' ? report : null
  // Unknown kind in the URL.
  if (!query) return <ErrorState error={{ status: 404, message: 'Nothing to verify here.' }} />
  // Loading.
  if (query.isLoading) return <PageSkeleton variant="detail" />
  // Load failed: show the error with a retry button.
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />
  // The loaded purchase or report (short name).
  const r = query.data
  // Can it be verified yet? Purchases: approved. Reports: submitted or queried.
  const ready = kind === 'purchase' ? r.status === 'APPROVED' : ['SUBMITTED', 'QUERIED'].includes(r.status)
  // Link back to the purchase or report page.
  const back = kind === 'purchase' ? `/p/${project.id}/purchases/${r.id}` : `/p/${project.id}/reports/${r.id}`
  // Not ready: explain why instead of showing the form.
  if (!ready) {
    return (
      <Page width="narrow">
        <PageTitle back={{ to: back, label: 'Back' }} title="Verify on site" />
        <div className="card">
          {/* Different message for "already verified" and "not approved yet". */}
          <EmptyState title={r.status === 'VERIFIED' ? 'Already verified' : 'Not ready to verify'} description={r.status === 'VERIFIED' ? 'Someone has already checked this at the site.' : 'Purchases are verified after the owner approves them.'} />
        </div>
      </Page>
    )
  }
  // Ready: show the form.
  return (
    <VerifyForm
      // 'purchase' or 'report'.
      kind={kind}
      // Back link.
      back={back}
      kicker="Verify on site"
      // e.g. "Al-Noor, Rs 45k" (compact money) or "Daily report, 3 Oct 2026".
      title={kind === 'purchase' ? `${r.supplierName}, ${formatPKR(r.totalPaisa, { compact: true })}` : `Daily report, ${formatDate(r.reportDate)}`}
      // For purchases: list the lines like "10 bag cement, 2 trip sand" (.map to strings, then .join with ', '). For reports: the summary.
      context={kind === 'purchase' ? r.lines.map((l) => `${l.qty} ${l.unit} ${l.description.toLowerCase()}`).join(', ') : r.summary}
      // What to send to the server: the record type and its id.
      target={{ targetType: kind === 'purchase' ? 'EXPENSE' : 'REPORT', targetId: r.id }}
    />
  )
}

// The actual form. Props are destructured in the parameter list.
function VerifyForm({ kind, back, kicker, title, context, target }) {
  // Current project.
  const { project } = useProjectContext()
  // Page navigation.
  const navigate = useNavigate()
  // Mutation for recording an inspection.
  const record = useRecordInspection(project.id)
  // Mutation for an owner decision (here: VERIFY).
  const decide = useDecide(project.id)
  // Attached photos.
  const [photos, setPhotos] = useState([])
  // Three checkboxes, all off at first.
  const [checks, setChecks] = useState([false, false, false])
  // The result picked by hand (null = not picked yet).
  const [result, setResult] = useState(null)
  // Notes text.
  const [notes, setNotes] = useState('')
  // Show errors after a submit attempt.
  const [tried, setTried] = useState(false)
  // True when every check is ticked (.every(Boolean) = all truthy).
  const allChecked = checks.every(Boolean)
  // Result to use: the hand-picked one, or by default PASS when all checks are ticked, otherwise PARTIAL.
  const chosen = result ?? (allChecked ? 'PASS' : 'PARTIAL')
  // The first photo (undefined if none).
  const photo = photos[0]
  // Busy if either mutation is running (`||` = or).
  const saving = record.isPending || decide.isPending
  // Whichever mutation has an error.
  const error = record.error ?? decide.error

  // Awaited: once verified, the record no longer needs verifying and this form gives way.
  // Async submit handler.
  const submit = async () => {
    // Show errors.
    setTried(true)
    // A photo is required; `return toast.error(...)` shows the toast and leaves the function.
    if (!photo) return toast.error('Take a photo at the site first')
    // try/catch: mutateAsync throws if the server rejects the request.
    try {
      // Inspection branch.
      if (kind === 'inspection') {
        // A non-pass result needs a note explaining what to fix.
        if (chosen !== 'PASS' && !notes.trim()) return toast.error('Say what needs fixing')
        // `await` waits for the server. Spread copies stage/step from target, then adds the result, notes, date and photo ids.
        await record.mutateAsync({ ...target, result: chosen, notes: notes.trim() || undefined, inspectedOn: today(), evidenceIds: photos.map((p) => p.id) })
        // Success message depends on the result.
        toast.success(chosen === 'PASS' ? 'Marked as passed' : 'Inspection recorded')
        // Purchase/report branch.
      } else {
        // All three checks must be ticked to verify.
        if (!allChecked) return toast.error('Tick all three checks, or ask a question instead')
        // Send a VERIFY decision with the photo as proof.
        await decide.mutateAsync({ ...target, decision: 'VERIFY', evidenceId: photo.id, note: notes.trim() || undefined })
        toast.success('Verified on site')
      }
    } catch {
      return // shown above the button
    }
    // Success: go back.
    navigate(back)
  }

  // The form's JSX.
  return (
    <Page width="narrow">
      {/* Heading with back link, kicker and title. */}
      <PageTitle back={{ to: back, label: 'Back' }} kicker={kicker} title={title} />
      {/* Context line only when there is one. */}
      {context && (
        <p data-reveal className="-mt-2 mb-6 text-body text-ink-2">
          {context}
        </p>
      )}
      {/* Sections stacked with large gaps. */}
      <div className="flex flex-col gap-8">
        {/* Photo section. */}
        <section data-reveal className="flex flex-col gap-3">
          <SectionHead title="Photo" />
          <EvidenceUploader
            // Project id for uploads.
            projectId={project.id}
            // Controlled list of photos.
            value={photos}
            onChange={setPhotos}
            // Highlight the missing photo after a try.
            showErrors={tried}
            // One required live photo slot; inspections may attach several (multiple: true/false).
            slots={[{ kind: 'PHOTO', label: 'Live photo at the site', hint: 'Taken now, with the location on', required: true, multiple: kind === 'inspection' }]}
          />
          {/* Distance and clock checks for the first photo. `ev` is the prop name. */}
          {photo && <PhotoChecks ev={photo} />}
        </section>

        {/* Checklist section. */}
        <section data-reveal className="flex flex-col gap-3">
          <SectionHead title="Checklist" />
          {/* divide-y draws lines between rows. */}
          <ul className="card divide-y divide-line">
            {/* CHECKS[kind] picks the labels for this kind (bracket notation with a variable key). */}
            {CHECKS[kind].map((label, i) => (
              <li key={label} className="flex items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1 text-body font-semibold">{label}</span>
                {/* Toggle number i: copy the array, replacing only position i (k is each element's index) with the new value v. */}
                <Toggle checked={checks[i]} onChange={(v) => setChecks((c) => c.map((x, k) => (k === i ? v : x)))} label={label} />
              </li>
            ))}
          </ul>
        </section>

        {/* Result picker, inspections only. */}
        {kind === 'inspection' && (
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="Result" />
            {/* Picking a result stores it in `result` (overriding the default). */}
            <Segmented label="Result" value={chosen} onChange={setResult} options={RESULTS} />
          </section>
        )}

        {/* Notes. For a non-pass inspection it becomes the required "What needs fixing" field, with an error after a try. */}
        <Field label={kind === 'inspection' && chosen !== 'PASS' ? 'What needs fixing' : 'Notes'} optional={kind !== 'inspection' || chosen === 'PASS'} error={tried && kind === 'inspection' && chosen !== 'PASS' && !notes.trim() ? 'Say what needs fixing' : undefined}>
          {/* Controlled textarea with a kind-specific placeholder. */}
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'inspection' ? 'e.g. Column C3 is out of plumb by 15 mm.' : 'Anything worth noting'} />
        </Field>

        {/* Submit area. */}
        <div className="flex flex-col gap-2">
          {/* Server error, if any. */}
          {error && <Notice tone="error">{error.message}</Notice>}
          {/* Full-width (block) submit button with a spinner. */}
          <Button variant="primary" size="lg" block loading={saving} onClick={submit}>
            {/* Nested ternary for the label. */}
            {kind === 'inspection' ? (chosen === 'PASS' ? 'mark as passed' : 'record the inspection') : 'mark as verified'}
          </Button>
          {/* Hint for purchases/reports when not every check is ticked. */}
          {kind !== 'inspection' && !allChecked && <p className="text-center text-meta text-ink-3">Something not right? Ask a question on its page instead.</p>}
        </div>
      </div>
    </Page>
  )
}

/** Where and when the photo was taken, checked against the site pin and the server clock. */
// `{ ev }` destructures the evidence object from props.
function PhotoChecks({ ev }) {
  // Current project (for the site pin).
  const { project } = useProjectContext()
  // Photos still only on the phone have no server data yet: render nothing.
  if (ev.local) return null
  // Location status of the photo.
  const where = locationStatus(ev, project)
  // Timing info of the photo.
  const timing = evidenceTiming(ev)
  // Two rows of info, each { icon, bad, text }.
  const rows = [
    {
      // Map pin icon (the component itself).
      icon: MapPin,
      // Highlighted as a warning when taken away from the site.
      bad: where === 'OFF_SITE',
      // Chained (nested) ternaries choose the text: no pin / unknown location / "120 m from the site pin, GPS within 8 m".
      text:
        where === 'NO_PIN'
          ? 'The site has no pin yet, so the distance can’t be checked'
          : where === 'UNKNOWN'
            ? 'Location unknown. Turn location on for a stronger record.'
            : `${formatDistance(ev.distanceM)} from the site pin${ev.accuracyM ? `, GPS within ${Math.round(ev.accuracyM)} m` : ''}`,
    },
    {
      // Clock icon.
      icon: Clock,
      // Warning when the phone clock disagreed with the server (=== false, not just falsy, so "unknown" is not bad).
      bad: timing.clockOk === false,
      // Text: clock off / live camera / picked from gallery.
      text: timing.clockOk === false ? 'The phone’s clock is off. The server time is kept.' : ev.captureMode === 'IN_APP_CAMERA' ? 'Live camera, phone time matches the server' : 'Picked from the gallery, lower trust',
    },
  ]
  return (
    <ul className="flex flex-col gap-1.5 px-1">
      {/* Destructuring each row object in the parameter, renaming icon to Icon so it can be used as <Icon />. */}
      {rows.map(({ icon: Icon, bad, text }) => (
        // Warning rows are bold and amber; normal rows grey. cn() combines the classes.
        <li key={text} className={cn('flex items-center gap-2 text-meta', bad ? 'font-semibold text-warn-800' : 'text-ink-2')}>
          <Icon size={15} className={bad ? 'text-warn-600' : 'text-ink-3'} aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  )
}

// Shown to people who may not record inspections.
function NotForYou() {
  return (
    <div className="card">
      <EmptyState title="Not part of your role" description="Inspections are recorded by the project's inspector." />
    </div>
  )
}
