import { AuthService } from '../../src/auth/auth.service';
import { ConflictError, RateLimitError, UnauthorizedError } from '@velchat/common';

/**
 * Orchestration unit tests for AuthService — every dependency is a light fake (jest.fn), so we
 * exercise the state-machine logic (register, Reverse-OTP webhook registration vs number-change,
 * refresh, device-key login, magic-link, approve-device, recovery) without infra.
 */
function makeAuth() {
  const store = new Map<string, string>();
  const repo = {
    createAccount: jest.fn(async () => 'acc-new'),
    upsertVerifiedIdentifier: jest.fn(async () => undefined),
    addDevice: jest.fn(async () => 'dev-new'),
    audit: jest.fn(async () => undefined),
    getDevice: jest.fn(async () => ({
      accountId: 'acc-1',
      trusted: true,
      pubkey: Buffer.from('k'),
    })),
    getDevicePubkey: jest.fn(async () => Buffer.from('k')),
    accountForDevice: jest.fn(async () => 'acc-1'),
    listDevices: jest.fn(async () => [{ device_id: 'dev-1' }, { device_id: 'dev-2' }]),
    revokeDeviceTokens: jest.fn(async () => undefined),
    revokeAllAccountTokens: jest.fn(async () => undefined),
    revokeDevice: jest.fn(async () => undefined),
    findVerifiedPhoneAccount: jest.fn(async (_phone?: string): Promise<string | null> => null),
    repointPhone: jest.fn(async () => undefined),
    consumeBackupCode: jest.fn(async () => true),
    storeBackupCodes: jest.fn(async () => undefined),
  };
  const tokens = {
    issueAccess: jest.fn(() => 'access-jwt'),
    issueRefresh: jest.fn(async () => ({ token: 'refresh-1', familyId: 'fam-1' })),
    rotateRefresh: jest.fn(async () => ({
      token: 'refresh-2',
      familyId: 'fam-1',
      deviceId: 'dev-1',
    })),
    revokeRefresh: jest.fn(async () => undefined),
  };
  const revotp = {
    start: jest.fn(async () => ({ token: '123456', expiresAt: Date.now() + 300000 })),
    verify: jest.fn(async () => ({ verified: true, phone: '+919990000000' })),
  };
  const otp = {
    send: jest.fn(async () => ({ message: 'OTP sent', resendAfter: 120, expiresIn: 900 })),
    verify: jest.fn(async () => ({ verified: true })),
  };
  const deviceKey = {
    challenge: jest.fn(async () => ({ nonce: 'n', expiresIn: 120 })),
    verify: jest.fn(async () => undefined),
  };
  const magicLink = {
    begin: jest.fn(async () => ({ sent: true })),
    consume: jest.fn(async () => ({ email: 'a@b.com', platform: 'web', devicePubkeyDer: 'AAAA' })),
  };
  const approve = {
    request: jest.fn(async () => ({ linkId: 'L1', challenge: 'c1' })),
    getRequest: jest.fn(async () => ({
      newDevicePubkeyDer: 'AAAA',
      platform: 'web',
      challenge: 'c1',
    })),
    verifyApproval: jest.fn(() => undefined),
    markApproved: jest.fn(async () => undefined),
    getResult: jest.fn(async () => null),
  };
  const passkey = {};
  const recovery = {
    begin: jest.fn(async () => ({ recoveryId: 'R1', delaySec: 0 })),
    addFactor: jest.fn(async () => ({ factors: 2 })),
    assertCompletable: jest.fn(async () => ({ accountId: 'acc-1', factors: ['a', 'b'] })),
    consume: jest.fn(async () => undefined),
  };
  const rateLimiter = { allow: jest.fn(async () => true) };
  const events = {
    userCreated: jest.fn(async () => undefined),
    deviceAdded: jest.fn(async () => undefined),
    identifierChanged: jest.fn(async () => undefined),
  };
  const redis = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
  const deps = {
    repo,
    tokens,
    revotp,
    otp,
    deviceKey,
    magicLink,
    approve,
    passkey,
    recovery,
    rateLimiter,
    events,
    redis,
    store,
  };
  const svc = new AuthService(
    repo as never,
    tokens as never,
    revotp as never,
    otp as never,
    deviceKey as never,
    magicLink as never,
    approve as never,
    passkey as never,
    recovery as never,
    rateLimiter as never,
    events as never,
    redis as never,
    900,
  );
  return { svc, deps };
}

const baseProof = {
  sessionId: 'sess-1',
  cli: '+919990000000',
  path: 'sms' as const,
  token: '123456',
  originationClass: 'mobile' as const,
  attestation: 'genuine' as const,
  riskScore: 10,
  ts: Date.now(),
};

describe('AuthService orchestration', () => {
  it('register starts a Reverse-OTP session (rate-limit allowed)', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.register({
      phone: '+91999',
      platform: 'web',
      devicePubkeyBase64: 'AAAA',
    });
    expect(res.sessionId).toBeDefined();
    expect(deps.revotp.start).toHaveBeenCalled();
  });

  it('register is rate-limited (§B2.8)', async () => {
    const { svc, deps } = makeAuth();
    deps.rateLimiter.allow.mockResolvedValueOnce(false);
    await expect(
      svc.register({ phone: '+91999', platform: 'web', devicePubkeyBase64: 'AAAA' }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('webhook → registration provisions account + device + tokens', async () => {
    const { svc, deps } = makeAuth();
    deps.store.set(
      'revotp:input:sess-1',
      JSON.stringify({ platform: 'web', devicePubkeyBase64: 'AAAA' }),
    );
    const res = await svc.handleReverseOtpWebhook(baseProof);
    expect(res.verified).toBe(true);
    expect(deps.repo.createAccount).toHaveBeenCalledWith('full');
    expect(deps.events.userCreated).toHaveBeenCalled();
  });

  it('webhook → number-change re-points the phone on the same account', async () => {
    const { svc, deps } = makeAuth();
    deps.store.set('numchange:sess-1', JSON.stringify({ accountId: 'acc-1' }));
    const res = await svc.handleReverseOtpWebhook(baseProof);
    expect(res.verified).toBe(true);
    expect(deps.repo.repointPhone).toHaveBeenCalledWith('acc-1', '+919990000000');
    expect(deps.events.identifierChanged).toHaveBeenCalledWith('acc-1', 'phone');
  });

  it('webhook → number-change blocks when number is on another account', async () => {
    const { svc, deps } = makeAuth();
    deps.store.set('numchange:sess-1', JSON.stringify({ accountId: 'acc-1' }));
    deps.repo.findVerifiedPhoneAccount.mockResolvedValueOnce('acc-OTHER');
    await expect(svc.handleReverseOtpWebhook(baseProof)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refresh rotates and issues a new access token', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.refresh('refresh-1');
    expect(res.access).toBe('access-jwt');
    expect(res.refresh).toBe('refresh-2');
    expect(deps.tokens.rotateRefresh).toHaveBeenCalled();
  });

  it('device-key login verifies the signature and issues tokens', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.loginWithDeviceKey('dev-1', 'sig');
    expect(res.access).toBe('access-jwt');
    expect(deps.deviceKey.verify).toHaveBeenCalled();
  });

  it('magic-link verify provisions a limited-tier account', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.magicLinkVerify('tok');
    expect(res.accountId).toBe('acc-new');
    expect(deps.repo.createAccount).toHaveBeenCalledWith('limited');
  });

  it('approve-on-trusted links a new device under the approver account', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.linkApprove('L1', 'dev-1', 'sig');
    expect(res.approved).toBe(true);
    expect(deps.approve.verifyApproval).toHaveBeenCalled();
    expect(deps.approve.markApproved).toHaveBeenCalled();
  });

  it('recovery completes after 2 factors + cooling-off and revokes all sessions using batch query', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.recoveryComplete('R1');
    expect(res.recovered).toBe(true);
    // Batch query eliminates N+1 loop over devices.
    expect(deps.repo.revokeAllAccountTokens).toHaveBeenCalledTimes(1);
    expect(deps.repo.revokeAllAccountTokens).toHaveBeenCalledWith('acc-1');
  });

  it('recovery via backup code adds the backup-code factor', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.recoveryUseBackupCode('R1', 'acc-1', 'code');
    expect(res.factors).toBe(2);
    expect(deps.recovery.addFactor).toHaveBeenCalledWith('R1', 'backup-code');
  });

  // ── 2Factor SMS OTP → session provisioning (OTP→token bridge) ──
  it('otp verify → new account provisions account + trusted device + tokens', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.verifyOtp('+919990000000', '123456', 'android', 'AAAA');
    expect(deps.otp.verify).toHaveBeenCalledWith('+919990000000', '123456');
    expect(deps.repo.findVerifiedPhoneAccount).toHaveBeenCalledWith('+919990000000');
    expect(deps.repo.createAccount).toHaveBeenCalledWith('full');
    expect(deps.repo.upsertVerifiedIdentifier).toHaveBeenCalledWith(
      'acc-new',
      'phone',
      '+919990000000',
    );
    expect(deps.repo.addDevice).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-new', platform: 'android', trusted: true }),
    );
    expect(deps.repo.audit).toHaveBeenCalledWith('user.registered', 'acc-new', 'dev-new');
    expect(deps.events.userCreated).toHaveBeenCalledWith('acc-new');
    expect(deps.events.deviceAdded).toHaveBeenCalledWith('acc-new', 'dev-new', true);
    expect(res).toEqual({
      accountId: 'acc-new',
      deviceId: 'dev-new',
      access: 'access-jwt',
      refresh: 'refresh-1',
      expiresIn: 900,
    });
  });

  it('otp verify → existing account reuses it, adds an untrusted device, no user.created', async () => {
    const { svc, deps } = makeAuth();
    deps.repo.findVerifiedPhoneAccount.mockResolvedValueOnce('acc-existing');
    const res = await svc.verifyOtp('+919990000000', '123456', 'ios', 'AAAA');
    expect(deps.repo.createAccount).not.toHaveBeenCalled();
    expect(deps.repo.upsertVerifiedIdentifier).not.toHaveBeenCalled();
    expect(deps.repo.addDevice).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-existing', platform: 'ios', trusted: false }),
    );
    expect(deps.repo.audit).toHaveBeenCalledWith('login.otp', 'acc-existing', 'dev-new');
    expect(deps.events.userCreated).not.toHaveBeenCalled();
    expect(deps.events.deviceAdded).toHaveBeenCalledWith('acc-existing', 'dev-new', false);
    expect(res.accountId).toBe('acc-existing');
    expect(res.access).toBe('access-jwt');
  });

  it('otp verify → a wrong OTP throws before any provisioning', async () => {
    const { svc, deps } = makeAuth();
    deps.otp.verify.mockRejectedValueOnce(new UnauthorizedError('Invalid OTP'));
    await expect(
      svc.verifyOtp('+919990000000', '000000', 'android', 'AAAA'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.repo.findVerifiedPhoneAccount).not.toHaveBeenCalled();
    expect(deps.repo.createAccount).not.toHaveBeenCalled();
    expect(deps.repo.addDevice).not.toHaveBeenCalled();
  });

  // ── Sign-out / device revocation ──
  it('logout revokes the presented refresh token family', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.logout('refresh-1');
    expect(res.loggedOut).toBe(true);
    expect(deps.tokens.revokeRefresh).toHaveBeenCalledWith('refresh-1');
  });

  it('revokeDevice marks the device revoked and kills its sessions (own account)', async () => {
    const { svc, deps } = makeAuth();
    const res = await svc.revokeDevice('acc-1', 'dev-1');
    expect(res.revoked).toBe(true);
    expect(deps.repo.revokeDevice).toHaveBeenCalledWith('dev-1');
    expect(deps.repo.revokeDeviceTokens).toHaveBeenCalledWith('dev-1');
    expect(deps.repo.audit).toHaveBeenCalledWith('device.revoked', 'acc-1', 'dev-1');
  });

  it('revokeDevice rejects a device that belongs to another account', async () => {
    const { svc, deps } = makeAuth();
    // getDevice returns accountId 'acc-1'; caller claims 'acc-OTHER' → unauthorized
    await expect(svc.revokeDevice('acc-OTHER', 'dev-1')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.repo.revokeDevice).not.toHaveBeenCalled();
  });
});
