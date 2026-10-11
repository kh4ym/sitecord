// End-to-end smoke test against the demo data: signs in as each persona and
// calls every read endpoint, then exercises the write paths on throwaway
// projects that are archived at the end. Run with `npm run smoke`.
//
// What this file does: it starts the real Express app on a random port with a
// brand-new temporary database, loads the demo data, then acts like a browser
// for each role (owner, contractor, local rep, inspector) using `fetch`. Every
// expectation goes through `check(label, condition)`, which prints "ok" or
// "FAIL". The process exits with code 1 if any check failed, so CI can rely on it.
// Why it exists: one quick command proves the main flows and permission rules
// still work after a change.
// Depends on: src/app.js (the Express app), src/db (database), src/seed/demo.js
// (demo data), shared/houseConfig.js, and Node built-ins (crypto, fs, os, path).
// Uses Node 18+ globals: fetch, FormData, Blob.

// Named imports from Node's crypto module: random bytes and random UUID strings.
import { randomBytes, randomUUID } from 'node:crypto'
// Make a unique temporary folder / delete a folder.
import { mkdtempSync, rmSync } from 'node:fs'
// The operating system's temp directory path.
import { tmpdir } from 'node:os'
// Default import (no braces): the whole `path` module for joining file paths.
import path from 'node:path'
// How many build stages a house with N floors has.
import { stageCount } from '../../shared/houseConfig.js'

// A throwaway database and upload folder, so the local demo data is never touched.
// mkdtempSync creates e.g. /tmp/sitecord-smoke-abc123 and returns its path.
const scratch = mkdtempSync(path.join(tmpdir(), 'sitecord-smoke-'))
// Environment variables read by config.js: where the embedded database lives...
process.env.PGLITE_DIR = path.join(scratch, 'pglite')
// ...where uploads are stored...
process.env.UPLOAD_DIR = path.join(scratch, 'uploads')
// ...and enabling the demo sign-in endpoint.
process.env.DEMO_MODE = 'true'
// `delete obj.prop` removes a property: make sure no real PostgreSQL is used.
delete process.env.DATABASE_URL

// Dynamic imports (`await import(...)`) run only now, after the environment
// above is set, so config.js sees the new values. Each result is destructured.
const { buildApp } = await import('../src/app.js')
const { connect, close } = await import('../src/db/index.js')
const { migrate } = await import('../src/db/migrate.js')
const { seedDemo } = await import('../src/seed/demo.js')

await connect() // open the database
await migrate() // create tables
await seedDemo() // load demo data
// Start the HTTP server; port 0 asks the OS for any free port.
const server = buildApp().listen(0)
// Base URL of the API, using the port actually chosen.
const base = `http://localhost:${server.address().port}/api`
// Counters, changed by check(), so declared with `let`.
let failures = 0
let checks = 0

/** A file that passes the server's type check (PNG signature) with unique bytes. */
// Arrow function returning a Buffer (raw bytes): the 8-byte PNG header given
// as hex text, joined (`Buffer.concat`) with 64 random bytes.
const png = () => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)])

// Sign in as a demo role and return helper functions that send requests
// with that person's session cookie.
async function session(role) {
  // POST to the demo sign-in endpoint with a JSON body. `JSON.stringify`
  // turns an object into JSON text; `{ role }` is shorthand for { role: role }.
  const res = await fetch(`${base}/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })
  // Read the Set-Cookie header and keep only "name=value" (text before the
  // first ";"). `?.` skips the split if the header is missing.
  const cookie = res.headers.get('set-cookie')?.split(';')[0]
  // Generic request helper (an async arrow function). Note the inner `path`
  // parameter shadows (hides) the imported `path` module inside this function.
  const call = async (method, path, body) => {
    // Send the request; the body is only JSON-encoded when present.
    const r = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    // Read the response as text first.
    const text = await r.text()
    let data // declared without a value (undefined)
    // try/catch: try parsing JSON; if it throws, keep the raw text instead.
    // `catch { ... }` without "(err)" is allowed when the error isn't needed.
    try { data = JSON.parse(text) } catch { data = text }
    // Return the HTTP status code and the parsed body.
    return { status: r.status, data }
  }
  // Upload helper: project id, metadata fields, and the file bytes (default: a new fake PNG).
  const upload = async (pid, meta, bytes = png()) => {
    // FormData builds a multipart/form-data body like an HTML form.
    const form = new FormData()
    // `Object.entries(obj)` gives [key, value] pairs; add each non-null value as text.
    for (const [k, v] of Object.entries(meta)) if (v != null) form.append(k, String(v))
    // Add the file itself: a Blob (binary data with a MIME type) and a file name.
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'photo.png')
    // Send it; no content-type header here, fetch sets the multipart one itself.
    const r = await fetch(`${base}/projects/${pid}/evidence`, { method: 'POST', headers: { cookie }, body: form })
    // `await r.json()` parses the JSON response body.
    return { status: r.status, data: await r.json() }
  }
  // The session object: short helpers per HTTP method, the uploader, and the
  // signed-in user's details from the sign-in response.
  return {
    cookie,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    upload,
    user: await res.json(),
  }
}

// Record one check: print "ok" or "FAIL", the label and optional extra info.
// `extra = ''` is a default parameter value.
function check(label, cond, extra = '') {
  checks++ // `++` adds one
  // Nested template literal adds " — extra" only when extra is non-empty.
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}
// Request an evidence file as session `s` and return only the HTTP status code.
// The parentheses `(await fetch(...))` make the await finish before `.status`.
const fileStatus = async (s, pid, id) => (await fetch(`${base}/projects/${pid}/evidence/${id}/file`, { headers: { cookie: s.cookie } })).status

// ---------------------------------------------------------------- Owner reads
const owner = await session('OWNER') // sign in as the owner
// `?.` avoids a crash if user is missing.
check('owner signs in', owner.user?.name === 'Ayesha Khan')
const projects = await owner.get('/projects') // the owner's projects
// Two demo projects; extra text lists each with its waiting count.
check('owner sees two projects', projects.data.length === 2, projects.data.map((p) => `${p.name} (${p.waiting} waiting)`).join('; '))
// `.find` returns the first project matching the condition.
const lahore = projects.data.find((p) => p.city === 'Lahore')
const karachi = projects.data.find((p) => p.city === 'Karachi')
const pid = lahore.id // main test project id

// Call every read endpoint of the project and expect HTTP 200.
for (const path of ['', '/overview', '/plan', '/boq', '/expenses', '/approvals', '/payments', '/reports', '/questions', '/changes', '/documents', '/audit', '/findings', '/access-requests']) {
  const r = await owner.get(`/projects/${pid}${path}`)
  // `path || '/'` shows "/" for the empty path; on failure print the error body.
  check(`GET ${path || '/'}`, r.status === 200, r.status === 200 ? '' : JSON.stringify(r.data))
}
// Dashboard data and its money summary.
const overview = (await owner.get(`/projects/${pid}/overview`)).data
const money = overview.money
check('owner has things waiting', overview.waiting.length > 0, overview.waiting.map((w) => w.title).join(' | '))
// Budget arithmetic must add up: spent = approved + waiting, and
// left - over = budget - spent. Amounts are paisa, so /100 shows rupees.
check('budget summary adds up', money && money.spent === money.approved + money.waiting && money.left - money.over === money.budget - money.spent,
  `spent ${money?.spent / 100}, budget ${money?.budget / 100}, ${money?.usedPct}% used`)
// One entry per stage, and stage budgets sum to the total. `.reduce((n, s) =>
// n + s.budget, 0)` adds up all stage budgets starting from 0.
check('budget by stage covers the budget', money?.byStage.length === stageCount(lahore.floors) && money.byStage.reduce((n, s) => n + s.budget, 0) === money.budget)
check('approved changes shown beside the budget', money?.approvedChanges.count >= 1)
check('projects list carries the budget meter', lahore.money?.usedPct === money?.usedPct)
// Ask the server to re-check the audit hash chain.
const verify = await owner.post(`/projects/${pid}/audit/verify`)
// `.slice(0, 12)` shows the first 12 characters of the head hash.
check('audit chain verifies', verify.data.ok === true, `${verify.data.checked} events, head ${verify.data.head?.slice(0, 12)}`)

// Purchases and rule findings.
const expenses = (await owner.get(`/projects/${pid}/expenses`)).data
check('purchases listed', expenses.length >= 25, `${expenses.length} purchases`)
// A purchase with at least one open finding.
const flagged = expenses.find((e) => e.openFindings > 0)
// `!!flagged` converts the object (or undefined) to true/false.
check('rules flagged a purchase', !!flagged, flagged ? `#${flagged.number}` : '')
const findings = (await owner.get(`/projects/${pid}/findings`)).data
// `.some` = at least one finding has this rule.
check('off-site delivery photo flagged', findings.some((f) => f.rule === 'OFF_SITE_PHOTO'), findings.map((f) => f.rule).join(', '))
const detail = await owner.get(`/projects/${pid}/expenses/${flagged.id}`)
check('purchase detail has evidence', detail.data.evidence.length >= 2, detail.data.findings.map((f) => f.message).join(' | '))
const receipt = detail.data.evidence[0] // first attached file
check('evidence file served', (await fileStatus(owner, pid, receipt.id)) === 200)
// A live camera photo that has a distance from the site pin.
const live = detail.data.evidence.find((e) => e.captureMode === 'IN_APP_CAMERA' && e.distanceM != null)
check('live photos carry their distance from the site pin', !!live, live ? `${live.distanceM} m, ±${live.accuracyM} m` : '')

// --------------------------------------------------------- Contractor, rep
const contractor = await session('CONTRACTOR')
const today = await contractor.get(`/projects/${pid}/today`)
// `?.map` because waiting may be absent on failure.
check('contractor today', today.status === 200, today.data.waiting?.map((w) => w.title).join(' | '))
// The contractor tries to approve a purchase: must get 403 Forbidden.
const denied = await contractor.post(`/projects/${pid}/decisions`, { targetType: 'EXPENSE', targetId: flagged.id, decision: 'APPROVE' })
check('contractor cannot approve', denied.status === 403, denied.data.error)
const rep = await session('LOCAL_REP')
check('local rep sees overview', (await rep.get(`/projects/${pid}/overview`)).status === 200)

// ------------------------------------------------- Inspector, nothing shared
const inspector = await session('INSPECTOR')
const ip = (await inspector.get(`/projects/${pid}`)).data
// The budget field must be absent and the permission list lacks viewMoney.
check('inspector sees no budget', ip.budgetPaisa === undefined && !ip.permissions.includes('viewMoney'))
// `.every` = true only if all non-owner members have a null email.
check('inspector sees no contact details', ip.members.filter((m) => m.role !== 'OWNER').every((m) => m.email === null))
const insp = (await inspector.get(`/projects/${pid}/overview`)).data
check('inspector has no money view', insp.money === null && insp.counts.openQuestions === null, insp.waiting.map((w) => w.title).join(' | '))
// Each of these pages must answer 403 for the inspector.
for (const path of ['/expenses', '/reports', '/questions', '/changes', '/boq', '/audit', '/today', '/approvals']) {
  check(`inspector locked out of ${path}`, (await inspector.get(`/projects/${pid}${path}`)).status === 403)
}
const iplan = (await inspector.get(`/projects/${pid}/plan`)).data
check('inspector plan has no payment amounts', iplan.milestones.length === 0 && iplan.inspectionQueue.length >= 0)
const idocs = (await inspector.get(`/projects/${pid}/documents`)).data
// Every visible document is a drawing or an approval.
check('inspector sees only drawings and approvals', idocs.length > 0 && idocs.every((d) => ['DRAWING', 'APPROVAL'].includes(d.category)), idocs.map((d) => d.title).join('; '))
check('inspector can open a drawing', (await fileStatus(inspector, pid, idocs[0].evidenceId)) === 200)
check('inspector cannot open a receipt', (await fileStatus(inspector, pid, receipt.id)) === 403)
// The newest report and the first of its photo ids (comma-separated text).
const report = (await owner.get(`/projects/${pid}/reports`)).data[0]
const reportPhoto = report.photoIds.split(',')[0]
check('inspector cannot open a report photo', (await fileStatus(inspector, pid, reportPhoto)) === 403)
check('seeded photo request waits for the owner', (await owner.get(`/projects/${pid}/approvals`)).data.access.some((a) => a.scope === 'PHOTOS'))
// A request with no cookie must be refused with 401 Unauthorized.
const anonymous = await fetch(`${base}/projects/${pid}`)
check('anonymous request rejected', anonymous.status === 401)

// ------------------------------------------------------------ Self-managed
// The Karachi project is self-managed by the owner.
const kp = (await owner.get(`/projects/${karachi.id}`)).data
check('self-managed project has a custom 30 × 60 ft plot', kp.plotSize === 'CUSTOM' && kp.plotWidthFt === 30 && kp.plotDepthFt === 60, kp.plotLabel)
check('self-managed project has no inspections or approvals', kp.features.inspections === false && kp.features.approvals === false)
const kplan = (await owner.get(`/projects/${karachi.id}/plan`)).data
// Nested `.every`: no step of any stage is marked for inspection.
check('self-managed plan has no inspection steps', kplan.inspectionQueue.length === 0 && kplan.stages.every((s) => s.steps.every((st) => !st.inspect)))
const kexp = (await owner.get(`/projects/${karachi.id}/expenses`)).data
// Double-quoted label because it contains an apostrophe.
check("owner's own purchases are final", kexp.length >= 2 && kexp.every((e) => e.status === 'APPROVED'))
const kinvite = await owner.post(`/projects/${karachi.id}/invitations`, { email: 'someone@sitecord.test', role: 'INSPECTOR' })
check('self-managed project refuses an inspector', kinvite.status === 400, kinvite.data.error)
// Recording a payment is not allowed here (403).
check('self-managed project refuses payments', (await owner.post(`/projects/${karachi.id}/payments`, { type: 'OTHER', method: 'CASH', payeeName: 'x', amountPaisa: 1000, paidOn: '2026-01-01' })).status === 403)

// ------------------------------------------------- A new custom-size project
// A 15 ft wide plot is too narrow: 400 Bad Request.
const bad = await owner.post('/projects', { name: 'Too small', city: 'Lahore', plotSize: 'CUSTOM', plotWidthFt: 15, plotDepthFt: 40, floors: 1, contractType: 'GREY_STRUCTURE', budgetPaisa: 500000000 })
check('too-narrow custom plot refused', bad.status === 400, bad.data.error)
// A budget below the minimum is refused.
const cheap = await owner.post('/projects', { name: 'Tiny budget', city: 'Lahore', plotSize: 'MARLA_5', floors: 1, contractType: 'GREY_STRUCTURE', budgetPaisa: 5000000 })
check('budget under Rs 1 lakh refused', cheap.status === 400, cheap.data.error)
// A valid 32 × 70 ft, two-floor project.
const created = await owner.post('/projects', {
  name: 'Smoke test house', city: 'Lahore', plotSize: 'CUSTOM', plotWidthFt: 32, plotDepthFt: 70, floors: 2, contractType: 'GREY_STRUCTURE',
  budgetPaisa: 1200000000, startDate: '2026-09-01', drawingsApproved: true,
})
check('custom-size project created', created.status === 201, JSON.stringify(created.data))
const t1 = created.data.id // the throwaway project's id
const t1p = (await owner.get(`/projects/${t1}`)).data
check('custom size stored with the typed budget', t1p.plotWidthFt === 32 && t1p.plotDepthFt === 70 && t1p.budgetPaisa === 1200000000, t1p.plotLabel)
check('materials list generated from the size', (await owner.get(`/projects/${t1}/boq`)).data.length >= 10)

// Bring in the demo contractor and inspector.
// Loop over [session, role, email] triples, destructured in the `for...of` head.
for (const [s, role, email] of [[contractor, 'CONTRACTOR', 'imran@sitecord.test'], [inspector, 'INSPECTOR', 'sana@sitecord.test']]) {
  // Owner invites; the invitation response carries a token.
  const inv = await owner.post(`/projects/${t1}/invitations`, { email, role })
  // The invitee accepts it with their own session.
  const ok = (await s.post(`/invitations/${inv.data.token}/accept`)).status
  check(`${role.toLowerCase()} joins the new project`, inv.status === 201 && ok < 300)
}

// Outbox retries: same clientId → same record, once.
const evKey = randomUUID() // the client-side id
const bytes = png() // one file reused for both uploads
const ev1 = await contractor.upload(t1, { kind: 'PHOTO', captureMode: 'IN_APP_CAMERA', clientId: evKey }, bytes)
const ev2 = await contractor.upload(t1, { kind: 'PHOTO', captureMode: 'IN_APP_CAMERA', clientId: evKey }, bytes)
// First upload creates (201), the retry returns the same record (200).
check('photo retried with the same id is stored once', ev1.status === 201 && ev2.status === 200 && ev1.data.id === ev2.data.id)
// Same clientId but different bytes (default png()) must conflict (409).
const ev3 = await contractor.upload(t1, { kind: 'PHOTO', captureMode: 'IN_APP_CAMERA', clientId: evKey })
check('a different file under the same id is refused', ev3.status === 409)
// Empty GPS strings must be stored as null, not as coordinates 0,0.
const blank = await contractor.upload(t1, { kind: 'PHOTO', captureMode: 'GALLERY', lat: '', lng: '' })
check('blank GPS fields stay empty, not 0,0', blank.status === 201 && blank.data.lat === null)
// A daily report sent twice with the same clientId.
const reportKey = randomUUID()
const reportBody = { reportDate: '2026-09-02', summary: 'Excavation started on the north side today.', progressAfter: 10, stageIndex: 1, evidenceIds: [ev1.data.id], clientId: reportKey }
const rp1 = await contractor.post(`/projects/${t1}/reports`, reportBody)
const rp2 = await contractor.post(`/projects/${t1}/reports`, reportBody)
check('report retried with the same id is stored once', rp1.status === 201 && rp2.status === 200 && rp1.data.id === rp2.data.id && (await owner.get(`/projects/${t1}/reports`)).data.length === 1)

// Site pin and GPS checks.
// PUT sets the site's map pin.
const pinned = await owner.put(`/projects/${t1}/site`, { lat: 31.5204, lng: 74.3587, source: 'LINK' })
check('owner pins the site', pinned.status === 200 && pinned.data.siteLat === 31.5204)
// A photo taken roughly 10 km away.
const far = await owner.upload(t1, { kind: 'PHOTO', captureMode: 'IN_APP_CAMERA', lat: 31.6, lng: 74.4, accuracyM: 10 })
check('photo far from the pin knows its distance', far.data.distanceM > 9000, `${far.data.distanceM} m`)
// Verifying a report with that far-away photo must fail with code OFF_SITE.
const offSite = await owner.post(`/projects/${t1}/decisions`, { targetType: 'REPORT', targetId: rp1.data.id, decision: 'VERIFY', evidenceId: far.data.id })
check('verification from off-site refused', offSite.status === 400 && offSite.data.code === 'OFF_SITE', offSite.data.error)
// A photo a few metres from the pin.
const near = await owner.upload(t1, { kind: 'PHOTO', captureMode: 'IN_APP_CAMERA', lat: 31.52045, lng: 74.35875, accuracyM: 8 })
const onSite = await owner.post(`/projects/${t1}/decisions`, { targetType: 'REPORT', targetId: rp1.data.id, decision: 'VERIFY', evidenceId: near.data.id })
check('verification at the site accepted', onSite.status === 200, onSite.data.error ?? '')

// Inspector asks, owner shares for a week, then stops sharing.
check('inspector cannot see the history yet', (await inspector.get(`/projects/${t1}/audit`)).status === 403)
const ask = await inspector.post(`/projects/${t1}/access-requests`, { scope: 'HISTORY', reason: 'Checking the foundation timeline' })
check('inspector asks to see the history', ask.status === 201)
// A second pending request for the same scope conflicts (409).
check('asking twice is refused', (await inspector.post(`/projects/${t1}/access-requests`, { scope: 'HISTORY' })).status === 409)
const inbox = (await owner.get(`/projects/${t1}/approvals`)).data
check("request waits in the owner's approvals", inbox.access.some((a) => a.id === ask.data.id))
const yes = await owner.post(`/projects/${t1}/access-requests/${ask.data.id}/decide`, { decision: 'APPROVE', days: 7 })
check('owner shares the history for 7 days', yes.status === 200 && yes.data.status === 'APPROVED')
const shared = await inspector.get(`/projects/${t1}/audit`)
// Limited view, and no summary contains a rupee amount. `/Rs\s?\d/` is a
// regex ("Rs", optional space, a digit) and `.test(text)` returns true on a match.
check('inspector now sees the history, without money', shared.status === 200 && shared.data.limited && !shared.data.events.some((e) => /Rs\s?\d/.test(e.summary)),
  `${shared.data.events?.length} events`)
// 204 = success with no response body.
check('owner stops sharing', (await owner.post(`/projects/${t1}/access-requests/${ask.data.id}/revoke`)).status === 204)
check('history locked again', (await inspector.get(`/projects/${t1}/audit`)).status === 403)
// Ask for reports, owner declines.
const askReports = await inspector.post(`/projects/${t1}/access-requests`, { scope: 'REPORTS' })
const no = await owner.post(`/projects/${t1}/access-requests/${askReports.data.id}/decide`, { decision: 'DENY', note: 'Not needed for the foundation check' })
check('declined request leaves reports locked', no.status === 200 && (await inspector.get(`/projects/${t1}/reports`)).status === 403)

// Budget: a purchase above the budget alerts the owner once.
// Shrink the budget to Rs 1 lakh (10,000,000 paisa).
await owner.patch(`/projects/${t1}`, { budgetPaisa: 10000000 })
const receiptEv = await owner.upload(t1, { kind: 'RECEIPT', captureMode: 'GALLERY' })
// A Rs 1.5 lakh purchase, submitted immediately.
const buy = await owner.post(`/projects/${t1}/expenses`, {
  type: 'OTHER', supplierName: 'Smoke supplies', purchaseDate: '2026-09-03', lines: [{ description: 'Site office rent', qty: 1, unit: 'month', unitPaisa: 15000000 }],
  evidenceIds: [receiptEv.data.id], submit: true,
})
check("owner's own purchase is final", buy.status === 201 && buy.data.status === 'APPROVED')
const over = (await owner.get(`/projects/${t1}/overview`)).data.money
// Over by exactly Rs 50,000 and the alert level is 100.
check('over budget is shown', over.over === 5000000 && over.level === 100, `over by ${over.over / 100}`)
// Notifications for this project whose title matches the regex /over budget/.
const alerts = (await owner.get('/notifications')).data.items.filter((n) => n.projectId === t1 && /over budget/.test(n.title))
check('owner told once about going over budget', alerts.length === 1)

// Archived projects can be read but not changed.
check('project archived', (await owner.post(`/projects/${t1}/archive`)).status === 204)
check('archived project still readable', (await owner.get(`/projects/${t1}`)).status === 200)
check('archived project refuses changes', (await owner.patch(`/projects/${t1}`, { name: 'Renamed' })).status === 409)

// Guard rails that production depends on.
// 30 February is not a real date: 400.
check('bad calendar date refused', (await owner.post(`/projects/${karachi.id}/expenses`, { type: 'OTHER', supplierName: 'x', purchaseDate: '2026-02-30', lines: [{ description: 'x', qty: 1, unit: 'u', unitPaisa: 100 }] })).status === 400)
// `1e9` is scientific notation for 1,000,000,000; huge totals are refused.
check('absurd amount refused', (await owner.post(`/projects/${karachi.id}/expenses`, { type: 'OTHER', supplierName: 'x', purchaseDate: '2026-01-01', lines: [{ description: 'x', qty: 1e9, unit: 'u', unitPaisa: 1e11 }] })).status === 400)
const dup = await contractor.post(`/projects/${pid}/decisions`, { targetType: 'EXPENSE', targetId: flagged.id, decision: 'APPROVE' })
check('wrong role still cannot decide', dup.status === 403)
// An invitation for a different email can't be accepted by the rep's account.
const wrongEmail = await owner.post(`/projects/${karachi.id}/invitations`, { email: 'nobody@sitecord.test', role: 'LOCAL_REP' })
check('invitation for another address cannot be accepted by this account', wrongEmail.status === 201 && (await rep.post(`/invitations/${wrongEmail.data.token}/accept`)).status === 403)
check('health check answers', (await fetch(`${base}/health`)).status === 200)

server.close() // stop the HTTP server
await close() // close the database
// Delete the temporary folder and everything in it.
rmSync(scratch, { recursive: true, force: true })
// Final summary line; `\n` starts it on a new line.
console.log(failures ? `\n${failures} of ${checks} checks failed` : `\nAll ${checks} checks passed`)
// Exit code 1 when anything failed, 0 when all passed.
process.exit(failures ? 1 : 0)
