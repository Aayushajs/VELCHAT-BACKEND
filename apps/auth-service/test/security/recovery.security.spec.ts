import { RecoveryService } from '../../src/auth/recovery.service';

function fakeRedis() {
  const map = new Map<string, string>();
  return {
    async set(key: string, value: string) {
      map.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async del(key: string) {
      map.delete(key);
    },
  } as never;
}

describe('RecoveryService (§B2.7 — no weak back door)', () => {
  it('requires 2 distinct factors before completion', async () => {
    const svc = new RecoveryService(fakeRedis());
    const { recoveryId } = await svc.begin('acc-1', false); // no cooling-off for this test
    await svc.addFactor(recoveryId, 'email-link');
    await expect(svc.assertCompletable(recoveryId)).rejects.toThrow(/needs 2 factors/i);
    await svc.addFactor(recoveryId, 'backup-code');
    await expect(svc.assertCompletable(recoveryId)).resolves.toMatchObject({ accountId: 'acc-1' });
  });

  it('does not double-count the same factor', async () => {
    const svc = new RecoveryService(fakeRedis());
    const { recoveryId } = await svc.begin('acc-1', false);
    await svc.addFactor(recoveryId, 'passkey');
    const res = await svc.addFactor(recoveryId, 'passkey');
    expect(res.factors).toBe(1);
    await expect(svc.assertCompletable(recoveryId)).rejects.toThrow(/needs 2 factors/i);
  });

  it('enforces a cooling-off delay for high-risk recovery', async () => {
    const svc = new RecoveryService(fakeRedis());
    const { recoveryId, delaySec } = await svc.begin('acc-1', true);
    expect(delaySec).toBeGreaterThan(0);
    await svc.addFactor(recoveryId, 'email-link');
    await svc.addFactor(recoveryId, 'reverse-otp');
    await expect(svc.assertCompletable(recoveryId)).rejects.toThrow(/cooling-off/i);
  });

  it('reverse-otp alone is never enough (single factor)', async () => {
    const svc = new RecoveryService(fakeRedis());
    const { recoveryId } = await svc.begin('acc-1', false);
    await svc.addFactor(recoveryId, 'reverse-otp');
    await expect(svc.assertCompletable(recoveryId)).rejects.toThrow(/needs 2 factors/i);
  });
});
