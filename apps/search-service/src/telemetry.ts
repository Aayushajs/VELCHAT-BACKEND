// MUST be imported first (before any instrumented client) so OTel can patch http/grpc/kafka/db.
import { startTelemetry } from '@velchat/shared-utils';

startTelemetry({
  serviceName: process.env.SERVICE_NAME ?? 'unknown-service',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.0.0',
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
