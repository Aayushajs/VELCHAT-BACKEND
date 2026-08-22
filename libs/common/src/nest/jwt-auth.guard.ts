import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createVerify, createPublicKey, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../errors/errors';

/**
 * Verified principal attached to `request.user` after JWT validation.
 * Mirrors {@link AccessClaims} from the token service (§B2.3).
 */
export interface VerifiedPrincipal {
  accountId: string;
  deviceId: string;
  tenantId?: string;
  role?: string;
  scope?: string;
}

/** Metadata key for the @Public() decorator. */
export const IS_PUBLIC_KEY = 'isPublic';

/** Metadata key for the @AllowInternal() decorator. */
export const ALLOW_INTERNAL_KEY = 'allowInternal';

/** Header another VelChat service presents instead of a user token. */
export const INTERNAL_HEADER = 'x-velchat-internal';

/**
 * Mark an endpoint as public — the {@link JwtAuthGuard} will skip JWT verification.
 * Use on registration, webhook, JWKS, and other unauthenticated endpoints.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Mark an endpoint as callable by ANOTHER VELCHAT SERVICE as well as by a user.
 *
 * Needed because some endpoints have two legitimate callers: `GET /conversations/:id/members` is
 * read by the mobile app AND by the WebSocket fabric, which has no user token to present. Before
 * this the fabric sent no credential, got 401, read `[]`, and silently failed to deliver messages
 * whenever the Valkey membership projection was cold (DEF-14).
 *
 * Deliberately opt-in per endpoint: the shared secret unlocks only the routes that declare it, so a
 * leaked secret is not a master key. A user token still works on the same route.
 */
export const AllowInternal = (): CustomDecorator<string> => SetMetadata(ALLOW_INTERNAL_KEY, true);

export interface JwtAuthGuardOptions {
  /** PEM-encoded RSA public key (or certificate) used to verify RS256 access JWTs. */
  publicKeyPem: string;
  /** Expected `iss` claim value (must match the auth-service issuer). */
  issuer: string;
  /**
   * Shared secret for service-to-service calls. When unset, the internal path is DISABLED — an
   * unconfigured secret must never mean "any internal header is acceptable".
   */
  internalSecret?: string;
}

/** Constant-time compare that also rejects on length, so a prefix cannot pass. */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Minimal RS256 JWT verification using Node.js built-in `crypto` — no external dependency
 * on `jsonwebtoken` in the common lib (that dep lives in auth-service only).
 */
function verifyRS256(token: string, publicKeyPem: string, issuer: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const headerRaw = Buffer.from(headerB64, 'base64url').toString();
  const payloadRaw = Buffer.from(payloadB64, 'base64url').toString();
  const signature = Buffer.from(signatureB64, 'base64url');

  const header = JSON.parse(headerRaw) as { alg?: string };
  if (header.alg !== 'RS256') throw new Error('unsupported algorithm');

  // Verify signature
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const key = createPublicKey(publicKeyPem);
  if (!verifier.verify(key, signature)) throw new Error('invalid signature');

  const payload = JSON.parse(payloadRaw) as Record<string, unknown>;

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('token expired');

  // Check issuer
  if (payload.iss !== issuer) throw new Error('issuer mismatch');

  return payload;
}

/**
 * NestJS guard that enforces JWT-based authentication (§B2.3).
 *
 * Flow:
 * 1. Check `@Public()` metadata — skip if set.
 * 2. Extract `Authorization: Bearer <token>` from the request.
 * 3. Verify the RS256 JWT against the configured public key + issuer.
 * 4. Attach the verified {@link VerifiedPrincipal} to `request.user`.
 * 5. Throw 401 on any failure (missing, malformed, expired, wrong issuer).
 *
 * Apply at the controller class level: `@UseGuards(JwtAuthGuard)`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly opts: JwtAuthGuardOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip JWT check on @Public() endpoints.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request0 = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: VerifiedPrincipal;
    }>();

    // Service-to-service: only on endpoints that opted in, and only with a configured secret.
    const allowsInternal = this.reflector.getAllAndOverride<boolean>(ALLOW_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const presented = request0.headers[INTERNAL_HEADER];
    if (allowsInternal && this.opts.internalSecret && presented) {
      if (secretMatches(presented, this.opts.internalSecret)) {
        // A system principal, explicitly not a user, so nothing downstream mistakes it for one.
        request0.user = { accountId: 'system', deviceId: 'internal', scope: 'internal' };
        return true;
      }
      // A wrong secret is not fatal on its own — the caller may still hold a valid user token.
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: VerifiedPrincipal;
    }>();

    const authHeader = request.headers['authorization'] ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedError('Missing access token');
    }

    let payload: Record<string, unknown>;
    try {
      payload = verifyRS256(token, this.opts.publicKeyPem, this.opts.issuer);
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    const accountId = payload.account_id as string | undefined;
    const deviceId = payload.device_id as string | undefined;
    if (!accountId || !deviceId) {
      throw new UnauthorizedError('Malformed access token — missing principal claims');
    }

    request.user = {
      accountId,
      deviceId,
      tenantId: payload.tenant_id as string | undefined,
      role: payload.role as string | undefined,
      scope: payload.scope as string | undefined,
    };

    return true;
  }
}
