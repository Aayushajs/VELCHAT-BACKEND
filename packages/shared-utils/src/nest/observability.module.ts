import { Controller, Get, Header, Inject, Module, type DynamicModule } from '@nestjs/common';
import type { ServiceMetrics } from '../metrics';

export const OBSERVABILITY_OPTIONS = Symbol('OBSERVABILITY_OPTIONS');

export interface ObservabilityOptions {
  serviceName: string;
  version: string;
  metrics: ServiceMetrics;
  /** Optional readiness probe — return false to make /ready report not-ready (503). */
  readiness?: () => Promise<boolean>;
}

@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(@Inject(OBSERVABILITY_OPTIONS) private readonly opts: ObservabilityOptions) {}

  /** Liveness — process is up. */
  @Get('health')
  health(): { status: 'ok'; service: string; version: string; uptime_s: number } {
    return {
      status: 'ok',
      service: this.opts.serviceName,
      version: this.opts.version,
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Readiness — dependencies are reachable (override via options.readiness). */
  @Get('ready')
  async ready(): Promise<{ status: 'ready' | 'not-ready' }> {
    const ok = this.opts.readiness ? await this.opts.readiness() : true;
    return { status: ok ? 'ready' : 'not-ready' };
  }
}

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(OBSERVABILITY_OPTIONS) private readonly opts: ObservabilityOptions) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.opts.metrics.registry.metrics();
  }
}

/**
 * Registers `/health`, `/ready`, and `/metrics` for any service from a single import.
 * Keeps all 13 services identical on the observability surface (CLAUDE.md §7).
 */
@Module({})
export class ObservabilityModule {
  static forRoot(opts: ObservabilityOptions): DynamicModule {
    const provider = { provide: OBSERVABILITY_OPTIONS, useValue: opts };
    return {
      module: ObservabilityModule,
      controllers: [HealthController, MetricsController],
      providers: [provider],
      exports: [provider],
      global: true,
    };
  }
}
