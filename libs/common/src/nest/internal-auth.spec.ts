import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { JwtAuthGuard, AllowInternal } from './jwt-auth.guard';
import { UnauthorizedError } from '../errors/errors';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const ISSUER = 'https://auth.velchat.local';
const SECRET = 'internal-secret-value';

function userToken(): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'RS256', typ: 'JWT' });
  const body = b({
    account_id: 'acc-1',
    device_id: 'dev-1',
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const s = createSign('RSA-SHA256');
  s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(privateKey).toString('base64url')}`;
}

@Controller('conversations')
class MixedController {
  /** Reachable by a user OR by another service. */
  @AllowInternal()
  @Get('members')
  members(): string[] {
    return [];
  }

  /** User-only. */
  @Get('secret')
  secret(): string {
    return 'nope';
  }
}

function contextFor(
  handler: (...args: never[]) => unknown,
  headers: Record<string, string | undefined> = {},
) {
  const request: { headers: typeof headers; user?: unknown } = { headers };
  return {
    ctx: {
      getHandler: () => handler,
      getClass: () => MixedController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  };
}

const guard = (secret?: string) =>
  new JwtAuthGuard(new Reflector(), {
    publicKeyPem: publicKey,
    issuer: ISSUER,
    internalSecret: secret,
  });

/**
 * DEF-14: the WebSocket fabric resolves conversation membership over HTTP, but that endpoint is
 * guarded for users — so the internal caller was sending no credential at all, getting 401, reading
 * `[]`, and silently not delivering messages whenever the Valkey projection was cold.
 *
 * The fix is a credential of its own, not a hole. `@AllowInternal()` marks the few endpoints another
 * service may call; everything else stays user-only even with the correct secret, so a leaked secret
 * is not a master key.
 */
describe('internal service-to-service authentication', () => {
  it('admits an internal caller presenting the shared secret', () => {
    const { ctx, request } = contextFor(MixedController.prototype.members, {
      'x-velchat-internal': SECRET,
    });
    expect(guard(SECRET).canActivate(ctx)).toBe(true);
    // A system principal, clearly not a user — nothing downstream should mistake it for one.
    expect(request.user).toMatchObject({ accountId: 'system', scope: 'internal' });
  });

  it('still admits a normal user on the same endpoint', () => {
    const { ctx, request } = contextFor(MixedController.prototype.members, {
      authorization: `Bearer ${userToken()}`,
    });
    expect(guard(SECRET).canActivate(ctx)).toBe(true);
    expect(request.user).toMatchObject({ accountId: 'acc-1' });
  });

  it('refuses an internal secret on an endpoint that did not opt in', () => {
    // The secret must not become a universal key: only @AllowInternal() routes accept it.
    const { ctx } = contextFor(MixedController.prototype.secret, {
      'x-velchat-internal': SECRET,
    });
    expect(() => guard(SECRET).canActivate(ctx)).toThrow(UnauthorizedError);
  });

  it('refuses a wrong secret, falling through to normal token checking', () => {
    const { ctx } = contextFor(MixedController.prototype.members, {
      'x-velchat-internal': 'wrong-secret',
    });
    expect(() => guard(SECRET).canActivate(ctx)).toThrow(UnauthorizedError);
  });

  it('refuses a secret that is merely a prefix of the real one', () => {
    // Guards against a comparison that stops at the shorter length.
    const { ctx } = contextFor(MixedController.prototype.members, {
      'x-velchat-internal': SECRET.slice(0, 5),
    });
    expect(() => guard(SECRET).canActivate(ctx)).toThrow(UnauthorizedError);
  });

  it('disables the internal path entirely when no secret is configured', () => {
    // Fail closed: an unset secret must not mean "any internal header is fine".
    const { ctx } = contextFor(MixedController.prototype.members, {
      'x-velchat-internal': SECRET,
    });
    expect(() => guard(undefined).canActivate(ctx)).toThrow(UnauthorizedError);
  });

  it('still requires SOMETHING — an opted-in endpoint is not public', () => {
    const { ctx } = contextFor(MixedController.prototype.members, {});
    expect(() => guard(SECRET).canActivate(ctx)).toThrow(UnauthorizedError);
  });
});
