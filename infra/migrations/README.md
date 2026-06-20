# infra/migrations

SQL migrations for the Postgres tier. **Expand/contract only** (§G7): add new columns/tables/
indexes first, deploy, backfill, then remove old structures in a later migration — never a
single breaking cut.

- `0001_tenant_rls_reference.sql` — the canonical RLS pattern every tenant-scoped table follows (§G6).

Each service owns its own schema/migrations (§A10); this directory holds shared/reference and
cross-cutting migrations. Runner (Drizzle migrate / sqitch / atlas) is wired per service in its phase.
