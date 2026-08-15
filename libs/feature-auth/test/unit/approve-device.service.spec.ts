import { generateKeyPairSync, sign } from 'node:crypto';
import { ApproveDeviceService } from '../../src/auth/dapt/approve-device.service';

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

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { der: publicKey.export({ format: 'der', type: 'spki' }) as Buffer, privateKey };
}

describe('ApproveDeviceService (§B2.5 approve-on-trusted-device)', () => {
  it('request stores a link the trusted device can fetch', async () => {
    const svc = new ApproveDeviceService(fakeRedis());
    const { linkId, challenge } = await svc.request('NEWKEY', 'web');
    const req = await svc.getRequest(linkId);
    expect(req.challenge).toBe(challenge);
    expect(req.newDevicePubkeyDer).toBe('NEWKEY');
  });

  it('accepts a valid approver signature over the challenge', async () => {
    const { der, privateKey } = ed25519();
    const svc = new ApproveDeviceService(fakeRedis());
    const { challenge } = await svc.request('NEWKEY', 'web');
    const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64');
    expect(() => svc.verifyApproval(challenge, der, signature)).not.toThrow();
  });

  it('rejects a forged approver signature', () => {
    const { der } = ed25519();
    const other = ed25519();
    const svc = new ApproveDeviceService(fakeRedis());
    const challenge = 'fixed-challenge';
    const forged = sign(null, Buffer.from(challenge), other.privateKey).toString('base64');
    expect(() => svc.verifyApproval(challenge, der, forged)).toThrow(/signature invalid/i);
  });
});
