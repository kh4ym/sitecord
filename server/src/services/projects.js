// FILE: server/src/services/projects.js
//
// WHAT IT DOES
// Projects and their people: create/update/archive a project, the site pin,
// physical progress, and membership (invitations, joining, removal).
//
// WHY IT EXISTS
// The project row is the root of everything else (purchases, payments,
// reports all hang off it), and membership decides who can see what. Keeping
// creation (with its generated bill of quantities and milestones), progress
// and membership rules together means one place enforces them.
//
// WHO USES IT
// routes/projects.js, routes for invitations, auth/middleware.js (it imports
// PROJECT_COLUMNS and activeGrants) and the demo seed.
//
// WHAT IT DEPENDS ON
// shared/ budget, features, geo, houseConfig, estimates, permissions, records
// and money modules; audit; error helpers; lib/util.js; and the services
// access.js (endAccessFor), budget.js (checkBudget), evidence.js
// (recomputeDistances) and notify.js.
//
// Every service here takes (q, ctx, ...) where q is a transaction's query
// function and ctx comes from routes/context.js (or the seed). The project row
// read by auth/middleware.js is exported as PROJECT_COLUMNS so both agree.
// q(sql, values) resolves to an array of rows with camelCase keys.

// ES module named imports: `import { a, b } from 'path'`.
// budgetStatus works out spent/waiting/remaining against a budget.
import { budgetStatus } from '../../../shared/budget.js'
// Features per contract type; construction stages for a project.
import { featuresFor, stagesFor } from '../../../shared/features.js'
// GPS helpers: distance between points, distance as text, sanity check, max pin accuracy.
import { distanceMeters, formatDistance, isRealLocation, PIN_MAX_ACCURACY_M } from '../../../shared/geo.js'
// House/plot helpers: contract type labels, completion, last stage, overall %, plot sizes and labels.
import { CONTRACT_TYPES, isComplete, lastStageIndex, overallPercent, plotDims, plotKeyFor, plotLabel } from '../../../shared/houseConfig.js'
// Generators for the bill of quantities and payment milestones.
import { buildBoq, buildMilestones } from '../../../shared/estimates.js'
// Permissions for a role; human labels of roles.
import { permissionsFor, ROLE_LABELS } from '../../../shared/permissions.js'
// Which purchase statuses count as approved vs waiting.
import { APPROVED_EXPENSE_STATUSES, WAITING_EXPENSE_STATUSES } from '../../../shared/records.js'
// Money formatting.
import { formatPKR } from '../../../shared/money.js'
// Audit trail writer.
import { audit } from '../audit/audit.js'
// HTTP error builders.
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
// Timestamps, named locks, ids, random tokens, SHA-256 hashing.
import { isoAt, lock, newId, newToken, sha256 } from '../lib/util.js'
// Ends an inspector's shares when they leave.
import { endAccessFor } from './access.js'
// Re-checks the budget alert.
import { checkBudget } from './budget.js'
// Recomputes file distances after the site pin moves.
import { recomputeDistances } from './evidence.js'
// Members by role; notifications.
import { membersWithRoles, notify } from './notify.js'

// `export const` = an exported constant. This multi-line template literal is
// the list of project columns (prefixed with the alias `p.`) that every
// project query selects, so auth/middleware.js and this file read the same shape.
export const PROJECT_COLUMNS = `p.id, p.name, p.address, p.city, p.plot_size, p.plot_width_ft, p.plot_depth_ft, p.floors, p.contract_type,
  p.budget_paisa, p.budget_alert, p.site_lat, p.site_lng, p.site_set_at, p.start_date, p.planned_end_date, p.start_stage,
  p.stage_index, p.stage_progress, p.archived_at, p.created_at, p.updated_at`

// Stripped from responses for anyone without viewBudget (contractor,
// supervisor, inspector): the owner's budget is private.
const MONEY_FIELDS = ['budgetPaisa', 'budgetAlert']
// Arrow function turning ['A', 'B'] into the SQL text "('A', 'B')" (values are fixed constants, not user input).
const sqlList = (values) => `(${values.map((v) => `'${v}'`).join(', ')})`

/** Scopes (HISTORY, REPORTS, PHOTOS) the owner is currently sharing with this inspector. */
// `export async function` = importable, returns a Promise, may use `await`.
export async function activeGrants(q, projectId, userId) {
  // SELECT DISTINCT returns each scope once; only APPROVED, unexpired shares (expires_at > now()).
  const rows = await q(
    "SELECT DISTINCT scope FROM access_requests WHERE project_id = $1 AND user_id = $2 AND status = 'APPROVED' AND expires_at > now()",
    [projectId, userId],
  )
  // .map turns each row into just its scope string.
  return rows.map((r) => r.scope)
}

/** Projects the user belongs to, with what's waiting for them in each. */
export async function listProjects(q, userId) {
  // SQL: every non-archived project the user is an active member of, newest first:
  //   SELECT ${PROJECT_COLUMNS}, m.role — the project columns plus the user's role;
  //   each (SELECT count(*)::int ...) AS name is a subquery counting things
  //     waiting in that project (submitted purchases, change requests, requested
  //     milestones, pending access requests, my queried purchases, unresolved questions);
  //   COALESCE(sum(total_paisa) FILTER (WHERE status IN (...)), 0) — sums of
  //     approved and waiting purchase money (sqlList builds the IN lists);
  //   max(created_at) FROM audit_events — when anything last happened;
  //   JOIN project_members m ON ... AND m.user_id = $1 AND m.removed_at IS NULL —
  //     only projects where this user is a current member.
  const rows = await q(
    `SELECT ${PROJECT_COLUMNS}, m.role,
            (SELECT count(*)::int FROM expenses e WHERE e.project_id = p.id AND e.status = 'SUBMITTED') AS pending_expenses,
            (SELECT count(*)::int FROM change_requests c WHERE c.project_id = p.id AND c.status = 'SUBMITTED') AS pending_changes,
            (SELECT count(*)::int FROM milestones ms WHERE ms.project_id = p.id AND ms.status = 'REQUESTED') AS pending_milestones,
            (SELECT count(*)::int FROM access_requests ar WHERE ar.project_id = p.id AND ar.status = 'PENDING') AS pending_access,
            (SELECT count(*)::int FROM expenses e WHERE e.project_id = p.id AND e.status = 'QUERIED' AND e.created_by = $1) AS queried_mine,
            (SELECT count(*)::int FROM questions qq WHERE qq.project_id = p.id AND qq.status <> 'RESOLVED') AS open_questions,
            (SELECT COALESCE(sum(total_paisa) FILTER (WHERE status IN ${sqlList(APPROVED_EXPENSE_STATUSES)}), 0) FROM expenses e WHERE e.project_id = p.id) AS approved_paisa,
            (SELECT COALESCE(sum(total_paisa) FILTER (WHERE status IN ${sqlList(WAITING_EXPENSE_STATUSES)}), 0) FROM expenses e WHERE e.project_id = p.id) AS waiting_paisa,
            (SELECT max(created_at) FROM audit_events a WHERE a.project_id = p.id) AS last_activity_at
       FROM projects p
       JOIN project_members m ON m.project_id = p.id AND m.user_id = $1 AND m.removed_at IS NULL
      WHERE p.archived_at IS NULL
      ORDER BY p.created_at DESC`,
    [userId],
  )
  // The result list.
  const list = []
  // Loop over rows, destructuring each: the named count fields become local
  // variables, and the rest pattern `...p` collects all remaining fields
  // (the project itself) into a new object p.
  for (const { pendingExpenses, pendingChanges, pendingMilestones, pendingAccess, queriedMine, openQuestions, approvedPaisa, waitingPaisa, ...p } of rows) {
    // Inspectors' permissions depend on what's currently shared with them.
    if (p.role === 'INSPECTOR') p.grants = await activeGrants(q, p.id, userId)
    // This user's permission list on this project.
    const perms = permissionsFor(p.role, p)
    // Build the row sent to the client.
    const row = {
      // Copy every project field.
      ...p,
      // Derived display fields.
      plotLabel: plotLabel(p),
      overall: overallPercent(p),
      complete: isComplete(p),
      // How many things wait for this person: a nested ternary by role.
      waiting:
        p.role === 'OWNER'
          ? pendingExpenses + pendingChanges + pendingMilestones + pendingAccess
          : p.role === 'CONTRACTOR' || p.role === 'SUPERVISOR'
            ? queriedMine
            : 0,
      // Only for people who may see questions.
      openQuestions: perms.includes('viewQuestions') ? openQuestions : null,
      // Budget status only for budget viewers.
      money: perms.includes('viewBudget') ? budgetStatus({ budget: p.budgetPaisa, approved: approvedPaisa, waiting: waitingPaisa }) : null,
    }
    // `delete obj.prop` removes a property; grants were only needed for permissionsFor.
    delete row.grants
    // Remove private money fields (for...of over MONEY_FIELDS, delete by bracket key).
    if (!perms.includes('viewBudget')) for (const f of MONEY_FIELDS) delete row[f]
    // Add to the list.
    list.push(row)
  }
  return list
}

/** The project as this person sees it: always read fresh, money and contacts only for those allowed. */
export async function getProject(q, ctx) {
  // Re-read the project row (first row via array destructuring).
  const [fresh] = await q(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = $1`, [ctx.project.id])
  // Keep the grants from the context (default [] with `??`).
  const project = { ...fresh, grants: ctx.project.grants ?? [] }
  // Permissions for this role on this project.
  const permissions = permissionsFor(ctx.role, project)
  // Active members with contact details, in joining order.
  const members = await q(
    `SELECT u.id, u.name, u.email, u.phone, m.role, m.joined_at
       FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1 AND m.removed_at IS NULL
      ORDER BY m.joined_at`,
    [project.id],
  )
  // Inspectors don't get others' contact details.
  const contacts = ctx.role !== 'INSPECTOR'
  // For inspectors: each shared scope with its latest expiry (max(...) with
  // GROUP BY scope = one row per scope). Others get an empty array.
  const grants =
    ctx.role === 'INSPECTOR'
      ? await q(
          `SELECT scope, max(expires_at) AS expires_at FROM access_requests
            WHERE project_id = $1 AND user_id = $2 AND status = 'APPROVED' AND expires_at > now() GROUP BY scope`,
          [project.id, ctx.userId],
        )
      : []
  // The response object.
  const out = {
    ...project,
    role: ctx.role,
    // Shorthand for permissions: permissions.
    permissions,
    features: featuresFor(project.contractType),
    plotLabel: plotLabel(project),
    overall: overallPercent(project),
    complete: isComplete(project),
    // `!= null` is true unless archivedAt is null/undefined.
    archived: project.archivedAt != null,
    grants,
    // Keep contacts if allowed or for the owner; otherwise copy the member with email/phone blanked.
    members: members.map((m) => (contacts || m.role === 'OWNER' ? m : { ...m, email: null, phone: null })),
  }
  // Strip private money fields.
  if (!permissions.includes('viewBudget')) for (const f of MONEY_FIELDS) delete out[f]
  return out
}

/** Width and depth in feet from a preset key or a custom size; an exact preset size is stored as that preset. */
function resolvePlot(input) {
  // Destructure width and depth from plotDims' result.
  const { widthFt, depthFt } = plotDims({ plotSize: input.plotSize, widthFt: input.plotWidthFt, depthFt: input.plotDepthFt })
  // plotKeyFor returns the preset key matching those dimensions (or a custom key).
  return { plotSize: plotKeyFor({ widthFt, depthFt }), widthFt, depthFt }
}

/**
 * New project: the row, the creator as OWNER, a generated bill of
 * quantities and payment milestones sized from the plot (shared/estimates),
 * and the first audit event. "Drawings approved" starts at stage 1 so the
 * schedule skips the approvals stage.
 */
export async function createProject(q, ctx, input) {
  // New project id and timestamp.
  const id = newId()
  const at = isoAt(ctx.at)
  // Ternary: start at stage 1 if drawings are already approved, else 0.
  const startStage = input.drawingsApproved ? 1 : 0
  // Normalised plot size.
  const plot = resolvePlot(input)
  // A pin object only if both coordinates were given.
  const pin = input.siteLat != null && input.siteLng != null ? { lat: input.siteLat, lng: input.siteLng } : null
  // Reject nonsense coordinates.
  if (pin && !isRealLocation(pin)) throw badRequest("That isn't a real location")
  // INSERT the project. Note $16 is used twice (start_stage and stage_index
  // both start at startStage), stage_progress is a literal 0, and $17 is used
  // for both created_at and updated_at.
  await q(
    `INSERT INTO projects (id, name, address, city, plot_size, plot_width_ft, plot_depth_ft, floors, contract_type, budget_paisa,
                           site_lat, site_lng, site_set_at, start_date, planned_end_date, start_stage, stage_index, stage_progress, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, 0, $17, $17)`,
    // Values; `pin?.lat ?? null` = latitude or NULL; site_set_at only if pinned.
    [id, input.name, input.address ?? '', input.city, plot.plotSize, plot.widthFt, plot.depthFt, input.floors, input.contractType,
      input.budgetPaisa, pin?.lat ?? null, pin?.lng ?? null, pin ? at : null, input.startDate ?? null, input.plannedEndDate ?? null, startStage, at],
  )
  // The creator becomes the OWNER member.
  await q('INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)', [id, ctx.userId, 'OWNER', at])

  // Generate and insert the bill of quantities rows (one INSERT per item).
  for (const item of buildBoq({ floors: input.floors, widthFt: plot.widthFt, depthFt: plot.depthFt })) {
    await q(
      `INSERT INTO boq_items (id, project_id, code, description, category, unit, est_qty, est_unit_paisa, phase, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newId(), id, item.code, item.description, item.category, item.unit, item.estQty, item.estUnitPaisa, item.phase, at],
    )
  }
  // Generate and insert the payment milestones.
  for (const m of buildMilestones(input)) {
    await q('INSERT INTO milestones (id, project_id, stage_index, name, amount_paisa, sort) VALUES ($1, $2, $3, $4, $5, $6)', [
      newId(), id, m.stageIndex, m.name, m.amountPaisa, m.sort,
    ])
  }
  // e.g. "30 × 60 ft".
  const size = `${plot.widthFt} × ${plot.depthFt} ft`
  // First audit event.
  await audit(q, {
    projectId: id,
    actorId: ctx.userId,
    action: 'project.created',
    targetType: 'PROJECT',
    targetId: id,
    // Sentence with plot, floors (singular/plural via ternary), contract type and budget.
    summary: `Created "${input.name}" (${size}, ${input.floors} ${input.floors === 1 ? 'floor' : 'floors'}, ${CONTRACT_TYPES[input.contractType].label.toLowerCase()}) with a budget of ${formatPKR(input.budgetPaisa, { compact: true })}`,
    // `!!pin` converts to true/false.
    payload: { plotSize: plot.plotSize, widthFt: plot.widthFt, depthFt: plot.depthFt, floors: input.floors, contractType: input.contractType, budgetPaisa: input.budgetPaisa, pinned: !!pin },
    at: ctx.at,
  })
  // The route returns the new id.
  return { id }
}

// Only these fields can change after creation; plot, floors and contract
// type drive the generated BOQ and milestones, so they are fixed.
// Maps the camelCase input name to the database column name.
const EDITABLE = { name: 'name', address: 'address', city: 'city', budgetPaisa: 'budget_paisa', startDate: 'start_date', plannedEndDate: 'planned_end_date' }

/** Writes only the fields that actually changed, and re-checks the budget alert if the budget moved. */
export async function updateProject(q, ctx, input) {
  // Object.entries(input) gives [key, value] pairs; .filter keeps those that
  // are editable (`k in EDITABLE` checks the key exists), provided, and different.
  // `([k, v]) =>` destructures each pair in the parameter list.
  const changes = Object.entries(input).filter(([k, v]) => k in EDITABLE && v !== undefined && v !== ctx.project[k])
  // Nothing changed: stop.
  if (!changes.length) return
  // Build "column = $2", "column = $3", ... ($1 is the id). `$${i + 2}` = literal $ then the number.
  const sets = changes.map(([k], i) => `${EDITABLE[k]} = $${i + 2}`)
  // UPDATE with those SET clauses; values are the id followed by each new value
  // (spread `...` expands the mapped array into this one; `[, v]` skips the key).
  await q(`UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [ctx.project.id, ...changes.map(([, v]) => v)])
  // Names of the changed fields.
  const fields = changes.map(([k]) => k)
  // The budget change pair, if any (.find returns the first match or undefined).
  const budget = changes.find(([k]) => k === 'budgetPaisa')
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'project.updated',
    targetType: 'PROJECT',
    targetId: ctx.project.id,
    // Budget changes get their own sentence; otherwise list the field names,
    // turning camelCase into words with a regex (insert a space before each
    // capital letter: ' $1' is the captured letter) and lower-casing.
    summary: budget
      ? `Changed the budget from ${formatPKR(ctx.project.budgetPaisa, { compact: true })} to ${formatPKR(budget[1], { compact: true })}${fields.length > 1 ? ' and updated other details' : ''}`
      : `Updated project ${fields.map((f) => f.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')}`,
    // Object.fromEntries turns [key, value] pairs back into an object: { name: { from, to }, ... }.
    payload: Object.fromEntries(changes.map(([k, v]) => [k, { from: ctx.project[k] ?? null, to: v }])),
    at: ctx.at,
  })
  // If the budget moved, update the context copy and re-check the alert.
  if (budget) {
    // budget[1] = the new value (index 1 of the [key, value] pair).
    ctx.project.budgetPaisa = budget[1]
    await checkBudget(q, ctx)
  }
}

/**
 * Pin where the site is, from a phone at the site or a pasted map link. Every
 * file's distance from the site is worked out again. The owner hears about it
 * when someone else moves the pin.
 */
export async function setSitePin(q, ctx, { lat, lng, accuracyM, source }) {
  // Short name.
  const p = ctx.project
  // Sanity-check the coordinates.
  if (!isRealLocation({ lat, lng })) throw badRequest("That isn't a real location")
  // A phone fix must be accurate enough; `!(a <= b)` also rejects a missing accuracy.
  if (source === 'DEVICE' && !(accuracyM <= PIN_MAX_ACCURACY_M)) {
    throw badRequest("Your phone's location is too rough to pin the site. Step outside and try again, or paste a map link.")
  }
  // The old pin, if there was one.
  const before = p.siteLat != null ? { lat: p.siteLat, lng: p.siteLng } : null
  const at = isoAt(ctx.at)
  // Save the new pin ($4 used for both site_set_at and updated_at).
  await q('UPDATE projects SET site_lat = $2, site_lng = $3, site_set_at = $4, updated_at = $4 WHERE id = $1', [p.id, lat, lng, at])
  // Object.assign copies these properties onto p, keeping the context in sync.
  Object.assign(p, { siteLat: lat, siteLng: lng, siteSetAt: at })
  // Recompute every file's distance from the new pin.
  await recomputeDistances(q, p)
  // How far the pin moved, in metres (null for a first pin).
  const moved = before ? distanceMeters(before, { lat, lng }) : null
  // Look up the wording for the source in an inline object; `?? ''` if unknown.
  const how = { DEVICE: 'from a phone at the site', LINK: 'from a map link', MANUAL: 'from coordinates' }[source] ?? ''
  // Audit line.
  await audit(q, {
    projectId: p.id,
    actorId: ctx.userId,
    action: 'site.pinned',
    targetType: 'PROJECT',
    targetId: p.id,
    // .trim() removes a trailing space when `how` is empty.
    summary: before ? `Moved the site pin ${formatDistance(moved)} ${how}`.trim() : `Pinned the site location ${how}`.trim(),
    payload: { lat, lng, accuracyM: accuracyM ?? null, source, movedM: moved != null ? Math.round(moved) : null },
    at: ctx.at,
  })
  // Someone other than the owner changed the pin: tell the owner.
  if (ctx.role !== 'OWNER') {
    await notify(q, {
      userIds: await membersWithRoles(q, p.id, ['OWNER']),
      projectId: p.id,
      title: before ? `${ctx.userName} moved the site pin` : `${ctx.userName} pinned the site`,
      body: before ? `It moved ${formatDistance(moved)}. Photos are now checked against the new spot.` : 'Photos are now checked against this spot.',
      link: `/p/${p.id}/settings`,
      at: ctx.at,
    })
  }
}

// Remove the site pin.
export async function clearSitePin(q, ctx) {
  const p = ctx.project
  // Nothing to clear.
  if (p.siteLat == null) return
  // Set the three pin columns to NULL.
  await q('UPDATE projects SET site_lat = NULL, site_lng = NULL, site_set_at = NULL, updated_at = now() WHERE id = $1', [p.id])
  // Keep the context in sync.
  Object.assign(p, { siteLat: null, siteLng: null, siteSetAt: null })
  // Distances become NULL now.
  await recomputeDistances(q, p)
  // Audit line (all on one line as a single object literal).
  await audit(q, { projectId: p.id, actorId: ctx.userId, action: 'site.cleared', targetType: 'PROJECT', targetId: p.id, summary: 'Removed the site pin', at: ctx.at })
}

// Archive (hide) a project.
export async function archiveProject(q, ctx) {
  // Only if not already archived; RETURNING id gives back a row only when something changed.
  const [row] = await q('UPDATE projects SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id', [ctx.project.id])
  // Already archived: nothing to do.
  if (!row) return
  // Audit line.
  await audit(q, { projectId: ctx.project.id, actorId: ctx.userId, action: 'project.archived', targetType: 'PROJECT', targetId: ctx.project.id, summary: 'Archived the project', at: ctx.at })
}

/**
 * Record physical progress. Moving to a later stage marks every stage in
 * between complete. Every change is kept in progress_updates and the audit
 * trail. The project row is locked so two reports can't race each other.
 */
export async function updateProgress(q, ctx, { stageIndex, stageProgress, note, reportId }) {
  const p = ctx.project
  // FOR UPDATE: ctx.project was read before the transaction, so re-read the
  // two fields that matter under a row lock and work from those.
  const [current] = await q('SELECT stage_index, stage_progress FROM projects WHERE id = $1 FOR UPDATE', [p.id])
  // Overwrite p's stageIndex/stageProgress with the fresh values.
  Object.assign(p, current)
  // Index of the final stage for this many floors.
  const last = lastStageIndex(p.floors)
  // Out of range: 400.
  if (stageIndex < 0 || stageIndex > last) throw badRequest('That stage does not exist')
  // No change: stop.
  if (stageIndex === p.stageIndex && stageProgress === p.stageProgress) return
  // Stage definitions, timestamp, and whether we're moving to a later stage.
  const stages = stagesFor(p)
  const at = isoAt(ctx.at)
  const forward = stageIndex > p.stageIndex
  // Save the new position.
  await q('UPDATE projects SET stage_index = $2, stage_progress = $3, updated_at = $4 WHERE id = $1', [p.id, stageIndex, stageProgress, at])

  // Local helper (arrow function) inserting one progress_updates row; it
  // returns q's Promise so callers can await it.
  const row = (index, before, after, completed) =>
    q(
      `INSERT INTO progress_updates (id, project_id, stage_index, progress_before, progress_after, stage_completed, report_id, note, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newId(), p.id, index, before, after, completed, reportId ?? null, note ?? null, ctx.userId, at],
    )
  if (forward) {
    // Close the stage we were on and any stage skipped over, then open the new one.
    // Classic for loop: start at the current stage, run while i < target, add 1 each time.
    for (let i = p.stageIndex; i < stageIndex; i++) await row(i, i === p.stageIndex ? p.stageProgress : 0, 100, true)
    // The new stage starts from 0.
    await row(stageIndex, 0, stageProgress, false)
  } else {
    // Same stage or moving back: one row; completed only if the final stage hit 100%.
    await row(stageIndex, stageIndex === p.stageIndex ? p.stageProgress : 0, stageProgress, stageIndex === last && stageProgress === 100)
  }

  // Audit sentence by case (nested ternary): forward, backward, or a % change.
  const summary = forward
    ? `Marked ${stages[p.stageIndex].label.toLowerCase()} complete; ${stages[stageIndex].label.toLowerCase()} started`
    : stageIndex < p.stageIndex
      ? `Moved progress back to ${stages[stageIndex].label.toLowerCase()} at ${stageProgress}%`
      : `${stages[stageIndex].label} progress ${p.stageProgress}% → ${stageProgress}%`
  // Audit line.
  await audit(q, {
    projectId: p.id,
    actorId: ctx.userId,
    action: 'progress.updated',
    targetType: 'PROJECT',
    targetId: p.id,
    summary,
    payload: { from: { stageIndex: p.stageIndex, stageProgress: p.stageProgress }, to: { stageIndex, stageProgress }, reportId: reportId ?? null },
    at: ctx.at,
  })
  // Stage completions are worth a notification; percentage ticks are not.
  if (forward || (stageIndex === last && stageProgress === 100)) {
    // Who to tell: owner and local rep, plus inspectors where inspections exist.
    const watchers = await membersWithRoles(q, p.id, featuresFor(p.contractType).inspections ? ['OWNER', 'LOCAL_REP', 'INSPECTOR'] : ['OWNER', 'LOCAL_REP'])
    // The stage that was just completed.
    const done = forward ? stages[p.stageIndex] : stages[stageIndex]
    await notify(q, {
      userIds: watchers,
      projectId: p.id,
      title: `${done.label} reported complete`,
      body: `${p.name}: ${ctx.userName ?? 'the site team'} marked ${done.label.toLowerCase()} as complete.`,
      link: `/p/${p.id}/progress`,
      at: ctx.at,
      // Not the person who reported it.
      exclude: ctx.userId,
    })
  }
  // Keep the context in sync with the new position.
  Object.assign(p, { stageIndex, stageProgress })
}

// ---------- Members and invitations ----------

/** Roles a project can invite, by contract type: a self-managed project has no contractor or inspector. */
function checkInviteRole(contractType, role) {
  // Not an invitable role for this contract type.
  if (!featuresFor(contractType).inviteRoles.includes(role)) {
    // e.g. "contractor".
    const label = ROLE_LABELS[role].toLowerCase()
    // 400 with grammar: the regex /^[aeiou]/ tests whether the label starts with a vowel ("an inspector").
    throw badRequest(`A ${CONTRACT_TYPES[contractType].label.toLowerCase()} project doesn't have ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}. You can invite a local representative.`)
  }
}

/** A fresh link for someone; any earlier unused link for the same address is cancelled. */
export async function inviteMember(q, ctx, { email, role }) {
  // Role must fit the contract type.
  checkInviteRole(ctx.project.contractType, role)
  // Is someone with this email (case-insensitive via lower()) already an active member?
  const [existing] = await q(
    `SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1 AND lower(u.email) = lower($2) AND m.removed_at IS NULL`,
    [ctx.project.id, email],
  )
  if (existing) throw badRequest('That person is already a member of this project')
  // Cancel any earlier open invitation to the same address.
  await q('UPDATE invitations SET revoked_at = now() WHERE project_id = $1 AND email = lower($2) AND accepted_at IS NULL AND revoked_at IS NULL', [ctx.project.id, email])
  // A random secret token for the link, and a row id.
  const token = newToken()
  const id = newId()
  // Store only the token's SHA-256 hash (so a database leak doesn't leak links);
  // expires in 14 days (14 * 86400000 ms); the email is lower-cased in SQL.
  await q(
    `INSERT INTO invitations (id, project_id, email, role, token_hash, invited_by, expires_at, created_at)
     VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8)`,
    [id, ctx.project.id, email, role, sha256(token), ctx.userId, isoAt(Date.now() + 14 * 86400000), isoAt(ctx.at)],
  )
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'member.invited',
    targetType: 'INVITATION',
    targetId: id,
    summary: `Invited ${email} as ${ROLE_LABELS[role].toLowerCase()}`,
    payload: { email, role },
    at: ctx.at,
  })
  // The raw token goes back once, to build the link.
  return { id, token }
}

// Open invitations (not accepted, not revoked, not expired), newest first.
export async function listInvitations(q, projectId) {
  return q(
    `SELECT id, email, role, expires_at, created_at FROM invitations
      WHERE project_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [projectId],
  )
}

// Cancel one open invitation.
export async function revokeInvitation(q, ctx, id) {
  // UPDATE ... RETURNING email gives back a row only if an open invitation was changed.
  const [inv] = await q('UPDATE invitations SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email', [id, ctx.project.id])
  // Nothing changed: 404.
  if (!inv) throw notFound('Invitation not found')
  // Audit line.
  await audit(q, { projectId: ctx.project.id, actorId: ctx.userId, action: 'member.invite_revoked', targetType: 'INVITATION', targetId: id, summary: `Cancelled the invitation for ${inv.email}`, at: ctx.at })
}

/**
 * Look an invitation up by its raw token (only the hash is stored). Used
 * both for the public preview and, with forUpdate, by acceptInvitation so
 * two accepts of the same link can't both succeed.
 */
// `{ forUpdate = false } = {}`: destructured options with a default, and a default empty object.
export async function findInvitation(q, token, { forUpdate = false } = {}) {
  // SQL: the invitation with its project and inviter's name (two JOINs),
  // matched by token hash; `FOR UPDATE OF i` (when asked) locks only the invitation row.
  const [inv] = await q(
    `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, p.id AS project_id, p.name AS project_name, p.city,
            p.contract_type, p.archived_at, u.name AS invited_by_name
       FROM invitations i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = $1${forUpdate ? ' FOR UPDATE OF i' : ''}`,
    [sha256(token)],
  )
  // Unknown, cancelled, or the project is archived: 404.
  if (!inv || inv.revokedAt || inv.archivedAt) throw notFound('This invitation link is not valid')
  // Already used.
  if (inv.acceptedAt) throw badRequest('This invitation has already been used')
  // Expired (Date objects compare by time).
  if (new Date(inv.expiresAt) < new Date()) throw badRequest('This invitation has expired. Ask for a new link.')
  return inv
}

/** The link is for one address: the account accepting it must use that email. */
export async function acceptInvitation(q, ctx, token) {
  // Find and lock the invitation.
  const inv = await findInvitation(q, token, { forUpdate: true })
  // The role must still fit the contract type.
  checkInviteRole(inv.contractType, inv.role)
  // The signed-in email must match the invited one.
  if (ctx.userEmail && inv.email !== ctx.userEmail.toLowerCase()) {
    // (The trailing comma before `)` is allowed in JS argument lists.)
    throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email, or ask for a new link.`, )
  }
  // Membership is soft-deleted (removed_at), so someone removed and invited
  // again gets their old row revived with the new role.
  const [member] = await q('SELECT removed_at FROM project_members WHERE project_id = $1 AND user_id = $2', [inv.projectId, ctx.userId])
  // Already an active member: 409.
  if (member && !member.removedAt) throw conflict('You are already a member of this project')
  if (member) {
    // Revive the old row: new role, clear removed_at, new joined_at.
    await q('UPDATE project_members SET role = $3, removed_at = NULL, joined_at = $4 WHERE project_id = $1 AND user_id = $2', [inv.projectId, ctx.userId, inv.role, isoAt(ctx.at)])
  } else {
    // New membership row.
    await q('INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)', [inv.projectId, ctx.userId, inv.role, isoAt(ctx.at)])
  }
  // Mark the invitation used.
  await q('UPDATE invitations SET accepted_at = $2 WHERE id = $1', [inv.id, isoAt(ctx.at)])
  // Audit line.
  await audit(q, {
    projectId: inv.projectId,
    actorId: ctx.userId,
    action: 'member.joined',
    targetType: 'USER',
    targetId: ctx.userId,
    summary: `${ctx.userName} joined as ${ROLE_LABELS[inv.role].toLowerCase()}`,
    payload: { role: inv.role },
    at: ctx.at,
  })
  // Tell the owner(s).
  const owners = await membersWithRoles(q, inv.projectId, ['OWNER'])
  await notify(q, { userIds: owners, projectId: inv.projectId, title: `${ctx.userName} joined ${inv.projectName}`, body: `Role: ${ROLE_LABELS[inv.role]}`, link: `/p/${inv.projectId}/settings`, at: ctx.at })
  // The client navigates into the project.
  return { projectId: inv.projectId, role: inv.role }
}

/** Soft-remove a member (never the owner) and end any inspector shares they had. */
export async function removeMember(q, ctx, userId) {
  // You can't remove yourself.
  if (userId === ctx.userId) throw badRequest("You can't remove yourself")
  // Serialise membership changes on this project with a named lock.
  await lock(q, `members:${ctx.project.id}`)
  // UPDATE ... FROM users u joins users into the UPDATE so RETURNING can give
  // the name; only an active, non-owner member (`<> 'OWNER'`) is changed.
  const [m] = await q(
    `UPDATE project_members m SET removed_at = now() FROM users u
      WHERE m.project_id = $1 AND m.user_id = $2 AND u.id = m.user_id AND m.removed_at IS NULL AND m.role <> 'OWNER'
      RETURNING u.name, m.role`,
    [ctx.project.id, userId],
  )
  // Nothing changed (owner, unknown or already removed): 403.
  if (!m) throw forbidden('That member cannot be removed')
  // End their access requests/shares; returns how many.
  const ended = await endAccessFor(q, ctx, userId)
  // Audit line.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'member.removed',
    targetType: 'USER',
    targetId: userId,
    summary: `Removed ${m.name} (${ROLE_LABELS[m.role].toLowerCase()})`,
    payload: { role: m.role, accessEnded: ended },
    at: ctx.at,
  })
}
