// MUST be first: OpenTelemetry patches http/redis at import time.
import '@velchat/common/dist/telemetry-bootstrap';
import 'reflect-metadata';
import { hostname } from 'node:os';
import { loadConfig } from '@velchat/config';
import {
  createLogger,
  createMetrics,
  bootstrapService,
  resolveInternalSecret,
  resolveAuthMode,
} from '@velchat/common';
import type { InfraContext } from '@velchat/infra-context';
import {
  ConnectionRegistry,
  EventRouter,
  WsFabric,
  MembershipProjection,
  ValkeyPodPublisher,
  FanoutConsumer,
  ReceiptPublisher,
  SkdmStore,
  SkdmService,
  TypingRelay,
} from '@velchat/feature-realtime';
import { AppModule, INFRA } from './app.module';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics(config.SERVICE_NAME);
  const app = await bootstrapService(AppModule.forRoot({ config, logger, metrics }), {
    config,
    logger,
  });

  // The fabric needs the HTTP server, which only exists after bootstrap — hence the wiring here
  // rather than in the module. It reuses the module's infra instead of opening its own clients.
  const infra = app.get<InfraContext>(INFRA, { strict: false });
  const valkey = infra?.valkey;
  const bus = infra?.eventBus;
  if (!valkey) {
    logger.warn('no Valkey configured — WebSocket fabric not started');
    return;
  }

  const registry = new ConnectionRegistry(valkey.redis);
  const router = new EventRouter(registry, new ValkeyPodPublisher(valkey.redis));
  // Membership comes from the service that owns conversations; the Valkey projection is the cache.
  const internalSecret = resolveInternalSecret(config);
  const projection = new MembershipProjection(
    valkey.redis,
    process.env.UPSTREAM_IDENTITY || 'http://localhost:3002',
    internalSecret,
  );
  const skdm = new SkdmService(new SkdmStore(valkey.redis), router, projection, logger);
  const typing = new TypingRelay(projection, router);

  // Authorizes inbound receipts/typing/skdm. Without it the fabric refuses every frame that names a
  // conversation — fail-closed by design, since a valid token says nothing about membership.
  //
  // The PROJECTION is the resolver, not a bare HTTP client: authorizing a frame must not cost an
  // HTTP round-trip to identity-service. Typing alone emits a frame every few keystrokes per active
  // chat, so at 10k+ concurrent sockets a per-frame resolver would aim a self-inflicted DDoS at the
  // conversation owner. The projection answers from the Valkey set and only falls back to HTTP
  // (single-flight, secret-authenticated) when the set is genuinely cold, then re-seeds it.
  const membership = projection;
  if (!internalSecret) {
    logger.warn(
      'INTERNAL_API_SECRET is not set: when the Valkey membership projection is cold, its HTTP ' +
        'auto-heal will 401 and inbound receipts/typing/sender-key frames will be REFUSED until ' +
        'a conversation event re-seeds it. Live delivery still works.',
    );
  }

  const fabric = new WsFabric(app.getHttpServer(), valkey.redis, registry, logger, {
    podId: process.env.POD_ID ?? hostname(),
    // The SAME key the HTTP guard verifies with. Reading config.JWT_PUBLIC_PEM directly was wrong:
    // outside production that is unset and the real key comes from the shared dev pair, so the
    // fabric ended up with no key — and, now that it fails closed rather than falling back to
    // `jwt.decode` (DEF-06), it rejected every socket while HTTP requests worked fine.
    jwtPublicKey: resolveAuthMode(config).publicKeyPem,
    // Projection passed deliberately: a second, independent membership check behind the fabric's
    // gate, so neither layer is the only thing standing between a socket and someone else's chat.
    sink: bus ? new ReceiptPublisher(bus, projection) : undefined,
    skdm,
    typing,
    membership,
    maxPayloadBytes: config.WS_MAX_PAYLOAD_BYTES,
    inboundPerSecond: config.WS_INBOUND_PER_SECOND,
    // '*' means "no origin restriction" (native clients send no Origin at all); an explicit list
    // restricts browser clients to the app's own origins.
    allowedOrigins:
      config.CORS_ORIGINS.trim() === '*'
        ? undefined
        : config.CORS_ORIGINS.split(',').map((o) => o.trim()),
  });
  await fabric.start();

  // §B9.2 fan-out. Registered before the bus starts, so no event slips past the consumer.
  if (bus) {
    new FanoutConsumer(bus, projection, router, logger).register();
    await bus.start();
    logger.info('realtime fan-out consumer started');
  }

  app.enableShutdownHooks();
  process.on('SIGTERM', () => void fabric.stop());
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
