// End-to-end OTP / auth check against a RUNNING auth-service. Walks the Reverse-OTP cold-start
// happy path (§B2.2/§B2.4, flow C1) with the missed-call proof, then the device-key login (§B2.5):
//
//   register → revotp/webhook (anti-spoof) → session (tokens) → challenge → login/device-key
//
// This proves the OTP state machine + token issuance + device-key crypto all work together. It needs
// the service up (default http://localhost:3002; override AUTH_BASE_URL). It uses a random test number
// each run so it never collides with real data. No external SMS/DID is used — the webhook is the DID.
//
//   node scripts/test-otp.mjs
import { generateKeyPairSync, sign as edSign, randomInt } from 'node:crypto';
import { ui, done } from './_shared.mjs';

// 127.0.0.1 (not "localhost") — Node's fetch resolves localhost to ::1 on Windows, but services
// bind IPv4, so localhost would spuriously fail. Override with AUTH_BASE_URL for a deployed host.
const BASE = process.env.AUTH_BASE_URL || 'http://127.0.0.1:3002';
ui.title(`OTP / auth end-to-end  (${BASE})`);

// Unwrap the response envelope { success, statusCode, message, data }.
async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = json.message || json.error?.code || `HTTP ${res.status}`;
    throw new Error(`${path} → ${msg}`);
  }
  return json.data ?? json;
}

let failed = false;
try {
  // Device keypair (Ed25519). Private key stays local; public key (SPKI/DER) is registered.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const devicePubkeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const phone = `+1555${String(randomInt(1_000_000, 9_999_999))}`;
  ui.info(`test number ${phone}`);

  // 1) Cold-start: enter number → Reverse-OTP session.
  const { sessionId } = await call('/auth/register', {
    phone,
    platform: 'android',
    devicePubkeyBase64,
  });
  ui.ok(`register → session ${sessionId.slice(0, 8)}…`);

  // 2) The DID webhook reports a genuine missed-call proof; anti-spoof rules must pass.
  await call('/auth/revotp/webhook', {
    sessionId,
    cli: phone,
    path: 'missed-call',
    originationClass: 'mobile',
    attestation: 'genuine',
    riskScore: 0,
    ts: Date.now(),
  });
  ui.ok('revotp/webhook → verified (anti-spoof passed: mobile + genuine + low risk)');

  // 3) Client fetches its provisioned tokens.
  const provisioned = await call('/auth/session', { sessionId });
  if (!provisioned.access || !provisioned.deviceId) throw new Error('session returned no tokens');
  ui.ok(`session → account ${provisioned.accountId.slice(0, 8)}…, device ${provisioned.deviceId.slice(0, 8)}…, access token issued`);

  // 4) Device-key login: get a nonce, sign it, present the signature (no OTP — DAPT step 1).
  const { nonce } = await call('/auth/challenge', { deviceId: provisioned.deviceId });
  const signature = edSign(null, Buffer.from(nonce), privateKey).toString('base64');
  const loggedIn = await call('/auth/login/device-key', {
    deviceId: provisioned.deviceId,
    signature,
  });
  if (!loggedIn.access) throw new Error('device-key login returned no access token');
  ui.ok('challenge + login/device-key → fresh tokens (friction-free re-login works)');

  ui.line();
  ui.ok('Full Reverse-OTP + device-key flow works end to end.');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|other side closed/i.test(msg)) {
    ui.warn(`auth-service not reachable at ${BASE}.`);
    ui.info('Start it first:  pnpm --filter @velchat/auth-service dev   (or ./start-all.ps1)');
    ui.info('Then re-run:      node scripts/test-otp.mjs');
  } else {
    failed = true;
    ui.fail(msg);
  }
}
done(failed);
