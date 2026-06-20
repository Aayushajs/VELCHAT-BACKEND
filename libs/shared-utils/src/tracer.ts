import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  otlpEndpoint?: string;
  /** OTLP exporter headers (e.g. Grafana Cloud basic-auth: `{ Authorization: 'Basic ...' }`). */
  otlpHeaders?: Record<string, string>;
}

let sdk: NodeSDK | undefined;

/**
 * Bootstrap OpenTelemetry. MUST be called before NestJS / any instrumented client is
 * imported-and-used so auto-instrumentation can patch http/grpc/kafkajs/ioredis/pg/mongo.
 * No-op (logs a warning) when no OTLP endpoint is configured.
 */
export function startTelemetry(cfg: TelemetryConfig): void {
  if (sdk) return;
  if (!cfg.otlpEndpoint) {
    // Tracing is optional in local/dev without a collector; never crash boot over it.
    return;
  }

  sdk = new NodeSDK({
    resource: new Resource({
      'service.name': cfg.serviceName,
      'service.version': cfg.serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${cfg.otlpEndpoint}/v1/traces`,
      headers: cfg.otlpHeaders,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is noisy and rarely useful in services.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
