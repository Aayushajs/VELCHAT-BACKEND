import { generateKeyPairSync, sign } from 'node:crypto';
import { DeviceKeyService } from '../../src/auth/dapt/device-key.service';

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
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { der, privateKey };
}

describe('DeviceKeyService (§B2.5 same-device login)', () => {
  it('verifies a valid signature over the challenge nonce', async () => {
    const { der, privateKey } = ed25519();
    const svc = new DeviceKeyService(fakeRedis());
    const { nonce } = await svc.challenge('dev-1');
    const signature = sign(null, Buffer.from(nonce), privateKey).toString('base64');
    await expect(svc.verify('dev-1', signature, der)).resolves.toBeUndefined();
  });

  it('rejects a signature from the wrong key', async () => {
    const { der } = ed25519();
    const other = ed25519();
    const svc = new DeviceKeyService(fakeRedis());
    const { nonce } = await svc.challenge('dev-1');
    const forged = sign(null, Buffer.from(nonce), other.privateKey).toString('base64');
    await expect(svc.verify('dev-1', forged, der)).rejects.toThrow(/signature invalid/i);
  });

  it('rejects when there is no active challenge', async () => {
    const { der } = ed25519();
    const svc = new DeviceKeyService(fakeRedis());
    await expect(svc.verify('dev-x', 'AA==', der)).rejects.toThrow(/No active/i);
  });
});
