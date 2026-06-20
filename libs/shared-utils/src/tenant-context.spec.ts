import {
  runWithTenant,
  getTenantContext,
  requireTenant,
  currentTenantId,
  tenantKey,
  assertResourceTenant,
  systemScope,
} from './tenant-context';
import { TenantContextMissingError, CrossTenantAccessError } from './errors';

describe('tenant-context (§G6 fail-closed)', () => {
  it('has no context outside runWithTenant', () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it('requireTenant throws when no context (fail-closed, never defaults to "all")', () => {
    expect(() => requireTenant()).toThrow(TenantContextMissingError);
  });

  it('propagates context across async boundaries', async () => {
    await runWithTenant({ tenantId: 'org-A', scope: 'tenant' }, async () => {
      await Promise.resolve();
      expect(currentTenantId()).toBe('org-A');
    });
    // ...and is cleared afterwards
    expect(getTenantContext()).toBeUndefined();
  });

  it('tenantKey cannot be built without a tenant', () => {
    expect(() => tenantKey('channel', 1)).toThrow(TenantContextMissingError);
    runWithTenant({ tenantId: 'org-A', scope: 'tenant' }, () => {
      expect(tenantKey('channel', 1)).toBe('t:org-A:channel:1');
    });
  });

  it('assertResourceTenant blocks IDOR across tenants', () => {
    runWithTenant({ tenantId: 'org-A', scope: 'tenant' }, () => {
      expect(() => assertResourceTenant({ tenant_id: 'org-A' })).not.toThrow();
      expect(() => assertResourceTenant({ tenant_id: 'org-B' })).toThrow(CrossTenantAccessError);
    });
  });

  it('system scope requires a concrete tenant for currentTenantId', () => {
    runWithTenant(systemScope('nightly-retention'), () => {
      expect(() => currentTenantId()).toThrow(TenantContextMissingError);
      // but assertResourceTenant is permitted under audited system scope
      expect(() => assertResourceTenant({ tenant_id: 'anything' })).not.toThrow();
    });
  });
});
