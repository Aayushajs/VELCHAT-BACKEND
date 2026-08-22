import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the shared development keypair lives. Gitignored; never used in production. */
const DIR_NAME = '.velchat-dev-keys';

export interface DevKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  /** Absolute path the pair was loaded from or written to — useful in the startup log. */
  path: string;
}

/** Walk up to the monorepo root (the directory holding pnpm-workspace.yaml). */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Load — or create once — an RS256 keypair shared by every service on this machine.
 *
 * Local development needs to work with zero configuration, but "works" has to mean real JWT
 * verification. Switching authentication off locally would hide exactly the class of bug a local
 * run exists to catch, and it is what made 11 of 13 services ship unauthenticated in the first
 * place. So instead of relaxing the check, development gets a real key.
 *
 * It has to be shared and persistent for two reasons: a token minted by identity-service must
 * verify in messaging-service, and a restart must not invalidate the token you were just testing
 * with. Both fail if each process generates its own pair in memory.
 *
 * Never reachable in production — `resolveAuthMode` requires an explicit `JWT_PUBLIC_PEM` there.
 */
export function loadOrCreateDevKeyPair(): DevKeyPair {
  const dir = join(repoRoot(), DIR_NAME);
  const privatePath = join(dir, 'jwt.key');
  const publicPath = join(dir, 'jwt.pub');

  if (existsSync(privatePath) && existsSync(publicPath)) {
    return {
      privateKeyPem: readFileSync(privatePath, 'utf8'),
      publicKeyPem: readFileSync(publicPath, 'utf8'),
      path: dir,
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  mkdirSync(dir, { recursive: true });

  // `start:all` boots six services at once, so several will find the pair missing and try to create
  // it. Last-writer-wins is NOT good enough here: each process would keep the pair it generated
  // while the file ends up holding someone else's, and a token signed by one service then fails
  // verification in every other. Exactly one process may win, and the rest must adopt its key.
  //
  // The private file is the lock: `flag: 'wx'` fails if it already exists, so the create is atomic.
  try {
    writeFileSync(privatePath, privateKey, { mode: 0o600, flag: 'wx' });
  } catch {
    return readExisting(privatePath, publicPath, dir); // someone else won — use their pair
  }
  writeFileSync(publicPath, publicKey, { mode: 0o644 });

  return { privateKeyPem: privateKey, publicKeyPem: publicKey, path: dir };
}

/**
 * Read a pair another process is creating. The public half is written just after the private one,
 * so a loser can briefly observe the private file alone; wait the moment it takes rather than
 * generating a second key and desynchronising the fleet.
 */
function readExisting(privatePath: string, publicPath: string, dir: string): DevKeyPair {
  const deadline = Date.now() + 5_000;
  for (;;) {
    if (existsSync(publicPath)) {
      const privateKeyPem = readFileSync(privatePath, 'utf8');
      const publicKeyPem = readFileSync(publicPath, 'utf8');
      if (privateKeyPem.includes('PRIVATE KEY') && publicKeyPem.includes('PUBLIC KEY')) {
        return { privateKeyPem, publicKeyPem, path: dir };
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`dev keypair at ${dir} is incomplete. Delete the directory and start again.`);
    }
    // Deliberately blocking: this runs once, at boot, before anything is serving.
    const until = Date.now() + 50;
    while (Date.now() < until) {
      /* spin briefly */
    }
  }
}

/**
 * Shared internal service-to-service secret for local development.
 *
 * Same reasoning as the keypair: the WebSocket fabric refuses inbound receipts and typing unless it
 * can verify membership, and verifying membership needs this credential. Leaving it unset locally
 * would make `pnpm start:all` look healthy while receipts were silently refused — a confusing
 * failure that only shows up as missing blue ticks. Every service on the machine reads the same
 * file, so the caller and the callee agree.
 *
 * Never reachable in production: `resolveInternalSecret` only falls back outside production.
 */
export function loadOrCreateDevInternalSecret(): string {
  const dir = join(repoRoot(), DIR_NAME);
  const file = join(dir, 'internal.secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();

  mkdirSync(dir, { recursive: true });
  const secret = randomBytes(32).toString('base64url');
  try {
    // Exclusive create, so concurrently booting services adopt one value instead of each keeping
    // its own — a mismatch here means the caller is refused by the callee.
    writeFileSync(file, secret, { mode: 0o600, flag: 'wx' });
  } catch {
    return readFileSync(file, 'utf8').trim();
  }
  return secret;
}

/**
 * The internal secret this process should use: configured in production, generated locally.
 * Production without one leaves the internal path closed rather than open — endpoints marked
 * `@AllowInternal()` simply keep requiring a user token.
 */
export function resolveInternalSecret(config: {
  NODE_ENV: string;
  INTERNAL_API_SECRET?: string;
}): string | undefined {
  if (config.INTERNAL_API_SECRET?.trim()) return config.INTERNAL_API_SECRET.trim();
  if (config.NODE_ENV === 'production') return undefined;
  return loadOrCreateDevInternalSecret();
}
