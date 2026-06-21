// MUST be imported first (before any instrumented client) so OTel can patch http/grpc/redis/db.
import { startTelemetry } from '@velchat/shared-utils';

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

void startTelemetry({
  serviceName: process.env.SERVICE_NAME ?? 'unknown-service',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.0.0',
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  otlpHeaders: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
});
