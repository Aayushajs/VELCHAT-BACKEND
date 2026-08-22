import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import { JwtAuthGuard } from './jwt-auth.guard';
import { resolveAuthMode } from './auth-mode';
import { resolveInternalSecret } from './dev-keys';

/**
 * Registers {@link JwtAuthGuard} as a GLOBAL guard, so every route in the importing service is
 * authenticated by default and `@Public()` is the only way out (DEF-02).
 *
 * Default-deny is the whole point. The audit found 23 controllers across 11 services with no guard
 * at all — including `user-service/admin.controller.ts` — because per-controller `@UseGuards` is
 * opt-in, and opt-in security is forgotten. Inverting it means a new controller is protected
 * without anyone remembering to protect it.
 *
 * Boot fails when the service cannot verify tokens; see {@link resolveAuthMode}.
 */
@Module({})
export class GlobalAuthModule {
  static forRoot(config: AppConfig, logger: Logger): DynamicModule {
    const mode = resolveAuthMode(config); // throws → the service does not start

    if (!mode.verify || !mode.publicKeyPem || !mode.issuer) {
      logger.warn(
        { service: config.SERVICE_NAME, authDevInsecure: true },
        'AUTHENTICATION DISABLED (AUTH_DEV_INSECURE=true). Every route is unauthenticated. ' +
          'This is refused in production.',
      );
      return { module: GlobalAuthModule, global: true };
    }

    const guard = new JwtAuthGuard(new Reflector(), {
      publicKeyPem: mode.publicKeyPem,
      issuer: mode.issuer,
      // Enables @AllowInternal() endpoints for service-to-service calls. Unset ⇒ that path stays
      // closed, and the WebSocket fabric's membership lookups will be refused rather than trusted.
      internalSecret: resolveInternalSecret(config),
    });

    return {
      module: GlobalAuthModule,
      global: true,
      providers: [{ provide: APP_GUARD, useValue: guard }],
    };
  }
}
