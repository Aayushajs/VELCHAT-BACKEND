// Shared helpers for the operational check scripts.
// These load the SAME @velchat/config + @velchat/common the services use, so what a script
// sees is exactly what a service sees at boot — no separate .env parsing, no drift.
import { loadConfig } from '@velchat/config';
import { createLogger } from '@velchat/common';

/** Load config from the repo-root .env (loadConfig auto-loads it) + a quiet logger. */
export function boot(serviceName = 'scripts') {
  const config = loadConfig({ ...process.env, SERVICE_NAME: serviceName });
  const logger = createLogger(config);
  return { config, logger };
}

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? code + s + c.reset : s);

export const ui = {
  title: (s) => console.log('\n' + paint(c.bold + c.cyan, `▶ ${s}`)),
  ok: (s) => console.log(paint(c.green, '  ✓ ') + s),
  warn: (s) => console.log(paint(c.yellow, '  ! ') + s),
  fail: (s) => console.log(paint(c.red, '  ✗ ') + s),
  info: (s) => console.log(paint(c.dim, '    ' + s)),
  line: (s = '') => console.log(s),
};

/** Exit 0 = pass/skip (configured-or-intentionally-not); 1 = a configured integration failed. */
export function done(failed) {
  if (failed) {
    ui.line();
    ui.fail('One or more CONFIGURED integrations failed — see above.');
    process.exit(1);
  }
  process.exit(0);
}
