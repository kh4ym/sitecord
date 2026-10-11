// Daily site reports: the contractor's (or self-managing owner's) record of
// the day with photos, workers and materials used. Submitting one moves the
// project's progress through projects.js updateProgress. Status: SUBMITTED
// → VERIFIED (rep/owner/inspector on site, via decisions.js) or QUERIED
// (back to SUBMITTED when the author answers in questions.js). Used by
// routes/projects.js and the seed.
//
// What this file does: list reports, load one report with its materials,
// photos, decisions and questions, and create a report (which also records
// materials, flags reused photos, moves progress and notifies the owner).
// Depends on: shared/features.js (stages), audit/audit.js, lib/errors.js,
// lib/util.js, decisions.js, evidence.js, notify.js and projects.js.
// `q` runs SQL in the current transaction (camelCase rows); `ctx` holds the
// project, the user id, permission checks (`ctx.can`) and the request time.

// Stage list for a project.
import { stagesFor } from '../../../shared/features.js'
// Audit log writer.
import { audit } from '../audit/audit.js'
// HTTP 400 / 404 error builders.
import { badRequest, notFound } from '../lib/errors.js'
// Offline-replay lookup, timestamp formatter and id generator.
import { findByClientId, isoAt, newId } from '../lib/util.js'
// Owner decisions on a record.
import { decisionsFor } from './decisions.js'
// Link files, load files, and detect files already used elsewhere.
import { attachEvidence, evidenceFor, reusedFiles } from './evidence.js'
// Member lookup by role and notification sender.
import { membersWithRoles, notify } from './notify.js'
// Moves the project's stage/progress and logs it.
import { updateProgress } from './projects.js'

// List every report of the project.
export async function listReports(q, ctx) {
  // Each report with the author's name, a photo count, and up to 4 photo ids
  // as one comma-separated text: the inner subquery picks the first 4 files
  // and `string_agg(v.id, ',' ORDER BY ...)` glues their ids together.
  // Newest report date first, then newest created first.
  const rows = await q(
    `SELECT r.*, u.name AS author_name,
            (SELECT count(*)::int FROM evidence v WHERE v.report_id = r.id) AS photo_count,
            (SELECT string_agg(v.id, ',' ORDER BY v.received_at) FROM (SELECT id, received_at FROM evidence WHERE report_id = r.id ORDER BY received_at LIMIT 4) v) AS photo_ids
       FROM daily_reports r JOIN users u ON u.id = r.author_id
      WHERE r.project_id = $1 ORDER BY r.report_date DESC, r.created_at DESC`,
    [ctx.project.id],
  )
  // Someone shown the reports but not the photos sees how many there are, not the photos.
  // Ternary: unchanged rows, or copies with photoIds blanked (spread + override).
  return ctx.can('viewPhotos') ? rows : rows.map((r) => ({ ...r, photoIds: null }))
}

// Load one report with everything attached to it.
export async function getReport(q, ctx, id) {
  // The report plus author name, limited to this project.
  const [r] = await q(
    `SELECT r.*, u.name AS author_name FROM daily_reports r JOIN users u ON u.id = r.author_id WHERE r.id = $1 AND r.project_id = $2`,
    [id, ctx.project.id],
  )
  if (!r) throw notFound('Report not found') // 404
  // May this user see photos?
  const photos = ctx.can('viewPhotos')
  // Four loads in parallel, destructured in order.
  const [materials, evidence, decisions, questions] = await Promise.all([
    // Materials used, joined to their BOQ line for code/description/unit.
    q(`SELECT rm.qty, b.id AS boq_item_id, b.code, b.description, b.unit FROM report_materials rm JOIN boq_items b ON b.id = rm.boq_item_id
        WHERE rm.report_id = $1`, [id]),
    evidenceFor(q, 'REPORT', id), // photos
    decisionsFor(q, 'REPORT', id), // verify/query decisions
    // Questions only for users allowed to see them; else an empty array.
    ctx.can('viewQuestions') ? q(`SELECT id, number, title, status FROM questions WHERE target_type = 'REPORT' AND target_id = $1`, [id]) : [],
  ])
  // Build the response.
  return {
    ...r, // report fields
    materials,
    photoCount: evidence.length, // always shown
    evidence: photos ? evidence : [], // files only for photo viewers
    // Without photo rights, strip each decision's photo id and GPS location.
    decisions: photos ? decisions : decisions.map((d) => ({ ...d, evidenceId: null, lat: null, lng: null })),
    questions,
  }
}

/**
 * A daily report is the contractor's formal record of the day. Submitting
 * one also updates the project's progress, so the 3D site and plan follow it.
 * A report never moves progress backwards: one written offline for a stage
 * that has since moved on, or one that says less than is already recorded,
 * is kept as written and the project's progress stays where it is.
 */
export async function createReport(q, ctx, input) {
  // Offline clients may send the same report twice; if this clientId was
  // already saved, return the existing id instead of creating a duplicate.
  const replay = await findByClientId(q, 'daily_reports', 'author_id', ctx, input.clientId)
  if (replay) return { id: replay.id, replay: true }
  const p = ctx.project // the project
  const stages = stagesFor(p) // its stages
  // Validation: summary at least 10 characters after trimming spaces.
  if (input.summary.trim().length < 10) throw badRequest('Describe the work done in a sentence or two')
  // At least one photo: `?.length` is undefined when there's no array, which `!` treats as "missing".
  if (!input.evidenceIds?.length) throw badRequest('Add at least one photo from the site')
  // `stale`: written offline for a stage the project has since left.
  // `behind`: claims less progress than already recorded. Either way the
  // report is stored as written and progress is left alone.
  // `!= null` (loose) is true for anything except null and undefined.
  const stale = input.stageIndex != null && input.stageIndex !== p.stageIndex
  // A stale report must still name a real stage.
  if (stale && !stages[input.stageIndex]) throw badRequest('That stage does not exist')
  // The stage this report is about.
  const stageIndex = stale ? input.stageIndex : p.stageIndex
  // "Stage completed" means 100%; otherwise the given percentage.
  const progressAfter = input.stageCompleted ? 100 : input.progressAfter
  // Range check (`||` = either is enough to refuse).
  if (progressAfter < 0 || progressAfter > 100) throw badRequest('Progress must be between 0 and 100')
  // Claims less than the recorded progress on the current stage.
  const behind = !stale && !input.stageCompleted && progressAfter < p.stageProgress
  // Leave project progress unchanged in either case.
  const keepProgress = stale || behind
  // Where progress started for this report.
  const progressBefore = keepProgress ? progressAfter : p.stageProgress

  const id = newId()
  // Insert the report (14 columns, 14 values). `?.trim() || null` stores
  // NULL for missing/blank text; `!!x` converts any value to true/false;
  // stage_completed is only true for a non-stale report.
  await q(
    `INSERT INTO daily_reports (id, project_id, author_id, report_date, summary, issues, worker_count, weather, stage_index,
                                progress_before, progress_after, stage_completed, created_at, client_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, p.id, ctx.userId, input.reportDate, input.summary.trim(), input.issues?.trim() || null, input.workerCount ?? null,
      input.weather || null, stageIndex, progressBefore, progressAfter, !!input.stageCompleted && !stale, isoAt(ctx.at), input.clientId ?? null],
  )
  // Loop over materials (`?? []` loops over nothing when absent).
  for (const m of input.materials ?? []) {
    // `continue` skips to the next material when the quantity isn't positive.
    if (!(Number(m.qty) > 0)) continue
    // The BOQ line must exist in this project and be active.
    const [item] = await q('SELECT id FROM boq_items WHERE id = $1 AND project_id = $2 AND archived_at IS NULL', [m.boqItemId, p.id])
    if (!item) throw badRequest('Unknown material')
    // Record the material used.
    await q('INSERT INTO report_materials (id, report_id, boq_item_id, qty) VALUES ($1, $2, $3, $4)', [newId(), id, m.boqItemId, Number(m.qty)])
  }
  // Link the photos; returns their details (sha256, fileName, ...).
  const evidence = await attachEvidence(q, ctx, input.evidenceIds, 'REPORT', id)
  const stage = stages[stageIndex]
  // "1 photo" or "N photos": add "s" unless exactly one.
  const photos = `${evidence.length} photo${evidence.length === 1 ? '' : 's'}`
  // Audit entry; the summary text depends on whether progress moved.
  await audit(q, {
    projectId: p.id,
    actorId: ctx.userId,
    action: 'report.submitted',
    targetType: 'REPORT',
    targetId: id,
    summary: keepProgress
      ? `Submitted the daily report for ${input.reportDate} (progress already recorded further along, so it is unchanged), ${photos}`
      : `Submitted the daily report for ${input.reportDate}: ${stage.label} ${p.stageProgress}% → ${progressAfter}%, ${photos}`,
    // Payload includes every photo's fingerprint (sha256) via `.map`.
    payload: { reportDate: input.reportDate, stageIndex, from: progressBefore, to: progressAfter, stale, behind, photos: evidence.map((e) => e.sha256) },
    at: ctx.at,
  })

  // Same photo already used on another record? Raise it for the owner, don't block.
  const reused = await reusedFiles(q, p.id, evidence, 'REPORT', id)
  for (const ev of reused) {
    // Insert a HIGH-severity finding; fixed values are written straight into
    // the SQL, the variable ones are $1..$5.
    await q(
      `INSERT INTO findings (id, project_id, target_type, target_id, rule, severity, message, created_at)
       VALUES ($1, $2, 'REPORT', $3, 'REUSED_FILE', 'HIGH', $4, $5)`,
      [newId(), p.id, id, `"${ev.fileName}" is identical to a photo already attached to another record.`, isoAt(ctx.at)],
    )
  }

  // "Stage complete" opens the next stage at 0%; on the last stage it just
  // records 100%. updateProgress writes progress_updates and its own audit line.
  if (!keepProgress) {
    // Not the last stage (`stages.length - 1` is the last index).
    if (input.stageCompleted && stageIndex < stages.length - 1) {
      await updateProgress(q, ctx, { stageIndex: stageIndex + 1, stageProgress: 0, reportId: id })
    } else {
      // Same stage, new percentage.
      await updateProgress(q, ctx, { stageIndex, stageProgress: progressAfter, reportId: id })
    }
  }
  // Tell the owner and local rep (not the author).
  await notify(q, {
    userIds: await membersWithRoles(q, p.id, ['OWNER', 'LOCAL_REP']),
    projectId: p.id,
    title: `Daily report: ${stage.label} ${progressAfter}%`,
    body: input.summary.trim().slice(0, 140), // first 140 characters
    link: `/p/${p.id}/reports/${id}`,
    at: ctx.at,
    exclude: ctx.userId,
  })
  return { id }
}
