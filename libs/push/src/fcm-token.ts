import jwt from 'jsonwebtoken';

export interface GoogleServiceAccount {
  clientEmail: string;
  /** PEM private key. Env-escaped `\n` is unescaped automatically. */
  privateKey: string;
  tokenUri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/**
 * Mints + caches a Google service-account OAuth2 access token for FCM HTTP v1 (§A3.5) — the standard
 * JWT-bearer assertion flow, so we avoid the heavy firebase-admin dependency. The private key lives
 * in env/secrets (never in the repo). Returns a provider the FcmSender calls per send (cached to exp).
 */
export function createGoogleAccessToken(sa: GoogleServiceAccount): () => Promise<string> {
  const tokenUri = sa.tokenUri ?? DEFAULT_TOKEN_URI;
  const privateKey = sa.privateKey.replace(/\\n/g, '\n'); // unescape env-stored newlines
  let cached: { token: string; expEpoch: number } | null = null;

  return async () => {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expEpoch - 60 > now) return cached.token;

    const assertion = jwt.sign(
      { iss: sa.clientEmail, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 },
      privateKey,
      { algorithm: 'RS256' },
    );
    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, expEpoch: now + json.expires_in };
    return json.access_token;
  };
}
