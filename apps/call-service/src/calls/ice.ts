import { createHmac } from 'node:crypto';

/** An RTCIceServer entry the client feeds straight into `new RTCPeerConnection({ iceServers })`. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnConfig {
  /** CSV of STUN urls (e.g. "stun:host:3478"). */
  stunUrls: string;
  /** CSV of TURN urls (e.g. "turn:host:3478,turns:host:5349"). */
  turnUrls: string;
  /** coturn static-auth-secret; enables time-limited TURN credentials. */
  turnSecret?: string;
  /** Credential lifetime in seconds. */
  ttlSec: number;
}

const csv = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Build the ICE server list for a raw/P2P WebRTC call (§A17.1), self-hosted coturn only — nothing
 * paid, nothing external baked in. STUN needs no auth. TURN uses coturn's REST-API scheme
 * (`use-auth-secret`): `username = <unixExpiry>:<userId>`, `credential = base64(HMAC-SHA1(secret,
 * username))` — a short-lived credential the client can't forge and the server never stores. Pure +
 * deterministic (takes `now`) so it's unit-testable. Returns [] when nothing is configured.
 */
export function buildIceServers(cfg: TurnConfig, userId: string, nowMs: number): IceServer[] {
  const servers: IceServer[] = [];
  const stun = csv(cfg.stunUrls);
  if (stun.length > 0) servers.push({ urls: stun });

  const turn = csv(cfg.turnUrls);
  if (turn.length > 0 && cfg.turnSecret) {
    const expiry = Math.floor(nowMs / 1000) + cfg.ttlSec;
    const username = `${expiry}:${userId}`;
    const credential = createHmac('sha1', cfg.turnSecret).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
  }
  return servers;
}
