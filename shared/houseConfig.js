// FILE: shared/houseConfig.js
// Shared vocabulary for houses: plot sizes, contract types, and the stage list
// that the timeline, the plan, the server rules and the 3D model all build on.
// Imported by both sides: the server (services/projects, plan, lib/util,
// routes/projects, scripts/smoke) and the client (three/houseModel, lib/derive,
// lib/format, useProgressEditor, NewProjectPage, HomePage, ProjectSettingsPage).
// Invariants: plots are entered in feet and drawn in metres; a project has
// floors + 4 stages (blueprint, foundation, one per floor, roof, finishing);
// progress is measured in "stage units" (stageIndex + stageProgress / 100);
// "today" for site records is Pakistan time (UTC+5), see todayPK.
// Depends on nothing; features.js, budget.js and estimates.js build on it.

// --- Unit conversions (module-private constants, not exported) ---
const FT = 0.3048 // metres in one foot
const SQFT_PER_M2 = 10.7639 // square feet in one square metre
const MARLA_SQFT = 225 // one marla (local land unit) in square feet
const KANAL_SQFT = 20 * MARLA_SQFT // one kanal = 20 marla

/** Common plot sizes in feet. */
// Lookup table: preset key -> { label, widthFt, depthFt }. `export` makes it
// importable from other files; `const` means the name cannot be reassigned.
export const PLOT_PRESETS = {
  MARLA_5: { label: '5 Marla', widthFt: 25, depthFt: 45 },
  MARLA_7: { label: '7 Marla', widthFt: 30, depthFt: 52 },
  MARLA_10: { label: '10 Marla', widthFt: 35, depthFt: 65 },
  KANAL_1: { label: '1 Kanal', widthFt: 50, depthFt: 90 },
  KANAL_2: { label: '2 Kanal', widthFt: 75, depthFt: 120 },
}
// Every allowed plot-size key: the preset keys (spread out of Object.keys)
// followed by 'CUSTOM'.
export const PLOT_SIZES = [...Object.keys(PLOT_PRESETS), 'CUSTOM']

/** Sizes (feet) the 3D site draws well, and the depth ÷ width shapes allowed. */
// Each value is a [min, max] pair (a two-item array).
export const PLOT_LIMITS = { width: [20, 80], depth: [30, 150], ratio: [0.6, 5] }

// Arrow helper: keep `v` between `lo` and `hi` (Math.max raises it to lo,
// Math.min lowers it to hi).
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// Arrow helper: round to two decimal places.
const round2 = (v) => Math.round(v * 100) / 100

/**
 * Gaps around the house, anchored on the footprints the 5 Marla, 10 Marla and
 * 1 Kanal houses have always had, and interpolated in between (extended past
 * the ends), so a custom size grows smoothly from its neighbours.
 */
// Arrays of [x, y] pairs used as lookup tables by lerpTable below.
const SIDE_GAP = [[25, 0.3], [35, 0.45], [50, 1.1]] // plot width ft → gap on each side (m)
const FRONT_YARD = [[45, 2.7], [65, 4.8], [90, 8.4]] // plot depth ft → front yard (m)
const BACK_GAP = 1.0 // fixed gap behind the house (m)
const MIN_SIDE = 0.3 // keeps the boundary wall off the house
const MIN_FRONT = 2.7 // room for scaffolding, the drive and the material stock
const MAX_HOUSE = { w: 22, d: 26 } // largest house footprint drawn (m)

// Piecewise-linear lookup over [[x, y], ...] sorted by x. Outside the table it
// keeps following the first or last segment instead of clamping, so a 20 ft
// or 80 ft plot still gets a sensible gap rather than the 25 ft or 50 ft one.
function lerpTable(table, x) {
  // `.findIndex` returns the index of the first pair whose x0 is above x, or
  // -1 if none. `([x0])` destructures the first item of each pair.
  const next = table.findIndex(([x0]) => x < x0)
  // Segment to use: the one containing x, or the first/last one beyond the ends.
  const i = next === -1 ? table.length - 2 : Math.max(0, next - 1)
  // Array destructuring: unpack the two ends of the chosen segment.
  const [x0, y0] = table[i]
  const [x1, y1] = table[i + 1]
  // Straight-line interpolation between (x0, y0) and (x1, y1).
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)
}

/** Width and depth in feet for a preset key, or the custom size given. */
// The parameter is destructured: the caller passes one object and we read
// three of its properties by name.
export function plotDims({ plotSize, widthFt, depthFt }) {
  const preset = PLOT_PRESETS[plotSize] // undefined when not a preset key
  // Ternary: preset sizes if found, else the custom numbers (Number() converts
  // strings typed in a form into numbers).
  return preset ? { widthFt: preset.widthFt, depthFt: preset.depthFt } : { widthFt: Number(widthFt), depthFt: Number(depthFt) }
}

/** The preset key matching a size exactly, or CUSTOM. */
export function plotKeyFor({ widthFt, depthFt }) {
  // `.find` returns the first key whose preset matches both sizes, or
  // undefined; `?? 'CUSTOM'` supplies the fallback for undefined.
  return Object.keys(PLOT_PRESETS).find((k) => PLOT_PRESETS[k].widthFt === Number(widthFt) && PLOT_PRESETS[k].depthFt === Number(depthFt)) ?? 'CUSTOM'
}

/** Field messages for a custom plot size (shared by the form and the server). */
export function plotErrors({ widthFt, depthFt }) {
  const errors = {} // empty object; we add a property per bad field
  const [w0, w1] = PLOT_LIMITS.width // destructure min and max width
  const [d0, d1] = PLOT_LIMITS.depth // destructure min and max depth
  const w = Number(widthFt)
  const d = Number(depthFt)
  // Written as !(inside range) so NaN (from bad input) also counts as an error.
  if (!(w >= w0 && w <= w1)) errors.widthFt = `Width must be between ${w0} and ${w1} ft`
  if (!(d >= d0 && d <= d1)) errors.depthFt = `Depth must be between ${d0} and ${d1} ft`
  // Only check the shape when both sizes are valid.
  if (!errors.widthFt && !errors.depthFt) {
    const [r0, r1] = PLOT_LIMITS.ratio
    if (d / w < r0 || d / w > r1) errors.depthFt = 'That shape is too long or too wide for a house plot'
  }
  return errors // {} means no errors
}

/**
 * Plot and covered footprint in metres (x = width, z = depth, front is +z).
 * Sizes outside the limits are clamped so the 3D gate, stair tower and site
 * stock always fit; invalid input falls back to 10 Marla.
 */
export function plotGeometry(dims) {
  const raw = plotDims(dims) // sizes in feet
  // Number.isFinite rejects NaN/Infinity. `...PLOT_LIMITS.width` spreads the
  // [min, max] array into clamp's lo and hi arguments. 35/65 = 10 Marla.
  const widthFt = Number.isFinite(raw.widthFt) ? clamp(raw.widthFt, ...PLOT_LIMITS.width) : 35
  const depthFt = Number.isFinite(raw.depthFt) ? clamp(raw.depthFt, ...PLOT_LIMITS.depth) : 65
  const w = widthFt * FT // plot width in metres
  const d = depthFt * FT // plot depth in metres
  // The house is what is left after the gaps: a side gap on both sides, a
  // fixed gap at the back and a front yard, each never smaller than its
  // minimum. Very large plots cap the house at MAX_HOUSE so the model stays
  // a house, not a hall; the extra plot becomes yard. House sizes are rounded
  // to 0.1 m, then the gaps are recomputed from the rounded house so that
  // plot = house + gaps holds exactly in the 3D scene.
  const houseW = Math.min(MAX_HOUSE.w, w - 2 * Math.max(MIN_SIDE, lerpTable(SIDE_GAP, widthFt)))
  const houseD = Math.min(MAX_HOUSE.d, d - BACK_GAP - Math.max(MIN_FRONT, lerpTable(FRONT_YARD, depthFt)))
  // Round each house side to one decimal (x10, round, /10).
  const house = { w: Math.round(houseW * 10) / 10, d: Math.round(houseD * 10) / 10 }
  // Object literal; `widthFt,` is shorthand for `widthFt: widthFt`.
  return {
    widthFt,
    depthFt,
    plot: { w: round2(w), d: round2(d) }, // plot size in metres
    house,
    backGap: BACK_GAP,
    sideGap: round2((w - house.w) / 2), // gap on each side
    frontYard: round2(d - BACK_GAP - house.d), // whatever depth is left in front
  }
}

/** Plot area in square feet, and "≈ 10 marla" / "≈ 1.5 kanal" (225 sq ft marla). */
export function plotArea({ widthFt, depthFt }) {
  const sqft = Math.round(Number(widthFt) * Number(depthFt))
  // Rounded to the nearest half marla/kanal, which is how people talk about plots.
  const half = (v) => Math.round(v * 2) / 2
  // Template literals with `${...}` placeholders; kanal for big plots, marla otherwise.
  const approx = sqft >= KANAL_SQFT ? `≈ ${half(sqft / KANAL_SQFT)} kanal` : `≈ ${half(sqft / MARLA_SQFT)} marla`
  return { sqft, approx } // shorthand properties
}

/** "10 Marla · 35 × 65 ft" for a preset, "28 × 58 ft · ≈ 7 marla" for a custom plot. */
export function plotLabel(p) {
  // Destructure the result of plotDims. `p.plotWidthFt ?? p.widthFt` accepts
  // either the database field name or the form field name.
  const { widthFt, depthFt } = plotDims({ plotSize: p.plotSize, widthFt: p.plotWidthFt ?? p.widthFt, depthFt: p.plotDepthFt ?? p.depthFt })
  const size = `${widthFt} × ${depthFt} ft`
  const preset = PLOT_PRESETS[p.plotSize]
  // Preset: "label · size"; custom: "size · approx area".
  return preset ? `${preset.label} · ${size}` : `${size} · ${plotArea({ widthFt, depthFt }).approx}`
}

// Contract types: key -> { label, description } shown when creating a project.
export const CONTRACT_TYPES = {
  GREY_STRUCTURE: {
    label: 'Grey structure',
    description: 'Contractor supplies materials and labour for the structure. You finish the house.',
  },
  LABOUR_ONLY: {
    label: 'Labour only',
    description: 'Contractor provides labour at a rate. You buy all materials.',
  },
  TURNKEY: {
    label: 'Turnkey',
    description: 'Contractor delivers the finished house for an agreed price.',
  },
  SELF_MANAGED: {
    label: 'Self-managed',
    description: 'You coordinate workers and suppliers yourself.',
  },
}

// Cities offered in the new-project form (a plain array of strings).
export const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Sialkot', 'Gujranwala', 'Quetta', 'Hyderabad', 'Bahawalpur']

// Floors are counted including the ground floor: floors = 2 is a double storey.
export const MAX_FLOORS = 5
// Floor names by index (0 = ground).
const ORDINALS = ['Ground', 'First', 'Second', 'Third', 'Fourth']

// Arrow function returning e.g. "First floor" via a template literal.
const floorName = (k) => `${ORDINALS[k]} floor`

// "Single storey", "Double storey", ... for 1..5 floors (arrays start at 0,
// hence `floors - 1`).
export function storeyLabel(floors) {
  return ['Single storey', 'Double storey', 'Triple storey', '4 storeys', '5 storeys'][floors - 1]
}

/** Planned length of each kind of stage, in days. */
// Lookup table: stage kind -> days.
const DURATION_DAYS = { blueprint: 30, foundation: 45, floor: 60, roof: 30, finishing: 90 }

/**
 * Stages in build order. `steps[].at` is the stage progress (%) at which that
 * step is complete; `inspect` marks structural steps an engineer should check
 * before later work covers them. The 3D model uses the same timings.
 *
 * Stage indexes are fixed by construction, and other code relies on them:
 * 0 blueprint, 1 foundation, 2..floors+1 one per floor (ground first),
 * floors+2 roof, floors+3 finishing. The `at` values are cumulative, so a
 * step spans from the previous step's `at` to its own (see stepFraction);
 * the last step of every stage is always at 100. The top floor has no slab
 * step because the roof stage casts it.
 */
// Second parameter: destructured options with a default (`inspections = true`)
// and the whole object defaulting to {} when omitted.
export function buildStages(floors, { inspections = true } = {}) {
  // Start with the two fixed stages (an array of object literals).
  const stages = [
    // Stage 0: design and approval.
    {
      key: 'blueprint',
      kind: 'blueprint',
      label: 'Blueprint',
      detail: 'Drawings, structural design and approval',
      steps: [
        { label: 'Architectural drawings', at: 40 },
        { label: 'Structural design', at: 75 },
        { label: 'Authority approval', at: 100 },
      ],
    },
    // Stage 1: foundation; `inspect: true` marks steps an engineer checks.
    {
      key: 'foundation',
      kind: 'foundation',
      label: 'Foundation',
      detail: 'Excavation, footings, plinth beams and DPC',
      steps: [
        { label: 'Excavation', at: 15 },
        { label: 'Footings', at: 42, inspect: true },
        { label: 'Backfill', at: 62 },
        { label: 'Plinth beams', at: 80, inspect: true },
        { label: 'DPC and plinth slab', at: 100, inspect: true },
      ],
    },
  ]
  // One stage per floor. `let k` is a loop counter; `k++` adds 1 each pass.
  for (let k = 0; k < floors; k++) {
    const top = k === floors - 1 // true for the top floor
    stages.push({
      key: `floor-${k}`, // e.g. "floor-0"
      kind: 'floor',
      label: floorName(k),
      detail: top ? 'Columns and brick masonry' : 'Columns, brick masonry and slab',
      // The top floor has no slab step (the roof stage casts it).
      steps: top
        ? [{ label: 'Columns', at: 40, inspect: true }, { label: 'Brick walls', at: 100 }]
        : [{ label: 'Columns', at: 40, inspect: true }, { label: 'Brick walls', at: 86 }, { label: 'Slab casting', at: 100, inspect: true }],
    })
  }
  // `.push` with two arguments appends the roof and finishing stages.
  stages.push(
    // Stage floors+2: roof.
    {
      key: 'roof',
      kind: 'roof',
      label: 'Roof',
      detail: 'Roof slab, parapet, mumty and water tank',
      steps: [
        { label: 'Roof slab', at: 35, inspect: true },
        { label: 'Parapet wall', at: 60 },
        { label: 'Mumty (stair tower)', at: 93 },
        { label: 'Water tank', at: 100 },
      ],
    },
    // Stage floors+3: finishing (last stage).
    {
      key: 'finishing',
      kind: 'finishing',
      label: 'Finishing',
      detail: 'Plaster, paint, windows, doors and boundary',
      steps: [
        { label: 'Plaster and paint', at: 50 },
        { label: 'Windows and doors', at: 75 },
        { label: 'Boundary wall and gate', at: 88 },
        { label: 'Driveway and lawn', at: 100 },
      ],
    },
  )
  // Add index and duration to every stage. `.map((s, index) => ...)` receives
  // the item and its position; `...s` copies the stage's fields.
  return stages.map((s, index) => ({
    ...s,
    index, // shorthand for index: index
    durationDays: DURATION_DAYS[s.kind],
    // Projects without inspections (self-managed) never show inspection steps.
    // `({ inspect, ...step }) => step` drops the `inspect` property from each step.
    steps: inspections ? s.steps : s.steps.map(({ inspect, ...step }) => step),
  }))
}

/**
 * Planned start and end date of every stage, from the project start date.
 * Stages before `fromStage` (drawings already approved when the project was
 * created) are treated as already done on the start date.
 */
// `fromStage = 0` is a default parameter value.
export function buildSchedule(floors, startDate, fromStage = 0) {
  const day = 86400000 // milliseconds in one day
  // Dates are YYYY-MM-DD site days, handled as UTC midnight so that adding
  // whole days never drifts across a DST change on the machine running this.
  // `new Date('YYYY-MM-DDT00:00:00Z').getTime()` = ms since 1970 (Z = UTC);
  // Date.now() is the current time in ms when there is no start date.
  const t0 = startDate ? new Date(`${startDate}T00:00:00Z`).getTime() : Date.now()
  let t = t0 // running clock, moved forward stage by stage
  // Arrow with a block body `{ ... }` needs an explicit `return`.
  return buildStages(floors).map((s) => {
    const start = t
    // Skipped stages get a zero-length window (start === end) on the start date.
    if (s.index >= fromStage) t += s.durationDays * day
    // toISOString() gives "2026-10-03T00:00:00.000Z"; .slice(0, 10) keeps the date part.
    return { index: s.index, start: new Date(start).toISOString().slice(0, 10), end: new Date(t).toISOString().slice(0, 10) }
  })
}

/**
 * Days behind (positive) or ahead (negative) of the plan today, counted in
 * calendar days through each planned stage rather than at one stage's pace.
 */
// `position` is the actual build position in stage units; `now` defaults to the current time.
export function daysBehindPlan(floors, startDate, position, fromStage = 0, now = Date.now()) {
  if (!startDate) return 0 // no plan, so not behind
  const stages = buildStages(floors)
  const schedule = buildSchedule(floors, startDate, fromStage)
  // Where the plan says we should be: stage units reached by today. Each stage
  // contributes its fraction elapsed (0..1); a zero-length stage (skipped via
  // fromStage) counts as fully done once its date has arrived.
  let planned = 0
  for (const s of schedule) {
    const a = new Date(`${s.start}T00:00:00Z`).getTime() // stage start (ms)
    const b = new Date(`${s.end}T00:00:00Z`).getTime() // stage end (ms)
    // Nested ternary: elapsed fraction clamped to 0..1, or 1/0 for zero-length stages.
    planned += b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : now >= a ? 1 : 0
  }
  // Convert the gap to days, stage by stage, at each stage's own pace. The gap
  // [lo, hi] in stage units is intersected with each stage's [index, index+1]
  // and that overlap is scaled by the stage's planned duration, so half a
  // finishing stage (45 days) weighs more than half a roof stage (15 days).
  let days = 0
  const lo = Math.min(planned, position) // lower end of the gap
  const hi = Math.max(planned, position) // upper end of the gap
  for (const s of stages) {
    // How much of this stage's [index, index+1] range lies inside [lo, hi].
    const overlap = Math.min(hi, s.index + 1) - Math.max(lo, s.index)
    if (overlap > 0) days += overlap * s.durationDays
  }
  // Positive when the plan is ahead of reality (we are behind), else negative.
  return Math.round(planned > position ? days : -days)
}

/** How far through a single step the stage progress is, 0..1. */
export function stepFraction(steps, i, progress) {
  // Step i starts where the previous step ended (0 for the first; `i` is
  // falsy when 0, so the ternary picks 0).
  const from = i ? steps[i - 1].at : 0
  return Math.min(1, Math.max(0, (progress - from) / (steps[i].at - from)))
}

/** Continuous build position in stage units: 2.5 = halfway through stage 2. */
export const buildPosition = (stageIndex, stageProgress) => stageIndex + stageProgress / 100

// blueprint + foundation + one stage per floor + roof + finishing.
export const stageCount = (floors) => floors + 4
export const lastStageIndex = (floors) => floors + 3 // index of the finishing stage

/** Whole-project percentage, treating every stage as an equal share. */
export function overallPercent(house) {
  return Math.round((buildPosition(house.stageIndex, house.stageProgress) / stageCount(house.floors)) * 100)
}

// True only when the last stage is at 100%.
export const isComplete = (house) => house.stageIndex === lastStageIndex(house.floors) && house.stageProgress === 100

/**
 * Today's date in Pakistan (UTC+5) as YYYY-MM-DD; site records are kept in site days.
 * Pakistan has no daylight saving, so a fixed +5 h shift of the UTC clock is
 * exact and works the same on a server in Frankfurt and a phone in Lahore.
 */
// `at` defaults to now; 3600000 ms = one hour, so +5 hours is added before
// reading the UTC date.
export function todayPK(at = Date.now()) {
  return new Date(new Date(at).getTime() + 5 * 3600000).toISOString().slice(0, 10)
}

/**
 * Covered area across all floors, in square feet, for a plot in feet. Uses the
 * same house footprint the 3D model draws, so the BOQ in estimates.js and the
 * picture on screen describe the same building.
 */
export function coveredAreaSqft(dims, floors) {
  // Nested destructuring: take `w` and `d` from the `.house` of the geometry.
  const { w, d } = plotGeometry(dims).house
  // Footprint in m², converted to sq ft, times the number of floors.
  return Math.round(w * d * SQFT_PER_M2 * floors)
}
