import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sign a webhook payload so the receiving bot can verify it came from us (§B17). HMAC-SHA256 over the
 * exact JSON body with the bot's shared secret → hex digest sent in the `X-Velchat-Signature` header.
 */
export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Constant-time verify of a received signature (for inbound bot callbacks). */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
