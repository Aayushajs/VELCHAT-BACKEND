import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';
import type { Logger } from 'pino';
import type { AppConfig } from '@velchat/config';
import { TenantInterceptor } from './tenant.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { shutdownTelemetry } from '../observability/tracer';

export interface BootstrapOptions {
  config: AppConfig;
  logger: Logger;
}

/**
 * Standard service bootstrap — keeps all 13 services identical at the edges:
 * tenant context interceptor, consistent error mapping, graceful drain (§B9), and
 * a clean OTel shutdown. Returns the Nest app so callers can extend it (gRPC, WS, etc.).
 */
export async function bootstrapService(
  appModule: Type<unknown> | DynamicModule,
  opts: BootstrapOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(appModule, { bufferLogs: false });

  app.useGlobalInterceptors(new TenantInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(opts.logger));
  app.enableShutdownHooks();

  // OpenAPI/Swagger docs for every service — UI at /docs, JSON at /docs-json. Scans all
  // registered controllers, so each module's routes show up automatically every run (§A8).
  // Loaded lazily so importing @velchat/common in tests doesn't pull the Swagger graph.
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const openapi = new DocumentBuilder()
    .setTitle(`VelChat — ${opts.config.SERVICE_NAME}`)
    .setDescription(`API documentation for ${opts.config.SERVICE_NAME}.`)
    .setVersion(opts.config.SERVICE_VERSION)
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openapi), {
    jsonDocumentUrl: 'docs-json',
  });

  // Graceful drain: stop accepting, let in-flight finish, flush telemetry (§B9).
  const shutdown = async (signal: string): Promise<void> => {
    opts.logger.info({ signal }, 'shutting down');
    await app.close();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen(opts.config.HTTP_PORT, '0.0.0.0');
  opts.logger.info(
    { port: opts.config.HTTP_PORT, service: opts.config.SERVICE_NAME },
    'service listening',
  );
  return app;
}
