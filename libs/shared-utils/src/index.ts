// Errors
export * from './errors';

// IDs
export { uuidv7 } from './ids';

// Tenant context (§G6)
export * from './tenant-context';

// Observability
export { createLogger, type Logger, type LogConfig } from './logger';
export { startTelemetry, shutdownTelemetry, type TelemetryConfig } from './tracer';
export { createMetrics, type ServiceMetrics } from './metrics';

// Eventing (§A11, §G7)
export * from './event-envelope';
export { createKafka, EventPublisher } from './kafka-client';
export { IdempotencyStore } from './idempotency';
export { BaseEventConsumer, type ConsumerDeps } from './kafka-consumer.base';

// Authz
export * from './authz';

// NestJS building blocks
export {
  ObservabilityModule,
  HealthController,
  MetricsController,
  OBSERVABILITY_OPTIONS,
  type ObservabilityOptions,
} from './nest/observability.module';
export { TenantInterceptor } from './nest/tenant.interceptor';
export { AllExceptionsFilter } from './nest/all-exceptions.filter';
export { bootstrapService, type BootstrapOptions } from './nest/bootstrap';
export { InfraLifecycle, type ManagedResource } from './nest/infra-lifecycle';
