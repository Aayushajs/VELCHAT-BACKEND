# infra/observability

Placeholder for the observability stack manifests/dashboards (§A20), installed in **P0**:

- Prometheus + Grafana (metrics; default dashboards for NestJS RED, Kafka, each datastore)
- Loki (logs) + Tempo (traces) + OpenTelemetry Collector
- GlitchTip (errors, Sentry-API compatible) + Alertmanager (SLO burn alerts)

Services already emit the data: `/metrics` (Prometheus), structured pino logs (no PII), and OTLP
traces to `OTEL_EXPORTER_OTLP_ENDPOINT`. This directory wires the collectors + dashboards in P0.
