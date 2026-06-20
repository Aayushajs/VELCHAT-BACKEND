import {
  ReverseOtpService,
  ReverseOtpRejected,
  type InboundProof,
  type ReverseOtpSession,
  type ReverseOtpStore,
} from '../../src/auth/reverse-otp.service';

class MemoryStore implements ReverseOtpStore {
  private map = new Map<string, ReverseOtpSession>();
  async put(s: ReverseOtpSession): Promise<void> {
    this.map.set(s.sessionId, { ...s });
  }
  async get(id: string): Promise<ReverseOtpSession | null> {
    return this.map.get(id) ?? null;
  }
  async del(id: string): Promise<void> {
    this.map.delete(id);
  }
}

const PHONE = '+919999000011';

async function setup() {
  const store = new MemoryStore();
  const svc = new ReverseOtpService(store, { ttlSec: 300, riskThreshold: 70 });
  const { token } = await svc.start(PHONE, 'sess-1');
  return { svc, token };
}

function proof(over: Partial<InboundProof>, token: string): InboundProof {
  return {
    sessionId: 'sess-1',
    cli: PHONE,
    path: 'sms',
    token,
    originationClass: 'mobile',
    attestation: 'genuine',
    riskScore: 10,
    ts: Date.now(),
    ...over,
  };
}

describe('Reverse-OTP anti-spoof (§B2.2 / §D4)', () => {
  it('happy path: all rules pass → verified', async () => {
    const { svc, token } = await setup();
    const res = await svc.verify(proof({}, token));
    expect(res.verified).toBe(true);
    expect(res.phone).toBe(PHONE);
  });

  it('rule 1 — CLI/sender mismatch rejected', async () => {
    const { svc, token } = await setup();
    await expect(svc.verify(proof({ cli: '+919999999999' }, token))).rejects.toMatchObject({
      rule: 'cli-match',
    });
  });

  it('rule 2 — wrong token rejected', async () => {
    const { svc } = await setup();
    await expect(svc.verify(proof({ token: '000000' }, '000000'))).rejects.toMatchObject({
      rule: 'token',
    });
  });

  it('rule 2 — expired time-window rejected', async () => {
    const { svc, token } = await setup();
    await expect(
      svc.verify(proof({ ts: Date.now() + 10 * 60 * 1000 }, token)),
    ).rejects.toMatchObject({ rule: 'time-window' });
  });

  it('rule 3 — VoIP/SIP origination rejected', async () => {
    const { svc, token } = await setup();
    await expect(svc.verify(proof({ originationClass: 'voip' }, token))).rejects.toMatchObject({
      rule: 'origination',
    });
  });

  it('rule 4 — failed attestation rejected', async () => {
    const { svc, token } = await setup();
    await expect(svc.verify(proof({ attestation: 'failed' }, token))).rejects.toMatchObject({
      rule: 'attestation',
    });
  });

  it('rule 5 — high risk score rejected', async () => {
    const { svc, token } = await setup();
    await expect(svc.verify(proof({ riskScore: 95 }, token))).rejects.toMatchObject({
      rule: 'risk',
    });
  });

  it('rejects when no pending session exists', async () => {
    const { svc, token } = await setup();
    await expect(svc.verify(proof({ sessionId: 'nope' }, token))).rejects.toBeInstanceOf(
      ReverseOtpRejected,
    );
  });
});
