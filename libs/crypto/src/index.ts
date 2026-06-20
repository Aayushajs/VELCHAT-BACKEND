/**
 * @velchat/crypto — Signal Protocol boundary (§B6).
 *
 * THE E2EE BOUNDARY IS SACRED (CLAUDE.md §2). The real X3DH + Double Ratchet runs ON-DEVICE
 * in the clients (libsignal). On the server, personal-conversation content is ALWAYS opaque
 * ciphertext — the server transports and stores it but can never read it.
 *
 * This package therefore exposes:
 *  - an opaque, branded `Ciphertext` type so plaintext can't be mistaken for ciphertext;
 *  - the PUBLIC prekey-directory shapes the server legitimately stores (§B6 — public keys only);
 *  - a client-only `SignalClient` interface (the implementation lives in the client repos);
 *  - server-side guards that throw if any code attempts to treat E2EE content as readable.
 */

declare const opaqueBrand: unique symbol;

/** Opaque E2EE blob. The server stores/relays it but must never decrypt or inspect it. */
export type Ciphertext = string & { readonly [opaqueBrand]: 'Ciphertext' };

export function asCiphertext(base64: string): Ciphertext {
  return base64 as Ciphertext;
}

// ── Public prekey directory (server-stored; PUBLIC material only, §B6) ───────
export interface IdentityPublicKey {
  account_id: string;
  device_id: string;
  /** Base64 of the device's long-term identity public key. */
  public_key: string;
}

export interface SignedPreKey {
  key_id: number;
  public_key: string; // base64
  signature: string; // base64, signed by the identity key
}

export interface OneTimePreKey {
  key_id: number;
  public_key: string; // base64
}

/** A prekey bundle a sender fetches to start an X3DH session. All fields are PUBLIC. */
export interface PreKeyBundle {
  identity: IdentityPublicKey;
  signed_prekey: SignedPreKey;
  one_time_prekey?: OneTimePreKey;
  /** Versioned device-list epoch this bundle is bound to (§G1-3). */
  device_list_epoch: number;
}

// ── Client-only Signal interface (implemented on-device, NOT on the server) ──
export interface SignalClient {
  encrypt(recipient: PreKeyBundle, plaintext: Uint8Array): Promise<Ciphertext>;
  decrypt(ciphertext: Ciphertext): Promise<Uint8Array>;
}

/**
 * Server-side guard. Calling this from any server path that "needs the plaintext" is a
 * design error — it throws to make the violation loud during development/review.
 */
export function refuseServerSidePlaintext(context: string): never {
  throw new Error(
    `E2EE violation: attempted to access personal plaintext on the server (${context}). ` +
      `Personal content is end-to-end encrypted; decryption only happens on-device (§B6).`,
  );
}
