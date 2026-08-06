#!/usr/bin/env node
/**
 * Wake all Render free-tier services before a test session.
 *
 * Render free web services HIBERNATE after ~15 min idle. The first request wakes a
 * service (~20-50s cold start); firing MANY requests at a sleeping service at once makes
 * Render throttle the wake-ups (`x-render-routing: hibernate-rate-limited`, HTTP 429).
 *
 * So this pings each service's own /health SEQUENTIALLY (one at a time, direct host, not
 * through the gateway) so every service wakes cleanly. Run it, wait for all-green, then
 * the app works instantly for the next ~15 min.
 *
 *   node tools/warmup.mjs           # or: pnpm warmup
 *
 * For a hands-off setup, run this on a schedule (external uptime monitor / cron every
 * ~10 min). NOTE: keeping every service awake 24/7 burns free-tier hours — for
 * production, move off the free plan (paid instances never hibernate).
 */
const SERVICES = [
  'velchat-api-gateway',
  'velchat-auth-service',
  'velchat-user-service',
  'velchat-chat-service',
  'velchat-group-channel-service',
  'velchat-presence-service',
  'velchat-realtime-gateway',
  'velchat-media-service',
  'velchat-notification-service',
  'velchat-search-service',
  'velchat-call-service',
  'velchat-automation-service',
  'velchat-ai-service',
];

const TIMEOUT_MS = 120_000; // cold start can take ~50s; be patient

async function ping(host) {
  const url = `https://${host}.onrender.com/health`;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const routing = res.headers.get('x-render-routing') ?? '';
    const flag = res.ok ? 'OK ' : `HTTP ${res.status}`;
    console.log(
      `  ${res.ok ? '✅' : '⚠️ '} ${host.padEnd(32)} ${flag}  ${secs}s${
        routing ? `  (${routing})` : ''
      }`,
    );
    return res.ok;
  } catch (e) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ❌ ${host.padEnd(32)} ${String(e.name || e)}  ${secs}s`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Warming ${SERVICES.length} services (sequential, patient)…\n`);
let ok = 0;
for (const host of SERVICES) {
  if (await ping(host)) ok++;
}
console.log(`\nDone: ${ok}/${SERVICES.length} awake.`);
process.exit(ok === SERVICES.length ? 0 : 1);
