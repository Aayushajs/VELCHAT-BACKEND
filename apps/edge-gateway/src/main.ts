import '@velchat/common/dist/telemetry-bootstrap';
import 'reflect-metadata';
import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, bootstrapService } from '@velchat/common';
import { AppModule } from './app.module';
import { createRateLimiter } from './gateway/rate-limit';
import { createProxyMiddleware } from './gateway/proxy';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics(config.SERVICE_NAME);
  const rateLimit = createRateLimiter();
  const proxy = createProxyMiddleware(logger);
  await bootstrapService(AppModule.forRoot({ config, logger, metrics }), {
    config,
    logger,
    // Edge pipeline: rate-limit → reverse-proxy to the owning service (§A12.1). Unmatched paths
    // (/health, /metrics, /docs) fall through to the gateway's own Nest handlers.
    configure: (app) => {
      app.use(rateLimit);
      app.use(proxy);
    },
  });
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
