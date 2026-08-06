import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createVerify, createPublicKey } from 'node:crypto';
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

/**
 * Mark an endpoint as public — the {@link JwtAuthGuard} will skip JWT verification.
 * Use on registration, webhook, JWKS, and other unauthenticated endpoints.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);

export interface JwtAuthGuardOptions {
  /** PEM-encoded RSA public key (or certificate) used to verify RS256 access JWTs. */
  publicKeyPem: string;
  /** Expected `iss` claim value (must match the auth-service issuer). */
  issuer: string;
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
