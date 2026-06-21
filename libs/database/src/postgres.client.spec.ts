import { runWithTenant, TenantContextMissingError } from '@velchat/shared-utils';
import { PostgresClient } from './postgres.client';

/**
 * Proves the §G6-1.1 RLS guardrail wiring WITHOUT a live database: `withTenantTransaction`
 * must open a tx, set the `app.tenant` GUC from the active tenant context, run the work,
 * and commit — and must refuse to run with no tenant context (fail-closed).
 */
describe('PostgresClient.withTenantTransaction (§G6 RLS GUC)', () => {
  function clientWithFakePool() {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const fakeClient = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pg = new PostgresClient('postgres://unused', 1, console as never);
    (pg as unknown as { pool: { connect: () => Promise<typeof fakeClient> } }).pool = {
      connect: async () => fakeClient,
    };
    return { pg, calls };
  }

  it('sets the tenant GUC inside the transaction and commits', async () => {
    const { pg, calls } = clientWithFakePool();
    const result = await runWithTenant({ tenantId: 'org-A', scope: 'tenant' }, () =>
      pg.withTenantTransaction(async (tx) => {
        await tx.query('SELECT 1');
        return 'done';
      }),
    );
    expect(result).toBe('done');
    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.tenant', $1, true)",
      'SELECT 1',
      'COMMIT',
    ]);
    expect(calls[1]?.values).toEqual(['org-A']);
  });

  it('fails closed when no tenant context is established', async () => {
    const { pg } = clientWithFakePool();
    await expect(pg.withTenantTransaction(async () => 'x')).rejects.toBeInstanceOf(
      TenantContextMissingError,
    );
  });
});
