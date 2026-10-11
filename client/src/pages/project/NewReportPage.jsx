// /p/:id/reports/new (submitReport). The daily report in three steps: work done
// (step switches + summary), photos (live camera), notes. Saves to the outbox
// when offline or when the send fails for network reasons.
//
// FILE OVERVIEW
// What it does: a three-step "wizard" for the daily site report, built for a
//   phone on site:
//     Step 0 "Work":   tick off work steps for the current stage (sets the
//                      progress %), optionally mark the stage finished, and
//                      write a short summary.
//     Step 1 "Photos": attach at least one photo (photos taken earlier today
//                      with "Take a photo" are added automatically).
//     Step 2 "Notes":  number of workers, weather, issues, materials used,
//                      and a one-line recap; then submit.
//   Each step is validated before moving on. On submit, if there are photos that
//   only exist on the phone, or the phone is offline, or the upload fails for a
//   network reason, the report is saved into the offline "outbox" instead, which
//   uploads it later. A GSAP animation slides each step in from the side.
// Route: /p/:id/reports/new.
// Who can see it: people with the submitReport permission (contractor,
//   supervisor, self-managing owner).
// Data it loads: useToday (today's photos, to pre-fill), useBoq (materials list)
//   and the useCreateReport mutation from lib/queries.js.
// Depends on: React hooks, React Router, sonner toasts, lucide icons, shared
//   stage config, EvidenceUploader, WorkItems, the UI kit, i18n, project
//   context, format helpers, the GSAP motion helpers, network helpers and the
//   offline outbox store.

// React hooks: useEffect (side effects), useRef (a persistent box / element handle), useState (state).
import { useEffect, useRef, useState } from 'react'
// useNavigate: change page from code.
import { useNavigate } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icons.
import { Plus, Trash2 } from 'lucide-react'
// stagesFor(project) returns the project's list of building stages.
import { stagesFor } from '@shared/features.js'
// Photo uploader with "slots".
import { EvidenceUploader } from '../../components/evidence/EvidenceUploader.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// Checklist of work steps for a stage.
import { WorkItems } from '../../components/WorkItems.jsx'
// UI kit components.
import { Button, Field, Input, Notice, Segmented, Select, Stepper, Textarea, Toggle } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// cn joins class names; today() gives today's date string.
import { cn, today } from '../../lib/format.js'
// Animation helpers: dirSign() is +1/-1 for left-to-right/right-to-left languages, gsap is the animation library,
// reduced() is true when the user prefers reduced motion, useGSAP is GSAP's React hook (runs animations and cleans them up).
import { dirSign, gsap, reduced, useGSAP } from '../../lib/motion.js'
// Is this error a network problem worth retrying?
import { isRetryable } from '../../lib/net.js'
// Save an item into the offline outbox.
import { enqueue } from '../../lib/outbox/store.js'
// Query hooks: materials list, the create-report mutation, and today's summary.
import { useBoq, useCreateReport, useToday } from '../../lib/queries.js'

// A constant array (written in CAPITALS by convention) of weather options.
const WEATHER = ['Clear', 'Hot', 'Cloudy', 'Rain', 'Windy']

/** Three short steps for a phone on site: work done, photos, notes. Works without signal. */
// The page component (default export).
export default function NewReportPage() {
  // Current project and signed-in user.
  const { project, me } = useProjectContext()
  // Translation helpers.
  const { t, term } = useI18n()
  // Page navigation function.
  const navigate = useNavigate()
  // Mutation that sends the report.
  const create = useCreateReport(project.id)
  // Today's data (used to pre-fill photos).
  const todayData = useToday(project.id)
  // Materials list query.
  const boq = useBoq(project.id)
  // The current stage object.
  const stage = stagesFor(project)[project.stageIndex]
  // A stable random id for this report (lazy initial state runs once). Prevents duplicates if it is sent twice.
  const [clientId] = useState(() => crypto.randomUUID())

  // Which step is showing: 0, 1 or 2.
  const [step, setStep] = useState(0)
  // Animation direction: 1 = forward, -1 = back.
  const [dir, setDir] = useState(1)
  // Has the user tried to go on from this step? (shows errors)
  const [tried, setTried] = useState(false)
  // Progress percentage, starting at the stage's saved progress.
  const [progress, setProgress] = useState(project.stageProgress)
  // Did they mark the whole stage as done?
  const [stageDone, setStageDone] = useState(false)
  // Summary text.
  const [summary, setSummary] = useState('')
  // Attached photos (array of evidence objects).
  const [photos, setPhotos] = useState([])
  // Number of workers, default 8.
  const [workers, setWorkers] = useState(8)
  // Weather choice.
  const [weather, setWeather] = useState('Clear')
  // Issues text.
  const [issues, setIssues] = useState('')
  // Material rows used today.
  const [materials, setMaterials] = useState([])
  // True while sending.
  const [saving, setSaving] = useState(false)

  // Photos taken earlier today with "Take a photo" come along automatically.
  // Flag so the pre-fill happens only once.
  const [prefilled, setPrefilled] = useState(false)
  // Effect runs after render whenever today's data or the flag changes.
  useEffect(() => {
    // Only once, and only after today's data has loaded.
    if (!prefilled && todayData.data) {
      // Functional update with the previous photos `p`: put today's PHOTO-kind photos first (skipping ones already in p, checked with .some), then the existing ones.
      setPhotos((p) => [...todayData.data.photos.filter((x) => x.kind === 'PHOTO' && !p.some((y) => y.id === x.id)), ...p])
      // Mark as done.
      setPrefilled(true)
    }
    // Dependencies: re-run when these change.
  }, [todayData.data, prefilled])

  // Translated step names, used for the progress bar and "Step 1 of 3" text.
  const STEPS = [t('report.step.work'), t('report.step.photos'), t('report.step.notes')]
  // One error per step (index matches the step). Each is `condition && 'message'`: a message string or false.
  const errors = [
    // Step 0: summary must have at least 10 characters.
    summary.trim().length < 10 && 'Write a sentence or two about the work.',
    // Step 1: at least one photo.
    !photos.length && 'Add at least one photo.',
    // Step 2: every material row needs an item and a quantity above 0.
    materials.some((m) => !m.boqItemId || !(Number(m.qty) > 0)) && 'Complete or remove the material rows.',
  ]
  // Move to step `to`.
  const go = (to) => {
    // Remember the direction for the slide animation.
    setDir(to > step ? 1 : -1)
    // Change step.
    setStep(to)
    // Hide errors on the new step until the user tries again.
    setTried(false)
    // Scroll to the top; instant when the user prefers reduced motion, otherwise smooth.
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })
  }
  // "Next" button: show errors, and only advance if this step has none.
  const next = () => {
    setTried(true)
    // errors[step] is false (no error) or a message string.
    if (!errors[step]) go(step + 1)
  }

  // Async submit handler.
  const submit = async () => {
    // Show errors.
    setTried(true)
    // findIndex(Boolean) gives the index of the first truthy error, or -1 if none.
    const firstBad = errors.findIndex(Boolean)
    // If some step has an error, jump back to it and stop.
    if (firstBad >= 0) return go(firstBad)
    // The data to send.
    const body = {
      // Today's date.
      reportDate: today(),
      // Trimmed summary.
      summary: summary.trim(),
      // Empty issues become undefined (left out).
      issues: issues.trim() || undefined,
      // Number of workers.
      workerCount: workers,
      // Shorthand property: same as `weather: weather`.
      weather,
      // If the stage is done, progress is 100%.
      progressAfter: stageDone ? 100 : progress,
      // Whether the stage was completed.
      stageCompleted: stageDone,
      // Which stage this report is about.
      stageIndex: project.stageIndex,
      // Material rows with quantity as a number.
      materials: materials.map((m) => ({ boqItemId: m.boqItemId, qty: Number(m.qty) })),
      // Ids of photos already uploaded to the server.
      evidenceIds: photos.filter((p) => !p.local).map((p) => p.id),
    }
    // Photos that only exist on the phone.
    const local = photos.filter((p) => p.local)
    // Save to the offline outbox and go to Today.
    const saveOffline = async () => {
      try {
        // Queue the report.
        await enqueue({
          // Same id as the online attempt.
          id: clientId,
          userId: me.id,
          projectId: project.id,
          kind: 'REPORT',
          // Singular or plural title, e.g. "Report with 3 photos".
          title: t(photos.length === 1 ? 'outbox.REPORT1' : 'outbox.REPORT', { n: photos.length }),
          // Shorthand for `body: body`.
          body,
          // Phone-only photo files, keyed f0, f1, ...
          files: local.map((p, i) => ({ key: `f${i}`, blob: p.blob, name: p.name, meta: p.meta })),
        })
      } catch {
        // Could not store it on the phone.
        return toast.error(t('outbox.saveFailed'))
      }
      // Saved on the phone.
      toast.success(t('outbox.savedToast'))
      // Go to Today.
      navigate(`/p/${project.id}/today`)
    }
    // Photos still on the phone, or offline: go straight to the outbox.
    if (local.length || navigator.onLine === false) return saveOffline()
    // Show the spinner.
    setSaving(true)
    // Send to the server: mutate(variables, options).
    create.mutate(
      // Variables: the body plus clientId.
      { ...body, clientId },
      {
        // Success: destructure the new report's id from the response, toast, and open the report.
        onSuccess: ({ id }) => {
          toast.success(t('report.submitted'))
          navigate(`/p/${project.id}/reports/${id}`)
        },
        // Network failure: fall back to the outbox; other errors are shown on the page.
        onError: (err) => (isRetryable(err) ? saveOffline() : undefined),
        // Always turn the spinner off afterwards.
        onSettled: () => setSaving(false),
      },
    )
  }

  // Ref to the step panel element, so GSAP can animate it.
  const panel = useRef(null)
  // useGSAP(callback, options): runs the animation and automatically cleans it up when the component unmounts or re-runs.
  useGSAP(
    () => {
      // Skip animation for reduced-motion users, or if the element is not there.
      if (reduced() || !panel.current) return
      // fromTo(element, fromState, toState): slide in 24px from the side (direction depends on dir and the text direction) while fading in.
      // autoAlpha = opacity + visibility; clearProps removes the leftover transform afterwards.
      gsap.fromTo(panel.current, { x: 24 * dir * dirSign(), autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.4, clearProps: 'transform' })
    },
    // Re-run the animation whenever `step` changes.
    { dependencies: [step] },
  )

  // The page JSX.
  return (
    <Page width="narrow">
      {/* Heading with a back link to Today. back={{ ... }}: the outer braces are JSX, the inner ones an object. */}
      <PageTitle title={t('report.title')} back={{ to: `/p/${project.id}/today`, label: t('common.back') }} />
      {/* Step indicator. */}
      <div data-reveal className="mb-5">
        {/* Three bars; aria-hidden because the text below says the same thing. */}
        <div className="flex gap-1.5" aria-hidden>
          {/* One bar per step; filled dark for steps up to and including the current one. */}
          {STEPS.map((s, i) => (
            <span key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-500', i <= step ? 'bg-ink' : 'bg-line')} />
          ))}
        </div>
        {/* "Step 2 of 3: Photos". aria-live="polite" makes screen readers announce changes. */}
        <p className="mt-2.5 text-meta font-semibold text-ink-3" aria-live="polite">
          {t('report.stepOf', { n: step + 1, name: STEPS[step] })}
        </p>
      </div>

      {/* The animated panel; ref={panel} gives GSAP this element. */}
      <div ref={panel} className="flex flex-col gap-5">
        {/* Step 0: work done. `<>...</>` is a Fragment grouping several elements. */}
        {step === 0 && (
          <>
            {/* Intro text. */}
            <p className="text-body text-ink-2">{t('report.workIntro')}</p>
            {/* Work steps checklist. Not editable once the stage is marked done. Changing it sets progress and un-marks "done" (comma operator runs both). */}
            <WorkItems stage={stage} progress={stageDone ? 100 : progress} editable={!stageDone} onChange={(v) => (setProgress(v), setStageDone(false))} showInspection={false} />
            {/* "Stage finished" switch inside a clickable card. */}
            <label className="card flex items-center gap-3 px-4 py-3.5">
              <span className="min-w-0 flex-1 text-body font-semibold">{t('report.stageDone', { stage: term(stage.label) })}</span>
              {/* Passing the setter directly: the toggle calls setStageDone(true/false). */}
              <Toggle checked={stageDone} onChange={setStageDone} label={t('report.stageDone', { stage: term(stage.label) })} />
            </label>
            {/* Summary field; its error is errors[0]. */}
            <Field label={t('report.summary')} hint={t('report.summaryHint')} error={tried && errors[0]}>
              {/* Controlled textarea, max 2000 characters. */}
              <Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} />
            </Field>
          </>
        )}

        {/* Step 1: photos. */}
        {step === 1 && (
          <>
            <p className="text-body text-ink-2">{t('report.photosIntro')}</p>
            <EvidenceUploader
              // Project the photos belong to.
              projectId={project.id}
              // Controlled photo list.
              value={photos}
              onChange={setPhotos}
              // Highlight missing photo after "next".
              showErrors={tried}
              // Boolean prop (= true): photos may stay on the phone until sending.
              offline
              // One required photo slot; missingText is the error from errors[1].
              slots={[{ kind: 'PHOTO', label: t('report.addPhoto'), hint: t('report.photosIntro'), required: true, missingText: errors[1] }]}
            />
          </>
        )}

        {/* Step 2: notes. */}
        {step === 2 && (
          <>
            {/* Workers count. */}
            <Field label={t('report.workers')} group>
              {/* +/- control. The handler clamps the value between 0 and 500 (Math.max then Math.min); invalid input becomes 0. */}
              <Stepper value={workers} onChange={(v) => setWorkers(Math.min(500, Math.max(0, Number(v) || 0)))} min={0} max={500} label={t('report.workers')} className="max-w-xs" />
            </Field>
            {/* Weather picker: map each weather word to { value, label } with a translated label. */}
            <Field label={t('report.weather')} group>
              <Segmented label={t('report.weather')} value={weather} onChange={setWeather} options={WEATHER.map((w) => ({ value: w, label: term(w) }))} size="sm" />
            </Field>
            {/* Optional issues text. */}
            <Field label={t('report.issues')} hint={t('report.issuesHint')} optional>
              <Textarea rows={3} value={issues} onChange={(e) => setIssues(e.target.value)} />
            </Field>
            {/* Materials used (optional). */}
            <div>
              {/* Heading "Materials · optional". */}
              <p className="mb-2 text-meta font-semibold text-ink-2">
                {t('report.materials')} <span className="font-normal text-ink-3">· {t('common.optional')}</span>
              </p>
              <ul className="flex flex-col gap-2">
                {/* One row per material, using a block-body arrow so we can compute `item` first. */}
                {materials.map((m) => {
                  // .find returns the first matching BOQ item (or undefined). `?.` because the list may not be loaded.
                  const item = boq.data?.find((b) => b.id === m.boqItemId)
                  return (
                    <li key={m.key} className="flex items-center gap-2">
                      {/* Material drop-down taking the remaining width. */}
                      <div className="min-w-0 flex-1">
                        {/* On change, replace this row's boqItemId (copy the row with spread, others unchanged). */}
                        <Select value={m.boqItemId} onChange={(e) => setMaterials((ms) => ms.map((x) => (x.key === m.key ? { ...x, boqItemId: e.target.value } : x)))} aria-label="Material">
                          <option value="">Choose…</option>
                          {/* Optional chaining on a method call: `?.filter` only runs if boq.data exists. Keep structure-phase items not measured in sq ft. */}
                          {boq.data
                            ?.filter((b) => b.phase === 'STRUCTURE' && b.unit !== 'sq ft')
                            // One <option> per item.
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.description}
                              </option>
                            ))}
                        </Select>
                      </div>
                      {/* Quantity input, fixed width. */}
                      <div className="w-32">
                        <Input
                          // Number keyboard on phones.
                          inputMode="decimal"
                          // Controlled value.
                          value={m.qty}
                          // Shows the item's unit as a hint, or 'qty'.
                          placeholder={item?.unit ?? 'qty'}
                          // Update this row's qty, keeping only digits and dots (regex replace).
                          onChange={(e) => setMaterials((ms) => ms.map((x) => (x.key === m.key ? { ...x, qty: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                          // Screen-reader label.
                          aria-label="Quantity"
                        />
                      </div>
                      {/* Remove this row (filter it out). Round 44px touch target. */}
                      <button onClick={() => setMaterials((ms) => ms.filter((x) => x.key !== m.key))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-ink/5" aria-label="Remove material">
                        <Trash2 size={17} />
                      </button>
                    </li>
                  )
                })}
              </ul>
              {/* Add an empty material row (new array: old rows + a new object). */}
              <Button size="sm" variant="soft" icon={Plus} className="mt-2" onClick={() => setMaterials((ms) => [...ms, { key: Math.random(), boqItemId: '', qty: '' }])}>
                {t('report.addMaterial')}
              </Button>
              {/* Materials error, after a try. */}
              {tried && errors[2] && <p className="mt-1.5 text-meta font-semibold text-danger-700">{errors[2]}</p>}
            </div>
            {/* Recap line, e.g. "Foundation: 40% → 60% · 3 photos · 8 workers". The ternary adds an "s" for plurals. */}
            <p className="rounded-tile bg-white px-4 py-3 text-meta text-ink-2 ring-1 ring-line">
              {term(stage.label)}: {project.stageProgress}% → {stageDone ? 100 : progress}% · {photos.length} photo{photos.length === 1 ? '' : 's'} · {workers} workers
            </p>
            {/* Server error (non-network). */}
            {create.error && !isRetryable(create.error) && <Notice tone="error">{create.error.message}</Notice>}
          </>
        )}

        {/* Navigation buttons. */}
        <div className="flex gap-2 pt-1">
          {/* Back button from step 1 onwards. */}
          {step > 0 && (
            <Button variant="secondary" size="lg" onClick={() => go(step - 1)}>
              {t('common.back')}
            </Button>
          )}
          {/* Steps 0 and 1 show "Next"; step 2 shows "Submit". */}
          {step < 2 ? (
            // Passing the `next` function as the click handler.
            <Button variant="primary" size="lg" className="flex-1" onClick={next}>
              {step === 0 ? t('report.nextPhotos') : t('report.nextNotes')}
            </Button>
          ) : (
            // Submit with a spinner while saving.
            <Button variant="primary" size="lg" className="flex-1" loading={saving} onClick={submit}>
              {t('report.submit')}
            </Button>
          )}
        </div>
      </div>
    </Page>
  )
}
