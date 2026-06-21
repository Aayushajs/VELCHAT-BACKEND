// Errors
export * from './errors/errors';

// IDs
export { uuidv7 } from './ids';

// Tenant context (§G6)
export * from './tenant/tenant-context';

// Observability
export { createLogger, type Logger, type LogConfig } from './observability/logger';
export { startTelemetry, shutdownTelemetry, type TelemetryConfig } from './observability/tracer';
export { createMetrics, type ServiceMetrics } from './observability/metrics';

// Eventing (§A11, §G7)
export * from './eventing/event-envelope';
export { createKafka, EventPublisher } from './eventing/kafka-client';
export { IdempotencyStore } from './eventing/idempotency';
export { BaseEventConsumer, type ConsumerDeps } from './eventing/kafka-consumer.base';

// Authz
export * from './tenant/authz';

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
