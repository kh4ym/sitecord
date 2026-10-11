# SiteCord — your house, on the record

An evidence-backed, tamper-evident record of a house being built in Pakistan:
what has been built, what was bought, and where the money went. Made for
owners who live far from the site, and for the people who build it.

PERN, plain JavaScript (no TypeScript): **P**ostgreSQL · **E**xpress 5 ·
**R**eact 19 (Vite, Tailwind 4, TanStack Query, GSAP, three.js) · **N**ode 24.

## Run it

```bash
npm run dev          # API on :4000 and the web app on :5173 together
```

Open http://localhost:5173 and use **Explore with demo data** on the sign-in
page to enter as the owner, contractor, local representative or inspector.

> Node isn't installed system-wide on this machine; a portable copy lives in
> `.tools/node`. In PowerShell run `$env:PATH = "D:\despa\.tools\node;$env:PATH"` first.

| Command | What it does |
|---|---|
| `npm run reset` | Wipes the local database and uploads, then reloads the demo (stop the API first) |
| `npm run smoke` | End-to-end API checks as every role, on a throwaway database (90 checks) |
| `npm run lint` | ESLint over server, shared and client: undefined names, unused code, hook rules |
| `npm run build` | Production build of the web app |
| `npm start` | Serves the API **and** the built web app from one port (`NODE_ENV=production`) |

### Database

By default the API uses **PGlite**: real PostgreSQL compiled to WebAssembly,
running inside the server and stored in `server/.data`. Nothing to install.
To use a PostgreSQL server instead, set `DATABASE_URL` in `server/.env`
(`docker compose up -d` starts one) and restart. Migrations run automatically.

### Demo accounts

All demo people share the password in `server/src/seed/people.js`. They use the
reserved `@sitecord.test` domain, so nothing is ever emailed.

| Person | Role | Starts on | Sees |
|---|---|---|---|
| Ayesha Khan | Owner, lives in Dubai | Home | Everything; sets the budget, approves money, decides what inspectors see |
| Imran Ali | Contractor | Today | Daily reports, purchases, payments to confirm; works offline |
| Bilal Khan | Local representative | Home | Progress, money and reports; verifies on site |
| Engr. Sana Malik | Inspector | Inspections | Inspections, progress, drawings. Asks to see history, reports or photos; never money |

Two houses:

- **DHA Phase 6 house**, Lahore: 10 Marla (35 × 65 ft), double storey, grey
  structure, Rs 1.79 crore budget, six months in. Site pinned; one steel
  delivery photographed 1.2 km from the site is flagged; the inspector is
  asking to see the site photos.
- **Parents' house**, Karachi: custom 30 × 60 ft, single storey,
  **self-managed**, Rs 55 lakh budget. No contractor, approvals, payments or
  inspections; the owner records purchases and progress.

### Running it for real

`server/.env` (copy `.env.example`) is read at start. What matters in production:

| Setting | Meaning |
|---|---|
| `NODE_ENV=production` | Secure cookies, HSTS, the built web app served from `client/dist`, demo off unless asked for |
| `DEMO_MODE` | `true` seeds the two sample houses on first start and shows the demo sign-in buttons. Off by default in production: it lets anyone in as the demo people |
| `CLIENT_ORIGIN` | Origins allowed to make changes, comma-separated. Requests from the server's own host are always allowed |
| `DATABASE_URL`, `PGLITE_DIR`, `UPLOAD_DIR` | Where data and photos live. With PGlite, keep both folders on a persistent disk |
| `PORT` | Defaults to 4000 |

The server runs migrations itself (each file in its own transaction, under an
advisory lock, so two instances starting together don't collide), rate-limits
sign-in, registration and invitation lookups per IP, logs one JSON line per
request, answers `GET /api/health` with 503 while the database is unreachable
or a migration is pending, sweeps expired sessions hourly, and shuts down
cleanly on SIGTERM. Behind a proxy (Render, nginx) it trusts the first hop for
the client IP and scheme.

## Pages

Phones get a floating tab bar (up to four tabs plus **more**); desktops get a
sidebar with the same places. Tabs depend on the role and the contract type.

| Route | Page | For |
|---|---|---|
| `/login`, `/register`, `/invite/:token` | Sign in, create an account, accept an invitation | Everyone |
| `/` | Your houses, each with a snapshot of its 3D model | Everyone |
| `/projects/new` | Four steps: the house, size (presets or custom width × depth) with live 3D, who builds it, your budget and site pin | Owners |
| `/settings` | Profile, language (English / اردو), password | Everyone |
| `/p/:id` | Home: the house, one status line, spent / waiting / left (or over) budget, what's waiting | Owner, local rep |
| `/p/:id/today` | Field home: daily report, add purchase, take a photo, today's steps, outbox | Contractor, supervisor, self-managing owner |
| `/p/:id/progress` | The 3D house, stage chips, steps as switches, inspection queue | Everyone |
| `/p/:id/budget` | Budget used, approved / waiting / left, by stage, approved changes | Owner, local rep |
| `/p/:id/purchases`, `/new`, `/:eid` | Purchases with required evidence, checks and history | Owner, rep, contractor |
| `/p/:id/payments` | Advance balance, milestones (request / approve / pay), payments with proof | Contractor-run projects |
| `/p/:id/materials` | Planned vs bought vs used, one bar per material; CSV import/export | Owner, rep, contractor |
| `/p/:id/approvals` | One inbox, oldest first; review sheet for purchases, payments, changes and inspector requests | Owner |
| `/p/:id/reports`, `/new`, `/:rid` | Daily reports (three short steps, live camera, works offline) | Team; inspector on request |
| `/p/:id/questions`, `/:qid` | Question threads tied to records | Contractor-run projects |
| `/p/:id/changes`, `/:cid` | Change requests with cost and time | Contractor-run projects |
| `/p/:id/findings` | Everything the automatic checks noticed | Owner, rep, contractor |
| `/p/:id/documents` | Drawings, approvals, contracts (inspectors: drawings and approvals) | Everyone |
| `/p/:id/history` | Hash-chained record with an integrity check | Owner, rep; inspector on request |
| `/p/:id/inspections`, `/verify/:kind/:id` | Inspection queue; checking something on site with a live photo | Inspector (verify: owner and rep too) |
| `/p/:id/settings` | Details and budget, site pin, people, what inspectors can see, invitations, archive | Owner |
| `/p/:id/more` | Everything that isn't a tab, notifications, language, sign out | Everyone (phones) |

## How it works

- **Your budget, not an estimate.** The owner types the budget. Spent =
  approved + waiting purchases. Home and Budget show what's left, or how far
  over it is; the owner is told once at 80% and once at 100%. Approved change
  requests are listed beside the budget, never added to it.
- **The contract type shapes the app.** Self-managed projects have no
  contractor, approvals, payments, milestones, questions, change requests or
  inspections; the owner's purchases are final when saved.
- **Inspectors ask first.** They see inspections, progress and drawings. History,
  daily reports and site photos are each requested separately; the owner shares
  for a day, a week or a month, and can stop sharing at any time. Money is never
  shown to inspectors, and a shared history is redacted to the build story.
- **Outbox.** Reports, purchases and photos saved without signal stay on the
  phone (IndexedDB) and send by themselves when the connection is back, files
  first, each with a retry key, so a cut-off send never creates anything twice.
- **Site pin and GPS.** Photos record their distance from the site pin.
  Verifying on site is refused from more than 300 m away; a delivery photo more
  than 500 m away is flagged.
- **Motion.** Short GSAP transitions (page reveal, sliding tab pill, sheets,
  counting numbers, growing bars, camera glides). They switch off with the
  system's "reduce motion" setting, or with `localStorage['sitecord.motion'] = 'reduce'`.

## How it's built

Full tour: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains every folder
and file and how they connect; [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) is a
reading order for newcomers.

```
shared/          Domain rules used by BOTH server and client (one source of truth)
  houseConfig.js   plot presets and custom sizes, contract types, stages and steps, schedule
  features.js      what each contract type uses
  permissions.js   the permission matrix, plus what an owner has shared with an inspector
  budget.js        budget status (left / over / used %) and per-stage shares
  geo.js           distances from the site pin, map-link parsing
  estimates.js     materials list and payment milestones for a new project
  records.js       statuses, evidence rules ("no proof, no submission")
  money.js         integer paisa, lakh/crore formatting
server/src/
  db/              pg or PGlite behind one q()/tx() API; SQL migrations
  auth/            sessions (hashed tokens, httpOnly cookies), origin check, project guard
  audit/           append-only hash chain + verifier
  services/        projects, budget, access, evidence, expenses (+ rule checks), decisions,
                   payments, reports, plan, boq, questions, changes, documents, history, dashboard
  routes/          thin Express routes with zod validation
  seed/            the demo story and its illustrated evidence (watermarked SAMPLE)
client/src/
  components/ui/   design system: Button, Chip, Field, Sheet, Menu, ListCard, FilterChips, bars, …
  components/      evidence uploader + in-app camera, decision actions, locked states, …
  layout/          app shell (sidebar, floating tab bar), navigation table, project context
  lib/             API client, queries, motion, outbox, connection state
  pages/           one file per page
  three/           the 3D house, workers, neighbourhood, snapshots
  i18n/            English and Urdu strings (right-to-left when Urdu)
```

Rules enforced on the server:

- Every purchase needs a receipt, invoice or handwritten slip; materials also
  need a delivery photo. Payments need proof.
- The person who submits never approves (except a self-managing owner).
- Verifying needs a site photo near the site pin; a live in-app capture counts
  for more than a gallery upload.
- Automatic checks flag duplicate invoices, prices more than 15% above the
  expected price, buying more than planned, reused photos, off-site delivery
  photos and late entries. They describe, never accuse.
- Every important action is appended to a per-project hash chain that a
  database trigger makes append-only.

## Not built yet

Receipt reading with AI, price checks against earlier purchases, report
quantities with steppers, an installable app with an offline start screen and
push notifications, email/WhatsApp summaries, two-factor sign-in, virus scanning
and object storage for files, and PDF export.
