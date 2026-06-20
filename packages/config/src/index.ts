import { z } from 'zod';

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
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse + validate the environment. Throws (fail-closed) on any invalid value,
 * listing every offending key so misconfiguration is obvious in the boot log.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
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
