import { requireTenant } from './tenant-context';

export interface AuthzResource {
  type: string;
  id: string;
  tenantId?: string;
  tenant_id?: string;
}

/**
 * Authorization port. Real implementation (user-service `Authorize(user, action, resource)`
 * with a Valkey cache invalidated on `member.*`/`role.*` events) lands in P5 / §B3.
 * Until then the data layer still enforces tenant isolation via {@link requireTenant} + RLS.
 */
export interface Authorizer {
  authorize(action: string, resource: AuthzResource): Promise<boolean>;
}

/** Fail-closed default: denies everything. Replaced by the real authorizer in P5. */
export class DenyByDefaultAuthorizer implements Authorizer {
  async authorize(): Promise<boolean> {
    return false;
  }
}

/** Ensures a tenant context exists for the current call (throws fail-closed otherwise). */
export function assertTenantScoped(): void {
  requireTenant();
}
