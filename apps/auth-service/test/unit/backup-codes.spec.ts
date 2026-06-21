import {
  generateBackupCodes,
  verifyBackupCode,
  hashCode,
} from '../../src/auth/recovery/backup-codes';

describe('backup codes (§B2.7)', () => {
  it('generates codes whose hashes verify', () => {
    const { codes, hashes } = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(hashes).toHaveLength(10);
    for (const code of codes) {
      expect(verifyBackupCode(code, hashes)).toBe(true);
    }
  });

  it('rejects an unknown code', () => {
    const { hashes } = generateBackupCodes(5);
    expect(verifyBackupCode('deadbeef00', hashes)).toBe(false);
  });

  it('only stores hashes (never the plaintext code)', () => {
    const { codes, hashes } = generateBackupCodes(1);
    expect(hashes[0]).not.toBe(codes[0]);
    expect(hashes[0]).toBe(hashCode(codes[0] as string));
  });
});
