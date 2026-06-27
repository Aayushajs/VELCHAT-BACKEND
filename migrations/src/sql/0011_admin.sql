-- 0011 — admin console: audit log, retention/legal-hold, compliance export (§A14 / §A4.6).
-- audit_log is append-only + long-retention; retention_policies drives per-org data lifecycle (a
-- legal hold suspends purges); compliance_exports records eDiscovery export jobs (the blob lands in
-- media-service when ready). All admin actions are gated by org RBAC (owner/admin). Expand-only.

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_ts_idx ON audit_log (org_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (org_id, actor_id);

CREATE TABLE IF NOT EXISTS retention_policies (
  org_id         uuid PRIMARY KEY,
  retention_days int,                                    -- NULL = keep forever
  legal_hold     boolean NOT NULL DEFAULT false,         -- suspends all purges when true
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

CREATE TABLE IF NOT EXISTS compliance_exports (
  export_id       uuid PRIMARY KEY,
  org_id          uuid NOT NULL,
  requested_by    uuid NOT NULL,
  scope           jsonb,                                 -- {channels?, from?, to?}
  status          text NOT NULL DEFAULT 'requested',     -- requested|processing|ready|failed
  result_media_id uuid,                                  -- export blob (media-service) when ready
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_exports_org_idx ON compliance_exports (org_id, created_at DESC);
