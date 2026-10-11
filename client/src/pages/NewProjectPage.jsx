// /projects/new (any signed-in person becomes the owner). Four steps with a live
// 3D preview: the house, plot size and floors, who builds it, budget / start
// date / site pin. Validation rules come from shared/houseConfig.js.
//
// FILE OVERVIEW
// - Route: /projects/new  (inside the signed-in app shell; RequireAuth guard).
// - Who sees it: any signed-in person. Whoever creates the project becomes its
//   OWNER.
// - How it works: a multi-step "wizard". All answers live in ONE form object in
//   React state; `step` (0-3) decides which group of fields is shown. "next"
//   validates the current step, and on the last step submits everything with
//   the useCreateProject() mutation, then navigates to the new project /p/:id.
// - Step 0: city, area/society, optional name.
//   Step 1: plot size (preset or custom width × depth) and number of floors.
//   Step 2: contract type (who builds it).
//   Step 3: budget, start date, "drawings approved" toggle, site map pin.
// - Beside the form, <Preview> shows a live 3D model of the house (Three.js,
//   lazy-loaded) that rebuilds 300 ms after the size stops changing.
// - Depends on: React hooks, React Router, sonner, lucide icons, shared budget
//   and house config rules, our UI kit, format/motion helpers, the
//   create-project mutation and the three/ 3D model code.

// Four React hooks: useEffect (side effects), useMemo (cache a computed value), useRef (mutable box / DOM handle), useState (state).
import { useEffect, useMemo, useRef, useState } from 'react'
// useNavigate returns a function for changing page from code.
import { useNavigate } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icons representing the four contract types.
import { Building, Hammer, Landmark, UserCog } from 'lucide-react'
// The minimum allowed budget, stored in paisa (1 rupee = 100 paisa) to avoid decimal maths.
import { MIN_BUDGET_PAISA } from '@shared/budget.js'
// Shared house rules/data: city list, contract types, floor limit, plot limits and presets, and helper functions.
import { CITIES, CONTRACT_TYPES, MAX_FLOORS, PLOT_LIMITS, PLOT_PRESETS, coveredAreaSqft, plotArea, plotErrors, storeyLabel } from '@shared/houseConfig.js'
// Standard page container.
import { Page } from '../components/Page.jsx'
// Map widget for dropping a pin on the site location.
import { SitePinField } from '../components/SitePinField.jsx'
// UI kit components used by the wizard.
import { Button, Field, Input, MoneyInput, Notice, OptionCards, Select, Stepper, Toggle } from '../components/ui/index.js'
// Page heading component (also sets the tab title and back link).
import { PageTitle } from '../layout/PageHeader.jsx'
// cn joins class names, formatPKR formats rupees, today() returns today's date as 'YYYY-MM-DD'.
import { cn, formatPKR, today } from '../lib/format.js'
// dirSign() is 1 or -1 depending on text direction (LTR/RTL); the rest are GSAP animation helpers.
import { dirSign, gsap, reduced, useGSAP } from '../lib/motion.js'
// Mutation hook that creates the project on the server.
import { useCreateProject } from '../lib/queries.js'
// Default import (no braces) of the lazily loaded 3D scene component.
import LazyHouseScene from '../three/LazyHouseScene.jsx'
// Builds the 3D model description from plot size and floors.
import { buildHouseModel } from '../three/houseModel.js'

// Labels for the four steps, in order; the array index is the step number.
const STEPS = ['the house', 'size', 'who builds it', 'budget']
// Maps each contract type key to its icon component.
const CONTRACT_ICONS = { GREY_STRUCTURE: Building, LABOUR_ONLY: Hammer, TURNKEY: Landmark, SELF_MANAGED: UserCog }

// A custom hook (name starts with "use"): returns `value`, but only after it stopped changing for `ms` milliseconds ("debounce").
function useDebounced(value, ms) {
  // v holds the delayed copy; it starts equal to value.
  const [v, setV] = useState(value)
  // Runs every time value or ms changes.
  useEffect(() => {
    // setTimeout schedules setV(value) after ms; it returns an id t.
    const t = setTimeout(() => setV(value), ms)
    // Cleanup: if value changes again before the timer fires, cancel the old timer.
    return () => clearTimeout(t)
  }, [value, ms])
  // Return the delayed value.
  return v
}

// Default export: the wizard page.
export default function NewProjectPage() {
  // Function to change page from code.
  const navigate = useNavigate()
  // Mutation: create.mutate, create.isPending, create.error.
  const create = useCreateProject()
  // Current step index, starting at 0.
  const [step, setStep] = useState(0)
  // Direction of the last step change: 1 = forward, -1 = back (used by the slide animation).
  const [dir, setDir] = useState(1)
  // tried = user pressed "next" on this step; errors are only shown after that.
  const [tried, setTried] = useState(false)
  // All wizard answers in one state object, with starting defaults.
  const [form, setForm] = useState({
    // Optional custom name.
    name: '',
    // Default city.
    city: 'Lahore',
    // Optional area/society.
    address: '',
    // Selected plot preset key.
    plotSize: 'MARLA_10',
    // Plot width in feet (used for custom size).
    widthFt: 35,
    // Plot depth in feet.
    depthFt: 65,
    // Number of floors.
    floors: 2,
    // Who builds it.
    contractType: 'GREY_STRUCTURE',
    // Budget in paisa; null = not entered yet.
    budgetPaisa: null,
    // Today's date as the default start.
    startDate: today(),
    // Toggle: drawings already approved.
    drawingsApproved: true,
    // Map pin { lat, lng } or null.
    pin: null,
  })
  // Curried change-handler maker: set('city') returns (v) => …. setForm((f) => …) uses the updater form (f = latest form).
  // v?.target ? v.target.value : v → if v is a DOM event take the input's text, otherwise use v directly (Stepper, Toggle etc. pass plain values).
  // ({ ...f, [k]: … }) — parentheses make the arrow return an object; [k] is a computed key.
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))
  // true when "Custom" plot size is selected.
  const custom = form.plotSize === 'CUSTOM'
  // Plot dimensions: custom → convert typed values to numbers with Number(); preset → look up by key with bracket notation.
  const dims = custom ? { widthFt: Number(form.widthFt), depthFt: Number(form.depthFt) } : PLOT_PRESETS[form.plotSize]
  // Size validation errors object (only checked for custom sizes).
  const sizeErrors = custom ? plotErrors(dims) : {}
  // Valid when the error object has no keys (! turns 0 into true).
  const sizeOk = !Object.keys(sizeErrors).length
  // Area info for the plot ({ sqft, approx, … }).
  const area = plotArea(dims)
  // Human-readable size: "35 × 65 ft" for custom, otherwise the preset's label.
  const sizeLabel = custom ? `${dims.widthFt} × ${dims.depthFt} ft` : PLOT_PRESETS[form.plotSize].label
  // Project name: the typed name with spaces trimmed, or (||) a generated one if empty.
  const name = form.name.trim() || `${sizeLabel} house, ${form.city}`

  // Error messages per field; each is either a string (error) or false (fine), thanks to `condition && 'message'`.
  const errors = {
    // No city chosen → message.
    city: !form.city && 'Choose the city',
    // Budget missing or below the minimum → message (null >= number is false, so empty budget also fails).
    budget: !(form.budgetPaisa >= MIN_BUDGET_PAISA) && 'Enter your budget: at least Rs 1 lakh',
  }
  // One true/false per step: is that step's input valid? Step 2 (contract type) always is.
  const stepValid = [!errors.city, sizeOk, true, !errors.budget]

  // Jump to step `to`.
  const go = (to) => {
    // Remember direction for the animation (ternary).
    setDir(to > step ? 1 : -1)
    // Change the visible step.
    setStep(to)
    // Hide errors on the new step until "next" is pressed there.
    setTried(false)
    // Scroll to the top; smooth unless the user prefers reduced motion.
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })
  }
  // "next" button handler.
  const next = () => {
    // Start showing errors for this step.
    setTried(true)
    // Stop here if the current step is invalid.
    if (!stepValid[step]) return
    // Not on the last step yet → go forward one step…
    if (step < STEPS.length - 1) go(step + 1)
    // …otherwise submit the whole form.
    else submit()
  }
  // Arrow function with an expression body: calls create.mutate(variables, callbacks).
  // (It's defined after `next` but that's fine: it's only called later, when the user clicks.)
  const submit = () =>
    create.mutate(
      // First argument: the data sent to the server.
      {
        // Shorthand property: `name` means name: name.
        name,
        city: form.city,
        // Trimmed address, or undefined to leave it out.
        address: form.address.trim() || undefined,
        // 'CUSTOM' or the preset key.
        plotSize: custom ? 'CUSTOM' : form.plotSize,
        // Width/depth are only sent for custom plots.
        plotWidthFt: custom ? dims.widthFt : undefined,
        plotDepthFt: custom ? dims.depthFt : undefined,
        floors: form.floors,
        contractType: form.contractType,
        budgetPaisa: form.budgetPaisa,
        // Empty date → undefined.
        startDate: form.startDate || undefined,
        drawingsApproved: form.drawingsApproved,
        // Optional chaining: undefined when no pin was set.
        siteLat: form.pin?.lat,
        siteLng: form.pin?.lng,
      },
      // Second argument: callbacks.
      {
        // ({ id }) destructures the id from the server's response object.
        onSuccess: ({ id }) => {
          // Success toast with a description that depends on the contract type.
          toast.success(`${name} is ready`, { description: form.contractType === 'SELF_MANAGED' ? 'Add your first purchase when you buy something.' : 'Invite your contractor from Settings.' })
          // Open the new project.
          navigate(`/p/${id}`)
        },
      },
    )

  // Ref to the form panel's DOM element, used by the slide-in animation.
  const panel = useRef(null)
  // Animate the panel each time the step changes.
  useGSAP(
    () => {
      // Skip if reduced motion is requested or the element isn't there.
      if (reduced() || !panel.current) return
      // Slide in from 28px to the side (direction depends on dir and text direction) while fading in; clearProps removes the leftover transform afterwards.
      gsap.fromTo(panel.current, { x: 28 * dir * dirSign(), autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: 'power3.out', clearProps: 'transform' })
    },
    // dependencies: re-run the animation whenever step changes.
    { dependencies: [step] },
  )

  // The page JSX.
  return (
    // Wide page container.
    <Page width="wide">
      {/* back={{ … }} passes an object prop (outer braces = JSX expression, inner = object). */}
      <PageTitle title="Add a house" back={{ to: '/', label: 'Back to your houses' }} />
      {/* Two-column grid on large screens: form on the left, preview on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
        {/* order-2 puts the form below the preview on phones, order-1 puts it first on large screens. */}
        <div className="order-2 lg:order-1">
          {/* Progress indicator block. */}
          <div data-reveal className="mb-5">
            {/* Row of progress bars; aria-hidden because the text below says the same thing. */}
            <div className="flex gap-1.5" aria-hidden>
              {/* .map with (item, index): one bar per step; completed/current bars are dark. */}
              {STEPS.map((s, i) => (
                <span key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-500', i <= step ? 'bg-ink' : 'bg-line')} />
              ))}
            </div>
            {/* aria-live="polite" makes screen readers announce the text when it changes. step + 1 because humans count from 1. */}
            <p className="mt-2.5 text-meta font-semibold text-ink-3" aria-live="polite">
              Step {step + 1} of {STEPS.length}, {STEPS[step]}
            </p>
          </div>

          {/* The animated panel; ref connects it to panel.current. */}
          <div ref={panel} className="flex flex-col gap-5">
            {/* Step 0: only rendered when step === 0 (=== is strict equality). */}
            {step === 0 && (
              // Fragment groups the fields without an extra wrapper element.
              <>
                {/* tried && errors.city: only show the error after "next" was pressed. */}
                <Field label="City" error={tried && errors.city}>
                  {/* Controlled select; set('city') receives the change event. */}
                  <Select value={form.city} onChange={set('city')}>
                    {/* One <option> per city; with no value attribute, the option's text is its value. */}
                    {CITIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                {/* Optional free-text address, limited to 200 characters. */}
                <Field label="Area or society" optional>
                  <Input value={form.address} onChange={set('address')} placeholder="e.g. Plot 214, DHA Phase 6" maxLength={200} />
                </Field>
                {/* The hint shows the name that will be used if this stays empty. */}
                <Field label="What do you call it?" optional hint={`Leave it empty to use “${name}”.`}>
                  <Input value={form.name} onChange={set('name')} placeholder="e.g. House 27" maxLength={80} />
                </Field>
              </>
            )}

            {/* Step 1: plot size and floors. */}
            {step === 1 && (
              <>
                <Field label="Plot size">
                  {/* role="radiogroup" tells assistive tech these buttons act like radio buttons. */}
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Plot size">
                    {/* Object.entries turns { KEY: preset } into [[KEY, preset], …]; spread [...a, extra] appends a "Custom" entry; ([key, p]) destructures each pair. */}
                    {[...Object.entries(PLOT_PRESETS), ['CUSTOM', { label: 'Custom' }]].map(([key, p]) => {
                      // on = is this option the selected one?
                      const on = form.plotSize === key
                      return (
                        <button
                          // Unique key for the list.
                          key={key}
                          // Not a submit button.
                          type="button"
                          // Acts as a radio option for accessibility…
                          role="radio"
                          // …and reports whether it's checked.
                          aria-checked={on}
                          // Select this size; for presets also copy the preset's width/depth. ...(cond ? {…} : {}) conditionally spreads extra properties.
                          onClick={() => setForm((f) => ({ ...f, plotSize: key, ...(key !== 'CUSTOM' ? { widthFt: p.widthFt, depthFt: p.depthFt } : {}) }))}
                          // Tile styling; dark filled when selected, white outlined otherwise.
                          className={cn(
                            'flex h-14 flex-col items-start justify-center rounded-tile border px-4 text-start transition',
                            on ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-line-strong',
                          )}
                        >
                          {/* Preset label, e.g. "10 Marla". */}
                          <span className="text-body font-bold">{p.label}</span>
                          {/* Second line: dimensions, or "width × depth" for the custom tile. */}
                          <span className={cn('text-2xs', on ? 'text-white/70' : 'text-ink-3')}>{key === 'CUSTOM' ? 'width × depth' : `${p.widthFt} × ${p.depthFt} ft`}</span>
                        </button>
                      )
                    })}
                  </div>
                </Field>
                {/* Width and depth steppers appear only for a custom plot. */}
                {custom && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* PLOT_LIMITS.width is [min, max]; [0] and [1] read them. group makes Field use a fieldset-style label. */}
                    <Field label="Width (front)" error={tried && sizeErrors.widthFt} hint={`${PLOT_LIMITS.width[0]}–${PLOT_LIMITS.width[1]} ft`} group>
                      {/* Stepper = number input with − / + buttons, clamped to min/max. */}
                      <Stepper value={form.widthFt} onChange={set('widthFt')} min={PLOT_LIMITS.width[0]} max={PLOT_LIMITS.width[1]} unit="ft" label="Plot width" />
                    </Field>
                    {/* Same for depth. */}
                    <Field label="Depth" error={tried && sizeErrors.depthFt} hint={`${PLOT_LIMITS.depth[0]}–${PLOT_LIMITS.depth[1]} ft`} group>
                      <Stepper value={form.depthFt} onChange={set('depthFt')} min={PLOT_LIMITS.depth[0]} max={PLOT_LIMITS.depth[1]} unit="ft" label="Plot depth" />
                    </Field>
                  </div>
                )}
                <Field label="Floors" group>
                  {/* Clamp floors between 1 and MAX_FLOORS: Number(v) || 1 handles empty/NaN; set('floors') returns the handler, which we call immediately with (…). */}
                  <Stepper value={form.floors} onChange={(v) => set('floors')(Math.min(MAX_FLOORS, Math.max(1, Number(v) || 1)))} min={1} max={MAX_FLOORS} label="Floors" className="max-w-xs" />
                </Field>
                {/* Summary line: plot area and covered area (toLocaleString('en-PK') adds thousands separators); '—' / 'enter a size' when the size is invalid. */}
                <p className="rounded-tile bg-white px-4 py-3 text-meta text-ink-2 ring-1 ring-line">
                  <span className="font-bold text-ink">{sizeOk ? `${area.sqft.toLocaleString('en-PK')} sq ft` : '—'}</span> plot {sizeOk && area.approx} ·{' '}
                  {sizeOk ? `${coveredAreaSqft(dims, form.floors).toLocaleString('en-PK')} sq ft covered over ${storeyLabel(form.floors).toLowerCase()}` : 'enter a size'}
                </p>
              </>
            )}

            {/* Step 2: who builds it. */}
            {step === 2 && (
              <>
                {/* OptionCards = a set of large selectable cards. */}
                <OptionCards
                  label="Who builds it"
                  // One card per row.
                  columns={1}
                  value={form.contractType}
                  // Receives the chosen value directly (not an event).
                  onChange={set('contractType')}
                  // Build the options array from CONTRACT_TYPES: ([value, c]) destructures each entry; `value` shorthand = value: value.
                  options={Object.entries(CONTRACT_TYPES).map(([value, c]) => ({ value, label: c.label, description: c.description, icon: CONTRACT_ICONS[value] }))}
                />
                {/* Extra explanation when the owner manages the build themselves. */}
                {form.contractType === 'SELF_MANAGED' && (
                  <Notice tone="neutral" title="You run the site yourself">
                    No contractor approvals, payments or inspections. You record what you buy and how far the house has got; a relative can help verify.
                  </Notice>
                )}
              </>
            )}

            {/* Step 3: budget, start date, drawings toggle, site pin. */}
            {step === 3 && (
              <>
                <Field label="Your budget" error={tried && errors.budget} hint="Your own number. You'll see how much of it you've used, and when you're going over.">
                  {/* MoneyInput shows rupees but reports paisa; autoFocus puts the cursor here immediately. */}
                  <MoneyInput value={form.budgetPaisa} onChange={set('budgetPaisa')} placeholder="e.g. 1,80,00,000" className="text-title font-bold" autoFocus />
                </Field>
                {/* Native date picker; value is a 'YYYY-MM-DD' string. */}
                <Field label="Start date" optional>
                  <Input type="date" value={form.startDate} onChange={set('startDate')} />
                </Field>
                {/* Wrapping in <label> makes the whole card clickable for the toggle. */}
                <label className="card flex items-center gap-3 px-4 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold">Drawings already approved</span>
                    <span className="block text-meta text-ink-3">Start at the foundation instead of the drawings stage</span>
                  </span>
                  {/* Toggle switch; checked is a boolean, onChange gives the new boolean. */}
                  <Toggle checked={form.drawingsApproved} onChange={set('drawingsApproved')} label="Drawings already approved" />
                </label>
                {/* Map pin picker; onChange receives { lat, lng } or null. */}
                <SitePinField pin={form.pin} onChange={set('pin')} />
              </>
            )}

            {/* Server error from creating the project, if any. */}
            {create.error && <Notice tone="error">{create.error.message}</Notice>}
            {/* Navigation buttons row. */}
            <div className="flex gap-2 pt-1">
              {/* "back" only after the first step. */}
              {step > 0 && (
                <Button variant="secondary" size="lg" onClick={() => go(step - 1)}>
                  back
                </Button>
              )}
              {/* Main button; flex-1 makes it fill the remaining width; shows a spinner while creating. */}
              <Button variant="primary" size="lg" className="flex-1" onClick={next} loading={create.isPending}>
                {/* Label: "next: <following step>" or, on the last step, "create the house". */}
                {step < STEPS.length - 1 ? `next: ${STEPS[step + 1]}` : 'create the house'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live 3D preview; dims is null while the size is invalid. */}
        <Preview dims={sizeOk ? dims : null} floors={form.floors} name={name} budget={form.budgetPaisa} />
      </div>
    </Page>
  )
}

/** Live 3D of the house as it will be: builds once, then follows every size change smoothly. */
// Props destructured in the parameter list.
function Preview({ dims, floors, name, budget }) {
  // Encode the size as a string like "35x65x2" (or null), and debounce it by 300 ms so typing doesn't rebuild the model on every keystroke.
  const settled = useDebounced(dims ? `${dims.widthFt}x${dims.depthFt}x${floors}` : null, 300)
  // last = the most recent valid size; it keeps the old model while the size is temporarily invalid.
  const [last, setLast] = useState(settled)
  // Updating state during render (allowed by React for "derived" state): adopt a new valid settled value.
  if (settled && settled !== last) setLast(settled)
  // useMemo(fn, deps): recompute the 3D model only when `last` changes.
  const model = useMemo(() => {
    // No size yet → no model.
    if (!last) return null
    // "35x65x2".split('x') → ['35','65','2']; .map(Number) converts each to a number; array destructuring names them.
    const [widthFt, depthFt, f] = last.split('x').map(Number)
    // Build the model description; floors: f renames f to the floors property.
    return buildHouseModel({ widthFt, depthFt, floors: f })
  }, [last])
  return (
    // <aside> for side content; sticky on large screens so it stays visible while scrolling.
    <aside data-reveal className="order-1 lg:sticky lg:top-8 lg:order-2">
      <div className="card overflow-hidden">
        {/* Fixed-height canvas area, taller on bigger screens. */}
        <div className="relative h-56 sm:h-72 lg:h-[440px]">
          {/* Render the 3D scene only when a model exists; many props configure it (autoRotate is a boolean shorthand; interactive={false} disables dragging). */}
          {model && <LazyHouseScene model={model} target={model.stageCount} replayKey={1} pace={1.6} autoRotate interactive={false} quality="preview" distance={0.9} />}
          {/* Small "preview" badge in the top corner. */}
          <span className="absolute start-3 top-3 rounded-full bg-black/45 px-3 py-1.5 text-2xs font-bold text-white backdrop-blur">preview</span>
        </div>
        {/* Caption under the preview: name, storeys and budget. */}
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-bold">{name}</p>
            {/* storeyLabel(2) → e.g. "Double storey". */}
            <p className="text-meta text-ink-3">{storeyLabel(floors)}</p>
          </div>
          {/* Budget appears once it's valid; formatPKR converts paisa to rupees text; { compact: true } asks for the short lakh/crore style. */}
          {budget >= MIN_BUDGET_PAISA && <p className="shrink-0 text-meta font-bold">{formatPKR(budget, { compact: true })}</p>}
        </div>
      </div>
    </aside>
  )
}
