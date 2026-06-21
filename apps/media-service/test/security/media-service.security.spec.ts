import { requireTenant, TenantContextMissingError } from '@velchat/common';

/**
 * Security regression for media-service (§D4 threat model + §G6 isolation).
 * Add a concrete test per API/feature: happy path, edge cases, and the security cases.
 * `it.todo` items below are the backlog to fill as endpoints land in the phase prompts.
 */
describe('media-service security (§D4 / §G6)', () => {
  it('tenant context fails closed — never defaults to "all"', () => {
    expect(() => requireTenant()).toThrow(TenantContextMissingError);
  });

  it.todo(
    'authorize-not-just-filter: single-resource read asserts resource.tenant_id == ctx (IDOR)',
  );
  it.todo('rate limiting + lockout on auth-sensitive endpoints');
  it.todo('input validation rejects malformed / oversized payloads');
  it.todo('no secret/PII/message-content in logs or error responses');
});
