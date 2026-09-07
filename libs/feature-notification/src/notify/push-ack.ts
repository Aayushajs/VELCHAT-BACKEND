/**
 * Device-authenticated delivery/read acks (§B4.4 + §B10).
 *
 * ## Why this exists
 *
 * Receipts were WebSocket-only. That made one very visible product promise impossible: a message
 * sent to someone whose phone is online but whose APP IS CLOSED stayed on a single tick forever,
 * because the only path that could say "delivered" required a live socket. WhatsApp shows two
 * ticks in that case, and it does it the only way it can be done honestly — the DEVICE
 * acknowledges after the push wakes it.
 *
 * A woken Android app has no usable JWT: the access token has almost certainly expired, and
 * refreshing from native is not an option because `AuthService.refresh` ROTATES the refresh token
 * with reuse-detection (`token.service.rotateRefresh`). A native refresh that the JS side never
 * learns about would hand the app a dead token family on its next launch — i.e. a silent logout.
 * That is a strictly worse bug than a missing tick.
 *
 * So the ack is authenticated by the credential the woken process demonstrably HAS: its own push
 * token. It is a device-bound secret (only that handset and the push provider know it), we already
 * store it against `device_id`, and the pair is exactly the claim being made — "the device this
 * push was addressed to received it".
 *
 * ## What an attacker holding a stolen push token can do
 *
 * Advance one conversation's delivered/read watermark for the user that token belongs to, in
 * conversations that user is already a member of. Watermarks are monotonic (§B4.4), so it cannot
 * be rewound and no content is exposed. That is the entire blast radius, and it is why this
 * endpoint is deliberately limited to receipts: a message SEND authenticated this way would be a
 * completely different risk, and is not offered.
 *
 * This module is PURE — parsing and validation only, no I/O, so every rejection above is unit
 * tested rather than discovered in production.
 */

export type DeviceAckState = 'delivered' | 'read';

export interface DeviceAck {
  readonly deviceId: string;
  readonly pushToken: string;
  readonly conversationId: string;
  readonly upToSeq: number;
  readonly state: DeviceAckState;
}

/** An FCM registration token is ~160 chars; APNs is 64 hex. Bound it so a body can't be abused. */
const MAX_TOKEN_LEN = 4096;
const MAX_ID_LEN = 200;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Validate an inbound ack body, returning `null` for anything that must not be acted on.
 *
 * `upToSeq` is accepted as a string as well as a number on purpose: every value in an FCM data
 * payload is a string on the wire, so the client reads `seq` back as `"42"`. Requiring a number
 * here would have made every native ack a 400 — and the failure would have been invisible, since
 * a dropped ack looks exactly like the bug this endpoint fixes.
 */
export function parseDeviceAck(body: unknown): DeviceAck | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  const deviceId = str(b.deviceId, MAX_ID_LEN);
  const pushToken = str(b.pushToken ?? b.token, MAX_TOKEN_LEN);
  const conversationId = str(b.conversationId, MAX_ID_LEN);
  if (!deviceId || !pushToken || !conversationId) return null;

  const state = b.state === 'read' ? 'read' : b.state === 'delivered' ? 'delivered' : null;
  if (!state) return null;

  const raw = b.upToSeq ?? b.up_to_seq ?? b.seq;
  const upToSeq = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(upToSeq) || upToSeq <= 0 || !Number.isSafeInteger(Math.floor(upToSeq))) {
    return null;
  }

  return { deviceId, pushToken, conversationId, upToSeq: Math.floor(upToSeq), state };
}

/**
 * Emits the durable receipt event. Implemented over the event bus by the composition root, so
 * this feature keeps no dependency on feature-realtime (which owns the socket-side publisher).
 */
export interface DeviceReceiptEmitter {
  emit(
    state: DeviceAckState,
    userId: string,
    conversationId: string,
    upToSeq: number,
  ): Promise<void>;
}
