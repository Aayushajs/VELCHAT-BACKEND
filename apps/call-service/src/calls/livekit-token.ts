import jwt from 'jsonwebtoken';

export interface LivekitGrant {
  /** Room to join (the call's `room_name`). */
  room: string;
  /** Participant identity — the account_id. */
  identity: string;
  displayName?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  ttlSec?: number;
}

/**
 * Mint a LiveKit access token (§A17.1). A LiveKit token is a plain HS256 JWT signed with the API
 * secret, carrying a `video` grant — so we don't need the livekit-server-sdk to issue join tokens.
 * The client connects to LIVEKIT_URL with this token; coturn/LiveKit handle the media plane.
 */
export function mintLivekitToken(apiKey: string, apiSecret: string, grant: LivekitGrant): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = grant.ttlSec && grant.ttlSec > 0 ? grant.ttlSec : 3600;
  return jwt.sign(
    {
      iss: apiKey,
      sub: grant.identity,
      nbf: now,
      exp: now + ttl,
      name: grant.displayName,
      video: {
        room: grant.room,
        roomJoin: true,
        canPublish: grant.canPublish ?? true,
        canSubscribe: grant.canSubscribe ?? true,
      },
    },
    apiSecret,
    { algorithm: 'HS256' },
  );
}
