import './telemetry';
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
