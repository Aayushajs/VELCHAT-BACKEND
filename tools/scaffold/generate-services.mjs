/**
 * VelChat service scaffolder (BOOT-0 / §D3).
 *
 * Stamps out the 13 backend microservice skeletons with an identical edge surface
 * (health/ready/metrics, OTel, tenant context, Kafka publisher) and only the DB clients
 * each service legitimately owns (§A10). Re-runnable; safe to extend for new services.
 *
 *   node tools/scaffold/generate-services.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** db ∈ postgres | valkey | mongo | opensearch | s3 ; kafka ∈ producer | consumer | both */
const SERVICES = [
  { name: 'api-gateway', http: 3000, grpc: 50051, dbs: [], kafka: 'producer', desc: 'Edge API gateway — request aggregation, authn passthrough, rate limiting (§A12).' },
  { name: 'realtime-gateway', http: 3001, grpc: 50052, dbs: ['valkey'], kafka: 'consumer', desc: 'WebSocket fabric — connection registry, fan-out, reconnect/sync-cursor (§B9).' },
  { name: 'auth-service', http: 3002, grpc: 50053, dbs: ['postgres', 'valkey'], kafka: 'producer', desc: 'DAPT auth, Reverse-OTP, tokens, device/key directory (§B2).' },
  { name: 'user-service', http: 3003, grpc: 50054, dbs: ['postgres', 'valkey'], kafka: 'both', desc: 'Orgs/workspaces/teams, memberships, roles, authorize API (§B3).' },
  { name: 'chat-service', http: 3004, grpc: 50055, dbs: ['mongo', 'valkey'], kafka: 'both', desc: 'Messages, delivery, receipts, ordering via per-conversation seq (§B4).' },
  { name: 'group-channel-service', http: 3005, grpc: 50056, dbs: ['postgres'], kafka: 'both', desc: 'Conversations, members, channels, communities, device-list epochs (§B7).' },
  { name: 'presence-service', http: 3006, grpc: 50057, dbs: ['valkey'], kafka: 'both', desc: 'Presence, last-seen, rich status, status/stories (§B8).' },
  { name: 'notification-service', http: 3007, grpc: 50058, dbs: ['postgres'], kafka: 'consumer', desc: 'Durable outbox, push routing (APNs/FCM/WebPush), idempotent dispatch (§B10).' },
  { name: 'media-service', http: 3008, grpc: 50059, dbs: ['postgres', 's3'], kafka: 'both', desc: 'Resumable uploads to MinIO, AV scan, transcode, thumbnails (§B11).' },
  { name: 'search-service', http: 3009, grpc: 50060, dbs: ['opensearch'], kafka: 'consumer', desc: 'Indexes events to OpenSearch with tenant + ACL stamping (§B13).' },
  { name: 'call-service', http: 3010, grpc: 50061, dbs: ['postgres'], kafka: 'both', desc: 'WebRTC signaling, LiveKit tokens, meetings, recording (§B12).' },
  { name: 'automation-service', http: 3011, grpc: 50062, dbs: ['postgres'], kafka: 'both', desc: 'Bots, slash commands, workflows, outbound webhooks (§B17).' },
  { name: 'ai-service', http: 3012, grpc: 50063, dbs: ['valkey'], kafka: 'both', desc: 'Translation/STT/TTS/summary; enterprise-only server path (privacy fork §A26.1).' },
];

const DB_DEPS = {
  postgres: { 'pg': '^8.13.1', 'drizzle-orm': '^0.38.3' },
  valkey: { 'ioredis': '^5.4.2' },
  mongo: { 'mongoose': '^8.9.3' },
  opensearch: { '@opensearch-project/opensearch': '^2.13.0' },
  s3: { '@aws-sdk/client-s3': '^3.717.0' },
};

const DB_DEV_DEPS = {
  postgres: { '@types/pg': '^8.11.10' },
};

function write(rel, content) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content.endsWith('\n') ? content : content + '\n', 'utf8');
}

// ── static client classes (one per datastore) ───────────────────────────────
const CLIENT_FILES = {
  postgres: `import { Pool, type PoolClient } from 'pg';
import type { Logger } from 'pino';
import { requireTenant, type ManagedResource } from '@velchat/shared-utils';

/** Postgres client + the §G6 RLS guardrail (set 'app.tenant' GUC per transaction). */
export class PostgresClient implements ManagedResource {
  readonly name = 'postgres';
  readonly pool: Pool;

  constructor(connectionString: string, max: number, private readonly logger: Logger) {
    this.pool = new Pool({ connectionString, max });
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'postgres ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * §G6-1.1: run fn inside a transaction with the RLS GUC set from the active tenant context,
   * so Postgres RLS policies (current_setting('app.tenant')) enforce isolation even if a query
   * forgets its WHERE clause. Missing tenant context → throws (fail-closed).
   */
  async withTenantTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const ctx = requireTenant();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant', $1, true)", [ctx.tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
`,
  valkey: `import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { ManagedResource } from '@velchat/shared-utils';

export class ValkeyClient implements ManagedResource {
  readonly name = 'valkey';
  readonly redis: Redis;

  constructor(url: string, private readonly logger: Logger) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'valkey ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
`,
  mongo: `import mongoose, { type Connection } from 'mongoose';
import type { Logger } from 'pino';
import type { ManagedResource } from '@velchat/shared-utils';

export class MongoClient implements ManagedResource {
  readonly name = 'mongo';
  private conn?: Connection;

  constructor(private readonly url: string, private readonly logger: Logger) {}

  async connect(): Promise<void> {
    this.conn = await mongoose.createConnection(this.url).asPromise();
  }

  async ping(): Promise<boolean> {
    if (this.conn?.readyState !== 1) return false;
    this.logger.debug('mongo connected');
    return true;
  }

  async close(): Promise<void> {
    await this.conn?.close();
  }

  get connection(): Connection | undefined {
    return this.conn;
  }
}
`,
  opensearch: `import { Client } from '@opensearch-project/opensearch';
import type { Logger } from 'pino';
import { currentTenantId, type ManagedResource } from '@velchat/shared-utils';

export class OpenSearchClient implements ManagedResource {
  readonly name = 'opensearch';
  readonly client: Client;

  constructor(
    node: string,
    auth: { username?: string; password?: string },
    private readonly logger: Logger,
  ) {
    this.client = new Client({
      node,
      auth: auth.username ? { username: auth.username, password: auth.password ?? '' } : undefined,
      ssl: { rejectUnauthorized: false },
    });
  }

  async connect(): Promise<void> {
    await this.client.ping();
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res.statusCode === 200;
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'opensearch ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** §G6-3: refuse to build a query without a tenant filter; inject it server-side. */
  withTenantFilter(query: Record<string, unknown>): Record<string, unknown> {
    const tenantId = currentTenantId();
    return { bool: { filter: [{ term: { tenant_id: tenantId } }], must: [query] } };
  }
}
`,
  s3: `import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Logger } from 'pino';
import type { ManagedResource } from '@velchat/shared-utils';

export class ObjectStoreClient implements ManagedResource {
  readonly name = 's3';
  readonly s3: S3Client;

  constructor(
    private readonly opts: { endpoint: string; region: string; accessKey?: string; secretKey?: string; bucket?: string },
    private readonly logger: Logger,
  ) {
    this.s3 = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: true,
      credentials: opts.accessKey
        ? { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey ?? '' }
        : undefined,
    });
  }

  async connect(): Promise<void> {
    await this.ping();
  }

  async ping(): Promise<boolean> {
    if (!this.opts.bucket) return true;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.opts.bucket }));
      return true;
    } catch (err) {
      this.logger.debug({ err: String(err) }, 's3 ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    this.s3.destroy();
  }
}
`,
};

const CLIENT_CLASS = {
  postgres: 'PostgresClient',
  valkey: 'ValkeyClient',
  mongo: 'MongoClient',
  opensearch: 'OpenSearchClient',
  s3: 'ObjectStoreClient',
};
const CLIENT_FILE = {
  postgres: 'postgres.client',
  valkey: 'valkey.client',
  mongo: 'mongo.client',
  opensearch: 'opensearch.client',
  s3: 'objectstore.client',
};
const TOKEN = {
  postgres: 'PG_CLIENT',
  valkey: 'VALKEY_CLIENT',
  mongo: 'MONGO_CLIENT',
  opensearch: 'OPENSEARCH_CLIENT',
  s3: 'S3_CLIENT',
};

function buildAppModule(svc) {
  const configRequires = new Set();
  const sharedImports = ['ObservabilityModule', 'InfraLifecycle', 'type ServiceMetrics', 'type ManagedResource'];
  const clientImports = [];
  const tokenDecls = ["export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');"];
  const blocks = [];

  for (const db of svc.dbs) {
    clientImports.push(`import { ${CLIENT_CLASS[db]} } from './infra/clients/${CLIENT_FILE[db]}';`);
    tokenDecls.push(`export const ${TOKEN[db]} = Symbol('${TOKEN[db]}');`);
    if (db === 'postgres') {
      configRequires.add('requirePostgresUrl');
      blocks.push(
        `    if (deps.config.POSTGRES_URL) {\n` +
          `      const pg = new PostgresClient(requirePostgresUrl(deps.config), deps.config.POSTGRES_MAX_POOL, deps.logger);\n` +
          `      managed.push(pg);\n` +
          `      providers.push({ provide: ${TOKEN[db]}, useValue: pg });\n` +
          `    }`,
      );
    } else if (db === 'valkey') {
      configRequires.add('requireValkeyUrl');
      blocks.push(
        `    if (deps.config.VALKEY_URL) {\n` +
          `      const valkey = new ValkeyClient(requireValkeyUrl(deps.config), deps.logger);\n` +
          `      managed.push(valkey);\n` +
          `      providers.push({ provide: ${TOKEN[db]}, useValue: valkey });\n` +
          `    }`,
      );
    } else if (db === 'mongo') {
      configRequires.add('requireMongoUrl');
      blocks.push(
        `    if (deps.config.MONGO_URL) {\n` +
          `      const mongo = new MongoClient(requireMongoUrl(deps.config), deps.logger);\n` +
          `      managed.push(mongo);\n` +
          `      providers.push({ provide: ${TOKEN[db]}, useValue: mongo });\n` +
          `    }`,
      );
    } else if (db === 'opensearch') {
      configRequires.add('requireOpenSearchNode');
      blocks.push(
        `    if (deps.config.OPENSEARCH_NODE) {\n` +
          `      const os = new OpenSearchClient(requireOpenSearchNode(deps.config), { username: deps.config.OPENSEARCH_USERNAME, password: deps.config.OPENSEARCH_PASSWORD }, deps.logger);\n` +
          `      managed.push(os);\n` +
          `      providers.push({ provide: ${TOKEN[db]}, useValue: os });\n` +
          `    }`,
      );
    } else if (db === 's3') {
      configRequires.add('requireS3Endpoint');
      blocks.push(
        `    if (deps.config.S3_ENDPOINT) {\n` +
          `      const store = new ObjectStoreClient({ endpoint: requireS3Endpoint(deps.config), region: deps.config.S3_REGION, accessKey: deps.config.S3_ACCESS_KEY, secretKey: deps.config.S3_SECRET_KEY, bucket: deps.config.S3_BUCKET }, deps.logger);\n` +
          `      managed.push(store);\n` +
          `      providers.push({ provide: ${TOKEN[db]}, useValue: store });\n` +
          `    }`,
      );
    }
  }

  // Kafka publisher for every service (DLQ + state-change events). Guarded by env.
  configRequires.add('kafkaBrokers');
  sharedImports.push('EventPublisher', 'createKafka');
  blocks.push(
    `    if (deps.config.KAFKA_BROKERS) {\n` +
      `      const kafka = createKafka({ clientId: deps.config.KAFKA_CLIENT_ID, brokers: kafkaBrokers(deps.config) });\n` +
      `      const publisher = new EventPublisher(kafka);\n` +
      `      managed.push({ name: 'kafka', connect: () => publisher.connect(), ping: async () => true, close: () => publisher.disconnect() });\n` +
      `      providers.push({ provide: EVENT_PUBLISHER, useValue: publisher });\n` +
      `    }`,
  );

  const configImport =
    configRequires.size > 0
      ? `import { ${[...configRequires].sort().join(', ')}, type AppConfig } from '@velchat/config';`
      : `import type { AppConfig } from '@velchat/config';`;

  return `import { Module, type DynamicModule } from '@nestjs/common';
${configImport}
import type { Logger } from 'pino';
import { ${sharedImports.join(', ')} } from '@velchat/shared-utils';
${clientImports.join('\n')}

${tokenDecls.join('\n')}

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/**
 * ${svc.desc}
 *
 * BOOT-0 skeleton: edge surface (health/ready/metrics, OTel, tenant context) + wired DB/Kafka
 * clients only. Business logic arrives in the phase prompts (see VelChat-ClaudeCode-Prompts.md).
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const managed: ManagedResource[] = [];
    const providers: Array<{ provide: symbol; useValue: unknown }> = [];

${blocks.join('\n\n')}

    const lifecycle = new InfraLifecycle(managed, deps.logger);

    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: deps.config.SERVICE_NAME,
          version: deps.config.SERVICE_VERSION,
          metrics: deps.metrics,
          readiness: () => lifecycle.isReady(),
        }),
      ],
      providers: [{ provide: InfraLifecycle, useValue: lifecycle }, ...providers],
      exports: providers.map((p) => p.provide),
    };
  }
}
`;
}

function buildPackageJson(svc) {
  const deps = {
    '@velchat/config': 'workspace:*',
    '@velchat/shared-utils': 'workspace:*',
    '@velchat/shared-types': 'workspace:*',
    '@nestjs/common': '^10.4.15',
    '@nestjs/core': '^10.4.15',
    '@nestjs/platform-express': '^10.4.15',
    'pino': '^9.6.0',
    'reflect-metadata': '^0.2.2',
    'rxjs': '^7.8.1',
  };
  let devDeps = {};
  for (const db of svc.dbs) {
    Object.assign(deps, DB_DEPS[db] ?? {});
    Object.assign(devDeps, DB_DEV_DEPS[db] ?? {});
  }
  const pkg = {
    name: `@velchat/${svc.name}`,
    version: '0.1.0',
    private: true,
    main: 'dist/main.js',
    scripts: {
      build: 'tsc -p tsconfig.json',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      lint: 'eslint src',
      test: 'jest',
      start: 'node dist/main.js',
      dev: 'tsx watch src/main.ts',
      clean: 'rimraf dist .turbo coverage',
    },
    dependencies: Object.fromEntries(Object.entries(deps).sort()),
  };
  if (Object.keys(devDeps).length > 0) {
    pkg.devDependencies = Object.fromEntries(Object.entries(devDeps).sort());
  }
  return JSON.stringify(pkg, null, 2);
}

const tsconfig = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "coverage", "**/*.spec.ts"]
}
`;

const jestConfig = `module.exports = { ...require('../../jest.preset.cjs') };
`;

const telemetry = `// MUST be imported first (before any instrumented client) so OTel can patch http/grpc/kafka/db.
import { startTelemetry } from '@velchat/shared-utils';

startTelemetry({
  serviceName: process.env.SERVICE_NAME ?? 'unknown-service',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.0.0',
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
`;

const mainTs = `import './telemetry';
import 'reflect-metadata';
import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, bootstrapService } from '@velchat/shared-utils';
import { AppModule } from './app.module';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics(config.SERVICE_NAME);
  await bootstrapService(AppModule.forRoot({ config, logger, metrics }), { config, logger });
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
`;

function appSpec(svc) {
  return `import { HealthController, createMetrics, type ObservabilityOptions } from '@velchat/shared-utils';

describe('${svc.name} health', () => {
  const opts: ObservabilityOptions = {
    serviceName: '${svc.name}',
    version: '0.1.0',
    metrics: createMetrics('${svc.name}-test'),
  };

  it('liveness reports ok', () => {
    const ctrl = new HealthController(opts);
    expect(ctrl.health().status).toBe('ok');
    expect(ctrl.health().service).toBe('${svc.name}');
  });

  it('readiness defaults to ready when no probe configured', async () => {
    const ctrl = new HealthController(opts);
    expect((await ctrl.ready()).status).toBe('ready');
  });
});
`;
}

function dockerfile(svc) {
  return `# syntax=docker/dockerfile:1
# Multi-stage build for @velchat/${svc.name}. Context = repo root. Buildah/Kaniko-friendly.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm -r build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/${svc.name}
EXPOSE ${svc.http}
USER node
CMD ["node", "dist/main.js"]
`;
}

function envExample(svc) {
  const lines = [
    `NODE_ENV=development`,
    `LOG_LEVEL=debug`,
    `SERVICE_NAME=${svc.name}`,
    `SERVICE_VERSION=0.1.0`,
    `HTTP_PORT=${svc.http}`,
    `GRPC_PORT=${svc.grpc}`,
    `METRICS_PORT=9464`,
    ``,
    `KAFKA_BROKERS=localhost:9092`,
    `KAFKA_CLIENT_ID=${svc.name}`,
    `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`,
  ];
  if (svc.dbs.includes('postgres')) lines.push(``, `POSTGRES_URL=postgres://velchat:velchat@localhost:5432/velchat`);
  if (svc.dbs.includes('mongo')) lines.push(`MONGO_URL=mongodb://velchat:velchat@localhost:27017/velchat?authSource=admin`);
  if (svc.dbs.includes('valkey')) lines.push(`VALKEY_URL=redis://localhost:6379`);
  if (svc.dbs.includes('opensearch')) lines.push(`OPENSEARCH_NODE=http://localhost:9200`, `OPENSEARCH_USERNAME=admin`, `OPENSEARCH_PASSWORD=Velchat_dev_1!`);
  if (svc.dbs.includes('s3')) lines.push(`S3_ENDPOINT=http://localhost:9000`, `S3_ACCESS_KEY=velchatadmin`, `S3_SECRET_KEY=velchatadminsecret`, `S3_BUCKET=velchat-media`);
  return lines.join('\n') + '\n';
}

function helmValues(svc) {
  return `# Per-service overrides for the generic velchat-service chart.
name: ${svc.name}
image:
  repository: registry.local/velchat/${svc.name}
  tag: latest
ports:
  http: ${svc.http}
  grpc: ${svc.grpc}
  metrics: 9464
envFrom:
  - configMapRef:
      name: ${svc.name}-config
  - secretRef:
      name: ${svc.name}-secrets
`;
}

function readme(svc) {
  return `# @velchat/${svc.name}

${svc.desc}

| | |
|---|---|
| HTTP port | \`${svc.http}\` |
| gRPC port | \`${svc.grpc}\` |
| Datastores | ${svc.dbs.length ? svc.dbs.join(', ') : '—'} |
| Kafka | ${svc.kafka} |

## Endpoints (BOOT-0)
- \`GET /health\` — liveness
- \`GET /ready\` — readiness (pings wired datastores)
- \`GET /metrics\` — Prometheus (RED metrics + default process metrics)

## Run
\`\`\`bash
cp .env.example .env
pnpm --filter @velchat/${svc.name} build
pnpm --filter @velchat/${svc.name} start
\`\`\`

Env is validated at boot by \`@velchat/config\` (zod, fail-closed). See \`.env.example\`.
`;
}

let count = 0;
for (const svc of SERVICES) {
  const base = `apps/${svc.name}`;
  write(`${base}/package.json`, buildPackageJson(svc));
  write(`${base}/tsconfig.json`, tsconfig);
  write(`${base}/jest.config.cjs`, jestConfig);
  write(`${base}/Dockerfile`, dockerfile(svc));
  write(`${base}/.env.example`, envExample(svc));
  write(`${base}/README.md`, readme(svc));
  write(`${base}/src/telemetry.ts`, telemetry);
  write(`${base}/src/main.ts`, mainTs);
  write(`${base}/src/app.module.ts`, buildAppModule(svc));
  write(`${base}/src/app.spec.ts`, appSpec(svc));
  for (const db of svc.dbs) {
    write(`${base}/src/infra/clients/${CLIENT_FILE[db]}.ts`, CLIENT_FILES[db]);
  }
  write(`deploy/helm/values/${svc.name}.yaml`, helmValues(svc));
  count += 1;
  // eslint-disable-next-line no-console
  console.log(`scaffolded ${svc.name} (${svc.dbs.join('+') || 'no-db'}, kafka:${svc.kafka})`);
}
// eslint-disable-next-line no-console
console.log(`\nDone: ${count} services.`);
