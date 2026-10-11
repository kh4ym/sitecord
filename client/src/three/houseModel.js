// houseModel.js - the procedural model of the house being built.
//
// Procedural model of a Pakistani RCC-frame house. Produces a flat list of
// building elements; each element knows which stage builds it and over which
// slice of that stage (start → end, as fractions). The renderer maps the
// current build position onto each element to grow it out of its blueprint.
//
// Coordinates are metres. y is up, the street-facing front is +z.
// (x = width, left/right; z = depth; the house footprint is centred on x = 0, z = 0.)
//
// Stages and the "build position": the position is a number like 2.4, meaning
// "stage 2, 40% done". Stage 0 = blueprint (outlines are drawn), 1 = foundation,
// 2 .. 1 + floors = one stage per storey (RCC frame, then brick walls, then the
// next slab), 2 + floors = roof (slab, parapets, mumty, water tank),
// 3 + floors = finishing (plaster, glass, doors, boundary wall, garden, scaffold
// removal). An element with stage 2, start 0.3, end 0.6 grows from position 2.3
// to 2.6.
//
// Each element: { stage, start, end, mat (material name used by HouseScene),
// min/max ([x, y, z] corners of its box), grow (axis it grows along: 'y' up by
// default, 'x' or 'z' for slabs and paths sliding across), shape ('box', 'cyl',
// 'cone', 'blob'), and optional flags: invert (shrinks instead of grows),
// noGhost (no blueprint outline), noShadow, outStage/outStart/outEnd (removed
// later, e.g. scaffolding) }.
// Also returns `workers` (Workers.jsx specs) and `bounds` (for camera framing).
// Where it's used: HouseScene.jsx/SnapshotRenderer.jsx (via buildHouseModel) and
// the pages that pass a model to the 3D view; neighborhoodModel.js imports FLOOR_H/PLINTH.
// Dependencies: @shared/houseConfig.js (plotGeometry: plot size -> house/plot
// dimensions in metres; stageCount: number of stages for a floor count). No three.js.

// `@shared` is a path alias (configured in Vite) for the code shared between client and server.
import { plotGeometry, stageCount } from '@shared/houseConfig.js'

// Storey height floor-to-floor (m). `export` so neighborhoodModel.js can match it.
export const FLOOR_H = 3.2
// Height of the plinth (raised base the ground floor sits on), m.
export const PLINTH = 0.45
// Concrete slab thickness.
const SLAB_T = 0.15
// Column cross-section (0.3 m square).
const COL = 0.3
// Brick wall thickness (a 9-inch wall).
const WALL_T = 0.23
// How deep the foundation pit is dug.
const PIT_DEPTH = 0.9
// How far the pit extends beyond the house footprint.
const PIT_MARGIN = 0.6
// Target distance between columns (one structural bay).
const BAY = 4.2
// Window sill height above the floor.
const SILL = 0.9
// Top of windows and doors above the floor.
const HEAD = 2.1

/** Column centre-lines along one axis, roughly one bay every 4.2 m. */
function gridLine(len) {
  // Number of bays: length / 4.2 rounded, at least 1.
  const n = Math.max(1, Math.round(len / BAY))
  // First column centre: half a column in from the left/back edge.
  const a = -len / 2 + COL / 2
  // Spacing so the last column sits half a column in from the other edge.
  const step = (len - COL) / n
  // Array.from({ length: n + 1 }, fn) builds an array of n + 1 items by calling fn(value, index).
  // `_` is a conventional name for an unused parameter.
  return Array.from({ length: n + 1 }, (_, i) => a + i * step)
}

/** Plot size of a project or a form, in feet. */
// Projects use widthFt/depthFt, forms use plotWidthFt/plotDepthFt; `??` falls back from one to the other.
// Wrapping the object in parentheses makes the arrow function return it.
const plotOf = (p) => ({ plotSize: p.plotSize, widthFt: p.widthFt ?? p.plotWidthFt, depthFt: p.depthFt ?? p.plotDepthFt })

/** The house for a plot ({ plotSize } preset or { widthFt, depthFt }) with `floors` floors. */
export function buildHouseModel(input) {
  // Destructure the floor count from the input.
  const { floors } = input
  // House and plot dimensions in metres for this plot size.
  const geometry = plotGeometry(plotOf(input))
  // house = footprint {w, d}; plot = whole plot {w, d}; backGap = open space behind the house.
  const { house, plot, backGap } = geometry
  // Footprint width (x) and depth (z).
  const W = house.w
  const D = house.d
  // Column grid lines along x and z.
  const xs = gridLine(W)
  const zs = gridLine(D)
  // Every column position [x, z]: flatMap maps each x to an array of [x, z] pairs and flattens them into one list.
  const cols = xs.flatMap((x) => zs.map((z) => [x, z]))
  // The output list of building elements.
  const elements = []

  /** Add an axis-aligned element. min/max are [x, y, z]. */
  // `opts = {}` default parameter; `...opts` at the end overrides the defaults grow 'y' and shape 'box'.
  const add = (stage, start, end, mat, min, max, opts = {}) =>
    elements.push({ stage, start, end, mat, min, max, grow: 'y', shape: 'box', ...opts })

  /**
   * A wall line between two column centres along `axis`, at fixed cross
   * coordinate `at`. Brickwork rises course by course: pieces higher up start
   * later within [start, end]. Openings leave window/door panes for finishing.
   */
  // A function declaration taking one object parameter, destructured into named fields.
  // u0/u1 = column centres along the wall; y0/y1 = bottom/top of the wall.
  function wall({ stage, start, end, axis, at, u0, u1, y0, y1, opening, finishStage, paneOrder }) {
    // The wall runs between column faces, not centres.
    const a = u0 + COL / 2
    const b = u1 - COL / 2
    // Adds one rectangular piece of the wall from p0..p1 along the wall and h0..h1 in height.
    // Many parameters have defaults: brick material, this stage, auto timing (null), normal thickness.
    const piece = (p0, p1, h0, h1, mat = 'brick', st = stage, s = null, e = null, thick = WALL_T, extra = {}) => {
      // Start/end times: given explicitly (s/e), or proportional to height so higher bricks are laid later.
      const t0 = s ?? start + ((h0 - y0) / (y1 - y0)) * (end - start)
      const t1 = e ?? start + ((h1 - y0) / (y1 - y0)) * (end - start)
      // Turn wall-local coordinates into world boxes: a wall along x has its thickness in z, and vice versa.
      const min = axis === 'x' ? [p0, h0, at - thick / 2] : [at - thick / 2, h0, p0]
      const max = axis === 'x' ? [p1, h1, at + thick / 2] : [at + thick / 2, h1, p1]
      add(st, t0, t1, mat, min, max, extra)
    }
    // Clear length of this wall panel.
    const len = b - a
    // No opening, or too short for one: a single solid piece. `return piece(...)` also ends the function.
    if (!opening || len < 1.2) return piece(a, b, y0, y1)
    // Opening width, leaving at least 0.3 m of wall either side.
    const w = Math.min(opening.w, len - 0.6)
    // Centre of the panel.
    const mid = (a + b) / 2
    // Windows have a sill; doors go down to the floor (0).
    const sill = opening.type === 'window' ? SILL : 0
    // Opening edges.
    const o0 = mid - w / 2
    const o1 = mid + w / 2
    // Wall left of the opening, full height.
    piece(a, o0, y0, y1)
    // Wall right of the opening, full height.
    piece(o1, b, y0, y1)
    // Wall below a window (sill is 0 = falsy for doors, so skipped).
    if (sill) piece(o0, o1, y0, y0 + sill)
    // Wall above the opening (lintel to slab).
    piece(o0, o1, y0 + HEAD, y1)
    // Glass or door leaf, fitted during finishing.
    // Stagger the panes through the finishing stage: `paneOrder.n++` reads n then increments it (post-increment);
    // `% 9` wraps 0..8, so start times cycle between 0.30 and 0.58.
    const ps = 0.3 + (paneOrder.n++ % 9) * 0.035
    // The pane itself: glass or door material, finishing stage, 6 cm thick; windows don't cast shadows.
    piece(o0, o1, y0 + sill, y0 + HEAD, opening.type === 'window' ? 'glass' : 'door', finishStage, ps, ps + 0.12, 0.06, {
      noShadow: opening.type === 'window',
    })
  }

  // Stage numbers (0 is the blueprint stage, so the foundation is 1).
  const FOUNDATION = 1
  // Roof comes after the floors (stages 2 .. 1 + floors).
  const ROOF = 2 + floors
  // Finishing is the last stage.
  const FINISH = 3 + floors
  // A shared counter object (objects are passed by reference, so wall() can increment it).
  const paneOrder = { n: 0 }

  // ---------- Foundation ----------
  // Half-size of the pit in x and z.
  const px = W / 2 + PIT_MARGIN
  const pz = D / 2 + PIT_MARGIN
  // Excavation (stage 1, 0-15%): a soil cover filling the pit that *shrinks* (invert) as it is dug out. No outline.
  add(FOUNDATION, 0, 0.15, 'soil', [-px, -PIT_DEPTH, -pz], [px, -0.002, pz], { invert: true, noGhost: true })
  // For each column position (destructured to x, z) with index i:
  cols.forEach(([x, z], i) => {
    // Stagger the footings across 15-30% of the stage.
    const s = 0.15 + (0.15 * i) / cols.length
    // Footing pad: a 1.1 m square concrete block at the pit bottom (grows up, y).
    add(FOUNDATION, s, s + 0.12, 'concrete', [x - 0.55, -PIT_DEPTH, z - 0.55], [x + 0.55, -0.5, z + 0.55])
    // Column stub rising from the footing to just above ground (grows up).
    add(FOUNDATION, s + 0.08, s + 0.14, 'concrete', [x - COL / 2, -0.5, z - COL / 2], [x + COL / 2, 0.3, z + COL / 2])
  })
  // Backfill (50-62%): soil grows back up to fill the pit around the footings. No outline.
  add(FOUNDATION, 0.5, 0.62, 'soil', [-px, -PIT_DEPTH, -pz], [px, -0.004, pz], { noGhost: true })
  // Plinth beams running along x at each z grid line (62% onward, staggered), sliding across in x.
  zs.forEach((z, i) =>
    add(FOUNDATION, 0.62 + i * 0.02, 0.72 + i * 0.02, 'concrete', [-W / 2 + 0.01, 0, z - 0.15], [W / 2 - 0.01, 0.44, z + 0.15], { grow: 'x' }),
  )
  // Plinth beams running along z at each x grid line (66% onward), growing in z.
  xs.forEach((x, i) =>
    add(FOUNDATION, 0.66 + i * 0.02, 0.76 + i * 0.02, 'concrete', [x - 0.15, 0, -D / 2 + 0.01], [x + 0.15, 0.44, D / 2 - 0.01], { grow: 'z' }),
  )
  // Ground-floor plinth slab over the whole footprint (82-100%), sliding across in x.
  add(FOUNDATION, 0.82, 1, 'concrete', [-W / 2 - 0.02, 0, -D / 2 - 0.02], [W / 2 + 0.02, PLINTH, D / 2 + 0.02], { grow: 'x' })

  // ---------- Floors ----------
  // One stage per storey k (0 = ground floor).
  for (let k = 0; k < floors; k++) {
    // This storey's stage number.
    const stage = 2 + k
    // Floor level, slab top, and wall top (just under the next slab).
    const base = PLINTH + k * FLOOR_H
    const top = base + FLOOR_H
    const wallTop = top - SLAB_T
    // Is this the top storey? (Its ceiling slab is the roof slab, built in the ROOF stage.)
    const isTop = k === floors - 1

    // RCC columns for this storey (0-40% of the stage, staggered), growing up.
    cols.forEach(([x, z], i) => {
      const s = (0.15 * i) / cols.length
      add(stage, s, s + 0.25, 'concrete', [x - COL / 2, base, z - COL / 2], [x + COL / 2, wallTop, z + COL / 2])
    })

    // Opening rule for the front wall: bay b of n gets the door if it is the middle bay
    // (ground floor 1.2 m door, upper floors a 1.5 m balcony door), otherwise a 1.6 m window.
    const front = (b, n) =>
      b === Math.floor(n / 2) ? { type: 'door', w: k === 0 ? 1.2 : 1.5 } : { type: 'window', w: 1.6 }
    // The four outer walls: axis it runs along, the cross coordinate `at`, the column line it spans,
    // and a function deciding the opening per bay. `zs.at(-1)` = last item (negative index counts from the end).
    const sides = [
      // Front wall (+z face): doors/windows from `front`.
      { axis: 'x', at: zs.at(-1), line: xs, opening: front },
      // Right wall (+x face): a 1.2 m window in every odd bay (`b % 2` is 1 for odd), none otherwise.
      { axis: 'z', at: xs.at(-1), line: zs, opening: (b) => (b % 2 ? { type: 'window', w: 1.2 } : null) },
      // Back wall (-z face): a window in every bay.
      { axis: 'x', at: zs[0], line: xs, opening: () => ({ type: 'window', w: 1.2 }) },
      // Left wall (-x face): windows in odd bays.
      { axis: 'z', at: xs[0], line: zs, opening: (b) => (b % 2 ? { type: 'window', w: 1.2 } : null) },
    ]
    // Brick walls: each side starts a little after the previous (j = 0..3), from ~30% of the stage.
    sides.forEach((side, j) => {
      // The top storey has no slab to cast, so its walls get a longer, more spread-out slot.
      const start = isTop ? 0.3 + j * 0.1 : 0.3 + j * 0.08
      const end = start + (isTop ? 0.4 : 0.32)
      // Number of bays between columns on this side.
      const n = side.line.length - 1
      // One wall panel per bay, between neighbouring column lines.
      for (let b = 0; b < n; b++) {
        // Object argument spread over several lines; several properties per line is fine.
        wall({
          stage, start, end, axis: side.axis, at: side.at,
          u0: side.line[b], u1: side.line[b + 1], y0: base, y1: wallTop,
          opening: side.opening(b, n), finishStage: FINISH, paneOrder,
        })
      }
    })

    // The slab above this storey (82-100%), sliding across in x - except for the top storey.
    if (!isTop) {
      add(stage, 0.82, 1, 'concrete', [-W / 2 - 0.02, wallTop, -D / 2 - 0.02], [W / 2 + 0.02, top, D / 2 + 0.02], { grow: 'x' })
    }
  }

  // ---------- Roof ----------
  // Height of the roof surface.
  const roofY = PLINTH + floors * FLOOR_H
  // Roof slab (roof stage 0-35%), sliding across in x.
  add(ROOF, 0, 0.35, 'concrete', [-W / 2 - 0.02, roofY - SLAB_T, -D / 2 - 0.02], [W / 2 + 0.02, roofY, D / 2 + 0.02], { grow: 'x' })
  // Parapet thickness and height.
  const PT = 0.2
  const PH = 0.9
  // The four parapet walls as [min, max] pairs: front, right, back, left.
  const parapets = [
    [[-W / 2, roofY, D / 2 - PT], [W / 2, roofY + PH, D / 2]],
    [[W / 2 - PT, roofY, -D / 2 + PT], [W / 2, roofY + PH, D / 2 - PT]],
    [[-W / 2, roofY, -D / 2], [W / 2, roofY + PH, -D / 2 + PT]],
    [[-W / 2, roofY, -D / 2 + PT], [-W / 2 + PT, roofY + PH, D / 2 - PT]],
  ]
  // Brick parapets, one after another from 35% of the roof stage, growing up.
  parapets.forEach(([min, max], i) => add(ROOF, 0.35 + i * 0.05, 0.45 + i * 0.05, 'brick', min, max))

  // Mumty: the stair tower at the back-right corner, with the water tank on top.
  // Its x range (3 m wide, inside the right parapet) and z range (4 m deep, from the back parapet).
  const mx0 = W / 2 - PT - 3.0
  const mx1 = W / 2 - PT
  const mz0 = -D / 2 + PT
  const mz1 = mz0 + 4.0
  // Top of the mumty (2.7 m tall) and its wall top (under its little slab).
  const mTop = roofY + 2.7
  const mWallTop = mTop - SLAB_T
  // Its four corner column centres.
  const mxs = [mx0 + COL / 2, mx1 - COL / 2]
  const mzs = [mz0 + COL / 2, mz1 - COL / 2]
  // Mumty corner columns (roof stage 60-68%), growing up.
  mxs.forEach((x) => mzs.forEach((z) => add(ROOF, 0.6, 0.68, 'concrete', [x - COL / 2, roofY, z - COL / 2], [x + COL / 2, mWallTop, z + COL / 2])))
  // Helper for one mumty wall, staggered by index i.
  const mumtyWall = (axis, at, line, opening, i) =>
    wall({
      stage: ROOF, start: 0.66 + i * 0.03, end: 0.76 + i * 0.03, axis, at, u0: line[0], u1: line[1],
      y0: roofY, y1: mWallTop, opening, finishStage: FINISH, paneOrder,
    })
  // Front mumty wall with a 1 m door onto the roof.
  mumtyWall('x', mzs[1], mxs, { type: 'door', w: 1.0 }, 0)
  // Left mumty wall with a small window.
  mumtyWall('z', mxs[0], mzs, { type: 'window', w: 0.9 }, 1)
  // Back and right mumty walls, solid.
  mumtyWall('x', mzs[0], mxs, null, 2)
  mumtyWall('z', mxs[1], mzs, null, 3)
  // Mumty slab with a 10 cm overhang (85-93%), sliding across in x.
  add(ROOF, 0.85, 0.93, 'concrete', [mx0 - 0.1, mWallTop, mz0 - 0.1], [mx1 + 0.1, mTop, mz1 + 0.1], { grow: 'x' })
  // Centre of the mumty roof.
  const tx = (mx0 + mx1) / 2
  const tz = (mz0 + mz1) / 2
  // Water tank: a 1.2 m wide, 1.1 m tall cylinder (93-100%), growing up.
  add(ROOF, 0.93, 1, 'tank', [tx - 0.6, mTop, tz - 0.6], [tx + 0.6, mTop + 1.1, tz + 0.6], { shape: 'cyl' })

  // ---------- Finishing: boundary wall, gate, driveway, lawn ----------
  // Back and front edges of the plot in z.
  const zBack = -D / 2 - backGap
  const zFront = zBack + plot.d
  // Half the plot width.
  const pw = plot.w / 2
  // Boundary wall thickness and height.
  const BT = 0.2
  const BH = 2.0
  // Gate opening x range: 3.4 m wide, 0.4 m from the right edge.
  const gx1 = pw - 0.4
  const gx0 = gx1 - 3.4
  // Boundary wall pieces: back, left, right, front-left of the gate, front-right of the gate.
  const boundary = [
    [[-pw, 0, zBack], [pw, BH, zBack + BT]],
    [[-pw, 0, zBack + BT], [-pw + BT, BH, zFront - BT]],
    [[pw - BT, 0, zBack + BT], [pw, BH, zFront - BT]],
    [[-pw, 0, zFront - BT], [gx0, BH, zFront]],
    [[gx1, 0, zFront - BT], [pw, BH, zFront]],
  ]
  // Boundary walls rise one after another from 50% of the finishing stage.
  boundary.forEach(([min, max], i) => add(FINISH, 0.5 + i * 0.05, 0.6 + i * 0.05, 'boundary', min, max))
  // Metal gate (78-88%), sliding shut along x.
  add(FINISH, 0.78, 0.88, 'gate', [gx0, 0, zFront - 0.15], [gx1, 1.9, zFront - 0.05], { grow: 'x' })
  // Paved driveway from the house front to the gate (85-95%), laid along z, no outline.
  add(FINISH, 0.85, 0.95, 'paving', [gx0, 0, D / 2 + 0.05], [gx1, 0.04, zFront - BT], { grow: 'z', noGhost: true })
  // Front lawn: turf, a hedge along the boundary, a small tree and a planter.
  // Lawn rectangle: from the left boundary wall to just left of the driveway, house front to front wall.
  const lx0 = -pw + BT
  const lx1 = gx0 - 0.3
  const lz0 = D / 2 + 0.3
  const lz1 = zFront - BT
  // Only if there is more than 1 m of width for a lawn.
  if (lx1 - lx0 > 1) {
    // Turf (86-94%), rolled out along x.
    add(FINISH, 0.86, 0.94, 'grass', [lx0, 0, lz0], [lx1, 0.05, lz1], { grow: 'x', noGhost: true })
    // How many hedge blobs (one per 0.75 m) fit; at least 1.
    const hedge = Math.max(1, Math.floor((lx1 - lx0 - 0.2) / 0.75))
    for (let i = 0; i < hedge; i++) {
      // Blob centre x and its start time (planted left to right from 92%).
      const x = lx0 + 0.45 + i * 0.75
      const s = 0.92 + 0.04 * i
      // Hedge blob along the front wall, growing up.
      add(FINISH, s, s + 0.06, 'bush', [x - 0.38, 0.03, lz1 - 0.75], [x + 0.38, 0.8, lz1 - 0.05], { shape: 'blob', noGhost: true, noShadow: false })
    }
    // A small tree if the lawn is at least 2.2 m in both directions.
    if (lz1 - lz0 > 2.2 && lx1 - lx0 > 2.2) {
      // Tree position near the lawn's back-left corner (block-scoped `const`, separate from the tank's tx/tz).
      const tx = lx0 + 1.1
      const tz = lz0 + 1.0
      // Trunk (cylinder) then crown (blob).
      add(FINISH, 0.9, 0.96, 'trunk', [tx - 0.1, 0, tz - 0.1], [tx + 0.1, 1.9, tz + 0.1], { shape: 'cyl', noGhost: true })
      add(FINISH, 0.94, 1, 'bush', [tx - 1.0, 1.4, tz - 1.0], [tx + 1.0, 3.3, tz + 1.0], { shape: 'blob', noGhost: true })
    }
    // A planter shrub by the driveway near the house.
    add(FINISH, 0.95, 1, 'bush', [lx1 - 0.8, 0.03, lz0 + 0.1], [lx1 - 0.1, 0.55, lz0 + 0.7], { shape: 'blob', noGhost: true })
  }

  // ---------- Site: bamboo scaffolding, material stock ----------
  // Scaffolding goes up the street face with each floor and comes down
  // top-first during finishing. `out*` describes when an element is removed.
  // When scaffold level k is removed (fraction of the finishing stage): higher levels earlier.
  const scafOut = (k) => 0.8 + (floors - 1 - k) * 0.03
  // Options marking an element as removed during finishing over 8% of the stage, with no outline.
  const removed = (outStart) => ({ outStage: FINISH, outStart, outEnd: outStart + 0.08, noGhost: true })
  // The two rows of scaffold poles in front of the house (z).
  const sz1 = D / 2 + 0.4
  const sz2 = D / 2 + 1.1
  // Number of poles across: one per ~2.2 m (Math.ceil rounds up), at least 2.
  const nPoles = Math.max(2, Math.ceil(W / 2.2) + 1)
  // Evenly spaced pole x positions spanning the width plus 0.2 m each side.
  const poleXs = Array.from({ length: nPoles }, (_, i) => -W / 2 - 0.2 + (i * (W + 0.4)) / (nPoles - 1))
  // One scaffold lift: poles from y0 to y1 in both rows, and a plank deck at plankY (if given), removed at `out`.
  const scaffoldLevel = (stage, s, y0, y1, plankY, out) => {
    // Nested forEach: every x in both rows z.
    poleXs.forEach((x, i) =>
      [sz1, sz2].forEach((z) =>
        // Bamboo pole (10 cm cylinder), put up left to right; spread in the removal options.
        add(stage, s + i * 0.008, s + 0.06 + i * 0.008, 'bamboo', [x - 0.05, y0, z - 0.05], [x + 0.05, y1, z + 0.05], { shape: 'cyl', ...removed(out) }),
      ),
    )
    // `!= null` (loose inequality) is true unless plankY is null or undefined.
    if (plankY != null) {
      // Plank walkway across the full width, laid along x.
      add(stage, s + 0.06, s + 0.12, 'plank', [-W / 2 - 0.3, plankY - 0.06, sz1 - 0.06], [W / 2 + 0.3, plankY, sz2 + 0.06], { grow: 'x', ...removed(out) })
    }
  }
  // A scaffold lift per storey, put up at the very start of that storey's stage.
  for (let k = 0; k < floors; k++) {
    const base = PLINTH + k * FLOOR_H
    // Ground floor: poles from the ground, no plank; upper floors: start at floor level with a plank there.
    scaffoldLevel(2 + k, 0.02, k === 0 ? 0 : base, base + FLOOR_H, k === 0 ? null : base, scafOut(k))
  }
  // A short top lift at roof level (roof stage, from 36%) for the parapet work.
  scaffoldLevel(ROOF, 0.36, roofY, roofY + 1.2, roofY, scafOut(floors))

  // Front yard depth range for stacking materials, and its middle.
  const yardZ0 = D / 2 + 1.3
  const yardZ1 = zFront - BT
  const stockZ = (yardZ0 + yardZ1) / 2
  // Small front yards get a smaller sand heap so it stays inside the boundary wall.
  // Heap half-size clamped between 0.3 and 0.6 m.
  const heap = Math.max(0.3, Math.min(0.6, (yardZ1 - yardZ0) / 2))
  // x positions of the brick stack and the sand heap, near the left boundary.
  const bx = -pw + BT + 0.8
  const sx = -pw + BT + 2.2
  // Brick stack delivered mid-foundation (50-60%), cleared at 40% of finishing.
  add(FOUNDATION, 0.5, 0.6, 'brickStack', [bx - 0.6, 0, stockZ - Math.min(0.35, heap)], [bx + 0.6, 0.75, stockZ + Math.min(0.35, heap)], removed(0.4))
  // Sand heap (a cone) delivered at 55-65%, cleared at 42% of finishing.
  add(FOUNDATION, 0.55, 0.65, 'sand', [sx - heap, 0, stockZ - heap], [sx + heap, 0.7, stockZ + heap], { shape: 'cone', ...removed(0.42) })

  // ---------- Workers ----------
  // Each worker is on site between `from` and `to` (build positions). One group
  // per level: on the ground, on each floor's scaffold plank, inside the floor
  // being built, and on the roof. Everyone has gone home once the house is done.
  const workers = []
  // Adds a worker with defaults (facing +z, yellow hat, orange vest, normal speed, phase from its index),
  // overridden by whatever fields `w` provides (spread last).
  const worker = (w) => workers.push({ rot: 0, helmet: 'yellow', vest: 'orange', speed: 1, phase: workers.length * 1.7, ...w })
  // Build position when everything is finished.
  const done = FINISH + 1

  // Ground crew, present from just after the foundation starts until the end:
  // a labourer carrying bricks from the stack towards the gate...
  worker({ action: 'carry', pos: [bx + 0.9, 0, D / 2 + 1.45], range: [bx + 0.9, gx1 - 0.6], from: 1.01, to: done })
  // ...a worker hammering by the sand heap, facing -x (rotated -90 degrees)...
  worker({ action: 'hammer', pos: [sx + 0.95, 0, stockZ], rot: -Math.PI / 2, vest: 'lime', from: 1.01, to: done })
  // ...and a supervisor (white hat) by the gate, facing the house (rotated 180 degrees).
  worker({ action: 'idle', pos: [gx1 - 0.5, 0, zFront - 0.8], rot: Math.PI, helmet: 'white', vest: 'lime', from: 1.01, to: done })
  // In the foundation pit until it's backfilled.
  // One hammering at the pit floor in front, one walking along the back of the pit.
  worker({ action: 'hammer', pos: [-W / 4 + 0.7, -PIT_DEPTH, D / 2 + 0.25], rot: Math.PI, from: 1.15, to: 1.5 })
  worker({ action: 'walk', pos: [0, -PIT_DEPTH, -D / 2 - 0.45], range: [-W / 2, W / 2 - 1], from: 1.15, to: 1.5 })

  // Per storey k:
  for (let k = 0; k < floors; k++) {
    const base = PLINTH + k * FLOOR_H
    // Scaffold plank height (ground level for the ground floor).
    const y = k === 0 ? 0 : base
    // They stay until this level's scaffold comes down.
    const until = FINISH + scafOut(k)
    // On the scaffold: one walking along it, one hammering facing the wall (left/right alternating by floor).
    worker({ action: 'walk', pos: [0, y, D / 2 + 0.75], range: [-W / 2 + 0.4, W / 2 - 0.4], from: 2 + k, to: until })
    worker({ action: 'hammer', pos: [(k % 2 ? -1 : 1) * (W / 4), y, D / 2 + 0.75], rot: Math.PI, vest: k % 2 ? 'lime' : 'orange', from: 2 + k + 0.05, to: until })
    // Inside the storey only while it is being built (its own stage): one hammering, one walking.
    worker({ action: 'hammer', pos: [-W / 4 + k * 0.7, base, -D / 6], rot: Math.PI / 3, from: 2 + k, to: 3 + k })
    worker({ action: 'walk', pos: [0, base, D / 6], range: [-W / 3, W / 3], from: 2 + k + 0.1, to: 3 + k })
  }
  // Roof crew from once the roof slab is cast until the top scaffold is removed.
  worker({ action: 'walk', pos: [0, roofY, 0.5], range: [-W / 2 + 1, W / 2 - 4], from: ROOF + 0.35, to: FINISH + scafOut(floors) })
  worker({ action: 'hammer', pos: [-W / 3, roofY, D / 2 - 0.9], rot: 0, vest: 'lime', from: ROOF + 0.4, to: FINISH + scafOut(floors) })

  // Blueprint drawing order: lines appear bottom-up while the blueprint stage runs.
  // Bottom y of every element.
  const ys = elements.map((e) => e.min[1])
  // `...ys` spreads the array into separate arguments for Math.min / Math.max.
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  // Add derived fields to every element (objects are mutated in place).
  elements.forEach((e, i) => {
    // Stable React key.
    e.key = i
    // Size along x, y, z (index a = 0, 1, 2).
    e.size = [0, 1, 2].map((a) => e.max[a] - e.min[a])
    // Centre point.
    e.center = [0, 1, 2].map((a) => (e.max[a] + e.min[a]) / 2)
    // Blueprint position (0..0.9) at which its outline appears: lower elements first.
    e.bp = ((e.min[1] - minY) / (maxY - minY)) * 0.9
  })

  // The model object handed to the renderer.
  return {
    // Shorthand for geometry: geometry.
    geometry,
    // A string identifying the plot size, e.g. "30x60", used as a React key / memo dependency.
    geometryKey: `${geometry.widthFt}x${geometry.depthFt}`,
    elements,
    workers,
    // Total number of stages for this floor count.
    stageCount: stageCount(floors),
    finishStage: FINISH,
    // Plot centre along z: the house sits at 0, the plot runs from zBack to zFront.
    // h = overall height (top of the water tank); pit = foundation pit half-sizes and depth.
    bounds: { w: plot.w, d: plot.d, h: mTop + 1.1, cz: (zBack + zFront) / 2, pit: { x: px, z: pz, depth: PIT_DEPTH } },
    // House footprint size.
    footprint: { w: W, d: D },
  }
}
