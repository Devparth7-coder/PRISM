-- ============================================================================
-- PRISM relational schema (SQLite dialect; the DAL is isolated so PostgreSQL
-- can replace it in production — see README). Normalized, FK-enforced, indexed
-- on every hot query path described in the product spec.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---- identity / tenancy ---------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  github_id     INTEGER UNIQUE,
  login         TEXT NOT NULL UNIQUE,
  name          TEXT,
  email         TEXT,
  avatar_url    TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,             -- random opaque token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  github_id   INTEGER UNIQUE,
  login       TEXT NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL DEFAULT 'member',   -- member | admin
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS installations (
  id              TEXT PRIMARY KEY,
  github_id       INTEGER UNIQUE,
  org_id          TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  app_id          INTEGER,
  account_login   TEXT,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | suspended | deleted | demo
  permissions_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repositories (
  id               TEXT PRIMARY KEY,
  installation_id  TEXT REFERENCES installations(id) ON DELETE SET NULL,
  org_id           TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  github_id        INTEGER,
  owner            TEXT NOT NULL,
  name             TEXT NOT NULL,
  full_name        TEXT NOT NULL,
  default_branch   TEXT NOT NULL DEFAULT 'main',
  language         TEXT,
  profile_json     TEXT,                    -- RepoProfile
  is_demo          INTEGER NOT NULL DEFAULT 0,
  connected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, name)
);
CREATE INDEX IF NOT EXISTS idx_repos_org ON repositories(org_id);
CREATE INDEX IF NOT EXISTS idx_repos_install ON repositories(installation_id);

-- ---- pull requests & snapshots --------------------------------------------
CREATE TABLE IF NOT EXISTS pull_requests (
  id              TEXT PRIMARY KEY,
  repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  author          TEXT NOT NULL,
  base_ref        TEXT NOT NULL,
  head_ref        TEXT NOT NULL,
  base_sha        TEXT NOT NULL,
  head_sha        TEXT NOT NULL,
  additions       INTEGER NOT NULL DEFAULT 0,
  deletions       INTEGER NOT NULL DEFAULT 0,
  changed_files   INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'open',   -- open | closed | merged
  demo_kind       TEXT,                          -- flagship demo marker
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, number)
);
CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_prs_head_sha ON pull_requests(head_sha);

CREATE TABLE IF NOT EXISTS pr_snapshots (
  id              TEXT PRIMARY KEY,
  pr_id           TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  base_sha        TEXT NOT NULL,
  head_sha        TEXT NOT NULL,
  additions       INTEGER NOT NULL DEFAULT 0,
  deletions       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_pr ON pr_snapshots(pr_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_sha ON pr_snapshots(head_sha);

CREATE TABLE IF NOT EXISTS changed_files (
  id           TEXT PRIMARY KEY,
  snapshot_id  TEXT NOT NULL REFERENCES pr_snapshots(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  status       TEXT NOT NULL,
  additions    INTEGER NOT NULL DEFAULT 0,
  deletions    INTEGER NOT NULL DEFAULT 0,
  patch_json   TEXT NOT NULL,                  -- DiffHunk[]
  language     TEXT
);
CREATE INDEX IF NOT EXISTS idx_changed_files_snapshot ON changed_files(snapshot_id);

-- Immutable file blobs captured at a given commit; untrusted PR content.
CREATE TABLE IF NOT EXISTS file_blobs (
  id             TEXT PRIMARY KEY,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha            TEXT NOT NULL,
  path           TEXT NOT NULL,
  content        TEXT NOT NULL,
  truncated      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repository_id, sha, path)
);
CREATE INDEX IF NOT EXISTS idx_blobs_repo_sha ON file_blobs(repository_id, sha);

-- ---- reviews --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id               TEXT PRIMARY KEY,
  pr_id            TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  snapshot_id      TEXT NOT NULL REFERENCES pr_snapshots(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL DEFAULT 'standard',
  status           TEXT NOT NULL DEFAULT 'QUEUED',
  risk_score       INTEGER,
  risk_json        TEXT,
  recommendation   TEXT,
  summary_md       TEXT,
  intent_json      TEXT,                       -- concise PR understanding (decision summary)
  head_sha         TEXT NOT NULL,
  model            TEXT,
  provider         TEXT,
  tokens_in        INTEGER NOT NULL DEFAULT 0,
  tokens_out       INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  duration_ms      INTEGER,
  error            TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  is_stale         INTEGER NOT NULL DEFAULT 0,
  published_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(pr_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at);

CREATE TABLE IF NOT EXISTS findings (
  id                   TEXT PRIMARY KEY,
  review_id            TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  fingerprint          TEXT NOT NULL,
  severity             TEXT NOT NULL,
  category             TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  file                 TEXT,
  line_start           INTEGER,
  line_end             INTEGER,
  confidence           REAL NOT NULL,
  impact               TEXT,
  recommendation       TEXT NOT NULL,
  suggested_patch_json TEXT,
  detector             TEXT NOT NULL,          -- DETERMINISTIC | AI-DETECTED | HYBRID
  agent                TEXT NOT NULL,
  critic_verdict       TEXT,
  critic_notes         TEXT,
  status               TEXT NOT NULL DEFAULT 'OPEN',
  regression           TEXT,                   -- NEW | PERSISTENT | FIXED
  merged_from_json     TEXT,
  previous_finding_id  TEXT,
  dismissed_reason     TEXT,
  dismissed_note       TEXT,
  dismissed_by         TEXT REFERENCES users(id),
  dismissed_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_fp ON findings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_findings_file ON findings(file);

CREATE TABLE IF NOT EXISTS evidence_items (
  id          TEXT PRIMARY KEY,
  finding_id  TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  file        TEXT,
  line        INTEGER,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_evidence_finding ON evidence_items(finding_id);

-- ---- agents / observability -----------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  stage       INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id               TEXT PRIMARY KEY,
  review_id        TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  agent_key        TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED|RUNNING|COMPLETED|FAILED|SKIPPED
  model            TEXT,
  tokens_in        INTEGER NOT NULL DEFAULT 0,
  tokens_out       INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  tool_calls       INTEGER NOT NULL DEFAULT 0,
  findings_count   INTEGER NOT NULL DEFAULT 0,
  decision_summary TEXT,
  error            TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  duration_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_review ON agent_runs(review_id);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_key);

CREATE TABLE IF NOT EXISTS agent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id   TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  run_id      TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',    -- info|success|warn|error
  message     TEXT NOT NULL,
  data_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_review ON agent_events(review_id, id);

CREATE TABLE IF NOT EXISTS tool_executions (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool         TEXT NOT NULL,
  status       TEXT NOT NULL,
  summary      TEXT,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tools_run ON tool_executions(run_id);

-- ---- policy / memory -------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_policies (
  id                  TEXT PRIMARY KEY,
  repository_id       TEXT REFERENCES repositories(id) ON DELETE CASCADE, -- null = global default
  name                TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'standard',
  min_severity_comment TEXT NOT NULL DEFAULT 'LOW',
  severity_map_json   TEXT NOT NULL DEFAULT '{}',   -- CRITICAL -> BLOCK ...
  require_tests       INTEGER NOT NULL DEFAULT 1,
  security_blocking   INTEGER NOT NULL DEFAULT 1,
  dependency_blocking INTEGER NOT NULL DEFAULT 0,
  max_complexity      INTEGER,
  path_reviewers_json TEXT NOT NULL DEFAULT '[]',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, name)
);

CREATE TABLE IF NOT EXISTS repository_rules (
  id             TEXT PRIMARY KEY,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,                  -- block | require | allow | custom
  path_glob      TEXT,
  pattern        TEXT NOT NULL,
  description    TEXT NOT NULL,
  rationale      TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_repo ON repository_rules(repository_id);

CREATE TABLE IF NOT EXISTS repository_memory (
  id             TEXT PRIMARY KEY,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,   -- accepted_pattern|rejected_pattern|architecture_decision|feedback|exception
  content        TEXT NOT NULL,
  source_finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_repo ON repository_memory(repository_id);

CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  finding_id  TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,   -- false_positive|intentional|not_applicable|accepted_risk|reopen
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_finding ON feedback(finding_id);

-- ---- jobs / webhooks / artifacts / cache ----------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  dedupe_key   TEXT UNIQUE,                    -- idempotency: same PR+commit never runs twice
  payload_json TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued', -- queued|running|completed|failed|dead
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at       TEXT NOT NULL DEFAULT (datetime('now')),
  locked_by    TEXT,
  locked_at    TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id              TEXT PRIMARY KEY,
  delivery_id     TEXT,
  event           TEXT NOT NULL,
  action          TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  installation_id INTEGER,
  repository_full TEXT,
  payload_json    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'received', -- received|enqueued|ignored|invalid|error
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhooks_created ON webhook_events(created_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- github_review|markdown|json|test_patch
  filename    TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_review ON artifacts(review_id);

CREATE TABLE IF NOT EXISTS kv_cache (
  key        TEXT PRIMARY KEY,                 -- keys must embed commit SHA
  value      TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON kv_cache(expires_at);

-- ---- GitHub review publication state --------------------------------------
CREATE TABLE IF NOT EXISTS github_publications (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,                   -- live | demo_simulation
  github_id   TEXT,
  payload_json TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',-- pending|published|failed|simulated
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
