/**
 * Start every VelChat service (built dist) + the dev gateway in one terminal, with prefixed,
 * colourised logs and a single Ctrl+C that stops them all. Cross-platform (Windows/macOS/Linux).
 *
 * Build first: `pnpm build`. Then: `node tools/gateway/start-all.mjs`  (or: pnpm start:all)
 * Services boot even without infra (clients connect lazily); set up .env for real datastores.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const services = JSON.parse(readFileSync(join(here, 'services.json'), 'utf8'));
const colors = [36, 32, 33, 35, 34, 96, 92, 93, 95, 94, 90, 91, 38];
const children = [];

function prefixLines(prefix, buf) {
  return buf
    .toString()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => `${prefix} ${l}\n`)
    .join('');
}

function start(name, args, env, color) {
  const child = spawn('node', args, {
    cwd: root,
    env: { ...process.env, ...env },
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  child.stdout.on('data', (d) => process.stdout.write(prefixLines(prefix, d)));
  child.stderr.on('data', (d) => process.stderr.write(prefixLines(prefix, d)));
  child.on('exit', (code) => console.log(`${prefix} exited (code ${code})`));
  children.push(child);
}

for (let i = 0; i < services.length; i += 1) {
  const s = services[i];
  start(
    s.name,
    [`apps/${s.name}/dist/main.js`],
    { SERVICE_NAME: s.name, HTTP_PORT: String(s.http) },
    colors[i % colors.length],
  );
}
start('gateway', ['tools/gateway/dev-gateway.mjs'], {}, 97);

function shutdown() {
  console.log('\nstopping all services…');
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
