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
import { spawn, spawnSync } from 'node:child_process';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await httpOk(port)) return true;
    await sleep(750);
  }
  return false;
}

/** Poll every service until healthy (Nest takes a few seconds to boot) — returns the up-set. */
async function readiness(rounds = 40) {
  const up = new Set();
  for (let r = 0; r < rounds && up.size < services.length; r += 1) {
    await Promise.all(
      services.map(async (s) => {
        if (!up.has(s.name) && (await httpOk(s.http))) up.add(s.name);
      }),
    );
    if (up.size < services.length) await sleep(1000);
  }
  return up;
}

/** Force-kill the child's whole process tree — reliable on Windows (Ctrl+C must truly stop all). */
function killChild(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Windows backstop: kill anything still listening on our ports (catches orphaned grandchildren). */
function killByPorts() {
  if (process.platform !== 'win32') return;
  const ports = [...services.map((s) => s.http), GATEWAY_PORT].join(',');
  const ps = `$ports=@(${ports}); foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`;
  try {
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch {
    /* best effort */
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(color('\n\nStopping all services...\n', C.yellow));
  for (const { child } of children) killChild(child); // force-kill each child's tree
  killByPorts(); // + sweep any orphan still holding a port (reliable on Windows)
  process.stdout.write(color('Stopped.\n', C.green));
  process.exit(0);
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

  process.stdout.write(color('  waiting for services to boot...\n', C.gray));
  await waitFor(GATEWAY_PORT);
  const up = await readiness(); // poll each service until healthy (Nest needs a few seconds)

  // Health summary (one line per service).
  process.stdout.write(color('\nHealth:\n', C.cyan));
  for (const s of services) {
    process.stdout.write(
      up.has(s.name)
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
