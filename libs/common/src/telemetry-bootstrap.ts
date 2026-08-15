/**
 * Telemetry bootstrap, as a SIDE EFFECT of importing this module.
 *
 * Import it first, before anything that touches http/redis/pg/mongo:
 *
 *   import '@velchat/common/dist/telemetry-bootstrap';
 *
 * It has to be an import rather than a function call. Imports are hoisted and run before any
 * statement in the module body, so a `bootstrapTelemetry()` call would execute only after every
 * instrumented client had already been loaded — too late for OpenTelemetry to patch them.
 *
 * This replaces a `telemetry.ts` that was byte-identical in all 13 services.
 */
import { startTelemetry } from './observability/tracer';

/** `OTEL_EXPORTER_OTLP_HEADERS` is `k=v,k2=v2` (values may contain `=`, e.g. base64 auth). */
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
