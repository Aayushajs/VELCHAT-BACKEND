import type { AppConfig } from '@velchat/config';

const DEFAULT_ISSUER = 'https://auth.velchat.local';

/** Outcome of the boot-time auth decision. `verify: false` is reachable in development only. */
export interface AuthMode {
  verify: boolean;
  publicKeyPem?: string;
  issuer?: string;
}

/**
 * Decide, at boot, whether this service can verify access tokens — and refuse to start if it
 * cannot (DEF-02).
 *
 * The audit found 11 of 13 services serving every route unauthenticated, so the fix has to be
 * structural rather than a checklist: a service that lacks the public key does not come up. There
 * is exactly one escape hatch, `AUTH_DEV_INSECURE=true`, it is refused in production, and it is
 * named so it is obvious in a diff, a grep, and an env dump.
 */
export function resolveAuthMode(config: AppConfig): AuthMode {
  const isProduction = config.NODE_ENV === 'production';
  const publicKeyPem = config.JWT_PUBLIC_PEM?.trim();

  if (config.AUTH_DEV_INSECURE && isProduction) {
    throw new Error(
      `${config.SERVICE_NAME}: AUTH_DEV_INSECURE is set in production. ` +
        'Authentication cannot be disabled in production — unset it and set JWT_PUBLIC_PEM.',
    );
  }

  if (publicKeyPem) {
    return { verify: true, publicKeyPem, issuer: config.JWT_ISSUER ?? DEFAULT_ISSUER };
  }

  if (config.AUTH_DEV_INSECURE) return { verify: false };

  throw new Error(
    `${config.SERVICE_NAME}: JWT_PUBLIC_PEM is not set, so this service cannot verify access ` +
      'tokens and refuses to start. Set JWT_PUBLIC_PEM (the RS256 public half — it is public, ' +
      'safe to distribute to every service), or set AUTH_DEV_INSECURE=true for local development.',
  );
}
