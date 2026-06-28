import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';
import type { Logger } from 'pino';
import type { AppConfig } from '@velchat/config';
import { TenantInterceptor } from './tenant.interceptor';
import { ResponseInterceptor } from './response.interceptor';
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

  app.useGlobalInterceptors(new TenantInterceptor(), new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(opts.logger));
  // Global input validation for every service (§A14.5). `whitelist` strips unknown props
  // (anti mass-assignment); `transform` coerces payloads to the DTO types. Endpoints with a
  // DTO class + class-validator decorators are validated; inline/native body types pass through.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  // OpenAPI/Swagger docs for every service — UI at /docs, JSON at /docs-json. Scans all
  // registered controllers, so each module's routes show up automatically every run (§A8).
  // Loaded lazily so importing @velchat/common in tests doesn't pull the Swagger graph.
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const openapi = new DocumentBuilder()
    .setTitle(`VelChat — ${opts.config.SERVICE_NAME}`)
    .setDescription(
      [
        `REST API for the VelChat **${opts.config.SERVICE_NAME}**.`,
        '',
        'A free, self-hostable WhatsApp + Teams + Slack hybrid. Personal content is E2EE (the',
        'server stores only ciphertext); enterprise/workspace content is server-readable.',
        '',
        'Auth: send `Authorization: Bearer <access JWT>` (DAPT, device-bound).',
        'Index of every service: http://localhost:8080/docs',
      ].join('\n'),
    )
    .setVersion(opts.config.SERVICE_VERSION)
    .setLicense('AGPL-3.0 / OSS', 'https://www.gnu.org/licenses/agpl-3.0.html')
    .addServer(`http://localhost:${opts.config.HTTP_PORT}`, 'direct (this service)')
    .addServer('http://localhost:8080', 'dev gateway (unified)')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openapi), {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: `VelChat ${opts.config.SERVICE_NAME} API`,
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
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
