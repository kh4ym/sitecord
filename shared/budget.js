// FILE: shared/budget.js
// The owner's budget, split across stages so each stage can be tracked on its
// own. Shares are a starting point for a typical house; floors split theirs.
// Imported by both sides: the server stores the per-stage split and checks
// amount limits (services/projects, budget, expenses, routes/projects); the
// client previews the split on NewProjectPage. All amounts are integer paisa.
// Depends on: houseConfig.js (buildStages) for the list of stages.

// Named ES module import of the stage builder from the sibling file.
import { buildStages } from './houseConfig.js'

// Fractions of the whole budget per stage kind; they sum to 1. The floor
// share covers every floor together and is divided equally between them.
// Object literal used as a lookup table: SHARES.roof or SHARES['roof'] -> 0.08.
const SHARES = { blueprint: 0.02, foundation: 0.12, floor: 0.42, roof: 0.08, finishing: 0.36 }

/** [{ index, label, budget }] in paisa; the shares always add up to the whole budget. */
// Exported function taking the total budget (paisa) and the number of floors.
export function budgetByStage(budgetPaisa, floors) {
  const stages = buildStages(floors) // the ordered list of stages for this house
  // `.map` makes a new array by calling the arrow function on each stage `s`.
  // `({ ... })` - the parentheses make the arrow return an object literal.
  const list = stages.map((s) => ({
    index: s.index, // copy the stage's position
    label: s.label, // copy the stage's display name
    // Math.round rounds to the nearest whole paisa. The ternary picks the
    // per-floor share (floor share / number of floors) for floor stages, else
    // looks up the kind in SHARES with bracket notation SHARES[s.kind].
    budget: Math.round(budgetPaisa * (s.kind === 'floor' ? SHARES.floor / floors : SHARES[s.kind])),
  }))
  // Rounding each share to whole paisa can leave the sum a few paisa off; the
  // finishing stage absorbs the difference so the stages add up exactly.
  // `.reduce((n, s) => n + s.budget, 0)` sums the budgets, starting from 0.
  const drift = budgetPaisa - list.reduce((n, s) => n + s.budget, 0)
  // `list[list.length - 1]` is the last element; `+=` adds to it in place.
  list[list.length - 1].budget += drift
  return list // the finished per-stage split
}

// Exported limits. `100000 * 100` is Rs 1 lakh written in paisa.
export const MIN_BUDGET_PAISA = 100000 * 100 // Rs 1 lakh
// 1e9 = 1,000,000,000 rupees, times 100 for paisa.
export const MAX_BUDGET_PAISA = 1e9 * 100 // Rs 100 crore
/** No single purchase, line or payment may exceed this (well inside bigint and 2^53). */
// Reuses the budget ceiling as the per-amount ceiling.
export const MAX_AMOUNT_PAISA = MAX_BUDGET_PAISA

/**
 * Where a budget stands. Spent counts every purchase on record, approved or
 * waiting for approval, because both are money committed to the house.
 * `level` is the alert threshold reached (0, 80 or 100), compared exactly so
 * 79.6% never rounds up into an alert.
 */
// The single parameter is destructured from an object; `approved` and
// `waiting` default to 0 when the caller leaves them out.
export function budgetStatus({ budget, approved = 0, waiting = 0 }) {
  const spent = approved + waiting // total committed money
  // spent * 5 >= budget * 4 is "spent >= 80% of budget" in integer maths.
  // Chained ternary: 100 when fully spent, else 80 when past 80%, else 0.
  const level = budget > 0 && spent >= budget ? 100 : budget > 0 && spent * 5 >= budget * 4 ? 80 : 0
  // Object literal; `budget,` is shorthand for `budget: budget`.
  return {
    budget,
    approved,
    waiting,
    spent,
    left: Math.max(0, budget - spent), // Math.max picks the larger, so never below 0
    over: Math.max(0, spent - budget), // how far over budget, or 0
    // Percentage used, rounded; null (no value) when there is no budget.
    usedPct: budget > 0 ? Math.round((spent * 100) / budget) : null,
    level,
  }
}
