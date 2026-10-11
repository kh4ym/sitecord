// The build plan: stages and steps (from shared/houseConfig by floor count),
// the planned schedule against actual progress, the engineer's inspections
// and what still needs inspecting. Stages/steps are not stored; they are
// derived, and inspections and progress_updates are matched to them by
// index and label. Used by routes/projects.js, dashboard.js and the seed.
//
// What this file does: `inspectionQueue` works out which finished steps still
// need a passing inspection, `getPlan` assembles everything the Plan page
// shows, and `recordInspection` saves an engineer's inspection (with audit
// entry and notifications).
// Depends on: shared/features.js (which features a contract type has, the
// stage list), shared/houseConfig.js (schedule maths), audit/audit.js,
// lib/errors.js, lib/util.js, evidence.js and notify.js.

// Named imports: feature flags per contract type, and the stage list for a project.
import { featuresFor, stagesFor } from '../../../shared/features.js'
// Schedule helpers: overall position, planned dates, delay in days, step completion.
import { buildPosition, buildSchedule, daysBehindPlan, stepFraction } from '../../../shared/houseConfig.js'
// Audit log writer.
import { audit } from '../audit/audit.js'
// HTTP 400 error builder.
import { badRequest } from '../lib/errors.js'
// Timestamp formatter and id generator.
import { isoAt, newId } from '../lib/util.js'
// Links uploaded photos to the inspection.
import { attachEvidence } from './evidence.js'
// Member lookup by role and notification sender.
import { membersWithRoles, notify } from './notify.js'

/** Steps that are done, need an engineer's check, and have no passing inspection yet. */
// A plain (not async) exported function: it does no database work.
export function inspectionQueue(project, inspections) {
  // Contract types without inspections have an empty queue.
  if (!featuresFor(project.contractType).inspections) return []
  // All stages of this project (each with index, label and steps).
  const stages = stagesFor(project)
  // A Map is a key → value store; here "stage:step" → latest inspection.
  const latest = new Map()
  // Later inspections overwrite earlier ones under the same key, so the Map
  // ends up holding the newest per step.
  for (const i of inspections) latest.set(`${i.stageIndex}:${i.step}`, i) // ordered oldest → newest
  // The result list.
  const queue = []
  // Walk through stages in order.
  for (const s of stages) {
    // `break` leaves the loop: stages after the current one are not started.
    if (s.index > project.stageIndex) break
    // Past stages are 100% done; the current one uses its recorded progress.
    const progress = s.index < project.stageIndex ? 100 : project.stageProgress
    // `.forEach((item, index) => ...)` calls the function for each step.
    s.steps.forEach((step, i) => {
      // `return` inside forEach skips to the next step: skip steps that need no
      // inspection or are not fully done (fraction below 1).
      if (!step.inspect || stepFraction(s.steps, i, progress) < 1) return
      // The latest inspection for this step, if any.
      const last = latest.get(`${s.index}:${step.label}`)
      // Queue the step when never inspected or the last result wasn't PASS.
      if (!last || last.result !== 'PASS') queue.push({ stageIndex: s.index, stage: s.label, step: step.label, last: last ?? null })
    })
  }
  return queue
}

/** Everything the Plan page shows. Milestones (amounts) only for those who may see money. */
export async function getPlan(q, ctx) {
  const p = ctx.project // the current project
  const features = featuresFor(p.contractType) // which features apply
  const stages = stagesFor(p) // stage list
  // Planned start/end date per stage.
  const schedule = buildSchedule(p.floors, p.startDate, p.startStage)
  // Run three loads in parallel and destructure the results.
  const [updates, inspections, milestones] = await Promise.all([
    // 1) Progress updates in time order (ORDER BY created_at, ascending).
    q('SELECT stage_index, progress_after, stage_completed, created_at FROM progress_updates WHERE project_id = $1 ORDER BY created_at', [p.id]),
    // 2) Inspections, only if the feature is on (ternary `cond ? a : b`).
    features.inspections
      // Each inspection with the inspector's name and its first photo's id
      // (a subquery with ORDER BY ... LIMIT 1 picks the earliest file).
      ? q(
          `SELECT i.*, u.name AS inspector_name,
                  (SELECT v.id FROM evidence v WHERE v.inspection_id = i.id ORDER BY v.received_at LIMIT 1) AS evidence_id
             FROM inspections i JOIN users u ON u.id = i.inspector_id
            WHERE i.project_id = $1 ORDER BY i.inspected_on, i.created_at`,
          [p.id],
        )
      // Feature off: an empty array (Promise.all accepts plain values too).
      : [],
    // 3) Payment milestones only when the user may see money AND (`&&`) the
    // contract uses milestones; sorted by their `sort` column.
    ctx.can('viewMoney') && features.milestones ? q('SELECT * FROM milestones WHERE project_id = $1 ORDER BY sort', [p.id]) : [],
  ])
  // For each stage, find when work actually started and finished.
  const actual = stages.map((s) => {
    // Updates belonging to this stage.
    const mine = updates.filter((u) => u.stageIndex === s.index)
    // First update that completed it (`||` = either condition true).
    const done = mine.find((u) => u.stageCompleted || u.progressAfter === 100)
    // `mine[0]?.createdAt`: first update's time if there is one; `?? null` otherwise.
    return { start: mine[0]?.createdAt ?? null, end: done?.createdAt ?? null }
  })
  // How many days the build is behind the planned schedule.
  const daysBehind = daysBehindPlan(p.floors, p.startDate, buildPosition(p.stageIndex, p.stageProgress), p.startStage)

  // The response object for the Plan page.
  return {
    // One entry per stage; `.map((s, i) => ...)` also gives the index i.
    stages: stages.map((s, i) => ({
      ...s, // stage fields (label, steps, ...)
      planned: schedule[i], // planned dates
      actual: actual[i], // actual dates
      // Chained ternary: before current = DONE; current = DONE at 100% else
      // CURRENT; after current = UPCOMING.
      status: i < p.stageIndex ? 'DONE' : i === p.stageIndex ? (p.stageProgress === 100 ? 'DONE' : 'CURRENT') : 'UPCOMING',
      // Percentage for this stage: 100, the recorded progress, or 0.
      progress: i < p.stageIndex ? 100 : i === p.stageIndex ? p.stageProgress : 0,
      // Each step with its completion fraction (0..1) and its inspections.
      steps: s.steps.map((step, k) => ({
        ...step,
        fraction: i < p.stageIndex ? 1 : i === p.stageIndex ? stepFraction(s.steps, k, p.stageProgress) : 0,
        inspections: inspections.filter((x) => x.stageIndex === i && x.step === step.label),
      })),
    })),
    milestones, // shorthand property
    // Steps still awaiting a passing inspection.
    inspectionQueue: inspectionQueue(p, inspections),
    // Headline dates. `schedule.at(-1)` is the last element (negative index
    // counts from the end). `?.end` guards against an out-of-range stage.
    summary: { plannedEnd: p.plannedEndDate ?? schedule.at(-1).end, scheduleEnd: schedule.at(-1).end, daysBehind, currentPlannedEnd: schedule[p.stageIndex]?.end },
  }
}

/** An inspection is append-only: a re-check is a new row, and the latest result wins in the queue. */
// The third parameter destructures the request body's fields.
export async function recordInspection(q, ctx, { stageIndex, step, result, notes, inspectedOn, evidenceIds }) {
  // Refuse when the contract type doesn't use inspections (HTTP 400).
  if (!featuresFor(ctx.project.contractType).inspections) throw badRequest("This project doesn't use inspections")
  const stages = stagesFor(ctx.project)
  // Pick the stage by its index (`array[i]`; undefined when out of range).
  const stage = stages[stageIndex]
  // `.some(fn)` is true if any step matches; refuse unknown stage or step.
  if (!stage || !stage.steps.some((s) => s.label === step)) throw badRequest('Unknown step')
  // A non-pass result must explain what to fix. `notes?.trim()` trims spaces
  // if notes exists; an empty result is falsy, so `!` makes it true.
  if (result !== 'PASS' && !notes?.trim()) throw badRequest('Describe what needs fixing')
  const id = newId()
  // Insert the inspection row (nine placeholders, nine values).
  await q(
    `INSERT INTO inspections (id, project_id, stage_index, step, result, notes, inspector_id, inspected_on, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, ctx.project.id, stageIndex, step, result, notes?.trim() || null, ctx.userId, inspectedOn, isoAt(ctx.at)],
  )
  // Link the photos.
  await attachEvidence(q, ctx, evidenceIds, 'INSPECTION', id)
  // Look up a word for the result: an object literal indexed immediately with `[result]`.
  const word = { PASS: 'passed', PARTIAL: 'partly passed', FAIL: 'failed' }[result]
  // Audit entry.
  await audit(q, {
    projectId: ctx.project.id,
    actorId: ctx.userId,
    action: 'inspection.recorded',
    targetType: 'INSPECTION',
    targetId: id,
    // A nested template literal adds ` — "notes"` only when notes exist.
    summary: `Inspection ${word}: ${stage.label}, ${step}${notes?.trim() ? ` — "${notes.trim()}"` : ''}`,
    payload: { stageIndex, step, result },
    at: ctx.at,
  })
  // Everyone except the inspector role gets told.
  const people = await membersWithRoles(q, ctx.project.id, ['OWNER', 'LOCAL_REP', 'CONTRACTOR'])
  // Send the notification; `exclude` skips the person who recorded it.
  await notify(q, { userIds: people, projectId: ctx.project.id, title: `Inspection ${word}: ${step}`, body: notes?.trim() || `${stage.label} checked by ${ctx.userName}`, link: `/p/${ctx.project.id}/progress`, at: ctx.at, exclude: ctx.userId })
  return { id }
}
