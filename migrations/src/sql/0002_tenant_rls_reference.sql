-- ============================================================================
-- 0001 — RLS reference migration (§G6-1.1)
--
-- Reference pattern every tenant-scoped Postgres table follows. The app sets the
-- 'app.tenant' GUC per transaction (see @velchat shared PostgresClient.withTenantTransaction);
-- RLS then enforces isolation even if a query forgets its WHERE clause — the LAST line of
-- defense behind the fail-closed tenant context and tenant-aware repositories.
--
-- Migrations are expand/contract (§G7): additive first, destructive only after deploy.
-- ============================================================================

-- Example tenant-scoped table (a real one is defined by the owning service in its phase).
CREATE TABLE IF NOT EXISTS example_tenant_rows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Leading tenant_id index keeps RLS overhead negligible (§G6-1 scalability note).
CREATE INDEX IF NOT EXISTS example_tenant_rows_tenant_idx
  ON example_tenant_rows (tenant_id, created_at);

-- Enable + FORCE RLS so even the table owner is subject to the policy.
ALTER TABLE example_tenant_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE example_tenant_rows FORCE ROW LEVEL SECURITY;

-- Policy: a row is visible/writable only when its tenant_id matches the session GUC.
-- current_setting('app.tenant', true) returns NULL when unset → no rows (fail-closed).
DROP POLICY IF EXISTS tenant_isolation ON example_tenant_rows;
CREATE POLICY tenant_isolation ON example_tenant_rows
  USING (tenant_id = current_setting('app.tenant', true))
  WITH CHECK (tenant_id = current_setting('app.tenant', true));
