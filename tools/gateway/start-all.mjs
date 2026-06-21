/**
 * VelChat — start every service (built dist) + the dev gateway in ONE terminal on ONE port.
 *
 *   pnpm start:all              clean summary + unified URL (default)
 *   pnpm start:all --verbose    stream every service's prefixed logs (debugging)
 *
 * Quiet by default: per-service logs are buffered (shown only if a service crashes), so the
 * terminal stays readable and the final "UNIFIED API → http://localhost:8080" banner is visible.
 * A single Ctrl+C stops everything — children are direct node processes, so the kill is reliable
 * (SIGTERM, then SIGKILL for stragglers). Cross-platform (Windows / macOS / Linux).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const services = JSON.parse(readFileSync(join(here, 'services.json'), 'utf8'));
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const colors = [36, 32, 33, 35, 34, 96, 92, 93, 95, 94, 90, 91, 38];

const C = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};
const children = [];
let shuttingDown = false;

function color(text, c) {
  return `${c}${text}${C.reset}`;
}

/** Spawn a child; buffer its last lines for crash diagnosis. Stream only in --verbose. */
function start(name, args, env, col) {
  const child = spawn('node', args, { cwd: root, env: { ...process.env, ...env } });
  const prefix = `\x1b[${col}m[${name}]\x1b[0m`;
  const tail = [];
  const onData = (d) => {
    if (verbose) {
      for (const l of d.toString().split('\n'))
        if (l.length) process.stdout.write(`${prefix} ${l}\n`);
    } else {
      tail.push(d.toString());
      if (tail.length > 40) tail.shift();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      process.stdout.write(color(`\n  x ${name} exited (code ${code})\n`, C.red));
      if (!verbose && tail.length)
        process.stdout.write(color(`${tail.join('').trimEnd()}\n`, C.gray));
    }
  });
  children.push({ name, child });
  return child;
}

function httpOk(port, path = '/health', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitFor(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await httpOk(port)) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(color('\n\nStopping all services...\n', C.yellow));
  for (const { child } of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  // Force-kill anything that ignored SIGTERM, then exit.
  setTimeout(() => {
    for (const { child } of children) {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    process.stdout.write(color('Stopped.\n', C.green));
    process.exit(0);
  }, 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  process.stdout.write(
    color('\nVelChat - starting backend services + gateway...\n\n', C.cyan + C.bold),
  );

  services.forEach((s, i) =>
    start(
      s.name,
      [`apps/${s.name}/dist/main.js`],
      { SERVICE_NAME: s.name, HTTP_PORT: String(s.http) },
      colors[i % colors.length],
    ),
  );
  start('gateway', ['tools/gateway/dev-gateway.mjs'], { GATEWAY_PORT: String(GATEWAY_PORT) }, 97);

  process.stdout.write(color(`  waiting for the gateway on :${GATEWAY_PORT}...\n`, C.gray));
  await waitFor(GATEWAY_PORT);

  // Health summary (one line per service).
  process.stdout.write(color('\nHealth:\n', C.cyan));
  for (const s of services) {
    const ok = await httpOk(s.http);
    process.stdout.write(
      ok
        ? color(`  OK   ${s.name} (:${s.http})\n`, C.green)
        : color(`  DOWN ${s.name} (:${s.http})\n`, C.red),
    );
  }

  const line = '='.repeat(48);
  process.stdout.write(color(`\n${line}\n`, C.cyan));
  process.stdout.write(color('                 UNIFIED API\n', C.cyan + C.bold));
  process.stdout.write(
    `  ${color(`http://localhost:${GATEWAY_PORT}`, C.yellow)}   <- frontend base URL\n`,
  );
  process.stdout.write(color('  /auth /users /chat /channels /media /search ... routed\n', C.gray));
  process.stdout.write(
    `  ${color(`http://localhost:${GATEWAY_PORT}/docs`, C.yellow)}  <- API docs (all services)\n`,
  );
  process.stdout.write(color(`${line}\n`, C.cyan));
  process.stdout.write(
    color(
      verbose
        ? 'Streaming logs. Press Ctrl+C to stop all.\n\n'
        : 'Run with --verbose to stream logs. Press Ctrl+C to stop all.\n\n',
      C.gray,
    ),
  );
}

main().catch((err) => {
  process.stderr.write(color(`fatal: ${err?.message ?? err}\n`, C.red));
  shutdown();
});
