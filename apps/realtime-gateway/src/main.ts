import './telemetry';
import 'reflect-metadata';
import { hostname } from 'node:os';
import { loadConfig, requireValkeyUrl } from '@velchat/config';
import { createLogger, createMetrics, bootstrapService } from '@velchat/common';
import { ValkeyClient } from '@velchat/cache';
import { AppModule } from './app.module';
import { ConnectionRegistry } from './fabric/connection-registry';
import { WsFabric } from './fabric/ws-fabric';

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
    const fabric = new WsFabric(app.getHttpServer(), valkey.redis, registry, logger, {
      podId: process.env.POD_ID ?? hostname(),
      jwtPublicKey: process.env.JWT_PUBLIC_KEY,
    });
    await fabric.start();
    app.enableShutdownHooks();
    process.on('SIGTERM', () => void fabric.stop());
  }
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
