// Every project-scoped API route. The pattern throughout: a zod schema
// validates shape and ranges (with messages written for the form), an
// allow() guard checks the role's permission, and a service does the work
// inside run()'s transaction. Routes stay thin on purpose: the services are
// also driven directly by the demo seed, so the rules that matter live
// there, not here. Mounted under /api by app.js; everything past
// /projects/:projectId goes through loadProject first.
//
// Reading a typical line:
//   p.post('/x', allow('perm'), async (req, res) => {...})
//   - p.post: handle HTTP POST requests to /api/projects/:projectId/x
//   - allow('perm'): middleware; 403 unless the caller's role has 'perm'
//   - body(schema, req): validate req.body with a zod schema (400 if invalid)
//   - run(req, (tx, ctx) => service(tx, ctx, input)): call a service inside
//     one database transaction; tx is the transaction's query function and
//     ctx describes who is acting on which project (see routes/context.js)
//   - res.json(x) sends JSON; res.status(201) = Created; 204 = No Content.
// Depends on express, multer (file uploads), zod, the shared/*.js rule
// files, audit, auth middleware, config, db, lib/errors, every service in
// services/ and routes/context.js.

import { Router } from 'express' // route-group factory
import multer from 'multer' // multipart/form-data (file upload) parser
import { z } from 'zod' // schema builder for input validation
// Money limits, in paisa (1 rupee = 100 paisa), shared with the client.
import { MAX_AMOUNT_PAISA, MAX_BUDGET_PAISA, MIN_BUDGET_PAISA } from '../../../shared/budget.js'
// Roles that may be invited to a project.
import { INVITE_ROLES } from '../../../shared/features.js'
// House/plot rules: floor limit, plot size limits and names, plot validation.
import { MAX_FLOORS, PLOT_LIMITS, PLOT_SIZES, plotErrors } from '../../../shared/houseConfig.js'
// Allowed inspector access durations and scopes.
import { ACCESS_DAYS, ACCESS_SCOPES } from '../../../shared/permissions.js'
// A multi-line named import: one name per line inside the braces is the
// same as listing them on one line. These are lists/objects of allowed values.
import {
  CAPTURE_MODES,
  CONTRACT_TYPE_KEYS,
  DOCUMENT_CATEGORIES,
  EVIDENCE_KINDS,
  EXPENSE_STATUSES,
  EXPENSE_TYPES,
  PAYMENT_METHODS,
  PAYMENT_TYPES,
} from '../../../shared/records.js'
import { verifyChain } from '../audit/audit.js' // re-checks the audit hash chain
import { allow, loadProject, requireUser } from '../auth/middleware.js' // guards
import { config } from '../config.js' // maxUploadBytes
import { q } from '../db/index.js' // non-transaction query function
import { badRequest, forbidden } from '../lib/errors.js' // 400 and 403 builders
// `import * as access from '...'` is a namespace import: every export of the
// module becomes a property of one object, used as access.requestAccess(...).
import * as access from '../services/access.js'
import * as boq from '../services/boq.js' // bill of quantities (materials)
import * as changes from '../services/changes.js' // change requests
import * as dashboard from '../services/dashboard.js' // overview/today/approvals
import { decide } from '../services/decisions.js' // approve/reject/query/verify
import * as documents from '../services/documents.js' // project documents
// Evidence (uploaded files): permission check, disk path, lookup, save.
import { canViewEvidence, filePath, getEvidence, saveEvidence } from '../services/evidence.js'
import * as expenses from '../services/expenses.js' // purchases and findings
import { listHistory } from '../services/history.js' // readable audit history
import * as payments from '../services/payments.js' // payments and milestones
import * as plan from '../services/plan.js' // stage plan and inspections
import * as projects from '../services/projects.js' // projects, members, invitations
import * as questions from '../services/questions.js' // question threads
import * as reports from '../services/reports.js' // daily site reports
// Request helpers: body/query validation, ctx builder and transaction runner.
import { body, ctxFrom, query, run } from './context.js'

// The exported router that app.js mounts under /api.
export const projectRoutes = Router()
// Every route in this file requires a signed-in user.
projectRoutes.use(requireUser)

// ---------- Shared field rules ----------
// Reusable zod building blocks for the schemas below.
// keys(o): a schema that only accepts one of object o's property names.
const keys = (o) => z.enum(Object.keys(o))
// text(max): optional-length trimmed string up to `max` characters (default 200).
const text = (max = 200) => z.string().trim().max(max)
// required(label, max): non-empty string; the error message is built with a
// template literal, e.g. "Name is required".
const required = (label, max = 200) => z.string().trim().min(1, `${label} is required`).max(max)
/** A real calendar date, YYYY-MM-DD (2026-02-30 is refused, not passed to the database). */
// .regex(/^\d{4}-\d{2}-\d{2}$/): regex literal; ^ start, \d{4} four digits,
// '-' literal dashes, $ end. .refine(fn, msg) adds a custom check: parse the
// date at midnight UTC and confirm it formats back to the same text (an
// impossible date like Feb 30 rolls over to March and fails).
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, 'Choose a real date')
// Money amount: a whole number (.int()) of paisa from 0 up to the maximum.
const paisa = z.number().int().min(0).max(MAX_AMOUNT_PAISA, 'That amount is too large')
// A record id: trimmed string of 1 to 80 characters.
const id = z.string().trim().min(1).max(80)
// An optional list of up to 30 ids (used for attached evidence).
const ids = z.array(id).max(30).optional()
// A project budget: paisa, with tighter min/max and friendlier messages.
const budget = paisa.min(MIN_BUDGET_PAISA, 'Enter a budget of at least Rs 1 lakh').max(MAX_BUDGET_PAISA, 'That budget looks too large')
/** Retry key from the contractor's outbox. */
// Regex: 8 to 80 characters from the class [A-Za-z0-9_:-] (letters, digits,
// underscore, colon, dash).
const clientId = z.string().trim().regex(/^[A-Za-z0-9_:-]{8,80}$/, 'Invalid client id').optional()
/** Multipart fields arrive as strings; a blank one means "not given", never 0. */
// z.preprocess(fn, schema) transforms the raw value before validating it.
// `v == null` (loose equality) is true for both null and undefined.
// Empty/missing → undefined; anything else → Number(v).
const formNumber = (schema) => z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), schema.optional())
// Valid GPS ranges in degrees.
const latitude = z.number().min(-90).max(90)
const longitude = z.number().min(-180).max(180)

// ---------- Projects ----------
// GET /projects: list the caller's projects (no transaction needed, so plain q).
projectRoutes.get('/projects', async (req, res) => res.json(await projects.listProjects(q, req.user.id)))

// POST /projects: create a project.
projectRoutes.post('/projects', async (req, res) => {
  // body(schema, req) with a long schema spread over many lines.
  const input = body(
    // z.object({...}) describes the expected fields; method calls continue
    // on the following lines (a line starting with `.` continues the chain).
    z
      .object({
        name: required('Name', 80), // required, up to 80 characters
        address: text(200).optional(), // may be left out
        city: required('City', 60),
        plotSize: z.enum(PLOT_SIZES), // one of the named plot sizes (e.g. 'CUSTOM')
        // Custom width in feet; limits come from PLOT_LIMITS.width, an array
        // [min, max] read with [0] and [1]; messages use template literals.
        plotWidthFt: z
          .number()
          .min(PLOT_LIMITS.width[0], `Width must be at least ${PLOT_LIMITS.width[0]} ft`)
          .max(PLOT_LIMITS.width[1], `Width can be up to ${PLOT_LIMITS.width[1]} ft`)
          .optional(),
        // Same idea for the depth.
        plotDepthFt: z
          .number()
          .min(PLOT_LIMITS.depth[0], `Depth must be at least ${PLOT_LIMITS.depth[0]} ft`)
          .max(PLOT_LIMITS.depth[1], `Depth can be up to ${PLOT_LIMITS.depth[1]} ft`)
          .optional(),
        floors: z.number().int().min(1).max(MAX_FLOORS), // whole number of floors
        contractType: z.enum(CONTRACT_TYPE_KEYS),
        budgetPaisa: budget, // reuse the budget rule above
        startDate: date.optional(),
        plannedEndDate: date.optional(),
        drawingsApproved: z.boolean().optional(), // true/false
        siteLat: latitude.optional(),
        siteLng: longitude.optional(),
      })
      // .superRefine((value, ctx) => {...}) runs cross-field checks after the
      // basic ones; ctx.addIssue reports an error attached to a field `path`.
      .superRefine((v, ctx) => {
        // Custom plot: validate width/depth with the shared plotErrors rules.
        if (v.plotSize === 'CUSTOM') {
          // plotErrors returns { widthFt?: message, depthFt?: message };
          // loop over its [field, message] pairs.
          for (const [field, message] of Object.entries(plotErrors({ widthFt: v.plotWidthFt, depthFt: v.plotDepthFt }))) {
            // Map the shared field name to this form's field name with a ternary.
            ctx.addIssue({ code: 'custom', path: [field === 'widthFt' ? 'plotWidthFt' : 'plotDepthFt'], message })
          }
        }
        // Exactly one of lat/lng given? (`== null` → missing; `!==` between two
        // booleans = "they differ".)
        if ((v.siteLat == null) !== (v.siteLng == null)) ctx.addIssue({ code: 'custom', path: ['siteLat'], message: 'Give both latitude and longitude' })
        // 'YYYY-MM-DD' strings compare correctly with `<` as text.
        if (v.startDate && v.plannedEndDate && v.plannedEndDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['plannedEndDate'], message: 'The finish date is before the start' })
      }),
    req,
  )
  // Create inside a transaction and answer 201 Created with the new project.
  res.status(201).json(await run(req, (tx, ctx) => projects.createProject(tx, ctx, input)))
})

// Sub-router for one project. loadProject 404s non-members and 409s writes
// to an archived project, so handlers below can trust req.project/req.can.
// mergeParams: true lets this sub-router see :projectId from the parent path.
const p = Router({ mergeParams: true })
// Everything under /projects/:projectId runs loadProject, then the `p` routes.
projectRoutes.use('/projects/:projectId', loadProject, p)

// GET /projects/:projectId — the project itself.
p.get('/', async (req, res) => res.json(await run(req, (tx, ctx) => projects.getProject(tx, ctx))))

// Writes that return the project re-read it in a second transaction, so the
// response reflects what was committed (and what this role may see).
// PATCH = partial update.
p.patch('/', allow('manageProject'), async (req, res) => {
  const input = body(
    // .nullable() allows null (to clear a date); .partial() makes every field optional.
    z.object({
      name: required('Name', 80),
      address: text(200),
      city: required('City', 60),
      budgetPaisa: budget,
      startDate: date.nullable(),
      plannedEndDate: date.nullable(),
    }).partial(),
    req,
  )
  // First transaction: apply the update.
  await run(req, (tx, ctx) => projects.updateProject(tx, ctx, input))
  // Second transaction: read it back and send it.
  res.json(await run(req, (tx, ctx) => projects.getProject(tx, ctx)))
})

// POST /archive: make the project read-only.
p.post('/archive', allow('manageProject'), async (req, res) => {
  await run(req, (tx, ctx) => projects.archiveProject(tx, ctx))
  res.status(204).end() // success, no body
})

// PATCH /progress: current stage and its percentage (0–100).
p.patch('/progress', allow('updateProgress'), async (req, res) => {
  const input = body(z.object({ stageIndex: z.number().int().min(0), stageProgress: z.number().int().min(0).max(100), note: text(300).optional() }), req)
  await run(req, (tx, ctx) => projects.updateProgress(tx, ctx, input))
  res.json(await run(req, (tx, ctx) => projects.getProject(tx, ctx)))
})

// ---------- Site pin ----------
// PUT /site: set the site's GPS location; source says how it was obtained.
p.put('/site', allow('setSitePin'), async (req, res) => {
  const input = body(z.object({ lat: latitude, lng: longitude, accuracyM: z.number().min(0).max(100000).optional(), source: z.enum(['DEVICE', 'LINK', 'MANUAL']) }), req)
  await run(req, (tx, ctx) => projects.setSitePin(tx, ctx, input))
  res.json(await run(req, (tx, ctx) => projects.getProject(tx, ctx)))
})
// DELETE /site: remove the pin.
p.delete('/site', allow('setSitePin'), async (req, res) => {
  await run(req, (tx, ctx) => projects.clearSitePin(tx, ctx))
  res.json(await run(req, (tx, ctx) => projects.getProject(tx, ctx)))
})

// Dashboard reads: overview (anyone in the project), today's work, pending approvals.
p.get('/overview', async (req, res) => res.json(await run(req, (tx, ctx) => dashboard.getOverview(tx, ctx))))
p.get('/today', allow('submitReport'), async (req, res) => res.json(await run(req, (tx, ctx) => dashboard.getToday(tx, ctx))))
p.get('/approvals', allow('decide'), async (req, res) => res.json(await run(req, (tx, ctx) => dashboard.getApprovals(tx, ctx))))

// ---------- Members ----------
// List open invitations for this project.
p.get('/invitations', allow('manageProject'), async (req, res) => res.json(await projects.listInvitations(q, req.project.id)))
// Invite someone by email with one of the invitable roles.
p.post('/invitations', allow('manageProject'), async (req, res) => {
  const input = body(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address'), role: z.enum(INVITE_ROLES) }), req)
  res.status(201).json(await run(req, (tx, ctx) => projects.inviteMember(tx, ctx, input)))
})
// Revoke an invitation; `:id` arrives as req.params.id.
p.delete('/invitations/:id', allow('manageProject'), async (req, res) => {
  await run(req, (tx, ctx) => projects.revokeInvitation(tx, ctx, req.params.id))
  res.status(204).end()
})
// Remove a member from the project.
p.delete('/members/:userId', allow('manageProject'), async (req, res) => {
  await run(req, (tx, ctx) => projects.removeMember(tx, ctx, req.params.userId))
  res.status(204).end()
})

// ---------- Inspector access requests ----------
// allow(a, b): either permission is enough (owner decides, inspector requests).
p.get('/access-requests', allow('decideAccess', 'requestAccess'), async (req, res) => res.json(await run(req, (tx, ctx) => access.listAccessRequests(tx, ctx))))
// An inspector asks for a scope (one of ACCESS_SCOPES' keys).
p.post('/access-requests', allow('requestAccess'), async (req, res) => {
  const input = body(z.object({ scope: keys(ACCESS_SCOPES), reason: text(300).optional() }), req)
  res.status(201).json(await run(req, (tx, ctx) => access.requestAccess(tx, ctx, input)))
})
// The owner approves or denies; `days` must be one of ACCESS_DAYS (checked with .refine).
p.post('/access-requests/:id/decide', allow('decideAccess'), async (req, res) => {
  const input = body(
    z.object({ decision: z.enum(['APPROVE', 'DENY']), days: z.number().int().refine((d) => ACCESS_DAYS.includes(d), 'Choose 1, 7 or 30 days').optional(), note: text(300).optional() }),
    req,
  )
  res.json(await run(req, (tx, ctx) => access.decideAccess(tx, ctx, req.params.id, input)))
})
// The owner withdraws previously granted access.
p.post('/access-requests/:id/revoke', allow('decideAccess'), async (req, res) => {
  await run(req, (tx, ctx) => access.revokeAccess(tx, ctx, req.params.id))
  res.status(204).end()
})
// The inspector cancels their own request.
p.post('/access-requests/:id/cancel', allow('requestAccess'), async (req, res) => {
  await run(req, (tx, ctx) => access.cancelAccess(tx, ctx, req.params.id))
  res.status(204).end()
})

// ---------- Plan, inspections, milestones ----------
// The construction plan (stages, inspections, milestones).
p.get('/plan', async (req, res) => res.json(await run(req, (tx, ctx) => plan.getPlan(tx, ctx))))
// Record an inspection result for a stage step, with optional evidence.
p.post('/inspections', allow('recordInspection'), async (req, res) => {
  const input = body(z.object({ stageIndex: z.number().int().min(0), step: required('Step'), result: z.enum(['PASS', 'PARTIAL', 'FAIL']), notes: text(1000).optional(), inspectedOn: date, evidenceIds: ids }), req)
  res.status(201).json(await run(req, (tx, ctx) => plan.recordInspection(tx, ctx, input)))
})
// The contractor asks for a milestone payment.
p.post('/milestones/:id/request', allow('requestMilestone'), async (req, res) => {
  await run(req, (tx, ctx) => payments.requestMilestone(tx, ctx, req.params.id))
  res.status(204).end()
})

// ---------- Materials (BOQ) ----------
// One bill-of-quantities line: code, text fields, estimated quantity
// (1e9 = 1,000,000,000) and estimated unit price in paisa.
const boqItem = z.object({
  code: required('Code', 20),
  description: required('Description', 120),
  category: required('Category', 40),
  unit: required('Unit', 20),
  estQty: z.number().min(0).max(1e9),
  estUnitPaisa: paisa,
  phase: z.enum(['STRUCTURE', 'FINISHING']).optional(),
})
// List BOQ items.
p.get('/boq', allow('viewBoq'), async (req, res) => res.json(await run(req, (tx, ctx) => boq.listBoq(tx, ctx))))
// Add (or upsert = insert-or-update) an item; validation happens inline inside the arrow function.
p.post('/boq', allow('manageBoq'), async (req, res) => res.status(201).json(await run(req, (tx, ctx) => boq.upsertBoqItem(tx, ctx, body(boqItem, req)))))
// Edit an item: .omit({ code: true }) removes the code field (it can't
// change), .partial() makes the rest optional; the item id is the 4th argument.
p.patch('/boq/:id', allow('manageBoq'), async (req, res) => res.json(await run(req, (tx, ctx) => boq.upsertBoqItem(tx, ctx, body(boqItem.omit({ code: true }).partial(), req), req.params.id))))
// "Delete" an item by archiving it.
p.delete('/boq/:id', allow('manageBoq'), async (req, res) => {
  await run(req, (tx, ctx) => boq.archiveBoqItem(tx, ctx, req.params.id))
  res.status(204).end()
})
// Import many items from CSV text (up to 200,000 characters).
p.post('/boq/import', allow('manageBoq'), async (req, res) => {
  // Destructure the validated `csv` field.
  const { csv } = body(z.object({ csv: z.string().min(1).max(200000) }), req)
  res.json(await run(req, (tx, ctx) => boq.importBoqCsv(tx, ctx, csv)))
})

// ---------- Evidence ----------
// Files are buffered in memory (10 MB cap) so the service can hash and sniff
// them before anything touches disk. Upload is the one multipart route; the
// metadata fields arrive as strings, hence formNumber above.
// multer({...}) builds an upload middleware: keep the file in memory, at most
// one file of maxUploadBytes, at most 12 text fields of up to 1024 bytes each.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 12, fieldSize: 1024 } })

// Replays (same clientId from the outbox) answer 200 instead of 201 so the
// client knows nothing new was created.
// upload.single('file') reads one file from the form field named "file" into req.file.
p.post('/evidence', allow('uploadEvidence'), upload.single('file'), async (req, res) => {
  // No file in the request → 400.
  if (!req.file) throw badRequest('Choose a file to upload')
  // Validate the text fields that came with the upload. .datetime() requires
  // an ISO date-time string. `clientId,` is shorthand for clientId: clientId.
  // .parse(req.body) validates directly (throws ZodError on failure).
  const meta = z
    .object({
      kind: keys(EVIDENCE_KINDS),
      captureMode: z.enum(CAPTURE_MODES),
      capturedAt: z.string().datetime().optional(),
      clientSentAt: z.string().datetime().optional(),
      lat: formNumber(latitude),
      lng: formNumber(longitude),
      accuracyM: formNumber(z.number().min(0).max(100000)),
      clientId,
      caption: text(300).optional(),
    })
    .parse(req.body)
  // Save the file: pass its bytes (buffer), the original file name or
  // 'upload' as fallback (`||`), and spread `...meta` to include all metadata fields.
  const saved = await run(req, (tx, ctx) => saveEvidence(tx, ctx, { buffer: req.file.buffer, fileName: req.file.originalname || 'upload', ...meta }))
  // Re-read it; drop storageKey (internal disk name) with rest destructuring.
  const { storageKey, ...ev } = await getEvidence(q, req.project.id, saved.id)
  // 200 for a replay, 201 for a new upload.
  res.status(saved.replay ? 200 : 201).json(ev)
})

// No allow() here: who may open a file depends on what it is attached to,
// so canViewEvidence decides per file.
// GET /evidence/:id/file — download/view the stored file.
p.get('/evidence/:id/file', async (req, res) => {
  // Look up the evidence record in this project.
  const ev = await getEvidence(q, req.project.id, req.params.id)
  // Permission check per file; `!(await ...)` negates the awaited result.
  if (!(await canViewEvidence(q, ctxFrom(req), ev))) throw forbidden("You need the owner's permission to see this file")
  // Stream the file from disk with protective headers.
  res.sendFile(filePath(ev.storageKey), {
    headers: {
      // The stored MIME type (e.g. image/jpeg).
      'Content-Type': ev.mime,
      // Files are immutable (named by id, checked by hash) and never run as a page.
      // Browser may cache privately for one day (86400 seconds).
      'Cache-Control': 'private, max-age=86400, immutable',
      // CSP sandbox: if a file were opened as a page, no scripts/resources may run.
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      // Browser must trust Content-Type rather than guess.
      'X-Content-Type-Options': 'nosniff',
      // ?download=1 → "attachment" (save dialog), otherwise "inline" (show it).
      // encodeURIComponent makes the file name safe inside the header.
      'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(ev.fileName)}"`,
    },
  })
})

// ---------- Purchases ----------
// Schema for creating/updating a purchase (expense) with 1 to 30 item lines.
const expenseInput = z.object({
  type: keys(EXPENSE_TYPES),
  supplierName: required('Supplier or payee', 120),
  description: text(500).optional(),
  invoiceNumber: text(60).optional(),
  purchaseDate: date,
  fromAdvance: z.boolean().optional(), // paid from the contractor's advance?
  // z.array(itemSchema) = a list where each element must match itemSchema.
  lines: z
    .array(
      z.object({
        boqItemId: id.nullable().optional(), // optional link to a BOQ item
        description: required('Item', 120),
        qty: z.number().min(0.001, 'Quantity must be more than zero').max(1e9),
        unit: required('Unit', 20),
        unitPaisa: paisa,
      }),
    )
    .min(1, 'Add at least one item')
    .max(30),
  evidenceIds: ids,
  submit: z.boolean().optional(), // submit for approval right away?
  clientId,
})
// Someone who can't see the project's money (a site supervisor) still works with their own purchases.
// allow(...) returns a middleware; stored in a constant to reuse below.
const seesExpenses = allow('viewMoney', 'createExpense')
// GET /expenses with optional filters from the query string.
p.get('/expenses', seesExpenses, async (req, res) => {
  // query(schema, req) validates req.query instead of req.body.
  const filters = query(z.object({ status: z.enum(EXPENSE_STATUSES).optional(), type: keys(EXPENSE_TYPES).optional(), boqItemId: id.optional() }), req)
  res.json(await run(req, (tx, ctx) => expenses.listExpenses(tx, ctx, filters)))
})
// POST /expenses: create (or replay) a purchase.
p.post('/expenses', allow('createExpense'), async (req, res) => {
  const result = await run(req, (tx, ctx) => expenses.createExpense(tx, ctx, body(expenseInput, req)))
  res.status(result.replay ? 200 : 201).json(result)
})
// GET one purchase.
p.get('/expenses/:id', seesExpenses, async (req, res) => res.json(await run(req, (tx, ctx) => expenses.getExpense(tx, ctx, req.params.id))))
// PUT = full replacement of a draft purchase, then read it back.
p.put('/expenses/:id', allow('createExpense'), async (req, res) => {
  await run(req, (tx, ctx) => expenses.updateExpense(tx, ctx, req.params.id, body(expenseInput, req)))
  res.json(await run(req, (tx, ctx) => expenses.getExpense(tx, ctx, req.params.id)))
})
// Submit a draft for approval.
p.post('/expenses/:id/submit', allow('createExpense'), async (req, res) => {
  await run(req, (tx, ctx) => expenses.submitExpense(tx, ctx, req.params.id))
  res.json(await run(req, (tx, ctx) => expenses.getExpense(tx, ctx, req.params.id)))
})
// Automatic findings (e.g. price anomalies), optionally filtered by status.
p.get('/findings', allow('viewMoney'), async (req, res) => {
  const filters = query(z.object({ status: z.enum(['OPEN', 'DISMISSED']).optional() }), req)
  res.json(await run(req, (tx, ctx) => expenses.listFindings(tx, ctx, filters)))
})
// Dismiss a finding; a note is required.
p.post('/findings/:id/dismiss', allow('decide'), async (req, res) => {
  const { note } = body(z.object({ note: required('A note', 300) }), req)
  await run(req, (tx, ctx) => expenses.dismissFinding(tx, ctx, req.params.id, note))
  res.status(204).end()
})

// ---------- Decisions (approve / reject / query / verify) ----------
// Who may do what depends on the record and the decision, so the service decides.
p.post('/decisions', allow('decide', 'verify', 'raiseQuestion'), async (req, res) => {
  const input = body(
    z.object({
      targetType: z.enum(['EXPENSE', 'CHANGE', 'MILESTONE', 'REPORT']), // what kind of record
      targetId: id, // which record
      decision: z.enum(['APPROVE', 'REJECT', 'QUERY', 'VERIFY']),
      note: text(1000).optional(),
      evidenceId: id.optional(),
    }),
    req,
  )
  res.json(await run(req, (tx, ctx) => decide(tx, ctx, input)))
})

// ---------- Payments ----------
// List and read payments (money viewers only).
p.get('/payments', allow('viewMoney'), async (req, res) => res.json(await run(req, (tx, ctx) => payments.listPayments(tx, ctx))))
p.get('/payments/:id', allow('viewMoney'), async (req, res) => res.json(await run(req, (tx, ctx) => payments.getPayment(tx, ctx, req.params.id))))
// Record a payment.
p.post('/payments', allow('recordPayment'), async (req, res) => {
  const input = body(
    z.object({
      type: keys(PAYMENT_TYPES),
      method: keys(PAYMENT_METHODS),
      payeeUserId: id.nullable().optional(),
      payeeName: text(120).optional(),
      amountPaisa: paisa.min(100, 'Enter the amount'), // at least 100 paisa = Rs 1
      paidOn: date,
      reference: text(80).optional(),
      note: text(500).optional(),
      milestoneId: id.nullable().optional(),
      evidenceIds: ids,
    }),
    req,
  )
  res.status(201).json(await run(req, (tx, ctx) => payments.createPayment(tx, ctx, input)))
})
// The payee confirms they received it.
p.post('/payments/:id/confirm', allow('confirmPayment'), async (req, res) => {
  await run(req, (tx, ctx) => payments.confirmPayment(tx, ctx, req.params.id))
  res.status(204).end()
})

// ---------- Daily reports ----------
p.get('/reports', allow('viewReports'), async (req, res) => res.json(await run(req, (tx, ctx) => reports.listReports(tx, ctx))))
p.get('/reports/:id', allow('viewReports'), async (req, res) => res.json(await run(req, (tx, ctx) => reports.getReport(tx, ctx, req.params.id))))
// Submit a daily site report (at least one photo required).
p.post('/reports', allow('submitReport'), async (req, res) => {
  const input = body(
    z.object({
      reportDate: date,
      summary: required('Work done', 2000),
      issues: text(1000).optional(),
      workerCount: z.number().int().min(0).max(500).optional(),
      weather: text(30).optional(),
      progressAfter: z.number().int().min(0).max(100), // stage % after today's work
      stageCompleted: z.boolean().optional(),
      stageIndex: z.number().int().min(0).optional(),
      // Materials used: up to 20 { boqItemId, qty } objects; .positive() = greater than 0.
      materials: z.array(z.object({ boqItemId: id, qty: z.number().positive().max(1e9) })).max(20).optional(),
      evidenceIds: z.array(id).min(1, 'Add at least one photo').max(30),
      clientId,
    }),
    req,
  )
  const result = await run(req, (tx, ctx) => reports.createReport(tx, ctx, input))
  res.status(result.replay ? 200 : 201).json(result)
})

// ---------- Change requests ----------
p.get('/changes', allow('viewChanges'), async (req, res) => res.json(await run(req, (tx, ctx) => changes.listChanges(tx, ctx))))
p.get('/changes/:id', allow('viewChanges'), async (req, res) => res.json(await run(req, (tx, ctx) => changes.getChange(tx, ctx, req.params.id))))
// Propose a change; cost and day impacts may be negative (unary minus on -MAX_AMOUNT_PAISA).
p.post('/changes', allow('submitChange'), async (req, res) => {
  const input = body(
    z.object({
      title: required('Title', 120),
      description: required('Description', 2000),
      reason: text(1000).optional(),
      costImpactPaisa: z.number().int().min(-MAX_AMOUNT_PAISA).max(MAX_AMOUNT_PAISA),
      daysImpact: z.number().int().min(-365).max(365),
      evidenceIds: ids,
    }),
    req,
  )
  res.status(201).json(await run(req, (tx, ctx) => changes.createChange(tx, ctx, input)))
})
// Resubmit a change that was queried or rejected.
p.post('/changes/:id/resubmit', allow('submitChange'), async (req, res) => {
  await run(req, (tx, ctx) => changes.resubmitChange(tx, ctx, req.params.id))
  res.status(204).end()
})

// ---------- Questions ----------
p.get('/questions', allow('viewQuestions'), async (req, res) => {
  const filters = query(z.object({ status: z.enum(['OPEN', 'ANSWERED', 'RESOLVED']).optional() }), req)
  res.json(await run(req, (tx, ctx) => questions.listQuestions(tx, ctx, filters)))
})
p.get('/questions/:id', allow('viewQuestions'), async (req, res) => res.json(await run(req, (tx, ctx) => questions.getQuestion(tx, ctx, req.params.id))))
// Raise a question; .refine requires targetId whenever targetType is given
// (`!v.targetType || v.targetId`: no type, or an id is present).
p.post('/questions', allow('raiseQuestion'), async (req, res) => {
  const input = body(
    z.object({ title: required('Question', 160), body: required('Details', 2000), targetType: z.enum(['EXPENSE', 'PAYMENT', 'REPORT', 'CHANGE']).optional(), targetId: id.optional() }).refine((v) => !v.targetType || v.targetId, 'Say which record the question is about'),
    req,
  )
  res.status(201).json(await run(req, (tx, ctx) => questions.createQuestion(tx, ctx, input)))
})
// Reply in a thread. `{ body: message }` destructures with renaming: the
// field `body` is stored in a variable called `message` (avoids clashing
// with the body() helper).
p.post('/questions/:id/messages', allow('reply'), async (req, res) => {
  const { body: message } = body(z.object({ body: required('Message', 2000) }), req)
  await run(req, (tx, ctx) => questions.replyToQuestion(tx, ctx, req.params.id, message))
  res.json(await run(req, (tx, ctx) => questions.getQuestion(tx, ctx, req.params.id)))
})
// Mark a question resolved.
p.post('/questions/:id/resolve', allow('viewQuestions'), async (req, res) => {
  await run(req, (tx, ctx) => questions.resolveQuestion(tx, ctx, req.params.id))
  res.json(await run(req, (tx, ctx) => questions.getQuestion(tx, ctx, req.params.id)))
})

// ---------- Documents ----------
p.get('/documents', async (req, res) => res.json(await run(req, (tx, ctx) => documents.listDocuments(tx, ctx))))
// Register an uploaded evidence file as a titled project document.
p.post('/documents', allow('uploadDocument'), async (req, res) => {
  const input = body(z.object({ title: required('Title', 120), category: keys(DOCUMENT_CATEGORIES), evidenceId: id }), req)
  res.status(201).json(await run(req, (tx, ctx) => documents.createDocument(tx, ctx, input)))
})
// Archive (soft-delete) a document.
p.delete('/documents/:id', allow('manageProject'), async (req, res) => {
  await run(req, (tx, ctx) => documents.archiveDocument(tx, ctx, req.params.id))
  res.status(204).end()
})

// ---------- History (audit trail) ----------
// Paged history: z.coerce.number() converts the query-string text to a
// number before validating; `before` is the seq to page back from.
p.get('/audit', allow('viewAudit'), async (req, res) => {
  const filters = query(z.object({ before: z.coerce.number().int().positive().optional(), type: z.string().max(30).optional() }), req)
  res.json(await run(req, (tx, ctx) => listHistory(tx, ctx, filters)))
})
// Recompute the hash chain and report whether it is intact.
p.post('/audit/verify', allow('viewAudit'), async (req, res) => res.json(await verifyChain(q, req.project.id)))
