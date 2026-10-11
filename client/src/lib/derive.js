// FILE: client/src/lib/derive.js
//
// What it does: pure helper functions that reshape server data for the
// screens ("Week 26 of 52", a one-line status sentence, grouping lists by
// month or day, extra computed columns for materials). "Pure" means each
// function only reads its arguments and returns a value; nothing else changes.
//
// Why it exists: kept out of the pages so they stay small and the logic can
// be tested on its own.
//
// Where it's used: HomePage (weekLine, statusLine), ReportsPage
// (groupByMonth), HistoryPage (groupByDay) and MaterialsPage (materialRows).
//
// Depends on: shared/houseConfig.js (the planned build schedule) and
// lib/format.js (date/month formatting).

// Named import from the shared folder. `@shared` is a path alias set up in the
// Vite config that points at the repo's shared/ folder.
import { buildSchedule } from '@shared/houseConfig.js'
// Two named imports from a sibling file in this folder.
import { formatDate, formatMonth } from './format.js'

// One day in milliseconds (24 * 60 * 60 * 1000). Module-level constant, not exported.
const DAY = 86400000

/** "Week 26 of 52", from the start date and the planned schedule. */
// `export function` declares and exports a normal function.
export function weekLine(project) {
  // No start date yet: nothing to show. `!x` is true for null/undefined/''.
  if (!project.startDate) return null
  // Build the planned stage list. `?? 0` uses 0 when startStage is null/undefined.
  const schedule = buildSchedule(project.floors, project.startDate, project.startStage ?? 0)
  // Template literal appends a time so the date parses as local midnight; getTime() gives milliseconds.
  const start = new Date(`${project.startDate}T00:00:00`).getTime()
  // `schedule.at(-1)` is the last element of the array (negative index counts from the end).
  const end = new Date(`${schedule.at(-1).end}T00:00:00`).getTime()
  // Whole weeks since start, plus one (week 1 is the first week). Math.max keeps it at least 1.
  const week = Math.max(1, Math.floor((Date.now() - start) / (7 * DAY)) + 1)
  // Total planned weeks, but never less than the current week (if running late).
  return `Week ${week} of ${Math.max(week, Math.round((end - start) / (7 * DAY)))}`
}

/** One sentence on where the build is: what was just done, what's next. */
// `t` is the translate function and `term` translates building terms; both are passed in.
export function statusLine(project, overview, t, term) {
  // Finished project: use the translated "complete" sentence.
  if (project.complete) return t('home.complete')
  // Translated name of the current stage.
  const stage = term(overview.stage.label)
  // Object destructuring: pull `done` and `next` out of nextStep. `?? {}` avoids
  // a crash when nextStep is null (both then become undefined).
  const { done, next } = overview.nextStep ?? {}
  // Both known: "X is done, Y is next". The object passes values into the translation.
  // `next.endsWith('s') ? 'are' : 'is'` picks the verb for plural-looking words.
  if (done && next) return t('home.status', { stage, done: term(done).toLowerCase(), next: term(next), verb: next.endsWith('s') ? 'are' : 'is' })
  // Only the next step known: the stage has just started.
  if (next) return t('home.started', { stage, next: term(next) })
  // Neither: the stage is finished.
  return t('home.finished', { stage })
}

/** Rows grouped under a heading, in the order they arrive: [{ key, label, items }]. */
// `keyOf` and `labelOf` are functions passed in as arguments (callbacks).
function groupBy(rows, keyOf, labelOf) {
  // The result list; `const` still allows pushing into the array (the binding is constant, not the contents).
  const groups = []
  // Visit each row in order.
  for (const r of rows) {
    // Ask the caller's function which group this row belongs to.
    const key = keyOf(r)
    // If the last group (`at(-1)`, maybe undefined, hence `?.`) has a different key, start a new group.
    if (groups.at(-1)?.key !== key) groups.push({ key, label: labelOf(key, r), items: [] })
    // Add the row to the current (last) group.
    groups.at(-1).items.push(r)
  }
  // Return the list of groups.
  return groups
}

// Group reports by "YYYY-MM": `slice(0, 7)` takes the first 7 characters of the date string.
// The label function turns that key into a month name like "October 2026".
export const groupByMonth = (reports) => groupBy(reports, (r) => r.reportDate.slice(0, 7), (key) => formatMonth(key))
// Group events by their formatted date; the key itself is the label.
export const groupByDay = (events) => groupBy(events, (e) => formatDate(e.createdAt), (key) => key)

/** Material rows with what the Materials page shows: on site, bought over plan, price against expected. */
// Arrow function whose body (on the next line) is the returned expression.
export const materialRows = (items) =>
  // `.map` makes a new array by transforming each item. `({ ... })` wraps an
  // object literal in parentheses so the arrow returns it (not a code block).
  items.map((b) => ({
    // Spread: copy every field of the original row.
    ...b,
    // Quantity still on site; never negative.
    onSite: Math.max(0, b.boughtQty - b.usedQty),
    // True when more than 5% over the estimate (and there is an estimate).
    overQty: b.estQty > 0 && b.boughtQty > b.estQty * 1.05,
    // Fractional price difference vs expected (0.1 = 10% dearer), or null if either price is missing.
    priceDiff: b.avgUnitPaisa && b.estUnitPaisa ? b.avgUnitPaisa / b.estUnitPaisa - 1 : null,
  }))
