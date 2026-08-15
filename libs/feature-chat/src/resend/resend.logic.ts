/**
 * Decryption-failure resend protocol (§G1-1). When a recipient device receives a ciphertext it
 * cannot decrypt (ratchet skipped past it / lost session / consumed prekey), it asks the sender to
 * RE-ENCRYPT the current plaintext in a FRESH ratchet message. Bounded retries; once exhausted the
 * message is surfaced as permanently unrecoverable rather than silently lost.
 *
 * Per-request state machine:
 *   REQUESTED → FULFILLED            (sender re-sent; recipient can decrypt)
 *   REQUESTED → REQUESTED (retry)    (still failed, attempts remaining)
 *   REQUESTED → EXHAUSTED            (attempts cap hit → UNRECOVERABLE, shown to the user)
 *
 * SECURITY (§G1-1): the resend re-encrypts the sender's CURRENT ratchet state — it never rewinds the
 * ratchet — so forward secrecy / post-compromise security are preserved. The server only transports
 * the request + the fresh ciphertext; it never sees plaintext.
 */
export type ResendStatus = 'requested' | 'fulfilled' | 'exhausted';

export const MAX_RESEND_ATTEMPTS = 5;

/** Decide what a new resend attempt should do, given how many have already happened. */
export function decideResend(
  priorAttempts: number,
  maxAttempts = MAX_RESEND_ATTEMPTS,
): { allowed: boolean; status: ResendStatus } {
  if (priorAttempts >= maxAttempts) return { allowed: false, status: 'exhausted' };
  return { allowed: true, status: 'requested' };
}

/** Is this request in a terminal state (no further action possible)? */
export function isTerminal(status: ResendStatus): boolean {
  return status === 'fulfilled' || status === 'exhausted';
}
