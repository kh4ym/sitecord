# Putting SiteCord online (Render)

SiteCord runs on Render as **one web service**. The server serves both the API
and the built web app, so everything lives at one address, for example
`https://sitecord.onrender.com`. `render.yaml` in this folder describes the
service, so Render sets it up for you.

## 1. Put the code on GitHub (once)

Git isn't installed on this computer, so use **GitHub Desktop**:

1. Create a free account at https://github.com, then install GitHub Desktop
   from https://desktop.github.com and sign in.
2. **File → Add local repository…**, choose `D:\despa`. When it says the folder
   isn't a repository, click **create a repository** (keep the name, leave
   "Initialize with README" off), then **Create repository**.
3. Check the file list on the left. `node_modules`, `.tools`, `server/.data`,
   `server/uploads` and `.env` must **not** appear (`.gitignore` excludes them).
4. Write a summary such as "First version", click **Commit to main**, then
   **Publish repository**. Keeping it private is fine.

Later changes: commit in GitHub Desktop, then **Push origin**. Render redeploys
by itself.

## 2. Create the service on Render (once)

1. Create an account at https://render.com and sign in with GitHub.
2. **New → Blueprint**, pick the repository and click **Apply**. Render reads
   `render.yaml`:
   - build: `npm run render-build` (installs packages and builds the web app)
   - start: `npm start`
   - a 1 GB disk at `/var/data` for the database and photos
3. The first deploy takes a few minutes. On first start the server creates the
   database and loads the demo houses. Open the `…onrender.com` address it shows.

Your friends can use **Explore with demo data** on the sign-in page, or create
their own accounts.

### Cost

A persistent disk needs a paid instance (the `starter` plan in `render.yaml`,
about US$7 a month). For a free trial run, change `plan: starter` to
`plan: free` and delete the `disk:` block (the last four lines) in
`render.yaml`. Everything then works, but the data resets to the demo whenever
the free service restarts or goes to sleep after about 15 minutes without
visitors, and waking it takes about a minute.

## Good to know

- **Shared demo.** Everyone who uses the demo buttons signs in as the same demo
  people, so friends see each other's changes. `render.yaml` sets
  `DEMO_MODE=true` on purpose: in production the demo is off unless asked for.
  To turn it off later, set `DEMO_MODE` to `false` in the service's
  **Environment** settings. The demo buttons disappear, and only people who
  register can sign in.
- **Health and logs.** Render checks `/api/health`; it answers 503 until the
  database is up and migrated. Each request is logged as one JSON line in the
  service's **Logs** tab. Sign-in is limited to 20 attempts per 15 minutes per
  address.
- **Starting over with fresh demo data:** in Render open the service, then
  **Shell**, run `rm -rf /var/data/pglite /var/data/uploads`, then use
  **Manual Deploy → Restart service**.
- **Nothing is emailed.** Invitations are links you copy and send yourself.
- The photos in the demo are drawn illustrations marked SAMPLE.
