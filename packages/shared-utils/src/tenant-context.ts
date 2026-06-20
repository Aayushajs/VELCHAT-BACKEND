import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantContextMissingError, CrossTenantAccessError } from './errors';

/**
 * Request/event/job-scoped tenant context (§G6-1.2).
 *
 * State machine (§G6-1): REQUEST/EVENT/JOB → EXTRACT tenant → ESTABLISH (ALS + RLS GUC)
 *   → [missing → FAIL_CLOSED] → scoped access → CLEAR.
 *
 * The data layer reads this; a missing tenant is an exception, never a default to "all".
 * Cross-tenant maintenance must run under an explicit, audited `system` scope.
 */
export interface TenantContext {
  /** Active tenant. For system scope this is a sentinel; use {@link currentTenantId} to require a real one. */
  readonly tenantId: string;
  readonly accountId?: string;
  readonly traceId?: string;
  readonly scope?: 'tenant' | 'system';
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Run `fn` (and all its async continuations) within the given tenant context. */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Returns the active context or `undefined` if none established. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** Returns the active context or throws (fail-closed). */
export function requireTenant(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx || (!ctx.tenantId && ctx.scope !== 'system')) {
    throw new TenantContextMissingError();
  }
  return ctx;
}

/** Returns the concrete tenant id, or throws if absent / under system scope. */
export function currentTenantId(): string {
  const ctx = requireTenant();
  if (ctx.scope === 'system') {
    throw new TenantContextMissingError(
      'Active scope is "system"; a concrete tenant is required for this operation',
    );
  }
  return ctx.tenantId;
}

/**
 * §G6-5: a cache/index/storage key cannot be constructed without a tenant.
 * e.g. `tenantKey('channel', id)` → `t:<tenant>:channel:<id>`.
 */
export function tenantKey(...parts: Array<string | number>): string {
  return [`t:${currentTenantId()}`, ...parts.map(String)].join(':');
}

/**
 * §G6-1.4 / §G6-6.5: authorize, don't just filter. On every single-resource read,
 * assert the resource belongs to the active tenant (defeats IDOR even if a query
 * forgot its WHERE clause).
 */
export function assertResourceTenant(resource: { tenant_id?: string; tenantId?: string }): void {
  const ctx = requireTenant();
  if (ctx.scope === 'system') {
    return; // audited system scope — caller is responsible for the allow-list
  }
  const resourceTenant = resource.tenant_id ?? resource.tenantId;
  if (resourceTenant !== ctx.tenantId) {
    throw new CrossTenantAccessError();
  }
}

/** Build an explicit, audited system-scope context for cross-tenant maintenance/jobs (§G6-1 edge cases). */
export function systemScope(reason: string, traceId?: string): TenantContext {
  return { tenantId: `__system__:${reason}`, scope: 'system', traceId };
}
