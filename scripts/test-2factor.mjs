// 2Factor SMS-OTP test command (§B2 additive method). Exercises send + verify either through the
// running auth-service (POST /auth/otp/send · /auth/otp/verify — the real rate-limited flow) or,
// with --direct, straight against the 2Factor API using OTP_API_KEY from .env (no service needed).
//
//   node scripts/test-2factor.mjs send   +919302633266            # via auth-service
//   node scripts/test-2factor.mjs verify +919302633266 123456     # via auth-service
//   node scripts/test-2factor.mjs send   +919302633266 --direct   # straight to 2Factor
//   node scripts/test-2factor.mjs verify +919302633266 123456 --direct
//
// AUTH_BASE_URL overrides the service base (default http://127.0.0.1:3002 — IPv4, see test-otp.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.AUTH_BASE_URL || 'http://127.0.0.1:3002';

/** Read a key from D:\Velchat\.env without a dotenv dependency (used only for --direct). */
function fromEnvFile(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(path.join(repoRoot, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line
      ? line
          .slice(key.length + 1)
          .split('#')[0]
          .trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function viaService(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, status: res.status, json };
}

async function viaDirect(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { ok: json.Status === 'Success', status: res.status, json };
}

async function main() {
  const [, , mode, phone, maybeOtp] = process.argv;
  const direct = process.argv.includes('--direct');
  if (!mode || !phone) {
    console.error('usage: node scripts/test-2factor.mjs <send|verify> <phone> [otp] [--direct]');
    process.exit(2);
  }
  const num = phone.replace(/[^\d+]/g, '');

  if (direct) {
    const key = fromEnvFile('OTP_API_KEY');
    const tmpl = fromEnvFile('OTP_TEMPLATE') || 'AUTOGEN';
    if (!key) throw new Error('OTP_API_KEY not found in env/.env (needed for --direct)');
    const url =
      mode === 'send'
        ? `https://2factor.in/API/V1/${key}/SMS/${num}/AUTOGEN/${tmpl}`
        : `https://2factor.in/API/V1/${key}/SMS/VERIFY3/${num}/${maybeOtp}`;
    const r = await viaDirect(url);
    console.log(
      `[direct 2Factor] ${mode} ${num} → ${r.ok ? 'OK' : 'FAIL'} ·`,
      JSON.stringify(r.json),
    );
    process.exit(r.ok ? 0 : 1);
  }

  const r =
    mode === 'send'
      ? await viaService('/auth/otp/send', { phone: num })
      : await viaService('/auth/otp/verify', { phone: num, otp: maybeOtp });
  console.log(`[auth-service ${BASE}] ${mode} ${num} → HTTP ${r.status} ·`, JSON.stringify(r.json));
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
