import { randomBytes, createHash } from 'node:crypto';

/** Recovery backup codes (§B2.1/§B2.7). Codes shown once; only hashes are stored. */
export function generateBackupCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = randomBytes(5).toString('hex'); // 10 hex chars
    codes.push(code);
    hashes.push(hashCode(code));
  }
  return { codes, hashes };
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

export function verifyBackupCode(code: string, hashes: string[]): boolean {
  return hashes.includes(hashCode(code));
}
