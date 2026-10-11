-- SiteCord: custom plot sizes, owner budgets with alerts, a site pin for GPS
-- checks, idempotent retries from the contractor's outbox, and inspector
-- access requests.
--
-- What this file is: the second migration, run once by db/migrate.js after
-- 001_init.sql. It changes existing tables (ALTER TABLE) and adds one new
-- table. Used by services/projects.js (plot, site pin, budget alerts),
-- services/evidence.js, reports.js, expenses.js (client_id retries) and
-- services/access.js (access_requests).
--
-- SQL used here:
--   ALTER TABLE t ADD COLUMN c type      adds a column to an existing table
--   ALTER TABLE t DROP CONSTRAINT name   removes a named rule
--   ALTER TABLE t ADD CONSTRAINT name CHECK (...)  adds a named rule
--   UPDATE t SET col = value             changes existing rows
--   CREATE UNIQUE INDEX ... WHERE cond   a "partial" unique index that only
--                                        covers rows matching cond

-- Plot size: a preset key or CUSTOM, always with its width and depth in feet.
-- Drop the old CHECK created in 001 (Postgres auto-named it
-- <table>_<column>_check) so it can be replaced with a longer list.
ALTER TABLE projects DROP CONSTRAINT projects_plot_size_check;
-- Re-add it under the same name with the new allowed values (the CHECK
-- clause continues on the next line; the statement ends at the semicolon).
ALTER TABLE projects ADD CONSTRAINT projects_plot_size_check
  CHECK (plot_size IN ('MARLA_5', 'MARLA_7', 'MARLA_10', 'KANAL_1', 'KANAL_2', 'CUSTOM'));
-- Plot dimensions in feet: numeric(6,1) = up to 6 digits, 1 after the decimal point.
ALTER TABLE projects ADD COLUMN plot_width_ft numeric(6,1);
ALTER TABLE projects ADD COLUMN plot_depth_ft numeric(6,1);
-- Fill the new columns for projects that already exist. A "simple CASE":
-- CASE x WHEN a THEN 1 WHEN b THEN 2 ELSE 3 END picks a value by matching x.
-- The two assignments are separated by a comma; no WHERE = every row.
UPDATE projects SET
  plot_width_ft = CASE plot_size WHEN 'MARLA_5' THEN 25 WHEN 'MARLA_10' THEN 35 ELSE 50 END,
  plot_depth_ft = CASE plot_size WHEN 'MARLA_5' THEN 45 WHEN 'MARLA_10' THEN 65 ELSE 90 END;
-- Now that every row has a value, make the columns required.
ALTER TABLE projects ALTER COLUMN plot_width_ft SET NOT NULL;
ALTER TABLE projects ALTER COLUMN plot_depth_ft SET NOT NULL;
-- Sensible ranges for both dimensions (AND = both must hold).
ALTER TABLE projects ADD CONSTRAINT projects_plot_dims_check
  CHECK (plot_width_ft BETWEEN 20 AND 80 AND plot_depth_ft BETWEEN 30 AND 150);

-- Where the site is, for "how far from the site was this photo taken".
ALTER TABLE projects ADD COLUMN site_lat double precision; -- latitude in degrees
ALTER TABLE projects ADD COLUMN site_lng double precision; -- longitude in degrees
ALTER TABLE projects ADD COLUMN site_set_at timestamptz; -- when the pin was set
-- Either both coordinates are missing (IS NULL), OR both are present and in
-- valid ranges. Parentheses group the two alternatives joined by OR.
ALTER TABLE projects ADD CONSTRAINT projects_site_check CHECK (
  (site_lat IS NULL AND site_lng IS NULL) OR (site_lat BETWEEN -90 AND 90 AND site_lng BETWEEN -180 AND 180));

-- Highest budget threshold (80 or 100 percent) the owner has been told about.
-- NOT NULL DEFAULT 0: existing rows get 0 automatically.
ALTER TABLE projects ADD COLUMN budget_alert int NOT NULL DEFAULT 0;

-- GPS accuracy and distance from the site pin, the phone's clock when it sent
-- the file (to tell a late upload from a wrong clock), and the outbox's retry key.
-- `real` = single-precision floating-point number. Column-level CHECK that
-- allows NULL or a non-negative value.
ALTER TABLE evidence ADD COLUMN accuracy_m real CHECK (accuracy_m IS NULL OR accuracy_m >= 0);
ALTER TABLE evidence ADD COLUMN distance_m real CHECK (distance_m IS NULL OR distance_m >= 0);
ALTER TABLE evidence ADD COLUMN client_sent_at timestamptz; -- device time at sending
ALTER TABLE evidence ADD COLUMN client_id text; -- outbox retry key
-- Partial unique index: within a project a client_id may appear only once,
-- but rows with no client_id (NULL) are not covered, so any number may exist.
CREATE UNIQUE INDEX evidence_client ON evidence (project_id, client_id) WHERE client_id IS NOT NULL;

-- Same retry key for daily reports.
ALTER TABLE daily_reports ADD COLUMN client_id text;
CREATE UNIQUE INDEX daily_reports_client ON daily_reports (project_id, client_id) WHERE client_id IS NOT NULL;

-- Same retry key for expenses.
ALTER TABLE expenses ADD COLUMN client_id text;
CREATE UNIQUE INDEX expenses_client ON expenses (project_id, client_id) WHERE client_id IS NOT NULL;

-- An inspector asks to see one kind of record; the owner says yes for a while, or no.
CREATE TABLE access_requests (
  id            text PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  user_id       text NOT NULL REFERENCES users(id), -- the inspector asking
  scope         text NOT NULL CHECK (scope IN ('HISTORY', 'REPORTS', 'PHOTOS')), -- what they want to see
  reason        text,
  -- Life cycle of a request.
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'CANCELLED')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    text REFERENCES users(id), -- the owner who answered
  decided_at    timestamptz,
  expires_at    timestamptz, -- end of the approved period
  note          text
);
-- At most one PENDING request per (project, inspector, scope); old decided
-- requests are outside the index, so they don't block a new one.
CREATE UNIQUE INDEX access_requests_pending ON access_requests (project_id, user_id, scope) WHERE status = 'PENDING';
-- Fast "this project's requests with status X".
CREATE INDEX access_requests_project ON access_requests (project_id, status);
