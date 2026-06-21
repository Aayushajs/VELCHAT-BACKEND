import { createHash } from 'node:crypto';

export type KtAction = 'proposed' | 'approved' | 'revoked';

export interface KtEntryFields {
  accountId: string;
  deviceId: string | null;
  action: KtAction;
  identityKeyHash: string | null;
  epoch: number;
  ts: string;
}

export interface KtEntry extends KtEntryFields {
  prevHash: string;
  entryHash: string;
}

/** Genesis link for an account with no prior entries. */
export const KT_GENESIS = '0'.repeat(64);

/**
 * Key-transparency hash chain (§G1-3, CONIKS-lite). Each device-list change appends an entry whose
 * hash commits to the previous one, so a client can verify the list it was handed is consistent with
 * the global, append-only history — turning a silent ghost-device injection into a detectable one.
 */
export function ktEntryHash(prevHash: string, f: KtEntryFields): string {
  return createHash('sha256')
    .update(
      [
        prevHash,
        f.accountId,
        f.deviceId ?? '',
        f.action,
        f.identityKeyHash ?? '',
        String(f.epoch),
        f.ts,
      ].join('|'),
    )
    .digest('hex');
}

/** Verify an account's chain links unbroken from genesis. Returns the index of the first break, or -1. */
export function verifyKtChain(entries: KtEntry[]): number {
  let prev = KT_GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    if (e.prevHash !== prev) return i;
    if (e.entryHash !== ktEntryHash(e.prevHash, e)) return i;
    prev = e.entryHash;
  }
  return -1;
}
