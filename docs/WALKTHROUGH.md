# Reading SiteCord from scratch

A guided order for understanding the codebase. Each step says what to read,
what to look for, and what you should be able to answer afterwards. Budget
roughly a day for the whole thing; the first three steps give you a working
mental model in an hour. The reference for every file is
[ARCHITECTURE.md](ARCHITECTURE.md).

Before you start, run it: `npm run dev`, open http://localhost:5173, use
**Explore with demo data** as each of the four people. Click around for ten
minutes as the owner (Ayesha), the contractor (Imran) and the inspector (Sana).
Everything below will make more sense once you've seen the screens.

---

## Step 1 — The vocabulary (shared/)

Read in this order:

1. `shared/houseConfig.js` — read `buildStages` first (what a "stage" and a
   "step" are, and what `at` means), then `buildPosition` / `stageCount`, then
   `plotGeometry`. Skim `buildSchedule` and `daysBehindPlan`.
2. `shared/features.js` — one function; note that only `SELF_MANAGED` differs.
3. `shared/permissions.js` — the matrix and `permissionsFor`. Note the three
   passes: base matrix → inspector grants → remove feature-less actions.
4. `shared/records.js` — statuses, `DECISION_RULES`, `expenseEvidenceGaps`.
5. `shared/budget.js`, `shared/money.js`, `shared/geo.js` — quick skims.

You should be able to answer: How many stages does a 2-floor house have, and
what is "position 2.5"? Why can't a contractor see the budget? What stops a
material purchase from being submitted without a delivery photo? When is a photo
"off site"?

## Step 2 — One request, end to end (server/)

1. `server/src/server.js` then `server/src/app.js` — the boot and the
   middleware stack. Find where `/api/health` returns 503 and why.
2. `server/src/auth/middleware.js` — `checkOrigin`, `loadProject`, `allow`.
3. `server/src/routes/context.js` — `ctxFrom` and `run`. This is the bridge
   between a route and a service; every service signature is `(q, ctx, …)`.
4. `server/src/routes/projects.js` — read the zod schemas at the top and then
   **one** route group end to end, e.g. expenses (`GET/POST /expenses`,
   `POST /expenses/:id/submit`).
5. `server/src/services/expenses.js` — follow `createExpense` → `submitExpense`
   → `runRules`. Notice `FOR UPDATE`, the `conflict()` codes, `audit(...)` and
   `notify(...)` inside the same transaction.
6. `server/src/services/decisions.js` — how a record changes status by someone
   else's decision; compare with `DECISION_RULES`.
7. `server/src/audit/audit.js` — the hash chain, 60 lines.
8. `server/src/db/index.js` and `migrate.js` — one API over `pg` and PGlite;
   how migrations run. Then skim `migrations/001_init.sql` table by table (the
   comments say what each holds).

You should be able to answer: What happens, in order, when the contractor posts
a purchase? Why does the service lock the row before changing its status? Where
does a thrown `conflict()` become a 409 JSON response? What makes the audit log
tamper-evident?

Then run `npm run smoke` and read `server/scripts/smoke.js` alongside the output;
it's the best executable description of the API.

## Step 3 — The app shell (client/)

1. `client/src/main.jsx` → `client/src/App.jsx` — providers and the route
   table. Note `RequireAuth` and that every page is lazy.
2. `client/src/layout/ProjectLayout.jsx` — how a project is loaded once and
   `Gate` decides between redirect, locked state and "not your role".
3. `client/src/layout/nav.js` — the navigation table; then
   `layout/AppShell.jsx` to see it rendered as sidebar and tab bar.
4. `client/src/lib/api.js` and `client/src/lib/queries.js` — how pages talk to
   the server and how mutations invalidate caches.
5. `client/src/lib/format.js` — the formatting helpers every page uses.

You should be able to answer: Why does an inspector see a locked History page
instead of a 403? Where do tab badges come from? What does `can('decide')` read?

## Step 4 — One screen in depth

Pick the owner's approvals flow:

1. `client/src/pages/project/ApprovalsPage.jsx` — the inbox and the review
   sheet.
2. `client/src/components/ExpenseParts.jsx` and
   `components/evidence/EvidenceGallery.jsx` — what the sheet shows.
3. `client/src/components/DecisionActions.jsx` — the buttons and
   `useDecide` → `POST /decisions`.
4. Back on the server: `services/dashboard.js` `getApprovals` and
   `services/decisions.js`.

Then the contractor's side:

5. `client/src/pages/project/PurchaseFormPage.jsx` and
   `components/evidence/EvidenceUploader.jsx` — note the two paths: upload now,
   or keep the blob and `enqueue()`.
6. `client/src/pages/project/TodayPage.jsx` — the field home and the outbox.

## Step 5 — Offline (lib/outbox)

1. `client/src/lib/outbox/store.js` — the item shape in IndexedDB.
2. `client/src/lib/outbox/flush.js` — files first, then the record; the
   `clientId` retry keys; back-off vs FAILED.
3. `client/src/lib/outbox/OutboxProvider.jsx` — when flushes run.
4. On the server, search for `clientId` in `services/evidence.js`,
   `services/reports.js` and `services/expenses.js`, and for `client_id` in
   `migrations/002_sitecord.sql`.

Try it: stop the API (`preview_stop` / Ctrl-C the `[api]` process), file a
report as the contractor, watch the outbox, start the API again.

## Step 6 — Progress and the 3D house

1. `client/src/lib/useProgressEditor.js` — switches → progress value, the
   serialised saves, mark complete / reopen.
2. `client/src/components/WorkItems.jsx` and
   `client/src/pages/project/ProgressPage.jsx`.
3. `client/src/three/houseModel.js` — read the element list for one stage (say
   the foundation) and the `{ stage, start, end, grow }` window each element
   gets. Then `HouseScene.jsx` `Elements` to see those windows turned into
   scale/visibility per frame, and `useBuildPosition` for the animation.
4. `client/src/three/snapshots.js` + `SnapshotRenderer.jsx` — how the still
   pictures on cards are produced and cached.
5. `server/src/services/plan.js` and `services/reports.js` — the server side
   of progress (`progress_updates`, days behind).

## Step 7 — The rest, as needed

- Inspector access: `services/access.js`, `components/access/AccessLocked.jsx`,
  `pages/project/MorePage.jsx`, `ProjectSettingsPage.jsx` ("shared with inspectors").
- Payments and milestones: `services/payments.js`, `shared/estimates.js`
  (`buildMilestones`), `pages/project/PaymentsPage.jsx`.
- Materials: `services/boq.js`, `pages/project/MaterialsPage.jsx`.
- Site pin and GPS: `shared/geo.js`, `components/SitePinField.jsx`,
  `components/evidence/CameraCapture.jsx`, `services/evidence.js`.
- Automatic checks: `runRules` in `services/expenses.js`, `pages/project/FindingsPage.jsx`.
- The demo story: `server/src/seed/demo.js` (replayed through the services with
  back-dated timestamps) and `seed/svg.js`.
- Design system: `client/src/components/ui/*` and the tokens in
  `client/src/index.css`.
- Motion: `client/src/lib/motion.js`.
- Internationalisation: `client/src/i18n/`.
- Production: `server/src/config.js`, `lib/log.js`, `lib/rateLimit.js`,
  `render.yaml`, `DEPLOY.md`.

---

## Conventions you'll notice

- Comments explain *why*; the code is meant to read as the *what*. Every file
  starts with a header saying its role and who uses it.
- Plain JavaScript ES modules everywhere; no TypeScript, no build step for the
  server.
- Money: integer paisa. Dates: `YYYY-MM-DD` strings for "days" (the site day is
  Pakistan time via `todayPK`), ISO timestamps for moments.
- Server errors carry a stable `code` (`VALIDATION`, `FORBIDDEN`,
  `WRONG_STATUS`, `ARCHIVED`, `RATE_LIMITED`, …) the client can switch on.
- Nothing is deleted: records are archived, the audit log is append-only.
- Tests: `npm run smoke` is the end-to-end suite; `npm run lint` catches
  undefined names, unused code and hook mistakes; `npm run build` must stay
  green.
