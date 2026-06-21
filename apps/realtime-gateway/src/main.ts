import './telemetry';
import 'reflect-metadata';
import { hostname } from 'node:os';
import { loadConfig, requireValkeyUrl } from '@velchat/config';
import { createLogger, createMetrics, bootstrapService } from '@velchat/common';
import { ValkeyClient } from '@velchat/cache';
import type { EventBus } from '@velchat/event-bus';
import { AppModule, EVENT_BUS } from './app.module';
import { ConnectionRegistry } from './fabric/connection-registry';
import { EventRouter } from './fabric/event-router';
import { WsFabric } from './fabric/ws-fabric';
import { MembershipProjection } from './fanout/membership-projection';
import { ValkeyPodPublisher } from './fanout/valkey-pod-publisher';
import { FanoutConsumer } from './fanout/fanout-consumer';
import { ReceiptPublisher } from './fanout/receipt-publisher';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics(config.SERVICE_NAME);
  const app = await bootstrapService(AppModule.forRoot({ config, logger, metrics }), {
    config,
    logger,
  });

  // Attach the WebSocket fabric to the HTTP server (§B9) once Valkey is available.
  if (config.VALKEY_URL) {
    const valkey = new ValkeyClient(requireValkeyUrl(config), logger);
    await valkey.connect();
    const registry = new ConnectionRegistry(valkey.redis);
    const bus = app.get<EventBus>(EVENT_BUS, { strict: false });

    const fabric = new WsFabric(app.getHttpServer(), valkey.redis, registry, logger, {
      podId: process.env.POD_ID ?? hostname(),
      jwtPublicKey: process.env.JWT_PUBLIC_KEY,
      // Inbound delivered/read acks → durable receipt events (§B4.4).
      sink: bus ? new ReceiptPublisher(bus) : undefined,
    });
    await fabric.start();

    // §B9.2 fan-out: consume durable events → resolve members → push to online sockets.
    if (bus) {
      const router = new EventRouter(registry, new ValkeyPodPublisher(valkey.redis));
      const projection = new MembershipProjection(valkey.redis);
      const fanout = new FanoutConsumer(bus, projection, router, logger);
      fanout.register();
      await bus.start();
      logger.info('realtime fan-out consumer started');
    }

    app.enableShutdownHooks();
    process.on('SIGTERM', () => void fabric.stop());
  }
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
