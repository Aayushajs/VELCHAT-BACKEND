// MUST be first: OpenTelemetry patches http/redis at import time.
import '@velchat/common/dist/telemetry-bootstrap';
import 'reflect-metadata';
import { hostname } from 'node:os';
import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, bootstrapService } from '@velchat/common';
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
  const projection = new MembershipProjection(
    valkey.redis,
    process.env.UPSTREAM_IDENTITY || 'http://localhost:3002',
  );
  const skdm = new SkdmService(new SkdmStore(valkey.redis), router, projection, logger);
  const typing = new TypingRelay(projection, router);

  const fabric = new WsFabric(app.getHttpServer(), valkey.redis, registry, logger, {
    podId: process.env.POD_ID ?? hostname(),
    // Schema-backed key. Undefined here would make the fabric fall back to `jwt.decode` and
    // accept forged tokens (DEF-06), so a production deployment must set it — GlobalAuthModule
    // already refuses to boot without it.
    jwtPublicKey: config.JWT_PUBLIC_PEM,
    sink: bus ? new ReceiptPublisher(bus) : undefined,
    skdm,
    typing,
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
