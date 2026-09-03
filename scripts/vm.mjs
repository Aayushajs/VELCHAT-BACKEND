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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const powerState = () =>
  az(
    [
      'vm',
      'get-instance-view',
      '-g',
      CFG.group,
      '-n',
      CFG.vm,
      '--query',
      'instanceView.statuses[?starts_with(code, `PowerState/`)].displayStatus | [0]',
      '-o',
      'tsv',
    ],
    { quiet: true },
  );

const publicIp = () => {
  if (CFG.host) return CFG.host;
  return az(
    ['vm', 'show', '-d', '-g', CFG.group, '-n', CFG.vm, '--query', 'publicIps', '-o', 'tsv'],
    {
      quiet: true,
    },
  );
};

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
