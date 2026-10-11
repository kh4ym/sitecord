-- Production hardening: indexes for the queries the services run, the
-- foreign keys and checks that were missing, the project's starting stage
-- (drawings already approved), and a truncate guard on the audit trail.
--
-- What this file is: the third migration, run once by db/migrate.js after
-- 002_sitecord.sql. It adds no new features of its own; it tightens the
-- rules (CHECK constraints, foreign keys) and speeds up common lookups
-- (indexes). Used indirectly by every service that queries these tables.

-- Which stage the project started at, so the planned schedule skips the
-- stages that were already done on day one.
-- New column limited to 0 or 1; existing rows get the default 0 first.
ALTER TABLE projects ADD COLUMN start_stage int NOT NULL DEFAULT 0 CHECK (start_stage BETWEEN 0 AND 1);
-- Backfill start_stage for existing projects. `projects p` gives the table
-- the alias p. A "searched CASE" (CASE WHEN cond THEN v ... ELSE v END)
-- returns the value of the first true condition:
--   1st WHEN: a scalar subquery in parentheses, (SELECT min(...) ...), finds
--      the lowest stage that ever had a progress update for this project
--      (u.project_id = p.id links the inner query to the outer row); if it
--      is >= 1, stage 0 was skipped → 1.
--   2nd WHEN: NOT EXISTS (subquery) is true when the subquery returns no
--      rows, i.e. no progress updates at all; then a current stage >= 1 → 1.
--   ELSE 0.
UPDATE projects p SET start_stage = CASE
  WHEN (SELECT min(stage_index) FROM progress_updates u WHERE u.project_id = p.id) >= 1 THEN 1
  WHEN NOT EXISTS (SELECT 1 FROM progress_updates u WHERE u.project_id = p.id) AND p.stage_index >= 1 THEN 1
  ELSE 0 END;
-- A CHECK can compare columns of the same row: the stage index can't exceed
-- the number of floors + 3 (the non-floor stages).
ALTER TABLE projects ADD CONSTRAINT projects_stage_index_check CHECK (stage_index BETWEEN 0 AND floors + 3);

-- Missing range checks on existing tables.
ALTER TABLE milestones ADD CONSTRAINT milestones_stage_index_check CHECK (stage_index IS NULL OR stage_index >= 0);
-- Progress percentages must be 0..100 (the CHECK continues on the next line).
ALTER TABLE progress_updates ADD CONSTRAINT progress_updates_range_check
  CHECK (progress_before BETWEEN 0 AND 100 AND progress_after BETWEEN 0 AND 100);
-- Same for daily reports.
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_range_check
  CHECK (progress_before BETWEEN 0 AND 100 AND progress_after BETWEEN 0 AND 100);
-- A line total can't be negative.
ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_total_check CHECK (total_paisa >= 0);
-- Findings only exist for expenses and reports.
ALTER TABLE findings ADD CONSTRAINT findings_target_type_check CHECK (target_type IN ('EXPENSE', 'REPORT'));

-- Foreign keys promised by the schema comments but never declared.
-- FOREIGN KEY (col) REFERENCES t(id): the table-level way to declare a foreign key.
ALTER TABLE evidence ADD CONSTRAINT evidence_decision_fk FOREIGN KEY (decision_id) REFERENCES decisions(id);
ALTER TABLE progress_updates ADD CONSTRAINT progress_updates_report_fk FOREIGN KEY (report_id) REFERENCES daily_reports(id);

-- Never written or read.
-- DROP COLUMN removes the column and its data.
ALTER TABLE questions DROP COLUMN source;

-- Indexes for the per-record subqueries and joins the services run.
-- Several are partial (WHERE ...): they only include the rows that queries
-- actually look for, which keeps them small.
-- "Which projects is this user an active member of?"
CREATE INDEX project_members_user ON project_members (user_id) WHERE removed_at IS NULL;
-- Open invitations of a project (not accepted, not revoked).
CREATE INDEX invitations_project ON invitations (project_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
-- Lines of an expense.
CREATE INDEX expense_lines_expense ON expense_lines (expense_id);
-- Lines linked to a BOQ item (for "spent vs estimate").
CREATE INDEX expense_lines_boq ON expense_lines (boq_item_id) WHERE boq_item_id IS NOT NULL;
-- Evidence attached to each kind of record.
CREATE INDEX evidence_expense ON evidence (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX evidence_payment ON evidence (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX evidence_report ON evidence (report_id) WHERE report_id IS NOT NULL;
CREATE INDEX evidence_change ON evidence (change_id) WHERE change_id IS NOT NULL;
CREATE INDEX evidence_inspection ON evidence (inspection_id) WHERE inspection_id IS NOT NULL;
CREATE INDEX evidence_document ON evidence (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX evidence_decision ON evidence (decision_id) WHERE decision_id IS NOT NULL;
-- One person's uploads in a project, in time order.
CREATE INDEX evidence_uploader_time ON evidence (project_id, uploaded_by, received_at);
-- Findings about a record, by status.
CREATE INDEX findings_target ON findings (target_type, target_id, status);
-- A project's findings by status.
CREATE INDEX findings_project_status ON findings (project_id, status);
-- A project's milestones in display order.
CREATE INDEX milestones_project ON milestones (project_id, sort);
-- A project's inspections by date.
CREATE INDEX inspections_project ON inspections (project_id, inspected_on, created_at);
-- A project's non-archived documents.
CREATE INDEX documents_project ON documents (project_id) WHERE archived_at IS NULL;
-- Messages of a question, oldest first.
CREATE INDEX question_messages_question ON question_messages (question_id, created_at);
-- A project's questions by status.
CREATE INDEX questions_project_status ON questions (project_id, status);
-- Questions about a specific record.
CREATE INDEX questions_target ON questions (target_type, target_id) WHERE target_type IS NOT NULL;
-- Materials of a report, and reports that used a BOQ item.
CREATE INDEX report_materials_report ON report_materials (report_id);
CREATE INDEX report_materials_boq ON report_materials (boq_item_id);
-- A project's payments by date.
CREATE INDEX payments_project ON payments (project_id, paid_on);
-- A project's change requests by status.
CREATE INDEX change_requests_project ON change_requests (project_id, status);
-- A project's decisions in time order.
CREATE INDEX decisions_project_time ON decisions (project_id, created_at);
-- A project's audit events in time order.
CREATE INDEX audit_events_project_time ON audit_events (project_id, created_at);
-- Currently approved inspector access (looked up on every inspector request).
CREATE INDEX access_requests_active ON access_requests (project_id, user_id, scope) WHERE status = 'APPROVED';
-- Lets the hourly "delete expired sessions" sweep find old rows quickly.
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- The audit trail is append-only: rows can't change, and the table can't be emptied.
-- TRUNCATE empties a whole table at once and does not fire row triggers, so
-- the 001 trigger didn't cover it. This one fires BEFORE TRUNCATE, once FOR
-- EACH STATEMENT, and reuses the function from 001 that always raises an error.
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
