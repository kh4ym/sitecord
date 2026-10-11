// FILE: server/src/services/dashboard.js
//
// WHAT IT DOES
// Read-only aggregations for the three home screens: the project overview
// (everyone), the owner's approvals inbox, and the field "Today" page for
// whoever submits reports. Nothing here writes. The core is waitingFor():
// the per-role to-do list that both overview and today show.
//
// WHY IT EXISTS
// Each home screen needs data from many tables at once. Gathering it here
// keeps the routes thin and keeps the "who sees what" gating in one file.
//
// WHO USES IT
// routes/projects.js (GET overview / approvals / today).
//
// WHAT IT DEPENDS ON
// Pulls summaries from budget.js, payments.js, plan.js, access.js and
// evidence.js, plus shared/features.js, shared/permissions.js,
// shared/records.js and lib/util.js (today's date in Pakistan).
//
// Services take (q, ctx): q runs SQL in the current transaction and resolves
// to camelCased rows; ctx is who is asking (role, permissions via ctx.can).

// ES module named imports.
// featuresFor = which features a contract type has; stagesFor = the construction stages list.
import { featuresFor, stagesFor } from '../../../shared/features.js'
// Labels for the scopes an inspector can ask to see.
import { ACCESS_SCOPES } from '../../../shared/permissions.js'
// Statuses that count as spent; labels of purchase types.
import { COUNTED_EXPENSE_STATUSES, EXPENSE_TYPES } from '../../../shared/records.js'
// Today's date in Pakistan as "YYYY-MM-DD".
import { todayPK } from '../lib/util.js'
// Pending inspector access requests.
import { pendingAccess } from './access.js'
// Budget numbers (budget, approved, waiting, remaining...).
import { budgetSummary } from './budget.js'
// Unattached uploads since a time.
import { looseEvidence } from './evidence.js'
// Is a milestone's stage finished; payment totals.
import { milestoneDue, paymentSummary } from './payments.js'
// Inspection steps still to do.
import { inspectionQueue } from './plan.js'

// SQL list text like "('APPROVED', 'VERIFIED')": .map quotes each status
// (arrow function + template literal), .join adds commas, outer template adds ( ).
const COUNTED = `(${COUNTED_EXPENSE_STATUSES.map((s) => `'${s}'`).join(', ')})`

// Money numbers for the overview (only called for people allowed to see the budget).
async function moneySummary(q, project) {
  // Short name for the project id.
  const pid = project.id
  // First day of this month: .slice(0, 7) keeps "YYYY-MM", then append "-01".
  const monthStart = `${todayPK().slice(0, 7)}-01`
  // One row of totals over this project's purchases:
  //   sum(total_paisa) FILTER (WHERE ...) — sum only matching rows;
  //   COALESCE(..., 0) — 0 instead of NULL when nothing matches;
  //   count(*) FILTER (...)::int — how many are waiting, cast to integer;
  //   purchase_date >= $2 — only purchases dated this month.
  const [extra] = await q(
    `SELECT COALESCE(sum(total_paisa) FILTER (WHERE status = 'VERIFIED'), 0) AS verified,
            COALESCE(sum(total_paisa) FILTER (WHERE status = 'REJECTED'), 0) AS rejected,
            count(*) FILTER (WHERE status IN ('SUBMITTED', 'QUERIED'))::int AS pending_count,
            COALESCE(sum(total_paisa) FILTER (WHERE status IN ${COUNTED} AND purchase_date >= $2), 0) AS this_month
       FROM expenses WHERE project_id = $1`,
    [pid, monthStart],
  )
  // Spending by category:
  //   COALESCE(b.category, CASE e.type WHEN ... END) — the BOQ item's category,
  //     or (for lines not tied to a BOQ item) a label based on the purchase type;
  //   FROM expense_lines l JOIN expenses e — each line with its purchase;
  //   LEFT JOIN boq_items b — the optional BOQ item;
  //   WHERE ... status IN (counted) — only money actually spent;
  //   GROUP BY 1 ORDER BY 2 DESC — group by the 1st selected column (label),
  //     sort by the 2nd (value), largest first.
  const categories = await q(
    `SELECT COALESCE(b.category, CASE e.type WHEN 'MATERIAL' THEN 'Other materials' ELSE e.type END) AS label, sum(l.total_paisa) AS value
       FROM expense_lines l JOIN expenses e ON e.id = l.expense_id LEFT JOIN boq_items b ON b.id = l.boq_item_id
      WHERE e.project_id = $1 AND e.status IN ${COUNTED}
      GROUP BY 1 ORDER BY 2 DESC`,
    [pid],
  )
  // Features of this contract type.
  const features = featuresFor(project.contractType)
  // Build one object by spreading (`...`) two others into it and adding fields.
  return {
    // `...(await x)` — await the budget summary, then copy its properties in.
    ...(await budgetSummary(q, project)),
    // Copy the totals row's properties.
    ...extra,
    // Translate type codes like 'LABOUR' to labels; `?? c.label` keeps category names that aren't type codes.
    categories: categories.map((c) => ({ ...c, label: EXPENSE_TYPES[c.label] ?? c.label })),
    // Payment totals only where payments exist.
    payments: features.payments ? await paymentSummary(q, pid) : null,
  }
}

/**
 * The things this person needs to do next on this project. Each block is
 * gated on the role or a permission and on the contract type's features, so
 * a self-managed owner sees "finish your draft" and never "approve". Items
 * carry a `kind` the client maps to an icon and an `href` to act on.
 */
async function waitingFor(q, ctx) {
  // Short names.
  const p = ctx.project
  const pid = p.id
  const features = featuresFor(p.contractType)
  // The to-do list being built.
  const items = []
  // Tiny helper so each block can call push({...}) instead of items.push({...}).
  const push = (item) => items.push(item)

  // Owner on a project that has a contractor role.
  if (ctx.role === 'OWNER' && features.contractor) {
    // A new project is stuck until the contractor joins: say so first.
    // `const [{ members }] = ...` destructures twice: first row, then its `members` field.
    const [{ members }] = await q("SELECT count(*)::int AS members FROM project_members WHERE project_id = $1 AND role = 'CONTRACTOR' AND removed_at IS NULL", [pid])
    // No contractor yet (0 is falsy).
    if (!members) {
      // Is there an unused, unexpired contractor invitation?
      const [{ pending }] = await q(
        "SELECT count(*)::int AS pending FROM invitations WHERE project_id = $1 AND role = 'CONTRACTOR' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
        [pid],
      )
      // Add an INVITE item; wording depends on whether an invite is outstanding.
      push({
        kind: 'INVITE',
        title: pending ? "Your contractor hasn't joined yet" : 'Invite your contractor',
        subtitle: pending ? 'Send them the invitation link again, or create a new one' : 'They report progress and record purchases with receipts',
        href: `/p/${pid}/settings`,
        at: null,
      })
    }
  }

  // Owner's approvals.
  if (ctx.role === 'OWNER') {
    // `for (const e of await q(...))` — await the rows, then loop over them.
    // Submitted purchases, oldest first.
    for (const e of await q("SELECT id, number, supplier_name, total_paisa, type, submitted_at FROM expenses WHERE project_id = $1 AND status = 'SUBMITTED' ORDER BY submitted_at", [pid])) {
      // One item per purchase, linking into the review dialog.
      push({ kind: 'APPROVE_EXPENSE', title: e.supplierName, subtitle: `P-${e.number} · ${EXPENSE_TYPES[e.type]}`, amountPaisa: e.totalPaisa, href: `/p/${pid}/approvals?review=EXPENSE:${e.id}`, at: e.submittedAt })
    }
    // Change requests, where used.
    if (features.changes) {
      for (const c of await q("SELECT id, number, title, cost_impact_paisa, created_at FROM change_requests WHERE project_id = $1 AND status = 'SUBMITTED'", [pid])) {
        // `signed: true` tells the client to show + or − on the amount.
        push({ kind: 'APPROVE_CHANGE', title: c.title, subtitle: `C-${c.number} · change request`, amountPaisa: c.costImpactPaisa, signed: true, href: `/p/${pid}/changes/${c.id}`, at: c.createdAt })
      }
    }
    // Milestones, where used.
    if (features.milestones) {
      // Requested milestones to approve.
      for (const m of await q("SELECT id, name, amount_paisa, requested_at FROM milestones WHERE project_id = $1 AND status = 'REQUESTED'", [pid])) {
        push({ kind: 'APPROVE_MILESTONE', title: m.name, subtitle: 'Payment requested', amountPaisa: m.amountPaisa, href: `/p/${pid}/approvals?review=MILESTONE:${m.id}`, at: m.requestedAt })
      }
      // Approved milestones still to pay.
      for (const m of await q("SELECT id, name, amount_paisa FROM milestones WHERE project_id = $1 AND status = 'APPROVED'", [pid])) {
        push({ kind: 'PAY_MILESTONE', title: `Pay: ${m.name}`, subtitle: 'Approved, not paid yet', amountPaisa: m.amountPaisa, href: `/p/${pid}/payments`, at: null })
      }
    }
    // Inspector access requests waiting for an answer.
    for (const a of await pendingAccess(q, pid)) {
      // `a.reason ?? 'Inspector'` = the reason, or a default subtitle.
      push({ kind: 'APPROVE_ACCESS', title: `${a.userName} asks to see the ${ACCESS_SCOPES[a.scope].label.toLowerCase()}`, subtitle: a.reason ?? 'Inspector', href: `/p/${pid}/approvals?review=ACCESS:${a.id}`, at: a.requestedAt })
    }
  }

  // Anyone who can pin the site, while it isn't pinned (`== null` covers null and undefined).
  if (ctx.can('setSitePin') && p.siteLat == null) {
    push({ kind: 'PIN_SITE', title: 'Pin the site location', subtitle: 'So photos show how far from the site they were taken', href: `/p/${pid}/settings#site`, at: null })
  }

  // People who record purchases: non-owners with createExpense, or a self-managing owner.
  // Note: `&&` binds tighter than `||`, so this reads (A && B) || (C).
  if (ctx.can('createExpense') && ctx.role !== 'OWNER' || (ctx.role === 'OWNER' && p.contractType === 'SELF_MANAGED')) {
    // My queried purchases that need an answer.
    for (const e of await q("SELECT id, number, supplier_name, updated_at FROM expenses WHERE project_id = $1 AND created_by = $2 AND status = 'QUERIED'", [pid, ctx.userId])) {
      push({ kind: 'ANSWER_EXPENSE', title: `Answer the question on P-${e.number}`, subtitle: e.supplierName, href: `/p/${pid}/purchases/${e.id}`, at: e.updatedAt })
    }
    // My unfinished drafts.
    for (const e of await q("SELECT id, number, supplier_name, total_paisa, updated_at FROM expenses WHERE project_id = $1 AND created_by = $2 AND status = 'DRAFT'", [pid, ctx.userId])) {
      push({ kind: 'FINISH_DRAFT', title: `Finish draft P-${e.number}`, subtitle: e.supplierName, amountPaisa: e.totalPaisa, href: `/p/${pid}/purchases/${e.id}`, at: e.updatedAt })
    }
  }
  // Payees: payments made to me that I haven't confirmed.
  if (ctx.can('confirmPayment')) {
    for (const pay of await q('SELECT id, number, amount_paisa, paid_on FROM payments WHERE project_id = $1 AND payee_user_id = $2 AND confirmed_at IS NULL', [pid, ctx.userId])) {
      push({ kind: 'CONFIRM_PAYMENT', title: `Confirm you received payment ${pay.number}`, subtitle: `Paid ${pay.paidOn}`, amountPaisa: pay.amountPaisa, href: `/p/${pid}/payments`, at: null })
    }
  }
  // Contractors: milestones whose stage is done and can be requested.
  if (ctx.can('requestMilestone')) {
    // Planned or previously rejected milestones, in order.
    const due = await q("SELECT id, name, amount_paisa, stage_index FROM milestones WHERE project_id = $1 AND status IN ('PLANNED', 'REJECTED') ORDER BY sort", [pid])
    for (const m of due) {
      // Only those whose stage is finished.
      if (milestoneDue(p, m)) push({ kind: 'REQUEST_MILESTONE', title: `Request payment: ${m.name}`, subtitle: 'The stage is complete', amountPaisa: m.amountPaisa, href: `/p/${pid}/payments`, at: null })
    }
  }

  // Open questions waiting on this person: on their records, or general ones for field roles.
  if (features.questions && ctx.can('viewQuestions')) {
    // SQL: every unresolved question in the project with the "owner" of the
    // record it is about. Each LEFT JOIN only matches when target_type is that
    // kind, so at most one of expense_owner / change_owner / report_owner /
    // payment_owner is non-NULL; general questions have none. `<>` = not equal.
    const questions = await q(
      `SELECT qq.id, qq.title, qq.status, qq.created_by, qq.target_type, qq.target_id, qq.updated_at,
              e.created_by AS expense_owner, c.created_by AS change_owner, r.author_id AS report_owner, pay.payee_user_id AS payment_owner
         FROM questions qq
         LEFT JOIN expenses e ON qq.target_type = 'EXPENSE' AND e.id = qq.target_id
         LEFT JOIN change_requests c ON qq.target_type = 'CHANGE' AND c.id = qq.target_id
         LEFT JOIN daily_reports r ON qq.target_type = 'REPORT' AND r.id = qq.target_id
         LEFT JOIN payments pay ON qq.target_type = 'PAYMENT' AND pay.id = qq.target_id
        WHERE qq.project_id = $1 AND qq.status <> 'RESOLVED'`,
      [pid],
    )
    for (const qq of questions) {
      // Chained `??` picks the first owner that isn't null/undefined.
      const recordOwner = qq.expenseOwner ?? qq.changeOwner ?? qq.reportOwner ?? qq.paymentOwner
      // OPEN questions are for the record's owner (or, for general questions,
      // contractors/supervisors); ANSWERED ones go back to whoever asked.
      const forMe =
        qq.status === 'OPEN'
          ? recordOwner === ctx.userId || (!qq.targetType && ['CONTRACTOR', 'SUPERVISOR'].includes(ctx.role))
          : qq.createdBy === ctx.userId
      // Skip if a purchase item for the same record is already listed:
      // .some((i) => ...) is true if any item's href ends with that record id.
      if (forMe && !(qq.targetType === 'EXPENSE' && items.some((i) => i.href.endsWith(qq.targetId)))) {
        push({
          // Kind and wording depend on whether I must answer or read a reply.
          kind: qq.status === 'OPEN' ? 'ANSWER_QUESTION' : 'READ_ANSWER',
          title: qq.status === 'OPEN' ? `Answer: ${qq.title}` : `Reply received: ${qq.title}`,
          subtitle: qq.status === 'OPEN' ? 'Waiting for your answer' : 'Read it and resolve the question',
          href: `/p/${pid}/questions/${qq.id}`,
          at: qq.updatedAt,
        })
      }
    }
  }

  // The owner's local representative checks deliveries and reports on site.
  if (ctx.role === 'LOCAL_REP') {
    // The 5 most recently approved purchases to check.
    for (const e of await q("SELECT id, number, supplier_name, total_paisa FROM expenses WHERE project_id = $1 AND status = 'APPROVED' ORDER BY decided_at DESC LIMIT 5", [pid])) {
      push({ kind: 'VERIFY_EXPENSE', title: `Check the delivery for P-${e.number}`, subtitle: e.supplierName, amountPaisa: e.totalPaisa, href: `/p/${pid}/purchases/${e.id}`, at: null })
    }
    // The 3 latest submitted daily reports to verify.
    for (const r of await q("SELECT id, report_date FROM daily_reports WHERE project_id = $1 AND status = 'SUBMITTED' ORDER BY report_date DESC LIMIT 3", [pid])) {
      push({ kind: 'VERIFY_REPORT', title: `Check the daily report for ${r.reportDate}`, subtitle: 'Visit the site and verify with a live photo', href: `/p/${pid}/reports/${r.id}`, at: null })
    }
  }
  // Inspectors: inspection steps still due.
  if (ctx.role === 'INSPECTOR') {
    // Every inspection so far, in date order.
    const inspections = await q('SELECT stage_index, step, result FROM inspections WHERE project_id = $1 ORDER BY inspected_on, created_at', [pid])
    // inspectionQueue works out which steps are due given progress and past results.
    for (const item of inspectionQueue(p, inspections)) {
      push({
        kind: 'INSPECT',
        title: `${item.stage}: ${item.step}`,
        // Last result in words (PARTIAL → "needs fixes"), or "Not inspected yet".
        subtitle: item.last ? `Last result: ${item.last.result === 'PARTIAL' ? 'needs fixes' : item.last.result.toLowerCase()}` : 'Not inspected yet',
        href: `/p/${pid}/inspections`,
        at: null,
      })
    }
  }
  // The finished to-do list.
  return items
}

/** Project home. Money and counts are null, not omitted, when the role may not see them. */
export async function getOverview(q, ctx) {
  // Short names.
  const p = ctx.project
  const stages = stagesFor(p)
  const features = featuresFor(p.contractType)
  // The latest progress update and who made it (first row, or undefined).
  const [lastUpdate] = await q(
    `SELECT pu.*, u.name AS created_by_name FROM progress_updates pu JOIN users u ON u.id = pu.created_by
      WHERE pu.project_id = $1 ORDER BY pu.created_at DESC LIMIT 1`,
    [p.id],
  )
  // Three counts in one row using scalar subqueries ( (SELECT ...) AS name ):
  // reports in the last 7 days (report_date >= $2), unresolved questions, open findings.
  const [counts] = await q(
    `SELECT (SELECT count(*)::int FROM daily_reports WHERE project_id = $1 AND report_date >= $2) AS reports_this_week,
            (SELECT count(*)::int FROM questions WHERE project_id = $1 AND status <> 'RESOLVED') AS open_questions,
            (SELECT count(*)::int FROM findings WHERE project_id = $1 AND status = 'OPEN') AS open_findings`,
    // $2 = the date six days ago (Date.now() is milliseconds; 86400000 ms per day).
    [p.id, todayPK(Date.now() - 6 * 86400000)],
  )
  // The overview object returned to the client.
  return {
    // The current stage definition (array index lookup).
    stage: stages[p.stageIndex],
    // What's done and what's next within the stage.
    nextStep: nextStep(stages[p.stageIndex], p.stageProgress),
    // `?? null` sends null (JSON-friendly) instead of undefined.
    lastUpdate: lastUpdate ?? null,
    // Money only for budget viewers.
    money: ctx.can('viewBudget') ? await moneySummary(q, p) : null,
    // The to-do list.
    waiting: await waitingFor(q, ctx),
    // Each count is null when the person may not see that area.
    counts: {
      reportsThisWeek: ctx.can('viewReports') ? counts.reportsThisWeek : null,
      openQuestions: features.questions && ctx.can('viewQuestions') ? counts.openQuestions : null,
      openFindings: ctx.can('viewMoney') ? counts.openFindings : null,
    },
  }
}

/** The first step of a stage that isn't finished yet, for "brick walls are next". */
// A function declaration lower in the file can still be used above it (hoisting).
function nextStep(stage, progress) {
  // No stage: nothing to say.
  if (!stage) return null
  // .find returns the first step whose threshold `at` is above the progress.
  const step = stage.steps.find((s) => progress < s.at)
  // `[...stage.steps]` copies the array so .reverse() (which mutates) doesn't
  // change the original; then find the last step already reached.
  const done = [...stage.steps].reverse().find((s) => progress >= s.at)
  // Labels or null; `step?.label` is undefined if step is undefined.
  return { next: step?.label ?? null, done: done?.label ?? null }
}

/** Owner's inbox: everything waiting for a decision, plus recent decisions. */
export async function getApprovals(q, ctx) {
  // Short names.
  const pid = ctx.project.id
  const features = featuresFor(ctx.project.contractType)
  // Submitted purchases with the submitter's name, a count of files (subquery
  // with count(*)::int) and a comma-joined list of item descriptions
  // (string_agg(text, separator ORDER BY ...) concatenates the line descriptions).
  const expenses = await q(
    `SELECT e.*, u.name AS created_by_name,
            (SELECT count(*)::int FROM evidence v WHERE v.expense_id = e.id) AS evidence_count,
            (SELECT string_agg(l.description, ', ' ORDER BY l.sort) FROM expense_lines l WHERE l.expense_id = e.id) AS items
       FROM expenses e JOIN users u ON u.id = e.created_by
      WHERE e.project_id = $1 AND e.status = 'SUBMITTED' ORDER BY e.submitted_at`,
    [pid],
  )
  // Add details to each purchase object (objects are mutable, so assigning e.x adds a property).
  for (const e of expenses) {
    // Open automatic-check flags.
    e.findings = await q("SELECT severity, rule, message FROM findings WHERE target_type = 'EXPENSE' AND target_id = $1 AND status = 'OPEN'", [e.id])
    // Attached files' metadata.
    e.evidence = await q('SELECT id, kind, mime, capture_mode, lat, lng, accuracy_m, distance_m FROM evidence WHERE expense_id = $1 ORDER BY received_at', [e.id])
    // Line items.
    e.lines = await q('SELECT description, qty, unit, unit_paisa, total_paisa FROM expense_lines WHERE expense_id = $1 ORDER BY sort', [e.id])
  }
  // Submitted change requests (with creator and file count) when the feature exists, else an empty array.
  const changes = features.changes
    ? await q(
        `SELECT c.*, u.name AS created_by_name, (SELECT count(*)::int FROM evidence v WHERE v.change_id = c.id) AS evidence_count
           FROM change_requests c JOIN users u ON u.id = c.created_by
          WHERE c.project_id = $1 AND c.status = 'SUBMITTED' ORDER BY c.created_at`,
        [pid],
      )
    : []
  // Requested milestones, when used.
  const milestones = features.milestones ? await q("SELECT * FROM milestones WHERE project_id = $1 AND status = 'REQUESTED' ORDER BY sort", [pid]) : []
  // Pending access requests, for those who can decide them.
  const access = ctx.can('decideAccess') ? await pendingAccess(q, pid) : []
  // The 20 most recent decisions (excluding site verifications), with:
  //   target_label — CASE on target_type picks a subquery that builds a text
  //     label; `||` in SQL concatenates strings (e.g. 'P-' || number);
  //   amount_paisa — the matching record's amount (NULL for reports, since
  //     a CASE with no matching WHEN gives NULL).
  const decided = await q(
    `SELECT d.*, u.name AS decided_by_name,
            CASE d.target_type
              WHEN 'EXPENSE' THEN (SELECT 'P-' || number || ' · ' || supplier_name FROM expenses WHERE id = d.target_id)
              WHEN 'CHANGE' THEN (SELECT 'C-' || number || ' · ' || title FROM change_requests WHERE id = d.target_id)
              WHEN 'MILESTONE' THEN (SELECT 'Milestone · ' || name FROM milestones WHERE id = d.target_id)
              WHEN 'REPORT' THEN (SELECT 'Daily report · ' || report_date FROM daily_reports WHERE id = d.target_id)
            END AS target_label,
            CASE d.target_type
              WHEN 'EXPENSE' THEN (SELECT total_paisa FROM expenses WHERE id = d.target_id)
              WHEN 'CHANGE' THEN (SELECT cost_impact_paisa FROM change_requests WHERE id = d.target_id)
              WHEN 'MILESTONE' THEN (SELECT amount_paisa FROM milestones WHERE id = d.target_id)
            END AS amount_paisa
       FROM decisions d JOIN users u ON u.id = d.decided_by
      WHERE d.project_id = $1 AND d.decision <> 'VERIFY' ORDER BY d.created_at DESC LIMIT 20`,
    [pid],
  )
  // Shorthand object: { expenses: expenses, ... }.
  return { expenses, changes, milestones, access, decided }
}

/** Field home for contractors, supervisors and self-managing owners. */
export async function getToday(q, ctx) {
  // Short names.
  const p = ctx.project
  const today = todayPK()
  // Midnight today in Pakistan (+05:00) converted to a UTC ISO string.
  const sinceMidnight = new Date(`${today}T00:00:00+05:00`).toISOString()
  // Have I already filed today's report? (first row or undefined)
  const [myReport] = await q(
    'SELECT id, created_at FROM daily_reports WHERE project_id = $1 AND report_date = $2 AND author_id = $3 LIMIT 1',
    [p.id, today, ctx.userId],
  )
  // The current stage: call stagesFor, then index the result.
  const stage = stagesFor(p)[p.stageIndex]
  // The Today page data.
  return {
    today,
    stage,
    nextStep: nextStep(stage, p.stageProgress),
    reportToday: myReport ?? null,
    // Photos I took today that aren't attached to anything yet.
    photos: await looseEvidence(q, ctx, sinceMidnight),
    waiting: await waitingFor(q, ctx),
  }
}
