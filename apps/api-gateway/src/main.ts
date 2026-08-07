import './telemetry';
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
  // Generous edge limit so normal use (incl. cold-start retry bursts on free-tier Render) never
  // trips a 429; tune down for prod via env. Fixed-window per IP, per pod.
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
  // Keep every downstream service warm from inside the gateway (no service sleeps → no cold-start
  // errors). Best-effort; complements the external cron.
  startKeepWarm(logger);
}

void main().catch((err) => {
  console.error('fatal: service failed to start', err);
  process.exit(1);
});
