// FILE: shared/estimates.js
// Starting point for a new project: the bill of quantities (BOQ) worked out
// from the covered area, and the contractor's payment milestones taken from
// the owner's own budget. BOQ rates are 2026 Lahore reference prices used by
// the automatic price check; owners edit both after the project is created.
// Lives in shared/ so the client can preview the figures on the new-project
// form, but today only the server imports it (services/projects, at project
// creation). Money is integer paisa; stageIndex values follow buildStages.
// Depends on: houseConfig.js (coveredAreaSqft).

// Named ES module import of the area calculator.
import { coveredAreaSqft } from './houseConfig.js'

// Arrow function: floor number -> "Ground floor", "First floor", ...
// The array literal is indexed directly with `[k]`, inside a template literal.
const floorName = (k) => `${['Ground', 'First', 'Second', 'Third', 'Fourth'][k]} floor`

/** Quantity per covered sq ft and rate in rupees. */
// Array of object literals, one per BOQ line. `perSqft` is quantity per
// covered square foot; `rate` is rupees per unit; `phase` groups the lines.
const BOQ_TEMPLATE = [
  // --- Structure materials (M-xx) ---
  { code: 'M-01', description: 'OPC cement, 50 kg bag', category: 'Cement', unit: 'bag', perSqft: 0.42, rate: 1450, phase: 'STRUCTURE' },
  { code: 'M-02', description: 'Steel bars, Grade 60', category: 'Steel', unit: 'kg', perSqft: 3.8, rate: 270, phase: 'STRUCTURE' },
  { code: 'M-03', description: 'Bricks, A-class', category: 'Bricks', unit: 'brick', perSqft: 33, rate: 17, phase: 'STRUCTURE' },
  { code: 'M-04', description: 'Sand, Chenab', category: 'Sand', unit: 'cft', perSqft: 1.3, rate: 110, phase: 'STRUCTURE' },
  { code: 'M-05', description: 'Crush, 3/4 inch', category: 'Crush', unit: 'cft', perSqft: 0.7, rate: 160, phase: 'STRUCTURE' },
  // --- Structure labour and equipment (L-xx, E-xx), priced per sq ft ---
  { code: 'L-01', description: 'Grey structure labour', category: 'Labour', unit: 'sq ft', perSqft: 1, rate: 450, phase: 'STRUCTURE' },
  { code: 'E-01', description: 'Shuttering and scaffolding hire', category: 'Equipment', unit: 'sq ft', perSqft: 1, rate: 45, phase: 'STRUCTURE' },
  // --- Finishing work (F-xx), priced per sq ft ---
  { code: 'F-01', description: 'Electrical wiring and fittings', category: 'Electrical', unit: 'sq ft', perSqft: 1, rate: 550, phase: 'FINISHING' },
  { code: 'F-02', description: 'Plumbing and sanitary', category: 'Plumbing', unit: 'sq ft', perSqft: 1, rate: 500, phase: 'FINISHING' },
  { code: 'F-03', description: 'Tiles and marble', category: 'Tiles', unit: 'sq ft', perSqft: 1, rate: 650, phase: 'FINISHING' },
  { code: 'F-04', description: 'Doors and windows', category: 'Woodwork', unit: 'sq ft', perSqft: 1, rate: 600, phase: 'FINISHING' },
  { code: 'F-05', description: 'Paint and polish', category: 'Paint', unit: 'sq ft', perSqft: 1, rate: 180, phase: 'FINISHING' },
  { code: 'F-06', description: 'Finishing labour', category: 'Labour', unit: 'sq ft', perSqft: 1, rate: 350, phase: 'FINISHING' },
]

// Estimates are not measurements: big quantities are rounded to tens so the
// list does not look more precise than it is.
// Ternary: >= 1000 rounds to the nearest 10, otherwise to the nearest whole.
const roundQty = (q) => (q >= 1000 ? Math.round(q / 10) * 10 : Math.round(q))

/** Materials list for a plot ({ plotSize } preset or { widthFt, depthFt }) and floor count. */
// Parameter destructuring with rest: `floors` is pulled out, and `...plot`
// collects every other property into a new object.
export function buildBoq({ floors, ...plot }) {
  const area = coveredAreaSqft(plot, floors) // total covered sq ft, all floors
  // For each template line, destructure out perSqft and rate and keep the
  // rest as `item`; return a new object with item's fields plus estimates.
  return BOQ_TEMPLATE.map(({ perSqft, rate, ...item }) => ({
    ...item, // spread: copy code, description, category, unit, phase
    estQty: roundQty(area * perSqft), // estimated quantity
    estUnitPaisa: rate * 100, // unit price converted to paisa
  }))
}

/**
 * Share of the budget the contractor is paid for, by contract type. Grey
 * structure is roughly half the cost of a house; turnkey is nearly all of it;
 * labour-only is just the structure labour; self-managed has no contractor,
 * so no milestones at all.
 */
// Lookup table: contract type -> fraction of the budget.
const CONTRACT_SCOPE = { GREY_STRUCTURE: 0.5, TURNKEY: 0.95, LABOUR_ONLY: 0.14, SELF_MANAGED: 0 }

/**
 * Payment milestones released to the contractor as stages complete.
 * `stageIndex` is the stage that must be complete; null means on signing.
 */
// Destructured single parameter with three named properties.
export function buildMilestones({ floors, contractType, budgetPaisa }) {
  // Look up the scope; `?? 0` falls back to 0 for an unknown type.
  const scope = CONTRACT_SCOPE[contractType] ?? 0
  if (!scope) return [] // 0 is falsy, so no contractor means no milestones
  const value = budgetPaisa * scope // contractor's total, in paisa
  // Only a turnkey contractor is paid for finishing, so only turnkey has
  // finishing and handover milestones; the other types release everything
  // by the roof. Each set of shares sums to 1 of the contractor's scope.
  const finishing = contractType === 'TURNKEY' // boolean
  // Multi-line ternary choosing one of two share tables.
  const shares = finishing
    ? { advance: 0.1, foundation: 0.1, floors: 0.35, roof: 0.1, finishing: 0.25, handover: 0.1 }
    : { advance: 0.1, foundation: 0.2, floors: 0.5, roof: 0.2 }
  // Round to a tidy figure (Rs 1 lakh, or Rs 1,000 for small budgets); the
  // last milestone takes the remainder so the total is exactly the scope.
  // Units are in paisa: 1e7 paisa = Rs 1 lakh, 1e5 paisa = Rs 1,000; the
  // threshold 50 * 1e7 is a contractor scope of Rs 50 lakh.
  const unit = value >= 50 * 1e7 ? 1e7 : 1e5
  // Helper: the share's amount, rounded to a whole number of `unit`s.
  const rounded = (share) => Math.round((value * share) / unit) * unit

  // Milestones mirror the stage list in houseConfig: stage 1 is foundation,
  // 2..floors+1 are the floors, floors+2 the roof, floors+3 finishing. The
  // floors share is split equally per floor.
  // Start the array with the advance paid on signing (stageIndex null).
  const list = [{ name: 'Mobilisation advance', stageIndex: null, amountPaisa: rounded(shares.advance) }]
  list.push({ name: 'Foundation and plinth complete', stageIndex: 1, amountPaisa: rounded(shares.foundation) })
  // Classic for loop: start k at 0, run while k < floors, add 1 (`k++`) each time.
  for (let k = 0; k < floors; k++) {
    const top = k === floors - 1 // is this the top floor?
    list.push({
      // The top floor finishes with walls (the roof slab is its own stage).
      name: top ? `${floorName(k)} walls complete` : `${floorName(k)} slab complete`,
      stageIndex: 2 + k, // floors start at stage 2
      amountPaisa: rounded(shares.floors / floors), // equal share per floor
    })
  }
  list.push({ name: 'Roof and mumty complete', stageIndex: floors + 2, amountPaisa: rounded(shares.roof) })
  // Turnkey only: finishing and the retained handover payment.
  if (finishing) {
    list.push({ name: 'Finishing complete', stageIndex: floors + 3, amountPaisa: rounded(shares.finishing) })
    list.push({ name: 'Handover (retention)', stageIndex: floors + 3, amountPaisa: rounded(shares.handover) })
  }
  const last = list[list.length - 1] // the final milestone object
  // Add the rounding remainder (exact total minus the sum so far) to it.
  last.amountPaisa += Math.round(value) - list.reduce((n, m) => n + m.amountPaisa, 0)
  // `.map((m, i) => ...)` also gets the index `i`; copy each milestone and add its sort order.
  return list.map((m, i) => ({ ...m, sort: i }))
}
