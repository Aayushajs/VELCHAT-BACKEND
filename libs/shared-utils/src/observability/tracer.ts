export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  otlpEndpoint?: string;
  /** OTLP exporter headers (e.g. Grafana Cloud basic-auth: `{ Authorization: 'Basic ...' }`). */
  otlpHeaders?: Record<string, string>;
}

// Minimal handle so importing this module never pulls the (heavy, optional) OpenTelemetry graph.
let sdk: { shutdown: () => Promise<void> } | undefined;

/**
 * Bootstrap OpenTelemetry. OTel packages are loaded LAZILY (dynamic import) only when an OTLP
 * endpoint is configured — so importing @velchat/shared-utils stays light and tests/services that
 * don't enable tracing never touch the instrumentation graph. No-op without an endpoint.
 */
export async function startTelemetry(cfg: TelemetryConfig): Promise<void> {
  if (sdk || !cfg.otlpEndpoint) return;

  const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }, { Resource }] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
    ]);

  const instance = new NodeSDK({
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
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  instance.start();
  sdk = instance;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
