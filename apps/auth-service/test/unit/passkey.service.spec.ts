import { PasskeyService } from '../../src/auth/passkey.service';

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

const rp = { rpID: 'localhost', rpName: 'VelChat', origin: 'http://localhost:8080' };

describe('PasskeyService (§B2.5 WebAuthn)', () => {
  it('registrationOptions returns a challenge', async () => {
    const svc = new PasskeyService(rp, fakeRedis());
    const options = await svc.registrationOptions('acc-1', 'alice');
    expect(typeof options.challenge).toBe('string');
    expect(options.challenge.length).toBeGreaterThan(0);
  });

  it('authenticationOptions returns a challenge', async () => {
    const svc = new PasskeyService(rp, fakeRedis());
    const options = await svc.authenticationOptions('acc-1', []);
    expect(typeof options.challenge).toBe('string');
  });

  // The attestation/assertion verification needs a real browser ceremony → covered by e2e (P1.7).
  it.todo('verifyRegistration accepts a real attestation response (browser e2e)');
  it.todo('verifyAuthentication accepts a real assertion response (browser e2e)');
});
