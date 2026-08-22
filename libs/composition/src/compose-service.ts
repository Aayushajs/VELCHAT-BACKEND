import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '@velchat/config';
import type { Logger } from 'pino';
import {
  ObservabilityModule,
  GlobalAuthModule,
  InfraLifecycle,
  type ServiceMetrics,
  type ManagedResource,
} from '@velchat/common';
import { createInfraContext, type InfraContext } from '@velchat/infra-context';
import { mergeMounted, mergeNeeds, type FeatureGroup } from './mounted';

export interface ServiceDeps {
  config: AppConfig;
  logger: Logger;
  metrics: ServiceMetrics;
}

/** Exposed so a main.ts can reach this process's infra (the WebSocket fabric needs it). */
export const INFRA = Symbol('INFRA');

/**
 * Assemble a runtime service from one or more feature groups.
 *
 * Every root used to repeat the same four things — build an infra context, register the global
 * guard and the observability surface, collect managed resources, and sequence
 * registration → single bus start → workers. That was ~600 lines of near-identical wiring across
 * six files, which is exactly where per-service drift accumulates.
 *
 * Centralising it also makes the deployment shape a parameter rather than a rewrite: one group per
 * process gives the six-service topology, and all five groups in one process gives `mono`, which is
 * what fits a 1 GB free-tier box (deploy/PORTABILITY.md). Same code either way.
 */
export function composeService(
  AppModuleClass: new () => unknown,
  deps: ServiceDeps,
  groups: FeatureGroup[],
): DynamicModule {
  const infra = createInfraContext(deps, { need: mergeNeeds(groups) });
  const mounted = mergeMounted(groups.map((g) => g.mount(infra)));

  const managed: ManagedResource[] = [...infra.managed];

  if (mounted.ensureIndexes.length > 0) {
    managed.push({
      name: 'indexes',
      connect: async () => {
        for (const fn of mounted.ensureIndexes) await fn();
      },
      ping: async () => true,
      close: async () => undefined,
    });
  }

  // Registration → ONE bus start → workers. Starting the bus before every consumer is registered
  // would silently drop whatever arrives in between (see Mounted).
  if (infra.eventBus) {
    const bus = infra.eventBus;
    managed.push({
      name: 'pipeline',
      connect: async () => {
        for (const fn of mounted.register) fn();
        await bus.start();
        for (const w of mounted.workers) w.start();
      },
      ping: async () => true,
      close: async () => {
        for (const w of mounted.workers) await w.stop();
      },
    });
  }

  const lifecycle = new InfraLifecycle(managed, deps.logger);

  return {
    module: AppModuleClass,
    imports: [
      // Default-deny authentication. Throws at boot when the service cannot verify tokens, so a
      // misconfigured process never comes up serving open endpoints.
      GlobalAuthModule.forRoot(deps.config, deps.logger),
      ObservabilityModule.forRoot({
        serviceName: deps.config.SERVICE_NAME,
        version: deps.config.SERVICE_VERSION,
        metrics: deps.metrics,
        readiness: () => lifecycle.isReady(),
      }),
      ...mounted.imports,
    ],
    providers: [
      { provide: InfraLifecycle, useValue: lifecycle },
      { provide: INFRA, useValue: infra satisfies InfraContext },
    ],
    exports: [INFRA],
  };
}

/** Convenience for the common case: a service that is exactly one feature group. */
export function composeSingle(
  AppModuleClass: new () => unknown,
  deps: ServiceDeps,
  group: FeatureGroup,
): DynamicModule {
  return composeService(AppModuleClass, deps, [group]);
}

/** Re-exported so a root can declare its module class without importing @nestjs/common. */
export { Module };
