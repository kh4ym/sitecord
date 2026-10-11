// Demo data: about six months of a real build, played through the same
// services the API uses (back-dated), so the audit chain, findings and
// notifications are all genuine. Run on first start, or with `npm run reset`.
//
// What this file does: `seedDemo()` creates the four demo users, a 10-marla
// two-storey house in Lahore managed by a contractor, and a smaller
// self-managed house in Karachi. It then replays roughly six months of
// activity in date order: documents, progress, purchases with receipts and
// delivery photos, approvals, site verifications, payments, inspections,
// daily reports, questions and change requests.
// Why it exists: so a fresh install (and the smoke test) has a realistic
// project to explore, produced by the real business logic rather than by
// hand-written rows.
// Who uses it: seed/run.js (`npm run reset`), first start-up, scripts/smoke.js.
// Depends on: shared/permissions.js, auth/sessions.js, db/index.js, lib/log.js,
// lib/util.js, many services/*.js modules, seed/people.js and seed/svg.js.

// Named import: computes the permission list for a role on a project.
import { permissionsFor } from '../../../shared/permissions.js'
// Hashes a sign-in secret for storage.
import { hashPassword } from '../auth/sessions.js'
// `q` runs one query; `tx(fn)` runs fn inside a database transaction.
import { q, tx } from '../db/index.js'
// The app's logger.
import { log } from '../lib/log.js'
// Id generator and "today's date in Pakistan" helper.
import { newId, todayPK } from '../lib/util.js'
// The service functions the demo replays (same ones the API routes call).
import { requestAccess } from '../services/access.js'
import { createChange } from '../services/changes.js'
import { decide } from '../services/decisions.js'
import { createDocument } from '../services/documents.js'
import { saveEvidence } from '../services/evidence.js'
import { createExpense } from '../services/expenses.js'
import { confirmPayment, createPayment, requestMilestone } from '../services/payments.js'
import { recordInspection } from '../services/plan.js'
import { acceptInvitation, createProject, inviteMember, PROJECT_COLUMNS, setSitePin, updateProgress } from '../services/projects.js'
import { createQuestion, replyToQuestion, resolveQuestion } from '../services/questions.js'
import { createReport } from '../services/reports.js'
// Demo people and their shared sign-in constant.
import { DEMO_PASSWORD, DEMO_PEOPLE } from './people.js'
// Namespace import: `* as art` puts every export of svg.js on one object,
// used as art.receipt(...), art.sitePhoto(...), etc.
import * as art from './svg.js'

// Milliseconds in one day (24 × 60 × 60 × 1000).
const DAY = 86400000
// File type info for the generated SVG images.
const SVG = { mime: 'image/svg+xml', ext: 'svg' }

// Site pins: DHA Phase 6, Lahore, and Gulshan-e-Iqbal, Karachi. Live photos are
// placed a few metres from the pin, with the GPS accuracy a phone would report.
const LAHORE = { lat: 31.4697, lng: 74.4089 }
const KARACHI = { lat: 24.918, lng: 67.0971 }
const STEEL_YARD = { lat: 31.479, lng: 74.415 } // about 1.2 km from the Lahore site
// Format coordinates for a photo stamp; the parameter object is destructured.
const printed = ({ lat, lng }) => `${lat.toFixed(4)}°N ${lng.toFixed(4)}°E`
// Deterministic "random" number in [0, 1) from n (a classic sine hash), so
// the demo is identical every time. A multi-line arrow function body in `{}`.
const noise = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  // Keep only the fractional part.
  return x - Math.floor(x)
}
// Counter so each generated GPS point differs.
let gpsSeq = 0
// A believable phone GPS reading 4–24 m from the pin.
function nearPin(pin) {
  // `++gpsSeq` increments first, then returns the new value.
  const n = ++gpsSeq
  const metres = 4 + noise(n) * 20 // distance
  const angle = noise(n + 0.5) * 2 * Math.PI // direction in radians
  return {
    // About 111,320 m per degree of latitude.
    lat: pin.lat + (metres * Math.cos(angle)) / 111320,
    // A degree of longitude shrinks with cos(latitude); degrees → radians via π/180.
    lng: pin.lng + (metres * Math.sin(angle)) / (111320 * Math.cos((pin.lat * Math.PI) / 180)),
    // Reported accuracy 5–15 m.
    accuracyM: Math.round(5 + noise(n + 0.25) * 10),
  }
}

/** ISO time for `daysAgo` days back at a Pakistan-local hour (never in the future). */
// `hour = 11, minute = 0` are default parameter values.
function when(daysAgo, hour = 11, minute = 0) {
  // The Pakistan calendar date that many days ago (Date.now() is milliseconds).
  const date = todayPK(Date.now() - daysAgo * DAY)
  // Build "YYYY-MM-DDTHH:MM:00+05:00"; `padStart(2, '0')` makes "9" into "09".
  const t = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`)
  // Clamp to at least one minute ago, then convert to an ISO string (UTC).
  return new Date(Math.min(t.getTime(), Date.now() - 60000)).toISOString()
}
// The Pakistan date (YYYY-MM-DD) n days ago.
const dateAgo = (n) => todayPK(Date.now() - n * DAY)
// Turn an ISO time into a "YYYY-MM-DD HH:MM" Pakistan-time stamp for images:
// add 5 hours, take the first 16 characters, swap the "T" for a space.
const stampOf = (iso) => new Date(new Date(iso).getTime() + 5 * 3600000).toISOString().slice(0, 16).replace('T', ' ')

// The exported entry point.
export async function seedDemo() {
  log.info('seeding demo data')
  // Role → { id, name, email }, filled in the loop below.
  const people = {}
  // Hash once and reuse for all demo users.
  const hash = await hashPassword(DEMO_PASSWORD)
  // `Object.entries` gives [role, person] pairs to loop over.
  for (const [role, p] of Object.entries(DEMO_PEOPLE)) {
    const id = newId()
    // Insert the user, created 190 days ago.
    await q('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [id, p.email, p.name, hash, when(190)])
    // `people[role] = ...` sets a property whose name is in a variable.
    people[role] = { id, name: p.name, email: p.email }
  }
  // Destructure with renaming: `OWNER: owner` reads people.OWNER into `owner`.
  const { OWNER: owner, CONTRACTOR: contractor, LOCAL_REP: rep, INSPECTOR: inspector } = people

  /** The same context the routes build, for a person acting on a project at a point in the past. */
  // A function declared inside another function (it can see `people` etc.).
  async function ctxFor(qq, person, projectId, at) {
    // The project's columns plus this person's role, only if they are an
    // active member. `${PROJECT_COLUMNS}` inserts the shared column list.
    const [row] = await qq(
      `SELECT ${PROJECT_COLUMNS}, m.role FROM projects p
         JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 AND m.removed_at IS NULL WHERE p.id = $1`,
      [projectId, person.id],
    )
    // Split `role` off; the rest of the row's properties go into `project`.
    const { role, ...project } = row
    // What this role may do on this project.
    const permissions = permissionsFor(role, project)
    // The ctx object services expect; `can` is an arrow function checking the list.
    return { userId: person.id, userName: person.name, userEmail: person.email, project, role, can: (a) => permissions.includes(a), at, cleanup: [] }
  }
  /** Run `fn` as `person` on the project, at a point in the past. */
  // Opens a transaction, builds the ctx, then calls fn(query, ctx).
  const as = (person, projectId, at, fn) => tx(async (qq) => fn(qq, await ctxFor(qq, person, projectId, at)))
  // Store an SVG image as evidence. The options object is destructured with
  // defaults and itself defaults to `{}`.
  const upload = (qq, ctx, kind, svgText, { captureMode = 'IN_APP_CAMERA', fileName, caption, point } = {}) => {
    // The project's site pin, if one is set (`!= null` excludes null and undefined).
    const pin = ctx.project.siteLat != null ? { lat: ctx.project.siteLat, lng: ctx.project.siteLng } : null
    // GPS only for in-app camera photos on a pinned site: a given point (with
    // 9 m accuracy) or a random spot near the pin; otherwise no GPS (`{}`).
    const gps = captureMode === 'IN_APP_CAMERA' && pin ? (point ? { ...point, accuracyM: 9 } : nearPin(pin)) : {}
    // Save it through the real evidence service.
    return saveEvidence(qq, ctx, {
      buffer: Buffer.from(svgText), // text → bytes
      type: SVG,
      // Default name like "photo-2026-05-0111.svg"; the regex /[: ]/g removes colons and spaces.
      fileName: fileName ?? `${kind.toLowerCase()}-${stampOf(ctx.at).replace(/[: ]/g, '')}.svg`,
      kind,
      captureMode,
      // Taken 4 minutes before it was saved.
      capturedAt: new Date(new Date(ctx.at).getTime() - 4 * 60000).toISOString(),
      // Only camera uploads report a client send time.
      clientSentAt: captureMode === 'IN_APP_CAMERA' ? ctx.at : undefined,
      ...gps, // spread lat/lng/accuracyM (or nothing)
      caption,
    })
  }

  // ---------------------------------------------------------------- Project
  // Create the Lahore project 186 days ago and keep its id as `pid`
  // (`{ id: pid }` destructures `id` into a variable named pid).
  const { id: pid } = await tx((qq) =>
    createProject(qq, { userId: owner.id, userName: owner.name, at: when(186, 21) }, {
      name: 'DHA Phase 6 house',
      address: 'Plot 214, Sector C, DHA Phase 6',
      city: 'Lahore',
      plotSize: 'MARLA_10',
      floors: 2,
      contractType: 'GREY_STRUCTURE',
      budgetPaisa: 1790000000, // Rs 1.79 crore, typed by the owner
      startDate: dateAgo(185),
      drawingsApproved: false,
    }),
  )
  // Lookup tables built with `Object.fromEntries([[key, value], ...])`:
  // BOQ items by code ('M-01' → row) and milestone ids by name.
  const boq = Object.fromEntries((await q('SELECT id, code, unit FROM boq_items WHERE project_id = $1', [pid])).map((b) => [b.code, b]))
  const milestones = Object.fromEntries((await q('SELECT id, name FROM milestones WHERE project_id = $1', [pid])).map((m) => [m.name, m.id]))

  // Invite contractor, rep and inspector; each accepts two hours later.
  for (const [person, role, day] of [[contractor, 'CONTRACTOR', 185], [rep, 'LOCAL_REP', 185], [inspector, 'INSPECTOR', 184]]) {
    // Owner invites; `{ token }` destructures the invitation token.
    const { token } = await as(owner, pid, when(day, 20), (qq, ctx) => inviteMember(qq, ctx, { email: DEMO_PEOPLE[role].email, role }))
    // The invitee accepts (they aren't a member yet, so a minimal ctx is built by hand).
    await tx((qq) => acceptInvitation(qq, { userId: person.id, userName: person.name, userEmail: person.email, at: when(day, 22) }, token))
  }
  // Bilal stands on the plot and pins it, so every live photo can be checked against it.
  await as(rep, pid, when(184, 10), (qq, ctx) => setSitePin(qq, ctx, { ...LAHORE, accuracyM: 6, source: 'DEVICE' }))

  // Helper: upload a document image and register it (default uploader: owner).
  const doc = (day, title, category, svgText, person = owner) =>
    as(person, pid, when(day, 19), async (qq, ctx) => {
      const ev = await upload(qq, ctx, 'DOCUMENT', svgText, { captureMode: 'FILE', fileName: `${title}.svg` })
      await createDocument(qq, ctx, { title, category, evidenceId: ev.id })
    })
  // Early documents: floor plan, soil test letter, structural drawings.
  await doc(184, 'Architectural plan, ground floor', 'DRAWING', art.floorPlan({ title: 'Ground floor plan' }))
  await doc(179, 'Soil test report', 'OTHER', art.letter({ heading: 'Soil investigation report', subheading: 'Plot 214, Sector C · Sample report', paragraphs: ['Two boreholes were drilled to 6 m. The soil is firm silty clay with a safe bearing capacity of 1.5 tons per square foot at 1.2 m depth.', 'Isolated footings at 1.2 m depth are suitable. No ground water was found within 6 m.'], signedBy: 'Geotechnical engineer', seal: false }))
  await doc(171, 'Structural drawings, foundation and columns', 'DRAWING', art.floorPlan({ title: 'Foundation and column layout' }))

  // Helper: the contractor records stage progress on a given day.
  const progress = (day, stageIndex, stageProgress, hour = 18) =>
    as(contractor, pid, when(day, hour), (qq, ctx) => updateProgress(qq, ctx, { stageIndex, stageProgress }))
  // Pre-construction stage at 40%, then 75%.
  await progress(178, 0, 40)
  await progress(166, 0, 75)
  // Plan approval and the construction agreement.
  await doc(156, 'Building plan approval', 'APPROVAL', art.letter({ heading: 'Building plan approval', subheading: 'Sample approval letter · Plot 214, Sector C', paragraphs: ['The building plan submitted for a double-storey residential house on the above plot is approved, subject to the bye-laws.', 'Construction must start within one year and follow the approved drawings. Any change needs a revised approval.'], signedBy: 'Building control officer' }))
  await doc(155, 'Construction agreement, Imran Builders', 'CONTRACT', art.letter({ heading: 'Construction agreement', subheading: 'Grey structure · Sample agreement', paragraphs: ['Imran Builders will build the grey structure of the house as per the approved drawings, supplying materials and labour.', 'Payments are released at the milestones in the project plan, after the owner approves each one. All purchases are recorded with receipts and delivery photos in SiteCord.'], signedBy: 'Ayesha Khan and Imran Ali' }))

  // ----------------------------------------------------------- Money flows
  // Calls below run in time order, so the audit trail reads chronologically.
  // Helper: the owner pays the contractor by bank transfer with a screenshot,
  // and the contractor confirms receipt two hours later.
  const pay = async (day, { type, amount, milestone, reference }) => {
    const { id } = await as(owner, pid, when(day, 14), async (qq, ctx) => {
      // Upload the transfer screenshot.
      const ev = await upload(qq, ctx, 'BANK_PROOF', art.bankProof({ amount, payee: 'Imran Builders', reference, when: stampOf(ctx.at) }), { captureMode: 'GALLERY', fileName: `transfer-${reference}.svg` })
      // Record the payment (amount in rupees × 100 = paisa); link the milestone if any.
      return createPayment(qq, ctx, {
        type, method: 'BANK_TRANSFER', payeeUserId: contractor.id, amountPaisa: amount * 100, paidOn: dateAgo(day), reference,
        milestoneId: milestone ? milestones[milestone] : null, evidenceIds: [ev.id],
      })
    })
    await as(contractor, pid, when(day, 16), (qq, ctx) => confirmPayment(qq, ctx, id))
  }
  // Helper: contractor requests a milestone, owner approves, owner pays.
  const milestonePayment = async (name, requested, approved, paid, amount, type = 'MILESTONE', reference) => {
    await as(contractor, pid, when(requested, 12), (qq, ctx) => requestMilestone(qq, ctx, milestones[name]))
    await as(owner, pid, when(approved, 21), (qq, ctx) => decide(qq, ctx, { targetType: 'MILESTONE', targetId: milestones[name], decision: 'APPROVE' }))
    await pay(paid, { type, amount, milestone: name, reference })
  }
  // Read the generated advance amount; `[{ amountPaisa: advance }]` takes the
  // first row and renames its amountPaisa to `advance`.
  const [{ amountPaisa: advance }] = await q('SELECT amount_paisa FROM milestones WHERE id = $1', [milestones['Mobilisation advance']])
  // Pay the mobilisation advance (paisa / 100 = rupees), then start stage 1.
  await milestonePayment('Mobilisation advance', 154, 153, 152, advance / 100, 'ADVANCE', 'TRF-50211')
  await progress(152, 1, 0, 17)

  // Which delivery-photo drawing to use for each material BOQ code.
  const MATERIAL_ART = { 'M-01': 'cement', 'M-02': 'steel', 'M-03': 'bricks', 'M-04': 'sand', 'M-05': 'crush' }
  // Helper: the contractor records a purchase with a receipt (or handwritten
  // slip) and, for submitted materials, a delivery photo. Many options have defaults.
  const purchase = (day, { type = 'MATERIAL', supplier, invoice, lines, slip = false, fromAdvance = true, submit = true, hour = 13, description, deliveredAt }) =>
    as(contractor, pid, when(day, hour), async (qq, ctx) => {
      // Each line is an array [code, desc, qty, unit, rate], destructured in
      // the arrow's parameter, and turned into an expense line object.
      const items = lines.map(([code, desc, qty, unit, rate]) => ({
        boqItemId: code ? boq[code].id : null, // linked BOQ item, if any
        description: desc,
        qty,
        unit: code ? boq[code].unit : unit, // BOQ unit wins when linked
        unitPaisa: Math.round(rate * 100), // rupees → paisa
      }))
      // The same lines in the shape the receipt drawings expect.
      const drawn = items.map((l) => ({ description: l.description, qty: l.qty, rate: l.unitPaisa / 100 }))
      const evidence = [] // evidence ids to attach
      // Ternary choosing between two awaited uploads: slip or printed receipt.
      const proof = slip
        ? await upload(qq, ctx, 'HANDWRITTEN_SLIP', art.handwrittenSlip({ supplier, date: dateAgo(day), lines: drawn }), { captureMode: 'IN_APP_CAMERA' })
        : await upload(qq, ctx, 'RECEIPT', art.receipt({ supplier, invoice, date: dateAgo(day), lines: drawn }), { captureMode: 'IN_APP_CAMERA' })
      evidence.push(proof.id)
      // Submitted material purchases also get a delivery photo.
      if (type === 'MATERIAL' && submit) {
        // The first line's BOQ code: `find(([c]) => c)` finds the first line
        // with a code, `?.[0]` reads its first element if found.
        const code = lines.find(([c]) => c)?.[0]
        // Quantity label like "220 bag + 600 cft". `[, , qty, unit]` skips the
        // first two array elements with empty commas.
        const label = `${lines.map(([, , qty, unit]) => `${qty.toLocaleString('en-PK')} ${code ? boq[lines[0][0]].unit : unit}`).join(' + ')}`
        // Upload the delivery photo; `deliveredAt && printed(...)` gives the
        // printed coordinates only when deliveredAt is set.
        const photo = await upload(
          qq,
          ctx,
          'DELIVERY_PHOTO',
          art.deliveryPhoto({ material: MATERIAL_ART[code] ?? 'steel', quantity: label, when: stampOf(ctx.at), where: deliveredAt && printed(deliveredAt) }),
          { point: deliveredAt },
        )
        evidence.push(photo.id)
      }
      // Create the expense through the real service (rules run here).
      return createExpense(qq, ctx, {
        type, supplierName: supplier, invoiceNumber: invoice, description: description ?? '', purchaseDate: dateAgo(day),
        fromAdvance, lines: items, evidenceIds: evidence, submit,
      })
    })
  // Helper: the owner approves an expense `e` in the evening.
  const approve = (day, e) => as(owner, pid, when(day, 22), (qq, ctx) => decide(qq, ctx, { targetType: 'EXPENSE', targetId: e.id, decision: 'APPROVE' }))
  // Helper: the local rep verifies a delivery on site with a photo.
  const verify = (day, e, scene = 'brickwork') =>
    as(rep, pid, when(day, 16), async (qq, ctx) => {
      const photo = await upload(qq, ctx, 'PHOTO', art.deliveryPhoto({ material: scene, quantity: 'Checked on site', when: stampOf(ctx.at) }))
      return decide(qq, ctx, { targetType: 'EXPENSE', targetId: e.id, decision: 'VERIFY', note: 'Counted at the site, matches the receipt.', evidenceId: photo.id })
    })

  // Allowed scene names for site photos (keys with dashes must be quoted).
  const SCENES = { excavation: 'excavation', footings: 'footings', plinth: 'plinth', columns: 'columns', brickwork: 'brickwork', slab: 'slab', curing: 'curing', 'columns-upper': 'columns-upper', 'brickwork-upper': 'brickwork-upper' }
  // Helper: the contractor files a daily report with N site photos.
  // `progress: to` renames the `progress` option to `to` (avoids clashing with
  // the progress() helper above).
  const report = (day, { summary, progress: to, complete = false, workers, issues, weather = 'Clear', scene, materials = [], photos = 2, hour = 18 }) =>
    as(contractor, pid, when(day, hour), async (qq, ctx) => {
      const ids = []
      // Photos taken half an hour apart (1800000 ms) before the report time.
      for (let i = 0; i < photos; i++) {
        const ev = await upload(qq, ctx, 'PHOTO', art.sitePhoto({ scene: SCENES[scene], when: stampOf(new Date(new Date(ctx.at).getTime() - (photos - i) * 1800000).toISOString()), seed: `${day}-${i}` }))
        ids.push(ev.id)
      }
      // Materials given as [code, qty] pairs become { boqItemId, qty }.
      return createReport(qq, ctx, {
        reportDate: dateAgo(day), summary, issues, workerCount: workers, weather, progressAfter: to, stageCompleted: complete,
        materials: materials.map(([code, qty]) => ({ boqItemId: boq[code].id, qty })), evidenceIds: ids,
      })
    })
  // Helper: the inspector records an inspection with a photo; a chained
  // ternary picks a fitting scene for the stage/step.
  const inspect = (day, stageIndex, step, result, notes) =>
    as(inspector, pid, when(day, 12), async (qq, ctx) => {
      const ev = await upload(qq, ctx, 'PHOTO', art.sitePhoto({ scene: stageIndex === 1 ? 'footings' : stageIndex === 2 && step === 'Slab casting' ? 'slab' : stageIndex === 3 ? 'columns-upper' : 'columns', when: stampOf(ctx.at), seed: `insp-${day}` }))
      return recordInspection(qq, ctx, { stageIndex, step, result, notes, inspectedOn: dateAgo(day), evidenceIds: [ev.id] })
    })
  // Helper: the rep verifies a daily report on site with a photo.
  const verifyReport = (day, r, scene) =>
    as(rep, pid, when(day, 11), async (qq, ctx) => {
      const ev = await upload(qq, ctx, 'PHOTO', art.sitePhoto({ scene, when: stampOf(ctx.at), seed: `v-${day}` }))
      return decide(qq, ctx, { targetType: 'REPORT', targetId: r.id, decision: 'VERIFY', note: 'Visited the site; work matches the report.', evidenceId: ev.id })
    })

  // ----------------------------------------------------------- Foundation
  // Days 149–146: excavation reports and the excavation labour (slip), approved.
  await report(149, { scene: 'excavation', progress: 8, workers: 8, weather: 'Hot', summary: 'Marked the layout with lime and started excavation with a JCB. North and east footing trenches dug to 1.2 m.' })
  const p1 = await purchase(147, { type: 'LABOUR', supplier: 'Rashid excavation team', slip: true, lines: [[null, 'Excavation labour, 6 workers × 5 days', 30, 'day', 1500]] })
  await report(146, { scene: 'excavation', progress: 15, workers: 6, summary: 'Excavation finished for all 20 footings. Soil is firm clay at 1.2 m, as the soil report said.' })
  await approve(146, p1)
  // Days 144–140: cement, steel, sand/crush bought, approved and verified;
  // footing report; a second advance paid.
  const p2 = await purchase(144, { supplier: 'Al-Noor Cement Traders', invoice: 'ANC-2231', lines: [['M-01', 'OPC cement, 50 kg bag', 220, null, 1440]] })
  const p3 = await purchase(143, { supplier: 'Punjab Steel House', invoice: 'PSH-0917', lines: [['M-02', 'Steel bars, Grade 60', 2400, null, 268]] })
  await approve(143, p2)
  const p4 = await purchase(142, { supplier: 'Ravi Sand & Crush Supply', invoice: 'RSC-118', lines: [['M-04', 'Sand, Chenab', 900, null, 108], ['M-05', 'Crush, 3/4 inch', 600, null, 158]] })
  await verify(142, p2, 'cement')
  await approve(142, p3)
  await report(141, { scene: 'footings', progress: 30, workers: 10, summary: 'PCC laid under the footings. Steel mesh for 10 footings tied and checked against the drawing.', materials: [['M-01', 40], ['M-02', 900], ['M-05', 150]] })
  await approve(141, p4)
  await pay(140, { type: 'ADVANCE', amount: 1500000, reference: 'TRF-50388' })
  await verify(140, p4, 'sand')
  // Days 138–133: footings inspected (pass), cast; contractor's own labour bill.
  await inspect(138, 1, 'Footings', 'PASS', 'Footing sizes and steel match the structural drawing. Cover is good.')
  await report(137, { scene: 'footings', progress: 42, workers: 12, summary: 'All footings cast. Curing with wet hessian twice a day.', materials: [['M-01', 60], ['M-04', 120], ['M-05', 180]] })
  const p5 = await purchase(134, { type: 'LABOUR', supplier: 'Imran Builders', invoice: 'IB-001', fromAdvance: false, lines: [['L-01', 'Grey structure labour, foundation', 600, null, 450]] })
  await approve(133, p5)
  // Days 131–121: plinth work, bricks and shuttering bought, two inspections pass.
  await report(131, { scene: 'plinth', progress: 58, workers: 9, summary: 'Backfill done in 9-inch layers with water and compaction. Started steel for the plinth beams.', materials: [['M-04', 200]] })
  const p6 = await purchase(128, { supplier: 'Ghazi Bricks Kiln', invoice: 'GBK-552', lines: [['M-03', 'Bricks, A-class', 12000, null, 16.5]] })
  await report(127, { scene: 'plinth', progress: 72, workers: 10, summary: 'Plinth beam steel tied on the east and north sides. Shuttering fixed.', materials: [['M-02', 600]] })
  await approve(127, p6)
  await inspect(126, 1, 'Plinth beams', 'PASS', 'Lap lengths and cover blocks checked on all sides.')
  const p7 = await purchase(124, { type: 'EQUIPMENT', supplier: 'Hafiz Shuttering Service', invoice: 'HSS-31', lines: [['E-01', 'Shuttering and scaffolding hire', 1000, null, 45]] })
  await report(123, { scene: 'plinth', progress: 85, workers: 11, summary: 'Plinth beams cast and curing. Brickwork for the plinth wall is underway.', materials: [['M-01', 45], ['M-03', 8000]] })
  await approve(123, p7)
  await inspect(121, 1, 'DPC and plinth slab', 'PASS', 'Bitumen coat continuous; no gaps at the corners.')
  // Days 120–117: foundation stage complete, verified on site, milestone paid.
  const r120 = await report(120, { scene: 'plinth', progress: 100, complete: true, workers: 8, summary: 'DPC (2-inch PCC with bitumen) laid over the plinth. Foundation stage complete.', materials: [['M-01', 30]], hour: 19 })
  await verifyReport(119, r120, 'plinth')
  await milestonePayment('Foundation and plinth complete', 119, 118, 117, 1800000, 'MILESTONE', 'TRF-50612')

  // --------------------------------------------------------- Ground floor
  // Days 116–106: columns; cement and steel bought; a partial inspection
  // (column C3 cover) and its passing re-check; bricks bought and verified.
  const p8 = await purchase(116, { supplier: 'Al-Noor Cement Traders', invoice: 'ANC-2398', lines: [['M-01', 'OPC cement, 50 kg bag', 260, null, 1460]] })
  await report(115, { scene: 'columns', progress: 15, workers: 10, summary: 'Column steel for all 20 ground floor columns tied; cover blocks fixed.', materials: [['M-02', 1100]] })
  await approve(115, p8)
  const p9 = await purchase(114, { supplier: 'Punjab Steel House', invoice: 'PSH-0988', lines: [['M-02', 'Steel bars, Grade 60', 2800, null, 272]] })
  await verify(114, p8, 'cement')
  await approve(113, p9)
  await pay(110, { type: 'ADVANCE', amount: 2000000, reference: 'TRF-50703' })
  await report(110, { scene: 'columns', progress: 35, workers: 12, summary: 'Columns cast up to 10 feet in two lifts. Curing is on.', materials: [['M-01', 50], ['M-05', 150]] })
  await inspect(109, 2, 'Columns', 'PARTIAL', 'Column C3 had less than 25 mm cover on one face. The contractor added cover blocks; re-check after the next lift.')
  const p10 = await purchase(108, { supplier: 'Ghazi Bricks Kiln', invoice: 'GBK-640', lines: [['M-03', 'Bricks, A-class', 25000, null, 16.8]] })
  await approve(107, p10)
  await inspect(106, 2, 'Columns', 'PASS', 'Re-checked C3. Cover is fine now.')
  await verify(106, p10, 'bricks')
  // Days 104–96: brick walls rise; sand and crush bought.
  await report(104, { scene: 'brickwork', progress: 50, workers: 14, summary: 'Brick walls started on the front and west sides. About 9,000 bricks laid this week.', materials: [['M-03', 9000], ['M-01', 30], ['M-04', 90]] })
  const p11 = await purchase(100, { supplier: 'Ravi Sand & Crush Supply', invoice: 'RSC-164', lines: [['M-04', 'Sand, Chenab', 700, null, 110], ['M-05', 'Crush, 3/4 inch', 400, null, 160]] })
  await approve(99, p11)
  await report(96, { scene: 'brickwork', progress: 65, workers: 14, summary: 'External walls at lintel level. Lintel steel placed over the main door and windows.', materials: [['M-03', 14000], ['M-01', 40]] })
  // Days 95–93: change request C-1 (water tank) proposed and approved by the owner.
  const cr1 = await as(contractor, pid, when(95, 15), (qq, ctx) =>
    createChange(qq, ctx, { title: 'Underground water tank, 2,000 gallons', description: 'Build an RCC underground water tank under the car porch, with a manhole cover and a connection for the pump.', reason: 'The owner asked for water storage because of low pressure in the area. The approved plan does not include one.', costImpactPaisa: 45000000, daysImpact: 7 }),
  )
  await as(owner, pid, when(93, 21), (qq, ctx) => decide(qq, ctx, { targetType: 'CHANGE', targetId: cr1.id, decision: 'APPROVE' }))
  // Days 92–74: transport, more bricks, walls done, ground floor labour bill.
  const p12 = await purchase(92, { type: 'TRANSPORT', supplier: 'Qadir Goods Transport', slip: true, lines: [[null, 'Tractor trolley trips, sand and bricks', 6, 'trip', 3500]] })
  await approve(91, p12)
  await report(88, { scene: 'brickwork', progress: 80, workers: 13, summary: 'Internal walls of the bedrooms and kitchen done. Electrical conduit routes marked before plaster.', materials: [['M-03', 15000], ['M-01', 40], ['M-04', 140]] })
  const p13 = await purchase(85, { supplier: 'Ghazi Bricks Kiln', invoice: 'GBK-702', lines: [['M-03', 'Bricks, A-class', 18000, null, 17]] })
  await approve(84, p13)
  await report(78, { scene: 'slab', progress: 86, workers: 10, summary: 'All ground floor walls complete. Shuttering for the roof slab started from the back.', materials: [['M-01', 10]] })
  const p14 = await purchase(75, { type: 'LABOUR', supplier: 'Imran Builders', invoice: 'IB-002', fromAdvance: false, lines: [['L-01', 'Grey structure labour, ground floor', 1476, null, 450]] })
  await approve(74, p14)
  // Days 72–63: advance paid; slab steel tied; cement, steel and shuttering
  // bought for the slab; slab inspection passes.
  await pay(72, { type: 'ADVANCE', amount: 1000000, reference: 'TRF-50980' })
  await report(70, { scene: 'slab', progress: 92, workers: 12, summary: 'Slab steel tied: main bars 1/2 inch at 6-inch spacing. Electrical boxes fixed in the slab.', materials: [['M-02', 1300]] })
  const p15 = await purchase(68, { supplier: 'Al-Noor Cement Traders', invoice: 'ANC-2510', lines: [['M-01', 'OPC cement, 50 kg bag', 140, null, 1470]] })
  await approve(67, p15)
  const p16 = await purchase(66, { supplier: 'Punjab Steel House', invoice: 'PSH-1043', lines: [['M-02', 'Steel bars, Grade 60', 1600, null, 270]] })
  await approve(65, p16)
  const p17 = await purchase(64, { type: 'EQUIPMENT', supplier: 'Hafiz Shuttering Service', invoice: 'HSS-58', lines: [['E-01', 'Shuttering and scaffolding hire', 1476, null, 45]] })
  await inspect(63, 2, 'Slab casting', 'PASS', 'Steel spacing and chairs checked before casting. Six cube samples taken.')
  await approve(63, p17)
  // Days 62–58: slab cast (stage complete), verified, milestone paid.
  const r62 = await report(62, { scene: 'curing', progress: 100, complete: true, workers: 18, summary: 'Ground floor slab cast in one day with a mixer and 18 workers. Curing with water ponds.', materials: [['M-01', 120], ['M-04', 260], ['M-05', 280]], hour: 20 })
  await verifyReport(61, r62, 'curing')
  await milestonePayment('Ground floor slab complete', 61, 60, 58, 2200000, 'MILESTONE', 'TRF-51122')

  // ---------------------------------------------------------- First floor
  // Days 52–43: first floor columns; bricks and cement bought.
  await report(52, { scene: 'columns-upper', progress: 12, workers: 9, summary: 'Started the first floor columns. Steel for all 20 columns tied.', materials: [['M-02', 900]] })
  const p18 = await purchase(50, { supplier: 'Ghazi Bricks Kiln', invoice: 'GBK-911', lines: [['M-03', 'Bricks, A-class', 15000, null, 17.2]] })
  await approve(49, p18)
  await verify(48, p18, 'bricks')
  await report(45, { scene: 'columns-upper', progress: 28, workers: 10, summary: 'Half the columns cast. Waiting for steel for the rest.', materials: [['M-01', 40], ['M-02', 600]] })
  const p19 = await purchase(44, { supplier: 'Al-Noor Cement Traders', invoice: 'ANC-2655', lines: [['M-01', 'OPC cement, 50 kg bag', 120, null, 1490]] })
  await approve(43, p19)
  await pay(40, { type: 'ADVANCE', amount: 800000, reference: 'TRF-51340' })
  // Days 40–39: the owner asks about Sunday work, the contractor answers, the owner resolves it.
  const q1 = await as(owner, pid, when(40, 20), (qq, ctx) =>
    createQuestion(qq, ctx, { title: 'Why were six workers on site on Sunday?', body: 'Bilal saw six workers on Sunday. Was it planned overtime? I want to understand the labour bill.' }),
  )
  await as(contractor, pid, when(40, 22), (qq, ctx) => replyToQuestion(qq, ctx, q1.id, 'The slab needs water every day, including Sunday. Two workers were curing and four were cleaning the shuttering for reuse. No overtime is charged.'))
  await as(owner, pid, when(39, 9), (qq, ctx) => resolveQuestion(qq, ctx, q1.id))
  // Days 38–37: columns cast; a partial inspection (out of plumb).
  await report(38, { scene: 'columns-upper', progress: 40, workers: 11, summary: 'All first floor columns cast and curing.', materials: [['M-01', 35], ['M-05', 120]] })
  await inspect(37, 3, 'Columns', 'PARTIAL', 'Two columns on the east side are 8 mm out of plumb. Acceptable, but the brickwork must follow the true line. Re-check when walls reach lintel level.')
  // Days 30–29: an early electrical purchase, rejected by the owner.
  const p20 = await purchase(30, { supplier: 'City Electric Store', invoice: 'CES-77', lines: [[null, 'PVC conduit pipe, 3/4 inch', 200, 'piece', 180]] })
  await as(owner, pid, when(29, 21), (qq, ctx) => decide(qq, ctx, { targetType: 'EXPENSE', targetId: p20.id, decision: 'REJECT', note: 'Electrical work starts at finishing. Please return these and get a credit note.' }))
  // Days 26–14: rain delay; sand bought; brickwork report with a shortage.
  await report(26, { scene: 'brickwork-upper', progress: 41, workers: 7, weather: 'Rain', summary: 'Rain stopped work for three days. Started brickwork on the back wall.', issues: 'Rain on three days this week; the site was closed.', materials: [['M-03', 4000], ['M-01', 15]] })
  const p21 = await purchase(21, { supplier: 'Ravi Sand & Crush Supply', invoice: 'RSC-207', lines: [['M-04', 'Sand, Chenab', 500, null, 112]] })
  await approve(20, p21)
  const r14 = await report(14, { scene: 'brickwork-upper', progress: 43, workers: 8, summary: 'Back and west walls up to 3 feet. Short of bricks; the next delivery is due.', issues: 'Bricks running short.', materials: [['M-03', 6000], ['M-01', 20]] })
  // Days 10–9: the rep asks for a curing photo on that report; the contractor replies (left ANSWERED).
  const rq = await as(rep, pid, when(10, 18), (qq, ctx) =>
    createQuestion(qq, ctx, { title: 'Photo of column curing, please', body: 'Can you share a photo of the curing on the first floor columns? I could not visit this week.', targetType: 'REPORT', targetId: r14.id }),
  )
  await as(contractor, pid, when(9, 11), (qq, ctx) => replyToQuestion(qq, ctx, rq.id, 'Columns are wrapped in wet hessian and watered three times a day. I have added photos in the next report.'))
  // Days 9–7: a sand purchase reusing invoice RSC-118 (the rules flag a
  // duplicate); the owner queries it, which opens a question; the contractor answers.
  const p22 = await purchase(9, { supplier: 'Ravi Sand & Crush Supply', invoice: 'RSC-118', lines: [['M-04', 'Sand, Chenab', 400, null, 112]] })
  await as(owner, pid, when(8, 21), (qq, ctx) => decide(qq, ctx, { targetType: 'EXPENSE', targetId: p22.id, decision: 'QUERY', note: 'Invoice RSC-118 was already used on purchase P-4 in June. Is this a new delivery? Please share the new slip.' }))
  // Find the question the QUERY decision created (`[qq22]` = first row).
  const [qq22] = await q("SELECT id FROM questions WHERE target_type = 'EXPENSE' AND target_id = $1", [p22.id])
  await as(contractor, pid, when(7, 10), (qq, ctx) => replyToQuestion(qq, ctx, qq22.id, "Yes, it's a new delivery of 400 cft. The supplier reused an old bill book number. I've asked him for a fresh slip and will attach it."))
  // Days 6–5: brickwork resumes; change request C-2 (higher ceiling) left waiting.
  await report(6, { scene: 'brickwork-upper', progress: 45, workers: 10, summary: 'Front wall brickwork resumed with new bricks. Window frame positions marked.', materials: [['M-03', 7000], ['M-01', 18]] })
  await as(contractor, pid, when(5, 16), (qq, ctx) =>
    createChange(qq, ctx, { title: 'Raise the first floor ceiling by 1 foot', description: 'Increase the first floor floor-to-ceiling height from 10 ft to 11 ft for better ventilation. Needs extra brickwork and taller column shuttering.', reason: 'The owner asked about higher ceilings during the last site visit.', costImpactPaisa: 22000000, daysImpact: 5 }),
  )
  // The delivery photo was taken at the supplier's yard, not the site: flagged for the owner.
  await purchase(4, { supplier: 'Punjab Steel House', invoice: 'PSH-1180', lines: [['M-02', 'Steel bars, Grade 60', 2000, null, 312]], deliveredAt: STEEL_YARD })
  // Day 2: the inspector asks the owner to share photos (left pending).
  await as(inspector, pid, when(2, 17), (qq, ctx) =>
    requestAccess(qq, ctx, { scope: 'PHOTOS', reason: 'I want to compare the column photos before re-checking the east columns.' }),
  )
  // Days 2–0: purchases still waiting for approval, a loose photo from this
  // morning, and a draft purchase (`submit: false`).
  await purchase(2, { supplier: 'Ghazi Bricks Kiln', invoice: 'GBK-1043', lines: [['M-03', 'Bricks, A-class', 16000, null, 17.5]] })
  await purchase(1, { type: 'TRANSPORT', supplier: 'Qadir Goods Transport', slip: true, lines: [[null, 'Tractor trolley trips, bricks', 3, 'trip', 3500]] })
  await as(contractor, pid, when(0, 8, 40), (qq, ctx) => upload(qq, ctx, 'PHOTO', art.sitePhoto({ scene: 'brickwork-upper', when: stampOf(ctx.at), seed: 'today' }), { caption: 'Front wall this morning' }))
  await purchase(0, { supplier: 'Al-Noor Cement Traders', invoice: 'ANC-2790', submit: false, hour: 9, lines: [['M-01', 'OPC cement, 50 kg bag', 150, null, 1480]] })

  // ------------------------------------------------ A second, smaller project
  // Self-managed on a custom 30 × 60 ft plot: the owner buys and reports herself,
  // so purchases are final when saved and there are no inspections.
  const { id: pid2 } = await tx((qq) =>
    createProject(qq, { userId: owner.id, userName: owner.name, at: when(42, 20) }, {
      name: "Parents' house, Gulshan-e-Iqbal", address: 'Block 13-D', city: 'Karachi', plotSize: 'CUSTOM', plotWidthFt: 30, plotDepthFt: 60,
      floors: 1, contractType: 'SELF_MANAGED', budgetPaisa: 550000000, startDate: dateAgo(40), drawingsApproved: true,
      siteLat: KARACHI.lat, siteLng: KARACHI.lng,
    }),
  )
  // BOQ lookup by code for the second project.
  const boq2 = Object.fromEntries((await q('SELECT id, code, unit FROM boq_items WHERE project_id = $1', [pid2])).map((b) => [b.code, b]))
  // Helper: the owner files a report with one Karachi site photo.
  const selfReport = (day, to, summary, scene) =>
    as(owner, pid2, when(day, 18), async (qq, ctx) => {
      const ev = await upload(qq, ctx, 'PHOTO', art.sitePhoto({ scene, when: stampOf(ctx.at), seed: `k-${day}`, where: printed(KARACHI) }))
      return createReport(qq, ctx, { reportDate: dateAgo(day), summary, progressAfter: to, workerCount: 6, evidenceIds: [ev.id] })
    })
  // Helper: the owner records a one-line material purchase with receipt and delivery photo.
  const selfPurchase = (day, { supplier, invoice, code, description, qty, unit, rate, material }) =>
    as(owner, pid2, when(day, 12), async (qq, ctx) => {
      const r1 = await upload(qq, ctx, 'RECEIPT', art.receipt({ supplier, address: 'Gulshan-e-Iqbal, Karachi', invoice, date: dateAgo(day), lines: [{ description, qty, rate }] }))
      const r2 = await upload(qq, ctx, 'DELIVERY_PHOTO', art.deliveryPhoto({ material, quantity: `${qty.toLocaleString('en-PK')} ${unit}`, when: stampOf(ctx.at), where: printed(KARACHI) }))
      return createExpense(qq, ctx, {
        type: 'MATERIAL', supplierName: supplier, invoiceNumber: invoice, purchaseDate: dateAgo(day),
        lines: [{ boqItemId: boq2[code].id, description, qty, unit, unitPaisa: rate * 100 }], evidenceIds: [r1.id, r2.id], submit: true,
      })
    })
  // The Karachi timeline: excavation, cement, bricks, footings and plinth.
  await selfReport(36, 15, 'Excavation complete for the strip foundation.', 'excavation')
  await selfPurchase(30, { supplier: 'Karachi Cement Depot', invoice: 'KCD-411', code: 'M-01', description: 'OPC cement, 50 kg bag', qty: 120, unit: 'bag', rate: 1500, material: 'cement' })
  await selfPurchase(27, { supplier: 'Saeed Bricks, Malir', invoice: 'SBM-88', code: 'M-03', description: 'Bricks, A-class', qty: 9000, unit: 'brick', rate: 18, material: 'bricks' })
  await selfReport(20, 60, 'Footings and plinth beams cast. Backfill in progress.', 'plinth')

  // Older notifications have been seen.
  // Mark notifications older than 3 days as read two hours after creation
  // (`interval '2 hours'` is a PostgreSQL time span added to a timestamp).
  await q("UPDATE notifications SET read_at = created_at + interval '2 hours' WHERE created_at < $1", [when(3, 0)])
  log.info('demo data ready')
}
