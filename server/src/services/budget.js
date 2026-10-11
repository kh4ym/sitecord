// The owner's budget against purchases. budgetSummary feeds the dashboard;
// checkBudget is called after anything that changes committed spending
// (submit/approve/reject a purchase, change the budget) and raises the 80%
// and 100% alerts. The maths (levels, spent/left/over) is in
// shared/budget.js so the client shows the same numbers.
//
// Used by: the dashboard route (budgetSummary) and the expense / payment /
// project services (checkBudget). Depends on: shared/budget.js, shared/money.js,
// shared/records.js (which expense statuses count), audit/audit.js,
// lib/util.js (`lock`) and notify.js.

// Budget maths shared with the client.
import { budgetByStage, budgetStatus } from '../../../shared/budget.js'
// Rupee formatter.
import { formatPKR } from '../../../shared/money.js'
// Arrays of expense statuses: approved, counted toward spending, and waiting.
import { APPROVED_EXPENSE_STATUSES, COUNTED_EXPENSE_STATUSES, WAITING_EXPENSE_STATUSES } from '../../../shared/records.js'
// Audit log writer.
import { audit } from '../audit/audit.js'
// Takes a transaction-level lock by name.
import { lock } from '../lib/util.js'
// Member lookup by role and notification sender.
import { membersWithRoles, notify } from './notify.js'

// Arrow function that turns ['A', 'B'] into the SQL text "('A', 'B')" for an
// IN (...) list. Values are fixed constants from shared code, not user input.
const list = (values) => `(${values.map((v) => `'${v}'`).join(', ')})`

/** Purchases on record: approved (or verified) and waiting for approval, in paisa. */
// Not exported: a private helper of this file.
async function purchaseTotals(q, projectId) {
  // `sum(x) FILTER (WHERE ...)` sums only rows matching the filter, so one
  // query gives two totals. COALESCE(value, 0) turns NULL (no rows) into 0.
  const [t] = await q(
    `SELECT COALESCE(sum(total_paisa) FILTER (WHERE status IN ${list(APPROVED_EXPENSE_STATUSES)}), 0) AS approved,
            COALESCE(sum(total_paisa) FILTER (WHERE status IN ${list(WAITING_EXPENSE_STATUSES)}), 0) AS waiting
       FROM expenses WHERE project_id = $1`,
    [projectId],
  )
  // `{ approved, waiting }` row.
  return t
}

/** The owner's budget against what has been spent: overall, by stage, and approved changes. */
export async function budgetSummary(q, project) {
  // Build one object from the budget plus the two totals (spread of the
  // awaited result; the parentheses make `await` happen before spreading),
  // then compute spent/left/over/level.
  const status = budgetStatus({ budget: project.budgetPaisa, ...(await purchaseTotals(q, project.id)) })
  // Spending grouped by build stage. Purchases without a stage count toward the
  // current stage ($2). `GROUP BY 1` groups by the first selected column.
  const spentByStage = await q(
    `SELECT COALESCE(stage_index, $2) AS stage_index, sum(total_paisa) AS spent
       FROM expenses WHERE project_id = $1 AND status IN ${list(COUNTED_EXPENSE_STATUSES)}
      GROUP BY 1`,
    [project.id, project.stageIndex],
  )
  // Split the budget across stages, then add each stage's spending.
  const byStage = budgetByStage(project.budgetPaisa, project.floors).map((s) => ({
    ...s, // copy the stage's fields
    // `.find` returns the first matching row or undefined; `?.spent` (optional
    // chaining) reads `spent` only if a row was found, else gives undefined,
    // and `?? 0` turns that into 0.
    spent: spentByStage.find((x) => x.stageIndex === s.index)?.spent ?? 0,
  }))
  // Total and count of approved change requests (shown beside the budget).
  const [changes] = await q(
    "SELECT COALESCE(sum(cost_impact_paisa), 0) AS total, count(*)::int AS count FROM change_requests WHERE project_id = $1 AND status = 'APPROVED'",
    [project.id],
  )
  // Combine everything into one object for the dashboard.
  return { ...status, byStage, approvedChanges: changes }
}

/**
 * Tell the owners once when committed spending reaches 80% and again at 100%
 * of the budget. If spending drops back (a rejection, a bigger budget), the
 * level is lowered silently so the next crossing is announced again.
 */
export async function checkBudget(q, ctx) {
  const pid = ctx.project.id // short name for the project id
  // Lock so two approvals landing together can't both see the old level and
  // both announce the same crossing. budget_alert is the highest level told.
  await lock(q, `budget:${pid}`)
  // Read the project's name, budget and last announced level.
  const [p] = await q('SELECT name, budget_paisa, budget_alert FROM projects WHERE id = $1', [pid])
  // Compute the current level (0, 80 or 100) from fresh totals.
  const status = budgetStatus({ budget: p.budgetPaisa, ...(await purchaseTotals(q, pid)) })
  // Same level as last time: nothing to do; `===` is strict equality.
  if (status.level === p.budgetAlert) return status
  // Remember the new level (note $2 and $1 may appear in any order).
  await q('UPDATE projects SET budget_alert = $2 WHERE id = $1', [pid, status.level])
  // Level went down: stored silently, no announcement.
  if (status.level < p.budgetAlert) return status

  // Text like "Rs 9 lakh of Rs 10 lakh"; `compact: true` uses lakh/crore wording.
  const of = `${formatPKR(status.spent, { compact: true })} of ${formatPKR(p.budgetPaisa, { compact: true })}`
  // Nested ternaries choose the title: at 100%, either "over budget" (when
  // over > 0) or "used its whole budget"; otherwise "used N% of its budget".
  const title =
    status.level === 100
      ? status.over > 0
        ? `${p.name} is ${formatPKR(status.over, { compact: true })} over budget`
        : `${p.name} has used its whole budget`
      : `${p.name} has used ${status.usedPct}% of its budget`
  // Audit entry; actorId null means "the system did this", not a person.
  await audit(q, {
    projectId: pid,
    actorId: null,
    action: 'budget.alert',
    targetType: 'PROJECT',
    targetId: pid,
    summary: `Spending reached ${status.level}% of the budget (${of})`,
    payload: { level: status.level, spentPaisa: status.spent, budgetPaisa: p.budgetPaisa },
    at: ctx.at,
  })
  // Notify the owners.
  await notify(q, {
    userIds: await membersWithRoles(q, pid, ['OWNER']),
    projectId: pid,
    title, // shorthand for title: title
    body: `Spent ${of}, including purchases waiting for approval.`,
    link: `/p/${pid}/money`,
    at: ctx.at,
  })
  // Return the computed status to the caller.
  return status
}
