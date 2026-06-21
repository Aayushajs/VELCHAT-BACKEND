import {
  ktEntryHash,
  verifyKtChain,
  KT_GENESIS,
  type KtEntry,
} from '../../src/auth/devices/key-transparency';

function chain(actions: Array<{ deviceId: string; action: KtEntry['action'] }>): KtEntry[] {
  let prev = KT_GENESIS;
  return actions.map((a, i) => {
    const fields = {
      accountId: 'acc-1',
      deviceId: a.deviceId,
      action: a.action,
      identityKeyHash: `idk-${i}`,
      epoch: i + 1,
      ts: `2026-06-21T00:00:0${i}.000Z`,
    };
    const entryHash = ktEntryHash(prev, fields);
    const entry: KtEntry = { ...fields, prevHash: prev, entryHash };
    prev = entryHash;
    return entry;
  });
}

describe('key transparency (§G1-3)', () => {
  it('verifies an unbroken chain from genesis', () => {
    const entries = chain([
      { deviceId: 'd1', action: 'proposed' },
      { deviceId: 'd1', action: 'approved' },
      { deviceId: 'd2', action: 'approved' },
    ]);
    expect(verifyKtChain(entries)).toBe(-1);
  });

  it('detects a tampered entry (silent ghost-device injection)', () => {
    const entries = chain([
      { deviceId: 'd1', action: 'approved' },
      { deviceId: 'ghost', action: 'approved' },
    ]);
    // Attacker rewrites entry 1's device but keeps the old hash → chain check catches it.
    entries[1] = { ...entries[1]!, deviceId: 'innocent-looking' };
    expect(verifyKtChain(entries)).toBe(1);
  });

  it('detects a broken link (deleted/reordered entry)', () => {
    const entries = chain([
      { deviceId: 'd1', action: 'approved' },
      { deviceId: 'd2', action: 'approved' },
      { deviceId: 'd3', action: 'approved' },
    ]);
    entries.splice(1, 1); // drop the middle entry
    expect(verifyKtChain(entries)).toBe(1);
  });
});
