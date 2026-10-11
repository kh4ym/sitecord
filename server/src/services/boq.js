// Bill of quantities: the planned materials, labour and equipment lines a
// project is measured against. Lines are generated at project creation
// (shared/estimates) and edited or CSV-imported here; purchases and daily
// reports reference them by id, and expenses.js runRules compares prices
// and quantities to them. Used by routes/projects.js.
//
// What this file does: list BOQ lines with bought/used totals, add or update
// a line, import many lines from CSV text, and archive (soft-delete) a line.
// Depends on: shared/money.js, shared/records.js, audit/audit.js,
// lib/errors.js and lib/util.js. `q` runs SQL (camelCase rows); `ctx` is the
// request context (project, userId, can(), at).

// Rupee formatter.
import { formatPKR } from '../../../shared/money.js'
// Expense statuses that count as real spending.
import { COUNTED_EXPENSE_STATUSES } from '../../../shared/records.js'
// Audit log writer.
import { audit } from '../audit/audit.js'
// HTTP 400 and 404 error builders.
import { badRequest, notFound } from '../lib/errors.js'
// Timestamp formatter and id generator.
import { isoAt, newId } from '../lib/util.js'

// SQL text "('A', 'B', ...)" for an IN list, built once with map + join.
const COUNTED = `(${COUNTED_EXPENSE_STATUSES.map((s) => `'${s}'`).join(', ')})`

/**
 * Bill of quantities with what was actually bought and used against each
 * line. People who can't see money (a site supervisor) get quantities only.
 */
export async function listBoq(q, ctx) {
  // One query. Each BOQ line `b` is LEFT JOINed to two subqueries (derived
  // tables named `bought` and `used`):
  //  - bought: purchase lines on counted expenses, summed per BOQ item
  //    (GROUP BY collapses rows per item; sum() adds them up);
  //  - used: materials reported used in daily reports, summed per item.
  // COALESCE(x, 0) turns "no rows" (NULL) into 0. CASE WHEN ... THEN ... ELSE
  // ... END is SQL's if/else: average unit price only when something was bought.
  // ORDER BY: phase descending, then materials (M-) before labour (L-) before
  // the rest, then by code. `$1` is used several times for the same project id.
  const rows = await q(
    `SELECT b.*,
            COALESCE(bought.qty, 0) AS bought_qty,
            COALESCE(bought.spent, 0) AS spent_paisa,
            COALESCE(used.qty, 0) AS used_qty,
            CASE WHEN COALESCE(bought.qty, 0) > 0 THEN round(bought.spent / bought.qty) ELSE NULL END AS avg_unit_paisa
       FROM boq_items b
       LEFT JOIN (SELECT l.boq_item_id, sum(l.qty) AS qty, sum(l.total_paisa) AS spent
                    FROM expense_lines l JOIN expenses e ON e.id = l.expense_id
                   WHERE e.project_id = $1 AND e.status IN ${COUNTED} GROUP BY l.boq_item_id) bought ON bought.boq_item_id = b.id
       LEFT JOIN (SELECT rm.boq_item_id, sum(rm.qty) AS qty FROM report_materials rm JOIN daily_reports r ON r.id = rm.report_id
                   WHERE r.project_id = $1 GROUP BY rm.boq_item_id) used ON used.boq_item_id = b.id
      WHERE b.project_id = $1 AND b.archived_at IS NULL
      ORDER BY b.phase DESC, CASE WHEN b.code LIKE 'M-%' THEN 0 WHEN b.code LIKE 'L-%' THEN 1 ELSE 2 END, b.code`,
    [ctx.project.id],
  )
  // Money viewers get everything.
  if (ctx.can('viewMoney')) return rows
  // Others: destructure each row in the arrow's parameter, pulling out the
  // three money fields, and collect the rest into `b` with the rest syntax
  // `...b`; returning `b` drops the money fields.
  return rows.map(({ estUnitPaisa, spentPaisa, avgUnitPaisa, ...b }) => b)
}

/** With an id: update (row locked so the audit "from → to" is accurate). Without: add, refusing a duplicate code. */
export async function upsertBoqItem(q, ctx, input, id) {
  // Update path (an id was given).
  if (id) {
    // Read the current row and lock it (`FOR UPDATE`) until the transaction ends.
    const [old] = await q('SELECT * FROM boq_items WHERE id = $1 AND project_id = $2 AND archived_at IS NULL FOR UPDATE', [id, ctx.project.id])
    if (!old) throw notFound('Item not found') // 404 when missing
    // Merge: start from the old row, overwrite with the new input (later spread wins).
    const next = { ...old, ...input }
    // Save the merged values.
    await q(
      'UPDATE boq_items SET description = $2, category = $3, unit = $4, est_qty = $5, est_unit_paisa = $6, phase = $7 WHERE id = $1',
      [id, next.description, next.category, next.unit, next.estQty, next.estUnitPaisa, next.phase],
    )
    // Audit entry recording what changed (old → new).
    await audit(q, {
      projectId: ctx.project.id, actorId: ctx.userId, action: 'boq.updated', targetType: 'BOQ', targetId: id,
      summary: `Updated ${old.code} ${next.description}: ${old.estQty} → ${next.estQty} ${next.unit} at ${formatPKR(next.estUnitPaisa)}`,
      // Nested objects with from/to for quantity and rate.
      payload: { estQty: { from: old.estQty, to: next.estQty }, estUnitPaisa: { from: old.estUnitPaisa, to: next.estUnitPaisa } },
      at: ctx.at,
    })
    // Done; return early so the "add" code below doesn't run.
    return { id }
  }
  // Add path: `SELECT 1` just checks whether any row exists with this code.
  const [dup] = await q('SELECT 1 FROM boq_items WHERE project_id = $1 AND code = $2', [ctx.project.id, input.code])
  if (dup) throw badRequest(`Code ${input.code} is already used`)
  // New id (named so it doesn't clash with the `id` parameter).
  const newIdValue = newId()
  // Insert the new line; phase defaults to 'STRUCTURE' via `??`.
  await q(
    `INSERT INTO boq_items (id, project_id, code, description, category, unit, est_qty, est_unit_paisa, phase, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [newIdValue, ctx.project.id, input.code, input.description, input.category, input.unit, input.estQty, input.estUnitPaisa, input.phase ?? 'STRUCTURE', isoAt(ctx.at)],
  )
  // Audit entry for the addition.
  await audit(q, {
    projectId: ctx.project.id, actorId: ctx.userId, action: 'boq.added', targetType: 'BOQ', targetId: newIdValue,
    summary: `Added ${input.code} ${input.description}: ${input.estQty} ${input.unit} at ${formatPKR(input.estUnitPaisa)}`,
    at: ctx.at,
  })
  // Return the new id under the property name `id`.
  return { id: newIdValue }
}

/** One CSV line into cells; quoted cells may hold commas and doubled quotes. */
// A small hand-written parser that reads the line character by character.
function csvCells(line) {
  const cells = [] // finished cells
  // `let` declares a variable that can be reassigned (unlike const).
  let cell = '' // the cell being built
  let quoted = false // are we inside "..."?
  // Classic for loop: start i at 0, keep going while i < length, add 1 each time (`i++`).
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] // the character at position i
    // Inside quotes, `""` means one literal quote character.
    if (quoted && ch === '"' && line[i + 1] === '"') {
      cell += '"' // `+=` appends to the string
      i++ // skip the second quote
    // A lone quote toggles quoted mode (`!` flips true/false).
    } else if (ch === '"') quoted = !quoted
    // A comma outside quotes ends the cell.
    else if (ch === ',' && !quoted) {
      cells.push(cell.trim()) // store it without surrounding spaces
      cell = '' // start a new cell
    // Any other character is added to the current cell.
    } else cell += ch
  }
  // Store the last cell (there is no comma after it).
  cells.push(cell.trim())
  return cells
}

/**
 * Import rows from CSV text: code, description, category, unit, quantity, rate (rupees).
 * Existing codes are updated, new codes are added.
 */
export async function importBoqCsv(q, ctx, csv) {
  // Split into lines on a regex (`\r?\n` = newline with optional carriage
  // return), trim each, and drop empty ones (`filter(Boolean)` keeps truthy values).
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // `!lines.length` is true when there are 0 lines.
  if (!lines.length) throw badRequest('The file is empty')
  if (lines.length > 500) throw badRequest('Import up to 500 rows at a time')
  // Parse each line into cells (passing the function itself to map).
  const rows = lines.map(csvCells)
  // First row lower-cased, in case it is a header.
  const header = rows[0].map((h) => h.toLowerCase())
  // If the first row has a "code" column, it is a header: skip it with `.slice(1)`.
  const body = header.includes('code') ? rows.slice(1) : rows
  // Helper: the column's position from the header, or a default position.
  const col = (name, fallback) => (header.includes(name) ? header.indexOf(name) : fallback)
  // Column positions for each field.
  const idx = { code: col('code', 0), description: col('description', 1), category: col('category', 2), unit: col('unit', 3), qty: col('quantity', 4), rate: col('rate', 5) }
  let added = 0 // counters (reassigned, so `let`)
  let updated = 0
  // `.entries()` yields [index, row] pairs; destructured into n and r.
  for (const [n, r] of body.entries()) {
    // Build one item from the cells; `?.slice(0, 20)` cuts to a max length
    // only when the cell exists.
    const item = {
      code: r[idx.code]?.slice(0, 20),
      description: r[idx.description]?.slice(0, 120),
      category: r[idx.category]?.slice(0, 40) || 'Other', // default category
      unit: r[idx.unit]?.slice(0, 20),
      estQty: Number(r[idx.qty]), // text → number (NaN if not a number)
      estUnitPaisa: Math.round(Number(r[idx.rate]) * 100), // rupees → paisa, rounded
    }
    // Validate. `!(x >= 0)` is also true for NaN, because NaN >= 0 is false.
    if (!item.code || !item.description || !item.unit || !(item.estQty >= 0) || !(item.estUnitPaisa >= 0)) {
      // n is 0-based and the header is row 1, so the file row is n + 2.
      throw badRequest(`Row ${n + 2} is incomplete. Each row needs code, description, category, unit, quantity and rate.`)
    }
    // Is there an active line with this code already?
    const [existing] = await q('SELECT id FROM boq_items WHERE project_id = $1 AND code = $2 AND archived_at IS NULL', [ctx.project.id, item.code])
    // Update when it exists (id given), otherwise add (id undefined).
    await upsertBoqItem(q, ctx, item, existing?.id)
    // Ternary used as a statement: increment one counter or the other.
    existing ? updated++ : added++
  }
  return { added, updated }
}

/** Soft delete. A line with purchases against it stays, so past expenses keep their reference. */
export async function archiveBoqItem(q, ctx, id) {
  // Any purchase line pointing at this item? LIMIT 1 stops at the first one.
  const [used] = await q('SELECT 1 FROM expense_lines WHERE boq_item_id = $1 LIMIT 1', [id])
  if (used) throw badRequest('This item has purchases against it, so it can only be edited, not removed')
  // Mark archived and get its code/description back with RETURNING.
  const [item] = await q('UPDATE boq_items SET archived_at = now() WHERE id = $1 AND project_id = $2 AND archived_at IS NULL RETURNING code, description', [id, ctx.project.id])
  if (!item) throw notFound('Item not found')
  // Audit entry.
  await audit(q, { projectId: ctx.project.id, actorId: ctx.userId, action: 'boq.removed', targetType: 'BOQ', targetId: id, summary: `Removed ${item.code} ${item.description}`, at: ctx.at })
}
