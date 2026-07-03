import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/**
 * Load the nearest `.env` walking up from the current working directory to the repo root. This makes
 * a single service work the SAME whether started from the repo root (`start-all`) or from its own
 * package dir (`pnpm dev:auth`) — otherwise the per-service run finds no `.env`, the datastore URLs
 * are missing, feature modules don't wire, and routes 404. No-op in prod/K8s/Render where env is
 * injected by the platform. dotenv never overrides already-set process.env (platform values win).
 */
function loadEnvFromRoot(): void {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadEnv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadEnv(); // fall back to dotenv's default (cwd) behaviour
}
loadEnvFromRoot();

/** Walk up from cwd to the monorepo root (the dir holding pnpm-workspace.yaml). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Short git SHA from a platform env (Render/CI) or the local .git — no shell spawn. */
function gitShortSha(root: string): string | null {
  const fromEnv =
    process.env.GIT_SHA ?? process.env.BUILD_SHA ?? process.env.RENDER_GIT_COMMIT ?? null;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 7); // detached HEAD = raw sha
    const ref = head.slice(4).trim();
    const refFile = join(root, '.git', ref);
    if (existsSync(refFile)) return readFileSync(refFile, 'utf8').trim().slice(0, 7);
    const packed = join(root, '.git', 'packed-refs');
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        const [sha, name] = line.split(' ');
        if (name === ref && sha) return sha.slice(0, 7);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The owning service's package.json version, resolved by SERVICE_NAME regardless of cwd. */
function packageVersion(root: string): string {
  const name = process.env.SERVICE_NAME;
  const candidates = [
    ...(name ? [join(root, 'apps', name, 'package.json')] : []),
    join(root, 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const v = (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version;
      if (v) return v;
    } catch {
      /* keep looking */
    }
  }
  return '0.1.0';
}

/**
 * Stamp SERVICE_VERSION so it is meaningful and auto-updates on every change: `<pkgVersion>+<sha>`
 * (e.g. `0.1.0+419f7f4`). An explicit SERVICE_VERSION env always wins (CI can pin it).
 */
function stampVersion(): void {
  if (process.env.SERVICE_VERSION) return;
  const root = findRepoRoot();
  const sha = gitShortSha(root);
  const base = packageVersion(root);
  process.env.SERVICE_VERSION = sha ? `${base}+${sha}` : base;
}
stampVersion();

/**
 * Environment schema (zod). Validated once at service boot.
 *
 * Non-negotiable (CLAUDE.md §5): no secrets in code. Every value is read from the
 * environment (injected via Sealed Secrets / Vault in prod). Invalid or missing
 * required config → the service refuses to start (fail-closed).
 *
 * Connection strings are optional in the base schema because not every service
 * touches every datastore; a service asserts what it needs via `requireX(cfg)`.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SERVICE_NAME: z.string().min(1, 'SERVICE_NAME is required'),
  SERVICE_VERSION: z.string().default('0.0.0'),

  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  GRPC_PORT: z.coerce.number().int().positive().default(50051),
  METRICS_PORT: z.coerce.number().int().positive().default(9464),

  // PostgreSQL (relational; RLS-enforced multi-tenant)
  POSTGRES_URL: z.string().url().optional(),
  POSTGRES_MAX_POOL: z.coerce.number().int().positive().default(10),

  // MongoDB (chat documents)
  MONGO_URL: z.string().min(1).optional(),

  // Valkey (cache / presence / seq)
  VALKEY_URL: z.string().min(1).optional(),

  // ── Provider selection (free-tier MVP defaults; switch to self-host at scale) ──
  // event bus: redis-streams (Upstash, ₹0) | kafka (self-host scale)
  EVENT_BUS: z.enum(['redis-streams', 'kafka']).default('redis-streams'),
  // object storage: cloudinary (₹0) | s3 (MinIO/AWS self-host)
  STORAGE_PROVIDER: z.enum(['cloudinary', 's3']).default('cloudinary'),
  // search: atlas (MongoDB Atlas Search, ₹0) | opensearch (self-host)
  SEARCH_PROVIDER: z.enum(['atlas', 'opensearch']).default('atlas'),

  // Kafka (only when EVENT_BUS=kafka)
  KAFKA_BROKERS: z.string().min(1).optional(),
  KAFKA_CLIENT_ID: z.string().default('velchat'),
  KAFKA_SCHEMA_REGISTRY_URL: z.string().url().optional(),

  // OpenSearch (only when SEARCH_PROVIDER=opensearch)
  OPENSEARCH_NODE: z.string().url().optional(),
  OPENSEARCH_USERNAME: z.string().optional(),
  OPENSEARCH_PASSWORD: z.string().optional(),

  // S3 / MinIO (only when STORAGE_PROVIDER=s3)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  // Cloudinary (only when STORAGE_PROVIDER=cloudinary). cloudinary://key:secret@cloud
  CLOUDINARY_URL: z.string().optional(),

  // OpenTelemetry → Grafana Cloud (free). Headers carry the basic-auth token.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_TRACES_SAMPLER: z.string().default('parentbased_always_on'),

  // Auth
  JWT_ISSUER: z.string().optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // Mail (self-hosted Postfix SMTP). Unset → mail is logged only (dev).
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('VelChat <no-reply@velchat.local>'),

  // Push (Web Push VAPID + FCM). Unset → no-op/log transport.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@velchat.local'),
  FCM_PROJECT_ID: z.string().optional(),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse + validate the environment. Throws (fail-closed) on any invalid value,
 * listing every offending key so misconfiguration is obvious in the boot log.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Render (and many PaaS) inject the listen port as PORT; map it to HTTP_PORT when unset.
  const source = env.PORT && !env.HTTP_PORT ? { ...env, HTTP_PORT: env.PORT } : env;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}

/** Comma-separated KAFKA_BROKERS → string[]. */
export function kafkaBrokers(cfg: AppConfig): string[] {
  if (!cfg.KAFKA_BROKERS) {
    throw new Error('KAFKA_BROKERS is required but not set');
  }
  return cfg.KAFKA_BROKERS.split(',')
    .map((b) => b.trim())
    .filter(Boolean);
}

function require_<K extends keyof AppConfig>(cfg: AppConfig, key: K): NonNullable<AppConfig[K]> {
  const value = cfg[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`${String(key)} is required for this service but not set`);
  }
  return value as NonNullable<AppConfig[K]>;
}

export const requirePostgresUrl = (cfg: AppConfig): string => require_(cfg, 'POSTGRES_URL');
export const requireMongoUrl = (cfg: AppConfig): string => require_(cfg, 'MONGO_URL');
export const requireValkeyUrl = (cfg: AppConfig): string => require_(cfg, 'VALKEY_URL');
export const requireOpenSearchNode = (cfg: AppConfig): string => require_(cfg, 'OPENSEARCH_NODE');
export const requireS3Endpoint = (cfg: AppConfig): string => require_(cfg, 'S3_ENDPOINT');
export const requireCloudinaryUrl = (cfg: AppConfig): string => require_(cfg, 'CLOUDINARY_URL');

export const isProduction = (cfg: AppConfig): boolean => cfg.NODE_ENV === 'production';

/** Parse `OTEL_EXPORTER_OTLP_HEADERS` ("k1=v1,k2=v2") into a header map (Grafana Cloud auth). */
export function otelHeaders(cfg: AppConfig): Record<string, string> {
  if (!cfg.OTEL_EXPORTER_OTLP_HEADERS) return {};
  const out: Record<string, string> = {};
  for (const pair of cfg.OTEL_EXPORTER_OTLP_HEADERS.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}
