// neighborhoodModel.js - generates the data for the housing society around the plot.
//
// A planned housing-society block around the plot: a street grid with
// footpaths and kerbs, finished neighbouring houses on every other plot,
// street trees and lights, parked cars, and a park across the junction.
// Output is grouped by material so each group renders as one instanced mesh.
//
// What it returns: { layers, extent }. `layers` is an object whose keys are
// material names ('plaster', 'asphalt', 'leaves', ...) and whose values are
// arrays of axis-aligned boxes { min: [x, y, z], max: [x, y, z], color? }.
// `extent` is how far (in metres) the society reaches from the origin, used
// to size the ground plane and fog. No three.js objects are created here: it
// is pure data, so it is cheap and easy to reason about.
// Coordinates: metres; x = width (left/right), y = up, z = depth, with +z the
// front of our house facing the street. Our house sits at the origin.
// Where it's used: HouseScene.jsx calls buildNeighborhood() and passes the result
// to Neighborhood.jsx, which draws it.
// Dependencies: ./houseModel.js (FLOOR_H storey height, PLINTH height) and
// ./util.js (rng, so the same plot size always produces the same neighbourhood).

// Named imports of two constants from houseModel.js.
import { FLOOR_H, PLINTH } from './houseModel.js'
// Seeded random number generator.
import { rng } from './util.js'

// Street dimensions in metres. A trailing `//` comment explains each constant.
const ROAD = 9 // carriageway width
const FOOT = 2.2 // footpath width
// Full street = road plus a footpath on each side.
const STREET = ROAD + 2 * FOOT
const PER_ROW = 7 // plots per block row

// Colour palettes (CSS hex strings) that houses, cars and trees pick from at random.
const PLASTER = ['#efe9df', '#f5f2ec', '#e7e1d5', '#ddd4c4', '#f2e7d4', '#e9ecea', '#e4dccf', '#d9d2c8']
const CARS = ['#d0d3d8', '#1d2126', '#f4f4f2', '#8c1d1d', '#24477a', '#9aa2aa', '#5b6168']
const LEAVES = ['#4f8a3a', '#5c9a44', '#3f7a33', '#6aa64c', '#477f37']

/**
 * Neighbours sized like our plot (from shared plotGeometry). Returns the
 * layers to draw and how far the society reaches, for the ground and fog.
 */
export function buildNeighborhood(geometry) {
  // Object destructuring: pull plot, house and backGap out of the geometry object.
  const { plot, house, backGap } = geometry
  // Plot width and depth (m).
  const PW = plot.w
  const PD = plot.d
  // House footprint width and depth (m).
  const W = house.w
  const D = house.d
  // z of the back of our plot. The house is centred on z = 0, so its back wall is at -D/2.
  const zBack = -D / 2 - backGap // matches houseModel.js
  // z of the centre of our plot (and of every plot in row 0).
  const zc = zBack + PD / 2
  // Width of one block of plots along x.
  const BW = PER_ROW * PW
  // Seed the random generator from the plot size, so every plot size gets its own but stable layout.
  const rand = rng(Math.round(geometry.widthFt * 131 + geometry.depthFt * 7))
  // Pick a random element: Math.floor rounds down, giving an index 0 .. length-1.
  const pick = (list) => list[Math.floor(rand() * list.length)]

  // The layers object being filled.
  const L = {}
  // Add one box to a layer. `L[layer] ??= []` creates the array the first time a layer is used,
  // and the assignment expression evaluates to that array, so .push can be called on it directly.
  const put = (layer, min, max, color) => (L[layer] ??= []).push({ min, max, color })

  // Rows of plots: row 0 is ours (fronts face +z). 0/-1 and 1/2 are back to back.
  // Each row: r = row index, cz = z of the plot centres, f = which way the fronts face (+1 = +z, -1 = -z).
  const rows = [
    { r: -2, cz: zc - 2 * PD - STREET, f: 1 },
    { r: -1, cz: zc - PD, f: -1 },
    { r: 0, cz: zc, f: 1 },
    { r: 1, cz: zc + PD + STREET, f: -1 },
    { r: 2, cz: zc + 2 * PD + STREET, f: 1 },
  ]
  // x centres of three blocks: left, centre (x = 0), right, separated by a street.
  const blocks = [-1, 0, 1].map((k) => k * (BW + STREET))
  // Block index 1 is the centre block (x = 0); the park is across the junction.
  // `===` is strict equality; `&&` and; `||` or. True for the right block in rows 1 and 2.
  const isPark = (k, r) => k === 2 && (r === 1 || r === 2)

  // ---------- Streets ----------
  // The overall bounding rectangle of the society (x and z limits).
  const xMin = blocks[0] - BW / 2 - STREET
  const xMax = blocks[2] + BW / 2 + STREET
  const zMin = zc - 2.5 * PD - STREET
  const zMax = zc + 2.5 * PD + STREET
  // z centres of the horizontal (running along x) streets.
  const hStreets = [zc + PD / 2 + STREET / 2, zc - 1.5 * PD - STREET / 2] // front road, back road
  // x centres of the vertical (running along z) streets: the two beside the centre block, then the two outer ones.
  // .concat joins two arrays into one.
  const vStreets = [-1, 1].map((s) => s * (BW / 2 + STREET / 2)).concat([-1, 1].map((s) => s * (1.5 * BW + 1.5 * STREET)))

  // Dashed centre-line: a 3 m white dash every 7 m from `from` to `to`, running along 'x' or 'z', centred at `at`.
  const dashes = (from, to, along, at) => {
    for (let u = from + 2; u < to - 3; u += 7) {
      // Dash 0.16 m wide, sitting just above the asphalt (y 0.03..0.036).
      if (along === 'x') put('marking', [u, 0.03, at - 0.08], [u + 3, 0.036, at + 0.08])
      else put('marking', [at - 0.08, 0.03, u], [at + 0.08, 0.036, u + 3])
    }
  }
  // For each horizontal street: an asphalt slab across the full width, 3 cm thick, plus dashes.
  hStreets.forEach((z) => {
    put('asphalt', [xMin, 0, z - STREET / 2], [xMax, 0.03, z + STREET / 2])
    dashes(xMin, xMax, 'x', z)
  })
  // Same for the vertical streets, along z.
  vStreets.forEach((x) => {
    put('asphalt', [x - STREET / 2, 0, zMin], [x + STREET / 2, 0.03, zMax])
    dashes(zMin, zMax, 'z', x)
  })

  // Footpath ring with kerb around each block.
  // x0..x1, z0..z1 = the block's edges.
  const ring = (x0, x1, z0, z1) => {
    // Four footpath strips as [[minX, minZ], [maxX, maxZ]]: front, back, left, right.
    const strips = [
      [[x0 - FOOT, z1], [x1 + FOOT, z1 + FOOT]],
      [[x0 - FOOT, z0 - FOOT], [x1 + FOOT, z0]],
      [[x0 - FOOT, z0], [x0, z1]],
      [[x1, z0], [x1 + FOOT, z1]],
    ]
    // Nested destructuring in the parameter unpacks each strip into a, b, c, d. Paving 15 cm tall (raised path).
    strips.forEach(([[a, b], [c, d]]) => put('paving', [a, 0, b], [c, 0.15, d]))
    // Kerb thickness (m).
    const k = 0.18
    // Kerbs (20 cm tall) along the outer edge of each footpath: front, back, left, right.
    put('curb', [x0 - FOOT - k, 0, z1 + FOOT], [x1 + FOOT + k, 0.2, z1 + FOOT + k])
    put('curb', [x0 - FOOT - k, 0, z0 - FOOT - k], [x1 + FOOT + k, 0.2, z0 - FOOT])
    put('curb', [x0 - FOOT - k, 0, z0 - FOOT], [x0 - FOOT, 0.2, z1 + FOOT])
    put('curb', [x1 + FOOT, 0, z0 - FOOT], [x1 + FOOT + k, 0.2, z1 + FOOT])
  }
  // The z extent [z0, z1] of each band of blocks (back, middle - ours, front).
  const blockZ = [
    [zc - 2.5 * PD - STREET, zc - 1.5 * PD - STREET],
    [zc - 1.5 * PD, zc + 0.5 * PD],
    [zc + 0.5 * PD + STREET, zc + 2.5 * PD + STREET],
  ]
  // Every block x crossed with every block z band gets a footpath ring.
  blocks.forEach((bx) => blockZ.forEach(([z0, z1]) => ring(bx - BW / 2, bx + BW / 2, z0, z1)))

  // ---------- Trees and lights ----------
  // A tree at (x, z), scaled by s (default 1): a trunk plus two leafy blobs.
  const tree = (x, z, s = 1) => {
    // Trunk: 0.26 m square, 2.4 m tall.
    put('trunk', [x - 0.13 * s, 0, z - 0.13 * s], [x + 0.13 * s, 2.4 * s, z + 0.13 * s])
    // One leaf colour for this tree.
    const c = pick(LEAVES)
    // Main crown: 2.8 m wide, from 1.9 m to 4.4 m up.
    put('leaves', [x - 1.4 * s, 1.9 * s, z - 1.4 * s], [x + 1.4 * s, 4.4 * s, z + 1.4 * s], c)
    // A random sideways offset for the top crown so trees aren't perfectly symmetric.
    const o = (rand() - 0.5) * 0.8 * s
    // Smaller top crown.
    put('leaves', [x - 0.9 * s + o, 3.5 * s, z - 0.9 * s - o], [x + 0.9 * s + o, 5.0 * s, z + 0.9 * s - o], c)
  }
  // A street light at (x, z) whose arm reaches 1.4 m towards the road (dir = +1 or -1 along z).
  const light = (x, z, dir) => {
    // 6.2 m tall pole.
    put('pole', [x - 0.07, 0, z - 0.07], [x + 0.07, 6.2, z + 0.07])
    // Horizontal arm; Math.min/Math.max order the z values correctly whichever way dir points.
    put('metal', [x - 0.05, 6.0, Math.min(z, z + dir * 1.4)], [x + 0.05, 6.1, Math.max(z, z + dir * 1.4)])
    // Glowing lamp head at the end of the arm.
    put('lamp', [x - 0.18, 5.88, z + dir * 1.4 - 0.3], [x + 0.18, 6.0, z + dir * 1.4 + 0.3])
  }
  // For each block (bx = x centre, k = index 0..2):
  blocks.forEach((bx, k) => {
    // Front road verges, both sides. Leave the view of our own plot clear.
    // Trees every 8.5 m along the block.
    for (let x = bx - BW / 2 + 3; x < bx + BW / 2 - 2; x += 8.5) {
      // `continue` skips to the next loop step: no trees right in front of our plot in the centre block.
      if (k === 1 && Math.abs(x) < PW * 0.75) continue
      // Tree on our side of the front road, slightly random size.
      tree(x, zc + PD / 2 + FOOT - 0.5, 0.9 + rand() * 0.25)
      // Tree on the opposite side, staggered by 4 m.
      tree(x + 4, zc + PD / 2 + STREET - FOOT + 0.5, 0.9 + rand() * 0.25)
    }
    // Street lights every 24 m, alternating sides (offset 12 m), arms pointing over the road.
    for (let x = bx - BW / 2 + 6; x < bx + BW / 2; x += 24) {
      light(x, zc + PD / 2 + FOOT - 0.3, 1)
      light(x + 12, zc + PD / 2 + STREET - FOOT + 0.3, -1)
    }
  })

  // ---------- Houses ----------
  // A finished neighbour house on the plot centred at (cx, cz), front facing f (+1 = +z, -1 = -z).
  const houseAt = (cx, cz, f) => {
    // Local depth u runs from the back of the plot (-PD/2) to the street (+PD/2).
    // Converts a local depth range to world z, flipping it for plots that face -z.
    const zr = (u0, u1) => (f > 0 ? [cz + u0, cz + u1] : [cz - u1, cz - u0])
    // Box helper in local coordinates: x range, y range, local depth range u0..u1, optional colour.
    const B = (layer, x0, x1, y0, y1, u0, u1, color) => {
      // Destructure the converted world z range.
      const [z0, z1] = zr(u0, u1)
      put(layer, [x0, y0, z0], [x1, y1, z1], color)
    }
    // Chained ternaries: 15% single-storey, otherwise 75% of the rest two storeys, else three.
    const floors = rand() < 0.15 ? 1 : rand() < 0.75 ? 2 : 3
    // Wall colour for this house.
    const color = pick(PLASTER)
    // Roof height = plinth + storeys x storey height.
    const top = PLINTH + floors * FLOOR_H
    // Local depth of the house's back wall (1 m from the plot back) and front wall.
    const hb = -PD / 2 + 1
    const hf = hb + D
    // Left and right walls in world x.
    const x0 = cx - W / 2
    const x1 = cx + W / 2

    // Main body: one solid plaster box from the ground to the roof.
    B('plaster', x0, x1, 0, top, hb, hf, color)
    // Plinth band: a slightly larger trim box around the base.
    B('trim', x0 - 0.05, x1 + 0.05, 0, PLINTH, hb - 0.05, hf + 0.05)
    // A trim band at each floor/roof line (`<=` includes the top storey).
    for (let k = 1; k <= floors; k++) {
      const y = PLINTH + k * FLOOR_H
      B('trim', x0 - 0.04, x1 + 0.04, y - 0.18, y, hb - 0.04, hf + 0.06)
    }

    // Openings per floor on the front: 3 for wide houses, else 2.
    const n = W > 9 ? 3 : 2
    // One random number decides this house's facade feature (brick or wood strip, or none).
    const feature = rand()
    // For each storey k:
    for (let k = 0; k < floors; k++) {
      // Floor level of this storey.
      const base = PLINTH + k * FLOOR_H
      for (let i = 0; i < n; i++) {
        // Centre x of opening i, spacing them evenly across the width.
        const wx = x0 + ((i + 0.5) * W) / n
        // The last opening on the ground floor is the front door.
        const door = k === 0 && i === n - 1
        // Opening width: door 1.1 m, window 2.0 m (wide houses) or 1.6 m.
        const w = door ? 1.1 : W > 9 ? 2.0 : 1.6
        // Doors start at floor level; windows have a 0.85 m sill.
        const y0 = door ? base : base + 0.85
        // The door (wood) or window (glass), a 5 cm thick panel on the front face up to 2.2 m.
        B(door ? 'wood' : 'glass', wx - w / 2, wx + w / 2, y0, base + 2.2, hf, hf + 0.05)
        // A sunshade/lintel projecting 0.55 m above each opening.
        B('trim', wx - w / 2 - 0.25, wx + w / 2 + 0.25, base + 2.28, base + 2.36, hf, hf + 0.55)
      }
      // Side windows for depth.
      // One on the right wall 30% back, one on the left wall 60% back.
      B('glass', x1, x1 + 0.04, base + 0.9, base + 2.1, hb + D * 0.3, hb + D * 0.3 + 1.2)
      B('glass', x0 - 0.04, x0, base + 0.9, base + 2.1, hb + D * 0.6, hb + D * 0.6 + 1.2)
    }
    // 35% get a brick cladding strip on the front left, the next 25% a wood strip, the rest nothing.
    if (feature < 0.35) B('brick', x0, x0 + 1.1, PLINTH, top - 0.2, hf, hf + 0.07)
    else if (feature < 0.6) B('wood', x0, x0 + 0.9, PLINTH, top - 0.2, hf, hf + 0.07)

    // Parapet, mumty and tank.
    // Parapet wall thickness.
    const pt = 0.2
    // Four 0.9 m parapet walls around the roof edge: front, back, left, right.
    B('plaster', x0, x1, top, top + 0.9, hf - pt, hf, color)
    B('plaster', x0, x1, top, top + 0.9, hb, hb + pt, color)
    B('plaster', x0, x0 + pt, top, top + 0.9, hb, hf, color)
    B('plaster', x1 - pt, x1, top, top + 0.9, hb, hf, color)
    // Mumty: the small stair-head room on the roof (3 m x 4 m, 2.7 m tall) at the back right.
    B('plaster', x1 - 3.2, x1 - 0.2, top, top + 2.7, hb + 0.2, hb + 4.2, color)
    // Water tank on top of the mumty.
    B('tank', x1 - 2.3, x1 - 1.1, top + 2.7, top + 3.8, hb + 1.6, hb + 2.8)

    // Front boundary, gate, lawn, driveway and maybe a car.
    // Local depth of the plot's front edge.
    const yardEnd = PD / 2
    // Gate x range: 3.4 m wide, 0.4 m in from the right plot edge.
    const gx1 = cx + PW / 2 - 0.4
    const gx0 = gx1 - 3.4
    // Front boundary wall (1.7 m tall) to the left of the gate...
    B('plaster', cx - PW / 2, gx0, 0, 1.7, yardEnd - 0.2, yardEnd, color)
    // ...and the short piece to its right.
    B('plaster', gx1, cx + PW / 2, 0, 1.7, yardEnd - 0.2, yardEnd, color)
    // Coping trim on top of the left wall.
    B('trim', cx - PW / 2, gx0, 1.7, 1.78, yardEnd - 0.25, yardEnd + 0.05)
    // The metal gate.
    B('metal', gx0, gx1, 0, 1.6, yardEnd - 0.14, yardEnd - 0.06)
    // Front lawn between the house and the boundary wall.
    B('grass', cx - PW / 2 + 0.2, gx0 - 0.3, 0, 0.05, hf, yardEnd - 0.2)
    // Driveway behind the gate.
    B('drive', gx0, gx1, 0, 0.04, hf, yardEnd - 0.2)
    // A row of hedge blobs every 1.1 m just inside the boundary wall, each a random green.
    for (let x = cx - PW / 2 + 0.6; x < gx0 - 0.7; x += 1.1) {
      B('hedge', x - 0.35, x + 0.35, 0, 0.75, yardEnd - 0.85, yardEnd - 0.25, pick(LEAVES))
    }
    // If the front yard is deeper than 5.2 m, 60% chance of a parked car on the driveway.
    if (yardEnd - hf > 5.2 && rand() < 0.6) {
      // Car colour.
      const c = pick(CARS)
      // Middle of the driveway in x.
      const mx = (gx0 + gx1) / 2
      // Local depth where the car starts.
      const u = hf + 0.5
      // Wheels (a dark slab under the body), body (4.4 m long), and the glass cabin on top.
      B('tyre', mx - 0.9, mx + 0.9, 0, 0.36, u + 0.5, u + 3.9)
      B('car', mx - 0.92, mx + 0.92, 0.3, 0.95, u, u + 4.4, c)
      B('carGlass', mx - 0.8, mx + 0.8, 0.95, 1.42, u + 1.2, u + 3.4)
    }
  }

  // An empty plot: bare soil plus three scattered bushes.
  const vacant = (cx, cz) => {
    put('soilPatch', [cx - PW / 2 + 0.3, 0, cz - PD / 2 + 0.3], [cx + PW / 2 - 0.3, 0.02, cz + PD / 2 - 0.3])
    // `...bush(...)` spreads the returned [min, max, color] array into put's three remaining arguments.
    for (let i = 0; i < 3; i++) put('hedge', ...bush(cx + (rand() - 0.5) * PW * 0.7, cz + (rand() - 0.5) * PD * 0.7, 0.5))
  }
  // Returns the min corner, max corner and colour of a bush of half-size s at (x, z).
  // (Declared after `vacant` but that's fine: it is only called later, once both exist.)
  const bush = (x, z, s) => [[x - s, 0, z - s], [x + s, s * 1.3, z + s], pick(LEAVES)]

  // Fill every plot: for each row (destructured to r, cz, f) and each block...
  rows.forEach(({ r, cz, f }) =>
    blocks.forEach((bx, k) => {
      // ...except the park area.
      if (isPark(k, r)) return
      // Seven plots per row, i = -3 .. 3.
      for (let i = -3; i <= 3; i++) {
        if (k === 1 && r === 0 && i === 0) continue // our plot
        // x centre of this plot.
        const cx = bx + i * PW
        // 8% of plots away from ours are vacant; the rest get a house.
        if (rand() < 0.08 && Math.abs(i) > 1) vacant(cx, cz)
        else houseAt(cx, cz, f)
      }
    }),
  )

  // ---------- Park across the junction ----------
  // The park fills the right block's front two rows: x range px0..px1, z range pz0..pz1.
  const px0 = blocks[2] - BW / 2
  const px1 = blocks[2] + BW / 2
  const pz0 = zc + 0.5 * PD + STREET
  const pz1 = zc + 2.5 * PD + STREET
  // Lawn over the whole park.
  put('grass', [px0, 0, pz0], [px1, 0.05, pz1])
  // Walking-path loop 3 m in from the edges, 1.6 m wide: near, far, left and right sides.
  const inset = 3
  put('drive', [px0 + inset, 0.05, pz0 + inset], [px1 - inset, 0.07, pz0 + inset + 1.6])
  put('drive', [px0 + inset, 0.05, pz1 - inset - 1.6], [px1 - inset, 0.07, pz1 - inset])
  put('drive', [px0 + inset, 0.05, pz0 + inset], [px0 + inset + 1.6, 0.07, pz1 - inset])
  put('drive', [px1 - inset - 1.6, 0.05, pz0 + inset], [px1 - inset, 0.07, pz1 - inset])
  // 26 trees at random spots at least 5 m inside the park, random sizes.
  for (let i = 0; i < 26; i++) {
    const x = px0 + 5 + rand() * (BW - 10)
    const z = pz0 + 5 + rand() * (pz1 - pz0 - 10)
    tree(x, z, 0.9 + rand() * 0.6)
  }

  // extent = the largest distance of any edge from the origin (Math.abs gives the absolute value).
  return { layers: L, extent: Math.max(Math.abs(xMin), Math.abs(xMax), Math.abs(zMin), Math.abs(zMax)) }
}
