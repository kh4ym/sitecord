// =============================================================================
// ProgressPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/progress  (":id" is the project id taken from the URL).
//
// What it shows: the live 3D house, stage chips (tap one to preview a stage),
// the steps of each stage as switches for people who can update progress, a
// schedule line ("3 days behind" / "on schedule") and the inspection queue
// when the project has inspections turned on.
//
// Who can see it: every member of the project can open it. Only people whose
// role has the "updateProgress" permission can flip the step switches, mark a
// stage complete or reopen the previous stage. Only people with
// "recordInspection" can tap an inspection row to record a result.
//
// Data it loads: the project itself comes from the shared ProjectContext; the
// project plan (schedule summary, per-stage steps, inspection queue) comes from
// the usePlan query hook; saving progress goes through useProgressEditor.
//
// Depends on: React hooks, sonner (toast pop-ups), lucide-react (icons), the
// shared stage list (stagesFor), the shared UI kit, i18n (translations), the
// lazily loaded three.js house scene and the house model builder.
// =============================================================================

// ES module import: pull three named exports (hooks) out of the 'react' package.
// useMemo caches a computed value, useRef holds a mutable box that survives re-renders, useState stores state.
import { useMemo, useRef, useState } from 'react'
// Named import of the `toast` function from the sonner library (small pop-up notifications).
import { toast } from 'sonner'
// Icon components from lucide-react; each one is a React component that draws an SVG icon.
import { Layers, Maximize2, Minus, Play, Plus, RotateCw } from 'lucide-react'
// stagesFor(project) returns the ordered list of building stages; '@shared' is a path alias set up in Vite config.
import { stagesFor } from '@shared/features.js'
// Page is the layout wrapper that gives every page the same width and padding.
import { Page } from '../../components/Page.jsx'
// WorkItems renders the steps of one stage as switches ("../../" means go up two folders).
import { WorkItems } from '../../components/WorkItems.jsx'
// Several UI building blocks imported at once from the UI kit's index file.
import { Button, Chip, ConfirmDialog, FilterChips, IconButton, ListCard, ListRow, SectionHead, StatusChip } from '../../components/ui/index.js'
// useI18n gives translation helpers (t = translate a key, term = translate a building term).
import { useI18n } from '../../i18n/I18nProvider.jsx'
// PageTitle draws the heading block at the top of a page.
import { PageTitle } from '../../layout/PageHeader.jsx'
// useProjectContext reads the current project and permissions provided by the project layout.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// cn joins CSS class names together, skipping empty/false ones.
import { cn } from '../../lib/format.js'
// useOnline is a custom hook that returns true while the device has a network connection.
import { useOnline } from '../../lib/net.js'
// usePlan is a TanStack Query hook that fetches the project plan from the API.
import { usePlan } from '../../lib/queries.js'
// useProgressEditor wraps the logic for changing and saving the current stage's progress.
import { useProgressEditor } from '../../lib/useProgressEditor.js'
// Default import (no curly braces): the file's `export default`, a lazily loaded 3D house scene.
import LazyHouseScene from '../../three/LazyHouseScene.jsx'
// buildHouseModel turns project dimensions into the data the 3D scene draws.
import { buildHouseModel } from '../../three/houseModel.js'

// A constant object literal mapping stage kinds to short chip labels. Keys on the left, values on the right.
const SHORT = { blueprint: 'drawings', foundation: 'foundation', roof: 'roof', finishing: 'finishing' }
// Arrow function `(s) => ...` taking a stage `s`. The ternary `cond ? a : b` picks a value:
// floor stages get their label with " floor" removed and lower-cased; other kinds look up SHORT[s.kind] (bracket property access).
const chipLabel = (s) => (s.kind === 'floor' ? s.label.replace(' floor', '').toLowerCase() : SHORT[s.kind])

/** The 3D house, the stage it's at, and the steps of each stage as switches. */
// `export default function` declares the React component this file provides; the router renders it.
export default function ProgressPage() {
  // Object destructuring: take the `project`, `can` (permission check function) and `features` properties out of the context object.
  const { project, can, features } = useProjectContext()
  // Destructure the translate helpers `t` and `term` from the i18n hook.
  const { t, term } = useI18n()
  // true/false: is the device online right now? Re-renders when that changes.
  const online = useOnline()
  // Query result object for the plan: has .data, .isLoading, .error and so on.
  const plan = usePlan(project.id)
  // Progress editor object: .value (0-100), .set(), .saving, .isLast, .completeStage(), .reopenPrevious().
  const progress = useProgressEditor(project)
  // useMemo(fn, deps) runs fn once and only re-runs it when something in the deps array changes.
  const stages = useMemo(() => stagesFor(project), [project])
  // Build the 3D model only when floors or plot size change; the comment after it tells ESLint to skip its dependency check on this line.
  const model = useMemo(() => buildHouseModel(project), [project.floors, project.plotWidthFt, project.plotDepthFt]) // eslint-disable-line react-hooks/exhaustive-deps
  // useRef(null) creates { current: null }; the 3D scene puts its control methods (zoom, resetView) on scene.current.
  const scene = useRef(null)
  // Array destructuring of useState: [current value, setter function]. Starts at the project's current stage.
  const [selected, setSelected] = useState(project.stageIndex)
  // A counter; bumping it tells the 3D scene to replay its build animation.
  const [replay, setReplay] = useState(0)
  // Whether the blueprint lines are drawn in the 3D scene (starts on).
  const [blueprint, setBlueprint] = useState(true)
  // Whether the camera slowly orbits around the house (starts off).
  const [orbit, setOrbit] = useState(false)
  // Whether the "is this stage finished?" confirm dialog is open.
  const [confirm, setConfirm] = useState(false)

  // Index of the stage the project is actually at today.
  const current = project.stageIndex
  // The stage object the user has selected (array index access with [ ]).
  const stage = stages[selected]
  // Strict equality `===`: true when the selected stage is today's stage.
  const isCurrent = selected === current
  // Chained ternary: earlier stages are 100%, later stages 0%, the current stage uses the live editor value.
  const stageProgress = selected < current ? 100 : selected > current ? 0 : progress.value
  // How far the 3D build animation should go, as a stage number with a fraction (e.g. 2.5 = halfway through stage 2).
  const target = isCurrent ? current + progress.value / 100 : selected < current ? selected + 1 : selected + 0.001
  // `&&` is logical AND; `!` is NOT. Editable only with permission, on today's stage, and if the house isn't complete.
  const editable = can('updateProgress') && isCurrent && !project.complete
  // Optional chaining `?.`: if plan.data is null/undefined, the whole expression is undefined instead of crashing.
  const planStage = plan.data?.stages[selected]
  // flatMap maps each step to its inspections array and flattens the result into one list; `??` (nullish coalescing) falls back to [] when the left side is null/undefined.
  const inspections = planStage?.steps.flatMap((s) => s.inspections) ?? []
  // Schedule summary (e.g. daysBehind) if the plan has loaded.
  const summary = plan.data?.summary
  // Steps waiting for inspection, or an empty array while loading.
  const queue = plan.data?.inspectionQueue ?? []

  // A component returns JSX: HTML-like syntax that compiles to React element calls. Parentheses let it span lines.
  return (
    // <Page> is a component; width="wide" is a string prop passed to it.
    <Page width="wide">
      {/* PageTitle receives props; values in { } are JavaScript expressions. */}
      <PageTitle
        // Translated page title.
        title={t('progress.title')}
        // Small line above the title: "Complete", or "stage 03 of 07 · walls". padStart(2, '0') pads numbers to two digits ("3" -> "03").
        kicker={project.complete ? 'Complete' : t('progress.stageOf', { n: String(current + 1).padStart(2, '0'), m: String(stages.length).padStart(2, '0'), stage: term(stages[current].label).toLowerCase() })}
        // A JSX element passed as a prop: a toggle button. `(v) => !v` flips the previous boolean; aria-pressed tells screen readers it's a toggle.
        actions={<IconButton icon={Layers} label={blueprint ? 'Hide the blueprint lines' : 'Show the blueprint lines'} onClick={() => setBlueprint((v) => !v)} aria-pressed={blueprint} variant={blueprint ? 'solid' : 'outline'} />}
        // The schedule chip, built with nested ternaries.
        meta={
          // Only when the plan summary exists, the project has started and is not complete...
          summary && project.startDate && !project.complete ? (
            // ...more than 3 days late shows a "behind" chip,
            summary.daysBehind > 3 ? (
              <Chip tone="waiting">{summary.daysBehind} days behind</Chip>
            ) : summary.daysBehind < -3 ? (
              // more than 3 days early shows "ahead" (unary minus turns -5 into 5),
              <Chip tone="approved">{-summary.daysBehind} days ahead</Chip>
            ) : (
              // otherwise "on schedule".
              <Chip tone="neutral">on schedule</Chip>
            )
            // `null` renders nothing.
          ) : null
        }
      />
      {/* Two-column grid on large screens (3D scene left, stage details right); one column on phones. In JSX, `className` replaces HTML's `class`. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        {/* The card that holds the 3D scene; tall, rounded, sticky while scrolling on large screens. data-reveal marks it for the GSAP reveal-on-scroll animation. */}
        <div data-reveal className="card relative h-[min(58vh,560px)] min-h-[320px] overflow-hidden lg:sticky lg:top-8 lg:h-[min(74vh,700px)]">
          {/* The 3D house. ref={scene} hands the scene's controls to our ref; the other props steer the animation. Self-closing tag `/>` because it has no children. */}
          <LazyHouseScene ref={scene} model={model} target={target} replayKey={replay} showBlueprint={blueprint} autoRotate={orbit} wheelZoom={false} />
          {/* Toolbar pinned to the bottom of the card, centred. */}
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
            {/* Dark translucent pill holding the tool buttons. */}
            <div className="flex gap-0.5 rounded-full bg-black/55 p-1 text-white backdrop-blur">
              {/* Replay: increase the counter, `(k) => k + 1` uses the previous value. */}
              <Tool onClick={() => setReplay((k) => k + 1)} icon={Play} label="replay" />
              {/* Orbit toggle; `active` highlights it while on. */}
              <Tool onClick={() => setOrbit((v) => !v)} icon={RotateCw} label="orbit" active={orbit} />
              {/* Zoom in; `scene.current?.zoom(...)` only calls zoom if the scene has loaded. `iconOnly` with no value means true. Hidden on small screens. */}
              <Tool onClick={() => scene.current?.zoom(0.8)} icon={Plus} label="Zoom in" iconOnly className="hidden sm:flex" />
              {/* Zoom out. */}
              <Tool onClick={() => scene.current?.zoom(1.25)} icon={Minus} label="Zoom out" iconOnly className="hidden sm:flex" />
              {/* Put the camera back where it started. */}
              <Tool onClick={() => scene.current?.resetView()} icon={Maximize2} label="Reset view" iconOnly />
            </div>
          </div>
          {/* Short-circuit rendering: `cond && <X/>` renders X only when cond is true. Shown while previewing another stage. */}
          {!isCurrent && (
            // Clicking jumps the selection back to today's stage; styled as a dark pill in the top corner.
            <button onClick={() => setSelected(current)} className="absolute start-3 top-3 rounded-full bg-black/55 px-3.5 py-2 text-meta font-semibold text-white backdrop-blur">
              Previewing {term(stage.label).toLowerCase()} · back to today
            </button>
          )}
        </div>

        {/* Right column: stage chips, stage heading, steps and actions stacked vertically. */}
        <div className="flex flex-col gap-5">
          {/* A row of chips to choose a stage. */}
          <FilterChips
            // Boolean attribute with no value: marks it for the reveal animation.
            data-reveal
            // Accessible label for the group.
            label="Stage"
            // Small chip size.
            size="sm"
            // Controlled component: the chip shown as selected comes from our state...
            value={selected}
            // ...and choosing a chip calls setSelected with its value.
            onChange={setSelected}
            // .map turns each stage into an option object `({ ... })` (parentheses needed to return an object literal from an arrow).
            // The label is a template literal `${...}`: a tick mark for finished stages, then the short label.
            options={stages.map((s) => ({ value: s.index, label: `${s.index < current || project.complete ? '✓ ' : ''}${chipLabel(s)}` }))}
          />
          {/* Stage name on the left, its percentage on the right, aligned on the text baseline. */}
          <div data-reveal className="flex items-baseline justify-between px-1">
            {/* Translated stage name. */}
            <h2 className="head">{term(stage.label)}</h2>
            {/* Percent complete in bold numeric style. */}
            <span className="num text-meta font-bold text-ink-2">{stageProgress}%</span>
          </div>
          {/* The step switches for the selected stage. */}
          <WorkItems
            // Which stage to list.
            stage={stage}
            // Its percentage, which decides which switches are on.
            progress={stageProgress}
            // Switches only work when editable AND online.
            editable={editable && online}
            // Arrow function called with the new value `v`; saves it via the editor.
            onChange={(v) => progress.set(v, 0)}
            // Inspections recorded for this stage's steps.
            inspections={inspections}
            // Show inspection badges only if the feature is on.
            showInspection={features.inspections}
          />
          {/* Offline warning, shown only to editors who have lost signal. */}
          {editable && !online && <p className="px-1 text-meta text-warn-800">{t('progress.needsSignal')}</p>}
          {/* When every step is done (100%), show the big "mark complete" button. */}
          {editable && progress.value === 100 && (
            // Clicking opens the confirm dialog; `loading` shows a spinner while saving. `block` makes it full width.
            <Button variant="primary" size="lg" block onClick={() => setConfirm(true)} loading={progress.saving}>
              {/* Last stage says "mark the house complete", otherwise "mark <stage> complete". */}
              {progress.isLast ? 'mark the house complete' : t('progress.markComplete', { stage: term(stage.label).toLowerCase() })}
            </Button>
          )}
          {/* Reopen link: needs permission, today's stage, and either a previous stage to go back to or a completed house. `||` is logical OR. */}
          {can('updateProgress') && isCurrent && (current > 0 || project.complete) && (
            // Passing the function itself (no parentheses) so React calls it on click.
            <button onClick={progress.reopenPrevious} className="self-center text-meta font-semibold text-ink-3 hover:text-ink">
              {/* Wording depends on whether the whole house is complete. */}
              {project.complete ? 'reopen finishing' : t('progress.reopen')}
            </button>
          )}

          {/* Inspection queue: only when inspections are on and something is waiting. */}
          {features.inspections && queue.length > 0 && (
            <section data-reveal className="flex flex-col gap-3">
              {/* Section heading with a count, built with a template literal. */}
              <SectionHead title="Inspections" meta={`${queue.length} waiting`} />
              {/* ListCard wraps rows in a card; the rows are its children. */}
              <ListCard>
                {/* slice(0, 4) keeps the first four items; map renders one row per item. */}
                {queue.slice(0, 4).map((item) => (
                  <ListRow
                    // `key` must be unique among siblings so React can track each row between renders.
                    key={`${item.stageIndex}-${item.step}`}
                    // e.g. "Walls: plaster" (stage name, then step in lower case).
                    title={`${term(item.stage)}: ${term(item.step).toLowerCase()}`}
                    // If there was a previous inspection it must be re-checked, otherwise it's never been inspected.
                    subtitle={item.last ? 'Re-check after fixes' : 'Done, not inspected yet'}
                    // Status chip with the last result, or 'NONE' when there is none (`?.` then `??`).
                    trailing={<StatusChip kind="inspection" status={item.last?.result ?? 'NONE'} />}
                    // Link to the record-inspection page for permitted users; encodeURIComponent makes the step name safe inside a URL. `undefined` means no link.
                    to={can('recordInspection') ? `/p/${project.id}/verify/inspection/${item.stageIndex}:${encodeURIComponent(item.step)}` : undefined}
                  />
                ))}
              </ListCard>
            </section>
          )}
        </div>
      </div>

      {/* "Is this stage finished?" dialog. */}
      <ConfirmDialog
        // Open/closed comes from state...
        open={confirm}
        // ...and the dialog calls setConfirm(false) when it wants to close.
        onOpenChange={setConfirm}
        // Title wording for the last stage vs any other stage.
        title={progress.isLast ? 'Mark the house complete?' : `${term(stage.label)} is finished?`}
        // Explain who is notified, depending on whether inspections are on.
        description={features.inspections ? 'The owner and the inspector are told, and the next stage starts.' : 'The next stage starts.'}
        // Text on the confirm button.
        confirmLabel="yes, it's finished"
        // Spinner while saving.
        loading={progress.saving}
        // On confirm, save; the callback runs after success. `(a, b, c)` is the comma operator: run all three in order —
        // close the dialog, select the next stage (Math.min keeps it within the list) and show a success toast.
        onConfirm={() => progress.completeStage(() => (setConfirm(false), setSelected(Math.min(stages.length - 1, current + 1)), toast.success(`${term(stage.label)} complete`)))}
      />
    </Page>
  )
}

// A small, file-private component for the 3D toolbar buttons.
// Its props are destructured in the parameter list; `icon: Icon` renames the prop to a capitalised name,
// because JSX treats capitalised names as components (<Icon />) and lower-case names as HTML tags.
function Tool({ onClick, icon: Icon, label, active, iconOnly, className }) {
  return (
    // A plain HTML button element.
    <button
      // Click handler passed in from the parent.
      onClick={onClick}
      // Screen-reader name (important for icon-only buttons).
      aria-label={label}
      // Announces on/off state for toggles; undefined means it isn't a toggle.
      aria-pressed={active}
      // cn() combines: base pill styles, square vs padded shape, white when active or a light hover otherwise, plus any extra classes from the parent.
      className={cn('flex h-10 items-center gap-1.5 rounded-full text-meta font-semibold transition', iconOnly ? 'w-10 justify-center' : 'px-3.5', active ? 'bg-white text-ink' : 'hover:bg-white/15', className)}
    >
      {/* Render the icon component that was passed in; aria-hidden hides it from screen readers. */}
      <Icon size={16} aria-hidden />
      {/* Show the text label unless this is an icon-only button. */}
      {!iconOnly && label}
    </button>
  )
}
