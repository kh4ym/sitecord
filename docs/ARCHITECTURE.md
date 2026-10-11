# SiteCord — how the project works

SiteCord is a web app for people building a house in Pakistan, often from abroad.
It keeps the build "on the record": every purchase is backed by a receipt, every
stage is checked on site, money is tracked against the owner's own budget, and
every important action lands in a tamper-evident history. This document explains
the whole codebase: the folders, why each exists, what its files do, and how they
connect. If you want a reading order instead, start with [WALKTHROUGH.md](WALKTHROUGH.md).

---

## 1. The shape of the system

```
 browser (React app)                         server (Node + Express)
 ───────────────────                         ───────────────────────
 pages ──► lib/queries.js ──► lib/api.js ──HTTP /api/*──► routes ──► services ──► db
   │             │                                          │           │           │
   │        TanStack Query cache                      zod validation   audit     PGlite or
   │                                                  + allow(...)     chain     PostgreSQL
   └── lib/outbox (IndexedDB) ── retries when offline ─────┘
                       ▲
          shared/  (plain JS imported by BOTH sides: permissions, stages, money, geo, rules)
```

Three top-level code folders, one of which is shared:

| Folder | Runs where | What it is |
|---|---|---|
| `server/` | Node 22+ | The API: Express 5 routes, services with the business rules, SQL migrations, the audit chain, the demo seed, the smoke test. |
| `client/` | Browser | The React 19 app: pages, a small design system, data hooks, the offline outbox, the 3D house. Built by Vite into `client/dist`. |
| `shared/` | Both | Domain rules that must agree on both sides: who may do what, the stage list and schedule, money formatting, GPS rules, record statuses. The server imports it with relative paths; the client bundles it through the `@shared` alias. |

In production the server serves `client/dist` too, so the whole thing is one
process on one address (see `render.yaml` and `DEPLOY.md`).

### Key ideas that run through everything

- **Roles and permissions are data, not code paths.** `shared/permissions.js`
  turns `(role, project)` into a list of action names such as `viewMoney` or
  `decide`. The server enforces it (`allow(...)` on routes, `ctx.can()` in
  services). The client only *hides* what can't work (`Gate`, `nav.js`). The
  project's `permissions` array is sent to the client by `GET /projects/:id`.
- **The contract type shapes the product.** `shared/features.js` says which
  features a project has (approvals, payments, milestones, changes, questions,
  inspections). A self-managed house has none of them. Pages, nav items and
  permissions all switch on these flags.
- **One request = one transaction.** `routes/context.js` `run()` wraps each
  service call in a DB transaction and builds the `ctx` (who is acting, their
  role, `can()`, a `cleanup` list for files written to disk). A service that
  writes a record, its audit event and its notifications lands all or nothing.
- **Status transitions are locked.** Every service that moves a record from one
  status to another does `SELECT … FOR UPDATE` first and answers `409
  WRONG_STATUS` if the status has moved. Two people can't both approve the same
  purchase.
- **Evidence first.** "No proof, no submission": `shared/records.js` says which
  evidence a purchase or payment needs; the server refuses submission without
  it; the forms show the gap.
- **Money is integer paisa everywhere.** 1 rupee = 100 paisa, stored as
  `bigint`, never floats. `shared/money.js` formats it (lakh / crore).
- **Stage units.** A house has `floors + 4` stages (blueprint, foundation, each
  floor, roof, finishing). Progress is `stageIndex + stageProgress/100`, so the
  3D house, the schedule, the budget split and the step switches all use one
  number line (`shared/houseConfig.js`).
- **Append-only history.** `server/src/audit/audit.js` hashes each event over
  the previous one; a DB trigger forbids updates and deletes; `POST /audit/verify`
  recomputes the chain.
- **Works without signal.** `client/src/lib/outbox/` keeps reports, purchases
  and photos in IndexedDB and sends them later, files first, each with a
  `clientId` the server uses to never create anything twice.

---

## 2. Repository root

| File | Why it exists |
|---|---|
| `package.json` | Root scripts: `dev` (API + web together), `build`, `lint`, `reset` (reseed demo DB), `smoke` (API test), `render-build` / `start` (production). Dev dependencies are ESLint only. |
| `scripts/dev.mjs` | Spawns the API (`node --watch`) and Vite together with coloured `[api]`/`[web]` prefixes and stops both on Ctrl-C. Plain Node, no dependency. |
| `eslint.config.js` | One ESLint 9 flat config for server, shared and client (hook rules and JSX awareness for the client). `npm run lint`. |
| `render.yaml` | Render blueprint: one Node web service, persistent disk at `/var/data`, `DEMO_MODE=true`. |
| `docker-compose.yml` | Optional local PostgreSQL. Not needed: PGlite is the default. |
| `README.md`, `DEPLOY.md` | How to run it, the pages, the demo people, how to put it online. |
| `docs/` | This file and the walkthrough. |
| `.tools/` | A portable Node on this machine (not part of the project). Ignored by git. |

---

## 3. `shared/` — the rules both sides agree on

Plain ES modules with no dependencies. `shared/package.json` only sets
`"type": "module"`.

| File | Owns | Main exports |
|---|---|---|
| `houseConfig.js` | The house vocabulary. Plot presets and limits, plot → geometry in metres (what the 3D model draws), contract types, cities, **the stage/step list** (`buildStages`), the planned schedule (`buildSchedule`), schedule-vs-actual (`daysBehindPlan`), progress helpers (`buildPosition`, `overallPercent`, `isComplete`), covered area, and `todayPK()` (the site day, UTC+5). | `PLOT_PRESETS`, `plotGeometry`, `plotErrors`, `buildStages`, `buildSchedule`, `daysBehindPlan`, `buildPosition`, `stageCount`, `todayPK` |
| `features.js` | What a contract type switches on. `featuresFor(contractType)` → `{ approvals, payments, milestones, changes, questions, inspections, inviteRoles }`; `stagesFor(project)` strips inspection flags for self-managed houses. | `featuresFor`, `stagesFor`, `INVITE_ROLES` |
| `permissions.js` | The role × action matrix, inspector access scopes (`HISTORY`, `REPORTS`, `PHOTOS`) and grant lengths (1/7/30 days). `permissionsFor(role, project)` applies the matrix, then inspector grants, then removes actions for features the project lacks. | `permissionsFor`, `ROLE_LABELS`, `ACCESS_SCOPES`, `ACCESS_DAYS` |
| `records.js` | Record vocabularies and rules: expense/payment/document types and statuses, evidence kinds, which evidence each record type may carry (`EVIDENCE_KINDS_FOR`), **which decision is legal from which status** (`DECISION_RULES`), evidence timing checks, and the "what's missing" rules (`expenseEvidenceGaps`, `paymentEvidenceGaps`). | `DECISION_RULES`, `EVIDENCE_KINDS_FOR`, `expenseEvidenceGaps`, `COUNTED/APPROVED/WAITING_EXPENSE_STATUSES` |
| `budget.js` | Splits the owner's budget by stage (`budgetByStage`), amount limits (`MIN/MAX_BUDGET_PAISA`, `MAX_AMOUNT_PAISA`), and `budgetStatus()` (spent = approved + waiting; 80 % / 100 % alert levels). | `budgetByStage`, `budgetStatus`, `MAX_AMOUNT_PAISA` |
| `geo.js` | Haversine distance, the site-pin radius rules (300 m to verify, 500 m for delivery photos, weak GPS never counts against anyone), `locationStatus(ev, project)`, `parseLocation(text)` for pasted coordinates / Google Maps links. | `distanceFromSite`, `locationStatus`, `usableFix`, `parseLocation`, `formatDistance` |
| `money.js` | `formatPKR(paisa, { compact, sign })` → "Rs 12.5 lakh". | `formatPKR` |
| `estimates.js` | Defaults created with a new project: the materials list (BOQ) from covered area and reference rates, and the contractor's payment milestones carved from the budget. Server only. | `buildBoq`, `buildMilestones` |

Dependencies inside shared: `estimates`, `budget`, `features` → `houseConfig`;
`permissions` → `features`.

---

## 4. `server/` — the API

```
server/
  package.json          dev / start / reset / smoke
  .env.example          every setting with a comment; copy to .env
  .env.public           the production-mode copy shared through ngrok (own data dir)
  scripts/smoke.js      end-to-end API test on a throwaway database (90 checks)
  src/
    server.js           process entry: connect, migrate, seed (demo), listen, shutdown
    app.js              builds the Express app (headers, /api/health, routers, static client, error handler)
    config.js           all settings read from the environment, with production defaults
    lib/                errors, logging, rate limit, small utils
    db/                 connection (pg or PGlite), migration runner, migrations/*.sql
    auth/               sessions (hashed tokens in httpOnly cookies) and middleware
    audit/              the hash chain
    routes/             thin Express routes with zod schemas
    services/           the business rules, one file per area
    seed/               the demo story (two houses, four people) and its SVG "photos"
```

### 4.1 Request lifecycle

1. `server.js` starts: `connect()` the database, `migrate()` (each `.sql` file
   in its own transaction under an advisory lock, so two instances starting
   together don't collide), `seedDemo()` if demo mode is on and the DB is
   empty, then `listen`. SIGTERM/SIGINT close the server and the pool.
2. `app.js` runs on every request: JSON log line, security headers, body
   parsing, cookies. `/api/health` answers 200, or 503 while the DB is down or a
   migration is pending.
3. Under `/api`: `checkOrigin` (CSRF: non-GET requests must come from a known
   origin or the server's own host), then `attachUser` (session cookie →
   `req.user` or `null`).
4. A route file matches. Project routes go through `requireUser` →
   `loadProject` (membership check — non-members get 404 so ids can't be
   probed; archived projects refuse writes with 409 `ARCHIVED`; permissions
   computed and `req.can` attached) → `allow(...)` guard.
5. The route parses the body with zod (`body(schema, req)`) and calls a service
   through `run(req, (q, ctx) => service(q, ctx, input))`, which opens one
   transaction. If the service throws, any `ctx.cleanup` steps run (a file
   already written to disk is removed) and the error reaches the handler.
6. The error handler maps `ZodError` → 400 `VALIDATION`, `HttpError` → its
   status and `code` (`FORBIDDEN`, `WRONG_STATUS`, `ARCHIVED`, …), multer and
   body-parser errors → 400/413, anything else → a logged 500 with no internals.

### 4.2 Files

**`src/lib/`**

| File | Purpose |
|---|---|
| `errors.js` | `HttpError` and helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`. Every service throws these; the handler in `app.js` turns them into JSON. |
| `log.js` | `log.info/warn/error` (JSON in production, text in dev) and the `requestLog` middleware (one line per request with status, ms, ip, user). |
| `rateLimit.js` | Fixed-window in-memory limiter per IP → 429 `RATE_LIMITED`. Used on login, register, demo login, password change and invitation lookups. |
| `util.js` | `sha256`, `isoAt`, `lock(q, key)` (transaction-scoped advisory lock), `todayPK` re-export, `isUniqueViolation`. |

**`src/db/`**

| File | Purpose |
|---|---|
| `index.js` | One API over two engines: `q(sql, params)`, `tx(fn)`, `connect()`, `close()`, `dbKind()`. Uses `pg` when `DATABASE_URL` is set, otherwise embedded PGlite in `PGLITE_DIR`. Rows come back camelCased. |
| `migrate.js` | Runs each file in `migrations/` once, recorded in `schema_migrations`; `pendingMigrations()` feeds the health check. |
| `migrations/001_init.sql` | The whole schema (below). |
| `migrations/002_sitecord.sql` | Custom plot sizes, site pin, budget alerts, GPS/timing columns on evidence, `client_id` retry keys, the `access_requests` table. |
| `migrations/003_production.sql` | `projects.start_stage`, CHECK constraints, missing foreign keys, ~27 indexes, and the trigger that forbids `TRUNCATE` on the audit table. |

**Database schema** (tables and what they hold)

| Table | Holds |
|---|---|
| `users`, `sessions` | Accounts (bcrypt hashes) and sessions (hashed token, expiry, user agent). |
| `projects` | A house: name, city, plot size and width/depth in feet, floors, contract type, budget (paisa), start date and `start_stage`, site pin (`site_lat/lng`), stage index + progress, archive time. |
| `project_members`, `invitations` | Who is on the project with which role; pending invitation links (token hash, email, role). |
| `progress_updates` | A row every time progress changes (who, from, to). |
| `boq_items` | The materials list: planned quantity and rate, bought and used quantities. |
| `milestones` | Contractor payment milestones with the stage that must be complete; status PLANNED → REQUESTED → APPROVED → PAID. |
| `expenses`, `expense_lines` | Purchases (type, supplier, status DRAFT → SUBMITTED → APPROVED/REJECTED/QUERIED → VERIFIED, `from_advance`, `client_id`) and their line items. |
| `payments` | Money paid by the owner (advance, milestone, settlement) with method, proof and payee confirmation. |
| `daily_reports`, `report_materials` | A day's report (progress before/after, workers, weather, summary, issues) and materials used. |
| `change_requests` | Scope changes with cost and extra days. |
| `inspections` | Inspector checks per stage step: PASS / PARTIAL / FAIL with notes. |
| `documents` | Drawings, approvals, contracts (category) pointing at evidence files. |
| `evidence` | Every uploaded file: kind, capture mode, SHA-256, captured/received times, GPS lat/lng/accuracy, distance to the pin, the record it belongs to, `client_id`. |
| `decisions` | Each approve / reject / query / verify on a record, with note and evidence. |
| `questions`, `question_messages` | Threads tied to a record (or free), with the person who must answer. |
| `findings` | What the automatic checks noticed (duplicate invoice, high price, off-site photo, late entry) and whether it was dismissed. |
| `notifications` | Per-user inbox with a link. |
| `access_requests` | Inspector requests for HISTORY / REPORTS / PHOTOS: status, decided by, expires at. |
| `audit_events` | The hash chain: `seq`, `prev_hash`, `hash`, action, summary, payload. Triggers forbid UPDATE, DELETE and TRUNCATE. |

**`src/auth/`**

| File | Purpose |
|---|---|
| `sessions.js` | `startSession` (random token, hashed in the DB, `sc_session` httpOnly cookie, 30 days), `endSession`, `userFromRequest`. |
| `middleware.js` | `checkOrigin`, `attachUser`, `requireUser`, `loadProject`, `allow(...actions)` (any-of). |

**`src/audit/audit.js`** — `audit(q, { projectId, action, summary, … })` appends
an event under a per-project lock; `verifyChain(q, projectId)` walks it. Every
service that changes something calls `audit` inside its transaction.

**`src/routes/`** (thin; validation and permission only)

| File | Routes |
|---|---|
| `auth.js` | `POST /auth/register`, `/auth/login`, `/auth/demo`, `/auth/logout`; `GET /auth/demo` (demo people when demo mode is on), `GET /auth/me`; `PATCH /me`, `POST /me/password`; `GET /notifications`, `POST /notifications/read`. |
| `invitations.js` | `GET /invitations/:token` (public preview), `POST /invitations/:token/accept` (must be signed in as the invited email). |
| `projects.js` | `GET/POST /projects`; then under `/projects/:projectId`: project (`GET`, `PATCH`, `POST /archive`, `PATCH /progress`, `PUT|DELETE /site`), dashboards (`/overview`, `/today`, `/approvals`), people (`/invitations`, `/members/:userId`), access requests (`/access-requests`, `/:id/decide|revoke|cancel`), plan (`/plan`, `/inspections`, `/milestones/:id/request`), materials (`/boq`, `/boq/:id`, `/boq/import`), evidence (`POST /evidence` multipart, `GET /evidence/:id/file`), purchases (`/expenses`, `/:id`, `/:id/submit`), findings (`/findings`, `/:id/dismiss`), `POST /decisions`, payments (`/payments`, `/:id`, `/:id/confirm`), reports (`/reports`, `/:id`), changes (`/changes`, `/:id`, `/:id/resubmit`), questions (`/questions`, `/:id`, `/:id/messages`, `/:id/resolve`), documents (`/documents`, `/:id`), history (`GET /audit`, `POST /audit/verify`). Each carries its `allow(...)` guard; zod schemas at the top of the file use the shared enums and `MAX_AMOUNT_PAISA`. |
| `context.js` | `ctxFrom`, `run`, `body`, `query` (described above). |

**`src/services/`** — all the rules. Each function takes `(q, ctx, …)`.

| File | Purpose |
|---|---|
| `projects.js` | Create (derives plot from preset or custom size, builds BOQ and milestones, stores the pin), list/get (strips money and contact details the role can't see; attaches `permissions`, `features`, `grants`), update, archive (idempotent), `updateProgress` (locks the project row, writes a `progress_updates` row per stage crossed, checks budget alerts), site pin rules, invitations (new one revokes earlier pending ones; accept checks the email), members. Exports `PROJECT_COLUMNS` and `activeGrants` for the middleware. |
| `expenses.js` | Purchases: create/update drafts (line caps, amount caps), submit (evidence gaps, self-managed owners auto-approve), `runRules` (the automatic checks that write `findings`), get/list scoped to the role (`ownOnly` for a supervisor). |
| `decisions.js` | The one place a record changes status by someone else's decision: loads the target `FOR UPDATE`, checks `DECISION_RULES`, applies APPROVE / REJECT / QUERY / VERIFY, stores the decision, audits, notifies. QUERY also opens a question. `decisionsFor(target)` lists a record's history. |
| `evidence.js` | Sniffs the real file type, writes the file *after* the DB row with an undo on rollback, stores GPS and timing, recognises `clientId` retries, and `canViewEvidence` (draft receipts only to their author, photos only with `viewPhotos`, money evidence only with `viewMoney`, …). |
| `payments.js` | Record a payment (proof required), confirm by the payee, milestone request/approve/pay with locks. |
| `reports.js` | Daily reports: create (moves progress, keeps earlier progress if higher, computes "behind plan"), list/get with photos gated by `viewPhotos`. |
| `plan.js` | The plan view: stages with steps, schedule dates, inspections per step, days behind, the inspection queue. |
| `boq.js` | Materials list CRUD, CSV import (`csvCells` parser, 500-row cap), bought/used roll-ups. |
| `budget.js` | Purchase totals by status and stage; budget alerts (owner told once at 80 %, once at 100 %). |
| `dashboard.js` | `getOverview` (home), `getToday` (field home), `getApprovals` (inbox) and the per-role "waiting for you" list. |
| `access.js` | Inspector access requests: request (one pending per scope), decide (grant for N days), revoke, cancel; audited and notified. |
| `questions.js` | Threads: ask (answerer derived from the target: contractor for a purchase, payee for a payment), reply (a report answered by its author goes back to SUBMITTED), resolve. |
| `changes.js` | Change requests: create, resubmit after a query. |
| `documents.js` | Upload (an evidence row + a document row), list (inspectors see drawings/approvals only), archive. |
| `history.js` | Audit list with filters; a shared history is redacted to the build story for inspectors. |
| `notify.js` | `notify(q, userIds, { title, body, link })` inserts notification rows. |

**`src/seed/`**

| File | Purpose |
|---|---|
| `people.js` | The four demo people (the shared demo password lives only here). |
| `demo.js` | Replays six months of a Lahore build and a self-managed Karachi house *through the services* with back-dated `ctx.at`, so the audit chain and notifications are real. |
| `svg.js` | Draws the illustrated, watermarked SAMPLE receipts, slips and site photos as SVG. |
| `run.js` | `npm run reset`: wipes the data dirs, migrates, seeds. |

**`scripts/smoke.js`** — boots the app on a temporary PGlite + upload dir, seeds
it, signs in as every persona and exercises every read and write path (90
checks), including permission refusals, locking conflicts and offline retries.

---

## 5. `client/` — the web app

```
client/
  index.html            Vite entry, fonts, favicon
  vite.config.js        React + Tailwind plugins, @shared alias, /api proxy
  src/
    main.jsx            providers: Query → Router → I18n → Outbox → App
    App.jsx             the route table
    index.css           Tailwind 4 theme tokens, base styles, utilities
    layout/             app shell, navigation table, project layout + guards
    lib/                API client, queries, formatting, motion, outbox, misc hooks
    components/ui/      the design system (Button, Chip, Field, Sheet, Menu, lists, bars)
    components/         app-specific pieces (evidence, decisions, notifications, outbox…)
    pages/              one file per page (auth/, project/, and the home shell pages)
    three/              the 3D house: model builder, scene, workers, neighbourhood, snapshots
    i18n/               English and Urdu strings and the provider
```

### 5.1 Boot and routing

`index.html` loads `main.jsx`, which mounts providers outermost-first:
TanStack Query (server cache; retries only network/5xx), the router, `I18nProvider`
(locale from the signed-in person, sets `dir=rtl` for Urdu and the Intl locale
used by `lib/format.js`), `OutboxProvider` (flushes on start, on `online`, every
30 s while items exist), then `App` and the toaster.

`App.jsx` is the route table. `/login`, `/register`, `/invite/:token` are public.
Everything else sits under `RequireAuth` (asks `/auth/me`; no connection shows a
retry card rather than bouncing to login). Outside a project, `Shell` wraps the
houses list, the new-project wizard and the account page in `AppShell`. Inside
`/p/:projectId`, `ProjectLayout` loads the project once and provides
`ProjectContext` (`project`, `me`, `can()`, `features`, `nav`), and each page is
wrapped in `Gate`:

- `feature="payments"` — redirect to the role's landing page if the contract type lacks it;
- `scope="REPORTS"` — an inspector without the grant sees `LockedState` with an "ask the owner" sheet (URL kept);
- `can="decide"` — anyone else without the permission sees "Not part of your role".

Every page is `lazy()` so the first paint doesn't wait for three.js or GSAP.

### 5.2 `layout/`

| File | Purpose |
|---|---|
| `AppShell.jsx` | Desktop sidebar (wordmark, project switcher, nav with a sliding pill, language, user menu) and the phone floating tab bar with badges (waiting approvals, open questions, outbox count, unread dot on "more"). |
| `nav.js` | **The one navigation table**: every destination with its permission / feature / inspector scope, and each role's tabs and "more" list. `navFor(project, can)` resolves it; `landingFor` picks the first page; `isActive` matches the current section. |
| `ProjectLayout.jsx` | Loads the project, builds the context, exports `Gate`, `ProjectIndex` (role landing), `MoneyLayout` (budget / purchases / payments / materials pills) and `MoneyIndex`. |
| `ProjectContext.jsx` | The context object and `useProjectContext()`. |
| `PageHeader.jsx` | `PageTitle` (kicker, title, back link, actions; sets `document.title`). |

### 5.3 `lib/`

| File | Purpose |
|---|---|
| `api.js` | `api(path, { method, body })` → fetch with JSON, cookies, and an `ApiError` carrying `status` and `code`; `uploadEvidence()` (XHR for progress); `fileUrl()`. |
| `queries.js` | Every TanStack Query hook: `useMe`, `useProjects`, `useProject`, `useOverview`, `useExpenses`, `useDecide`, … Mutations invalidate the right keys. A small `useQuery` wrapper returns a Proxy so pages can override `data` without losing tracked props. |
| `net.js` | `useOnline()`, `isRetryable(err)` (status 0, 408, 429, 502–504 → treat as no signal), reconnect events. |
| `format.js` | Locale-aware dates (`formatDate`, `formatMonth`, `formatWeekday`, `timeAgo`), `today()` = site day, money helpers (`amount()` = compact figure without "Rs", `moneyParts` for the big number + unit), `plural`, `initials`, `firstName`, `csvCell`, `cn` (class names). `setFormatLocale` is called by the i18n provider. |
| `derive.js` | Pure shaping of server data for screens: `weekLine`, `statusLine`, `groupByMonth`, `groupByDay`, `materialRows`. |
| `status.js` | Status → chip tone and label for every record kind. |
| `motion.js` | GSAP setup and hooks: `usePageReveal`, `useStagger`, `useSlidingPill`, `useCountUp`, `useGrow`, `reduced()` (honours reduce-motion). |
| `image.js` | `compressImage(file)` before upload; `currentPosition()` wrapper over geolocation. |
| `auth.js` | `safeNext()` — only same-site redirect targets. |
| `useProgressEditor.js` | The step switches' brain: turns a switch into a progress value, serialises saves through a promise chain so quick taps can't race, handles "mark stage complete" and reopen. |
| `useSignOut.js` | Sign out, warning first if the outbox still holds unsent items. |
| `outbox/store.js` | IndexedDB store of outbox items `{ id, userId, projectId, kind, title, body, files[], status, attempts, nextAttemptAt }` with subscribe/snapshot for React. |
| `outbox/flush.js` | Sends due items in order: each file (with `clientId = item.id:key`), then the record (`clientId = item.id`). Retryable errors → back-off (5 s … 5 min); others → FAILED with the message. |
| `outbox/OutboxProvider.jsx` | Triggers flushes (app start, `online`, interval, right after enqueue) and shows toasts. |
| `outbox/useOutbox.js` | `useOutbox(projectId)` and `useOutboxCounts` for lists and badges. |

### 5.4 `components/ui/` — the design system

Figma-derived: warm canvas, white cards with hairline borders, pill buttons
with lowercase labels, dotted status chips, floating tab bar, bottom sheets.

| File | Exports |
|---|---|
| `Button.jsx` | `Button` (variants primary / accent / secondary / soft / danger / danger-text / text; sizes sm / md / lg; `to` / `href` / `loading` / `block`), `IconButton`. |
| `Chip.jsx` | `Chip`, `StatusChip({ kind, status })` (translated), `RoleTag`. |
| `Field.jsx` | `Field` (label, hint, error wired for screen readers; `group` renders a fieldset/legend), `Input`, `Textarea`, `Select`, `MoneyInput` (live "= 1.79 crore"), `Stepper`, `Checkbox`, `OptionCards`, `Segmented`. |
| `Dialog.jsx` | `Sheet` (bottom sheet on phones, side panel or centred on desktop, GSAP open/close) and `ConfirmDialog` (optional required note). |
| `Menu.jsx` | `Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator` (Radix dropdown). |
| `FilterChips.jsx` | `FilterChips` (selected = black), `TabPills`. |
| `ListCard.jsx` | `ListCard` (one card, divided rows), `ListRow` (link / button / static), `IconTile`, `SectionHead`. |
| `Bars.jsx` | `StatRow`, `CountUp`, `Meter`, `StackedBar`, `Toggle`. |
| `misc.jsx` | `EmptyState`, `Skeleton`, `Spinner`, `PageSkeleton`, `ErrorState`, `Avatar`, `Notice`. |
| `index.js` | The barrel everything imports from. |

### 5.5 `components/` — app pieces

| File | Purpose |
|---|---|
| `evidence/CameraCapture.jsx` | Full-screen camera with mode switch (receipt / delivery / progress), GPS pill, shutter, "upload instead". |
| `evidence/EvidenceUploader.jsx` | Evidence slots on forms; uploads at once or keeps the blob locally for the outbox. |
| `evidence/EvidenceGallery.jsx` | `EvidenceTiles` + `EvidenceLightbox` with provenance (capture mode, time, distance from the pin, fingerprint). |
| `DecisionActions.jsx` | approve / ask / reject / verify buttons for a record, driven by `DECISION_RULES` and the viewer's permissions. |
| `DecisionTimeline.jsx` | The record's decision history. |
| `QuestionThread.jsx` | A thread with reply and resolve. |
| `ExpenseParts.jsx` | Shared pieces of a purchase (amount header, items, evidence, checks) used by the detail page and the approvals sheet. |
| `WaitingList.jsx` | "Waiting for you" rows (home, today). |
| `WorkItems.jsx` | A stage's steps as switches. |
| `HouseSnapshot.jsx` | Still 3D picture for cards and the home hero. |
| `Notifications.jsx` | Bell + popover and the list used by the More page. |
| `OutboxList.jsx`, `OfflineBanner.jsx` | Outbox section and the offline strip. |
| `SitePinField.jsx` | Pin picker (GPS or pasted coordinates). |
| `access/AccessLocked.jsx` | `LockedState`, `AccessRows` (More page), `useScopeState`, the request sheet. |
| `Page.jsx`, `Logo.jsx`, `ErrorBoundary.jsx` | Page wrapper with reveal, the wordmark, the crash card. |

### 5.6 `pages/`

Each page file starts with a comment giving its route and audience. The route →
page table is in `App.jsx`; the role → tabs table is in `layout/nav.js`. In
short:

| Area | Pages |
|---|---|
| Auth | `LoginPage` (email/password + demo buttons), `RegisterPage`, `InvitePage`, with `AuthLayout` (the blue hero). |
| Home shell | `ProjectsPage` (house cards), `NewProjectPage` (4-step wizard with live 3D), `AccountPage`. |
| Owner / rep | `HomePage`, `ProgressPage`, `BudgetPage`, `PurchasesPage`, `PurchaseDetailPage`, `PaymentsPage`, `MaterialsPage`, `ApprovalsPage`, `ChangesPage`/`ChangePage`, `QuestionsPage`, `FindingsPage`, `DocumentsPage`, `HistoryPage`, `ProjectSettingsPage`. |
| Field | `TodayPage`, `NewReportPage`, `ReportsPage`, `ReportDetailPage`, `PurchaseFormPage`. |
| Inspector | `InspectionsPage`, `VerifyPage` (also used by owner/rep to verify purchases and reports). |
| Phones | `MorePage`. |

### 5.7 `three/` — the 3D house

| File | Purpose |
|---|---|
| `houseModel.js` | `buildHouseModel({ floors, widthFt, depthFt })`: from `plotGeometry` builds every box/cylinder *element* with the stage and 0–1 window in which it grows (foundation pit, columns, walls, slabs, stairs, boundary wall, scaffold, stock piles, trees…), plus worker specs and bounds. Pure data, no three.js objects. |
| `neighborhoodModel.js` | The surrounding houses, road, cars, trees and lamps as layered boxes seeded from the plot dims. |
| `textures.js` | Procedural brick, plaster, concrete, soil, grass, wood, paving, asphalt textures drawn on canvas (no image assets) and a triplanar shader patch. |
| `HouseScene.jsx` | `Scene` animates a build position (`pos`) and sets each element's scale/visibility per frame; `Elements`, `Atmosphere` (sky/fog/ground from blueprint-blue to day), `CameraRig` (re-frames on plot change); `HouseScene` wraps it in a Canvas with orbit controls. |
| `Workers.jsx`, `Neighborhood.jsx` | The animated workers and the instanced neighbourhood. |
| `LazyHouseScene.jsx` | Code-split loader with a fallback and WebGL error boundary. |
| `snapshots.js`, `SnapshotRenderer.jsx` | `requestSnapshot(spec)` draws a still on a hidden canvas (one job at a time, torn down when idle) and caches it in memory and `localStorage`, keyed by floors, size, build position and framing. |
| `util.js` | `rng` (seeded), `smooth`, `clamp01`, `disposeAll`. |

### 5.8 `i18n/`

`strings.js` holds English and Urdu keys (field screens, navigation, chips,
shell, outbox are translated; other screens fall back to English) plus
`STEP_DETAILS`. `I18nProvider.jsx` provides `t(key, vars)`, `term(domainWord)`
and `locale`, persists the choice per account, flips `dir` for Urdu and calls
`setFormatLocale`.

---

## 6. Two end-to-end stories

**A contractor submits a purchase (online).** `PurchaseFormPage` → evidence
slots upload each file immediately via `uploadEvidence` (`POST /evidence`,
multipart; the service sniffs the type, inserts the `evidence` row, writes the
file, records GPS distance). On submit, `useCreateExpense` posts the body with
`evidenceIds` and a `clientId`. `routes/projects.js` validates with zod, `run()`
opens a transaction, `expenses.createExpense` + `submitExpense` check
`expenseEvidenceGaps`, run the automatic checks (findings), audit, notify the
owner. The owner's `ApprovalsPage` lists it from `GET /approvals`; approving
goes through `POST /decisions` → `decisions.decide` (locks the row, checks
`DECISION_RULES`, APPROVED, audit, notify). `BudgetPage` and `HomePage` read the
new totals from `GET /overview` (`dashboard.getOverview` → `budget.js`).

**The same, with no signal.** The uploads fail with a network error, so the
uploader keeps the blobs locally (`local: true`). Submit sees local files (or
`navigator.onLine === false`) and calls `enqueue()` → IndexedDB; the contractor
is sent to Today, where `OutboxList` shows the item. `OutboxProvider` flushes
when the browser comes back: `flush.js` uploads each file with
`clientId = item.id:f0`, writes the returned `evidenceId` back to the store,
then posts the record with `clientId = item.id`. If the connection drops
half-way, the retry only sends what is missing, and the server's `client_id`
unique indexes make the repeat a no-op.

---

## 7. Where to change what

| I want to… | Touch |
|---|---|
| Add a page | `pages/…`, a `<Route>` in `App.jsx`, a row in `layout/nav.js` DESTINATIONS and the role layouts, a label in `i18n/strings.js`. |
| Add an API endpoint | A zod schema and route in `routes/projects.js`, the rule in a service, an `audit(...)` call, a hook in `lib/queries.js`, a smoke check. |
| Add a permission | `shared/permissions.js` matrix (+ feature removal if tied to a feature); use it with `allow()` server-side and `can()` client-side. |
| Change a status flow | `shared/records.js` `DECISION_RULES` / status lists, the matching `CHECK` in a migration, `services/decisions.js`. |
| Change the stages or schedule | `shared/houseConfig.js` `buildStages` / durations; the 3D model (`three/houseModel.js`) reads the same indexes. |
| Add a column | A new `server/src/db/migrations/00N_*.sql` (never edit an applied one), `PROJECT_COLUMNS` if on projects. |
| Add a string | `i18n/strings.js` in both languages. |
