import '@velchat/common/dist/telemetry-bootstrap';
import 'reflect-metadata';
import { loadConfig } from '@velchat/config';
import { createLogger, createMetrics, bootstrapService } from '@velchat/common';
import { AppModule } from './app.module';
import { createRateLimiter } from './gateway/rate-limit';
import { createProxyMiddleware } from './gateway/proxy';
import { startKeepWarm } from './gateway/keep-warm';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics(config.SERVICE_NAME);
  // Generous by default so a cold-start retry burst never trips a 429 — on a sleeping free-tier
  // host the first request can take 30-50s, clients retry, and a tight limit turns that into a
  // self-inflicted outage. Tune down per environment.
  const rateLimit = createRateLimiter(
    Number(process.env.RATE_LIMIT_MAX) || 6000,
    Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  );
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

  // Keeps every upstream's /health warm so no service hibernates behind us. Pointless on an
  // always-on VM, so it is opt-out: KEEP_WARM_MS=0 disables it.
  const keepWarmMs = Number(process.env.KEEP_WARM_MS ?? 10 * 60_000);
  if (keepWarmMs > 0) startKeepWarm(logger, keepWarmMs);
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
