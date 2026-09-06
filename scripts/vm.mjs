#!/usr/bin/env node
// Azure VM control from the terminal — start/stop the box, deploy to it, read its logs.
//
// The one thing worth knowing up front: `az vm stop` leaves the VM ALLOCATED and you keep paying
// for it. Only `az vm deallocate` releases the compute and stops the meter. `pnpm vm stop` here
// deallocates, because a stop command that still bills is a trap.
//
// Config comes from the environment, with defaults matching the documented Azure setup. Put
// overrides in deploy/azure/.vmrc (gitignored) or export them in your shell.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
const ui = {
  title: (s) => console.log('\n' + paint(c.bold + c.cyan, `▶ ${s}`)),
  ok: (s) => console.log(paint(c.green, '  ✓ ') + s),
  warn: (s) => console.log(paint(c.yellow, '  ! ') + s),
  fail: (s) => console.log(paint(c.red, '  ✗ ') + s),
  info: (s) => console.log('  ' + s),
  dim: (s) => console.log(paint(c.dim, '  ' + s)),
};

// deploy/azure/.vmrc is a plain KEY=value file, gitignored, for machine-specific overrides.
function loadRc() {
  const rc = resolve(process.cwd(), 'deploy/azure/.vmrc');
  if (!existsSync(rc)) return {};
  const out = {};
  for (const line of readFileSync(rc, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const rc = loadRc();
const env = (k, fallback) => process.env[k] ?? rc[k] ?? fallback;

const CFG = {
  group: env('AZ_RESOURCE_GROUP', 'velchat'),
  vm: env('AZ_VM_NAME', 'velchat-vm'),
  user: env('AZ_SSH_USER', 'azureuser'),
  key: env('AZ_SSH_KEY', ''), // empty → ssh uses its default identity
  port: env('AZ_SSH_PORT', '22'),
  // Set AZ_HOST to skip the Azure CLI entirely for the SSH-based commands. Useful before the CLI
  // is installed, and mandatory-free once the public IP is static (it stops changing).
  host: env('AZ_HOST', ''),
  composeRemote: env('AZ_COMPOSE_PATH', '~/velchat-deploy/azure/compose.yml'),
  envRemote: env('AZ_ENV_PATH', '~/velchat.env'),

  // Billing inputs. Azure's consumption API returns empty cost fields on an Azure for Students
  // subscription, so spend is computed from measured running time rather than read back. That
  // makes these numbers an ESTIMATE: they track compute, which is the part that varies with what
  // you do, and carry the fixed monthly items as a flat figure.
  ratePerHour: Number(env('AZ_RATE_PER_HOUR', '0.0492')), // B2as_v2, Central India, pay-as-you-go
  fixedPerMonth: Number(env('AZ_FIXED_PER_MONTH', '7.5')), // 64 GB StandardSSD + static IP, approx
  creditTotal: Number(env('AZ_CREDIT_TOTAL', '100')), // the grant, not what is left
  creditRemaining: env('AZ_CREDIT_REMAINING', ''), // what the portal last showed you, if you set it

  // 2Factor SMS — the OTP credit pool, unrelated to Azure. Unlike Azure, this balance IS readable.
  otpApiKey: env('OTP_API_KEY', ''),
};

/**
 * Locate the Azure CLI. A pip --user install (the route that needs no administrator) puts `az`
 * under the Python user scripts directory, which is not on PATH by default, so fall back to it
 * rather than telling the user it is missing when it is right there.
 */
function azBin() {
  if (process.env.AZ_BIN) return process.env.AZ_BIN;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const candidates = [];
  if (home) {
    for (const v of ['313', '312', '311', '310']) {
      candidates.push(
        resolve(home, 'AppData/Roaming/Python/Python' + v + '/Scripts', 'az.bat'),
        resolve(home, '.local/bin/az'),
      );
    }
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return 'az'; // on PATH, or genuinely absent
}

const AZ = azBin();

function az(args, { quiet = false } = {}) {
  try {
    return execFileSync(AZ, args, {
      encoding: 'utf8',
      // An activity-log page runs to megabytes; execFileSync's 1 MB default fails with ENOBUFS.
      maxBuffer: 64 * 1024 * 1024,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
      shell: process.platform === 'win32', // az is a .cmd shim on Windows
    }).trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      ui.fail('Azure CLI not found. Install it without admin rights:');
      ui.dim('  python -m pip install --user azure-cli');
      ui.dim('Or set AZ_BIN in deploy/azure/.vmrc to its full path.');
      process.exit(1);
    }
    throw err;
  }
}

function requireLogin() {
  try {
    az(['account', 'show', '-o', 'none'], { quiet: true });
  } catch {
    ui.fail('Not signed in to Azure. Run:  az login');
    process.exit(1);
  }
}

/**
 * Current power state, e.g. "VM running" / "VM deallocated".
 *
 * Fetches JSON and picks the status here rather than filtering with a `--query`. On Windows `az` is
 * a .bat shim, so the CLI runs through cmd, and cmd treats the `|` inside a JMESPath expression as
 * a pipe — the command fails with "'[0]' is not recognized". Parsing locally sidesteps every
 * shell-quoting difference between platforms.
 */
const powerState = () => {
  const raw = az(['vm', 'get-instance-view', '-g', CFG.group, '-n', CFG.vm, '-o', 'json'], {
    quiet: true,
  });
  try {
    const statuses = JSON.parse(raw)?.instanceView?.statuses ?? [];
    const power = statuses.find((st) => String(st.code || '').startsWith('PowerState/'));
    return power?.displayStatus ?? '';
  } catch {
    return '';
  }
};

const publicIp = () => {
  if (CFG.host) return CFG.host;
  return az(
    ['vm', 'show', '-d', '-g', CFG.group, '-n', CFG.vm, '--query', 'publicIps', '-o', 'tsv'],
    {
      quiet: true,
    },
  );
};

/** Run a command over SSH and return its stdout, or '' if it fails. */
function sshCapture(remoteCmd) {
  const ip = publicIp();
  if (!ip) return '';
  const args = [
    '-p',
    CFG.port,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=15',
  ];
  if (CFG.key) args.push('-i', CFG.key);
  args.push(`${CFG.user}@${ip}`, remoteCmd);
  const r = spawnSync('ssh', args, { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

/** HTTP status for a URL, or 0 if it could not be reached. Uses curl to avoid a dependency. */
function httpStatus(url) {
  const r = spawnSync(
    'curl',
    [
      '-s',
      '-o',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
      '-w',
      '%{http_code}',
      '--max-time',
      '20',
      url,
    ],
    { encoding: 'utf8' },
  );
  return r.status === 0 ? Number(String(r.stdout || '').trim()) || 0 : 0;
}

/** Response body for a URL, or '' if it could not be reached. */
function httpBody(url) {
  const r = spawnSync('curl', ['-sS', '--max-time', '25', url], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

/** Run a command over SSH, streaming output. Returns the exit code. */
function ssh(remoteCmd, { interactive = false } = {}) {
  const ip = publicIp();
  if (!ip) {
    ui.fail('No public IP — the VM is probably deallocated. Run:  pnpm vm start');
    process.exit(1);
  }
  // ConnectTimeout so this fails fast instead of hanging for the default ~2 minutes. With
  // auto-shutdown enabled the box is deallocated most evenings, and a two-minute stall is a bad
  // way to find that out.
  const args = [
    '-p',
    CFG.port,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=15',
  ];
  if (CFG.key) args.push('-i', CFG.key);
  args.push(`${CFG.user}@${ip}`);
  if (remoteCmd) args.push(remoteCmd);
  const r = spawnSync('ssh', args, {
    stdio: interactive ? 'inherit' : ['ignore', 'inherit', 'inherit'],
  });
  if (r.status === 255) {
    ui.fail(`cannot reach ${ip}:${CFG.port}`);
    ui.dim('Most likely the VM is deallocated (auto-shutdown). Start it:  pnpm vm start');
    ui.dim('If it IS running, check the security group allows 22 from your address.');
  }
  return r.status ?? 1;
}

/**
 * Running intervals from the activity log, newest last.
 *
 * The log is the only record of when the box was actually on: an already-running VM still logs a
 * `start` (the call is a no-op), and a run that is still going has no `deallocate` yet — so a naive
 * pairing double-counts. State is tracked instead, and an open interval is closed at "now".
 */
function runningIntervals(sinceDays) {
  const raw = az(
    [
      'monitor',
      'activity-log',
      'list',
      '-g',
      CFG.group,
      '--offset',
      `${sinceDays}d`,
      '--max-events',
      '1000',
      '--query',
      '[].{t:eventTimestamp,o:operationName.value,s:status.value}',
      '-o',
      'json',
    ],
    { quiet: true },
  );

  let rows = [];
  try {
    rows = JSON.parse(raw);
  } catch {
    return null; // no log, or the CLI returned something unexpected
  }

  const events = [];
  for (const r of rows) {
    if (r.s !== 'Succeeded') continue;
    const op = String(r.o || '').toLowerCase();
    const at = Date.parse(r.t);
    if (Number.isNaN(at)) continue;
    if (op.endsWith('/start/action')) events.push({ at, kind: 'start' });
    else if (op.endsWith('/deallocate/action')) events.push({ at, kind: 'stop' });
  }
  events.sort((a, b) => a.at - b.at);

  const intervals = [];
  let openedAt = null;
  for (const e of events) {
    if (e.kind === 'start') {
      if (openedAt === null) openedAt = e.at; // a second start while running is a no-op
    } else if (openedAt !== null) {
      intervals.push([openedAt, e.at]);
      openedAt = null;
    }
  }
  if (openedAt !== null) intervals.push([openedAt, Date.now()]); // still running
  return intervals;
}

/**
 * Real spend from the Cost Management API, `{ cost, currency }`, or null.
 *
 * This is measured money, not a rate multiplied by hours. The older `az consumption` path returns
 * empty cost fields on this subscription — every row came back with pretaxCost "None" — which is
 * why spend used to be estimated. Cost Management answers properly.
 *
 * It is aggressively throttled, so a 429 is expected rather than exceptional and is retried.
 */
function actualCost(timeframe) {
  const body = JSON.stringify({
    type: 'ActualCost',
    timeframe,
    dataset: { granularity: 'None', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } } },
  });
  const file = join(tmpdir(), `velchat-cost-${process.pid}.json`);
  writeFileSync(file, body);

  const sub = az(['account', 'show', '--query', 'id', '-o', 'tsv'], { quiet: true });
  const url =
    `https://management.azure.com/subscriptions/${sub}` +
    '/providers/Microsoft.CostManagement/query?api-version=2023-03-01';

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const out = spawnSync(
        AZ,
        ['rest', '--method', 'post', '--url', url, '--body', `@${file}`, '-o', 'json'],
        { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024 },
      );
      const text = String(out.stdout || '') + String(out.stderr || '');
      if (text.includes('429')) {
        sleepSync(20_000);
        continue;
      }
      try {
        const row = JSON.parse(out.stdout)?.properties?.rows?.[0];
        if (!row) return null;
        return { cost: Number(row[0]), currency: String(row[1] || '') };
      } catch {
        return null;
      }
    }
    return null;
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* best effort */
    }
  }
}

/** Block for `ms`. Only used between throttled API retries, where sleeping is the point. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const hoursBetween = (from, to) => (to - from) / 3_600_000;

function humanDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const money = (n) => `$${n.toFixed(2)}`;

const compose = (rest) =>
  `docker compose -f ${CFG.composeRemote} --env-file ${CFG.envRemote} ${rest}`;

/** Arguments that follow the command name; assigned once the command is resolved below. */
let cmdArgs = [];

const commands = {
  async status() {
    requireLogin();
    ui.title(`${CFG.vm} (resource group: ${CFG.group})`);
    const state = powerState();
    const ip = publicIp();
    (state === 'VM running' ? ui.ok : ui.warn)(`power: ${state || 'unknown'}`);
    if (ip) {
      ui.ok(`public IP: ${ip}`);
      ui.dim('If this changed since your last deploy, update DNS and the AZURE_HOST secret.');
    } else {
      ui.warn('public IP: none (deallocated — a dynamic IP is released while stopped)');
    }
    if (state === 'VM running') {
      ui.title('containers');
      ssh(compose('ps'));
    }
  },

  /** Is it up, how long has it been up, and what has that cost. */
  async cost() {
    requireLogin();
    const state = powerState();
    const running = state === 'VM running';

    ui.title(`${CFG.vm} — ${running ? 'RUNNING' : state || 'unknown'}`);

    // Uptime of the current run, read from the box itself so it reflects reality rather than the
    // log's view of it.
    if (running) {
      const bootedAt = sshCapture('date -u +%s -d "$(uptime -s)"');
      const booted = Number(bootedAt);
      if (Number.isFinite(booted) && booted > 0) {
        const upMs = Date.now() - booted * 1000;
        ui.ok(
          `up for ${humanDuration(upMs)}  (this run costs ${money(hoursBetween(booted * 1000, Date.now()) * CFG.ratePerHour)} so far)`,
        );
      }
      const url = process.env.AZURE_PUBLIC_URL || 'https://velchat.duckdns.org';
      const code = httpStatus(`${url}/health`);
      (code === 200 ? ui.ok : ui.warn)(`${url}/health -> ${code || 'no answer'}`);
    } else {
      ui.warn('deallocated — compute is not being billed, and the site is not reachable');
    }

    // Measured running time. 30 days is a window, not a calendar month: the activity log retains
    // 90 days, and a fixed window is comparable week to week in a way "so far this month" is not.
    const intervals = runningIntervals(30);
    if (intervals === null) {
      ui.warn('activity log unavailable — cannot measure running hours');
      return;
    }

    const monthMs = Date.now() - 30 * 86_400_000;
    const hours30 = intervals.reduce(
      (sum, [a, b]) => sum + hoursBetween(Math.max(a, monthMs), b),
      0,
    );
    const dayMs = Date.now() - 86_400_000;
    const hours24 = intervals.reduce(
      (sum, [a, b]) => (b <= dayMs ? sum : sum + hoursBetween(Math.max(a, dayMs), b)),
      0,
    );

    ui.title('running time (from the activity log)');
    ui.info(`last 24h : ${hours24.toFixed(1)} h`);
    ui.info(`last 30d : ${hours30.toFixed(1)} h`);

    // Real money, not hours multiplied by a rate. `az consumption` returns empty cost fields on
    // this subscription (every row came back with pretaxCost "None"); Cost Management answers.
    ui.title('actual spend (Azure Cost Management)');
    const mtd = actualCost('MonthToDate');
    const lastMonth = actualCost('TheLastMonth');
    const dayOfMonth = new Date().getUTCDate();
    if (mtd) {
      ui.ok(`month to date  : ${mtd.cost.toFixed(2)} ${mtd.currency}`);
      const perMonth = (mtd.cost / Math.max(dayOfMonth, 1)) * 30;
      ui.info(`projected month: ${perMonth.toFixed(2)} ${mtd.currency} at this pace`);
    } else {
      ui.warn('Cost Management did not answer — it is heavily throttled; try again shortly');
    }
    if (lastMonth) ui.info(`last month     : ${lastMonth.cost.toFixed(2)} ${lastMonth.currency}`);

    ui.title('credit');
    const remaining = CFG.creditRemaining === '' ? null : Number(CFG.creditRemaining);
    if (remaining === null || !Number.isFinite(remaining)) {
      ui.warn('Balance unknown — Azure does not expose it for a Students subscription.');
      ui.dim('availableBalance returns Bad Request on a sponsorship account, so SPEND is readable');
      ui.dim('but the remaining balance is not. Read it from the portal (Cost Management ->');
      ui.dim('Credits) and set AZ_CREDIT_REMAINING in deploy/azure/.vmrc to project a runway.');
    } else {
      ui.ok(`${remaining} left (as you last recorded it)`);
      if (mtd && mtd.cost > 0) {
        const perMonth = (mtd.cost / Math.max(dayOfMonth, 1)) * 30;
        ui.info(
          `at ${perMonth.toFixed(2)} ${mtd.currency}/month that is ~${(remaining / perMonth).toFixed(1)} months`,
        );
      }
    }
  },

  /** 2Factor SMS credit, read live. Nothing to configure beyond the API key. */
  async otp() {
    if (!CFG.otpApiKey) {
      ui.fail('OTP_API_KEY is not set in deploy/azure/.vmrc');
      process.exit(1);
    }
    ui.title('2Factor SMS credit');

    // Only the subscribed pools answer; the rest return "Addon Services Not Subscribed", which is
    // information rather than an error — it says which pool the account actually draws from.
    const pools = ['TRANSACTIONAL_SMS', 'SMS', 'PROMOTIONAL_SMS', 'VOICE_OTP'];
    let found = false;
    for (const pool of pools) {
      const body = httpBody(
        `https://2factor.in/API/V1/${CFG.otpApiKey}/ADDON_SERVICES/BAL/${pool}`,
      );
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      if (parsed.Status === 'Success') {
        const credits = Number(parsed.Details);
        found = true;
        ui.ok(`${pool}: ${Number.isFinite(credits) ? credits.toFixed(0) : parsed.Details} credits`);
      }
    }
    if (!found) {
      ui.fail('No subscribed pool answered — check the key.');
      process.exit(1);
    }
    ui.dim(
      'One OTP send consumes one credit. OTP_DEV_MODE=false means any number can request one.',
    );
  },

  async start() {
    requireLogin();
    ui.title(`Starting ${CFG.vm}`);
    az(['vm', 'start', '-g', CFG.group, '-n', CFG.vm, '-o', 'none']);
    ui.ok('started');
    const ip = publicIp();
    ui.info(`public IP: ${ip}`);
    ui.dim('Containers restart on their own (restart: always in the compose file).');
  },

  async stop() {
    requireLogin();
    ui.title(`Deallocating ${CFG.vm}`);
    // deallocate, NOT stop: `az vm stop` keeps the compute reserved and you keep paying for it.
    az(['vm', 'deallocate', '-g', CFG.group, '-n', CFG.vm, '-o', 'none']);
    ui.ok('deallocated — compute billing stopped');
    ui.dim('Disk and any static public IP are still billed; those are the cheap parts.');
  },

  async restart() {
    requireLogin();
    ui.title(`Restarting ${CFG.vm}`);
    az(['vm', 'restart', '-g', CFG.group, '-n', CFG.vm, '-o', 'none']);
    ui.ok('restarted');
  },

  async ip() {
    requireLogin();
    const v = publicIp();
    if (!v) {
      ui.warn('no public IP (VM deallocated)');
      process.exit(1);
    }
    console.log(v);
  },

  async ssh() {
    if (!CFG.host) requireLogin();
    process.exit(ssh(null, { interactive: true }));
  },

  async logs() {
    if (!CFG.host) requireLogin();
    const service = cmdArgs[0] ?? '';
    ui.title(`logs ${service || '(all services)'} — Ctrl-C to stop`);
    process.exit(ssh(compose(`logs -f --tail=100 ${service}`)));
  },

  async deploy() {
    if (!CFG.host) requireLogin();
    const tag = cmdArgs[0];
    ui.title(`Deploying${tag ? ` tag ${tag}` : ' (tag from the env file)'}`);
    const prefix = tag ? `TAG=${tag} ` : '';
    const code = ssh(
      `set -e; ${prefix}${compose('pull')} && ${prefix}${compose('up -d --remove-orphans')} && docker image prune -f`,
    );
    if (code !== 0) {
      ui.fail('deploy failed');
      process.exit(code);
    }
    ui.ok('deployed');
    ui.dim('Check it:  pnpm vm health');
  },

  async health() {
    if (!CFG.host) requireLogin();
    const ip = publicIp();
    ui.title('health');
    // Checked from inside the box, so this works before DNS and TLS are set up.
    const code = ssh(
      `curl -fsS --max-time 10 http://localhost/health || curl -fsS --max-time 10 http://localhost:3000/health`,
    );
    if (code !== 0) {
      ui.fail(`no healthy response. Try:  pnpm vm logs`);
      process.exit(1);
    }
    console.log();
    ui.dim(`From your machine, once DNS points at ${ip}:  curl https://<your-domain>/health`);
  },

  /** One-time bootstrap: Docker, the compose file, and the edge config. Safe to re-run. */
  async setup() {
    if (!CFG.host) requireLogin();
    const ip = publicIp();
    ui.title(`Bootstrapping ${CFG.user}@${ip}`);

    ui.info('installing Docker (skipped if already present)…');
    let code = ssh(
      'set -e; ' +
        'if ! command -v docker >/dev/null 2>&1; then ' +
        '  sudo apt-get update -qq && sudo apt-get install -y -qq docker.io docker-compose-v2 && ' +
        '  sudo usermod -aG docker "$USER"; ' +
        'fi; docker --version',
    );
    if (code !== 0) {
      ui.fail('Docker install failed');
      process.exit(code);
    }

    // The compose file mounts ../shared/Caddyfile, a path relative to ITS OWN directory. Dropping
    // it in the home directory made that resolve to /home/shared, which does not exist, and Caddy
    // failed to start. Mirror the repo layout instead so the relative path means what it means in
    // the repo.
    ui.info('copying compose file + Caddyfile…');
    ssh('mkdir -p ~/velchat-deploy/azure ~/velchat-deploy/shared');
    const scpArgs = ['-P', CFG.port, '-o', 'StrictHostKeyChecking=accept-new'];
    if (CFG.key) scpArgs.push('-i', CFG.key);
    const scp = (src, dest) =>
      spawnSync('scp', [...scpArgs, src, `${CFG.user}@${ip}:${dest}`], { stdio: 'inherit' })
        .status ?? 1;
    if (scp('deploy/azure/compose.yml', '~/velchat-deploy/azure/compose.yml') !== 0)
      process.exit(1);
    if (scp('deploy/shared/Caddyfile', '~/velchat-deploy/shared/Caddyfile') !== 0) process.exit(1);
    // compose.yml also declares env_file: [./.env], resolved next to itself.
    ssh('ln -sf ~/velchat.env ~/velchat-deploy/azure/.env');

    // The env file holds database URLs and the internal secret, so it is created on the VM from
    // the template and filled in there. It never travels through this machine or through CI.
    ssh(
      'if [ ! -f ~/velchat.env ]; then cp ~/velchat.env.example ~/velchat.env 2>/dev/null || true; fi; ' +
        'ls -la ~/velchat.env 2>/dev/null || echo "MISSING"',
    );
    scp('deploy/azure/.env.example', '~/velchat.env.example');

    ui.ok('bootstrap done');
    ui.dim('Next: pnpm vm ssh, then edit ~/velchat.env (copy from ~/velchat.env.example).');
    ui.dim('Then: pnpm vm deploy');
    if (code === 0) {
      ui.warn('If Docker was just installed, log out and back in once so the group applies.');
    }
  },

  async help() {
    console.log(`
${paint(c.bold, 'VelChat — Azure VM control')}

  pnpm vm setup             one-time: install Docker, copy compose + Caddyfile
  pnpm vm status            power state, public IP, running containers
  pnpm vm cost              uptime, measured running hours, spend and credit runway
  pnpm vm otp               2Factor SMS credit remaining (read live)
  pnpm vm start             start the VM
  pnpm vm stop              DEALLOCATE the VM (this is what stops billing)
  pnpm vm restart           reboot the VM
  pnpm vm ip                print the current public IP
  pnpm vm ssh               open a shell on the VM
  pnpm vm deploy [tag]      pull images + restart containers (tag e.g. 0.2.0)
  pnpm vm logs [service]    follow container logs
  pnpm vm health            hit /health from inside the VM

${paint(c.dim, 'Config (env vars, or deploy/azure/.vmrc):')}
  AZ_RESOURCE_GROUP=${CFG.group}   AZ_VM_NAME=${CFG.vm}
  AZ_SSH_USER=${CFG.user}          AZ_SSH_KEY=${CFG.key || '(ssh default identity)'}
  AZ_HOST=${CFG.host || '(looked up via Azure CLI)'}
  AZ_RATE_PER_HOUR=${CFG.ratePerHour}   AZ_FIXED_PER_MONTH=${CFG.fixedPerMonth}
  AZ_CREDIT_REMAINING=${CFG.creditRemaining || '(unset — see `vm cost`)'}

${paint(c.dim, 'Requires the Azure CLI and `az login`.')}
`);
  },
};

// Pick the first argument that names a command, and treat everything after it as that command's
// arguments. Indexing fixed positions broke `vm deploy 8.1.0`: the tag landed where the command
// was expected and the script printed help instead of deploying.
const argv = process.argv.slice(2);
const cmdIndex = argv.findIndex((a) => Object.prototype.hasOwnProperty.call(commands, a));
const cmd = cmdIndex === -1 ? 'help' : argv[cmdIndex];
cmdArgs = cmdIndex === -1 ? [] : argv.slice(cmdIndex + 1);
const fn = commands[cmd] ?? commands.help;
fn().catch((err) => {
  ui.fail(String(err?.message ?? err));
  process.exit(1);
});
