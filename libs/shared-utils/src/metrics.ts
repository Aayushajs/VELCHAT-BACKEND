import client, { Registry, Counter, Histogram } from 'prom-client';

/**
 * Per-service Prometheus registry with default process metrics + RED building blocks
 * (Rate, Errors, Duration). Exposed at `GET /metrics` by the shared MetricsController.
 */
export interface ServiceMetrics {
  registry: Registry;
  httpRequests: Counter<'method' | 'route' | 'status'>;
  httpDuration: Histogram<'method' | 'route' | 'status'>;
  eventsConsumed: Counter<'topic' | 'result'>;
  eventsPublished: Counter<'topic'>;
}

export function createMetrics(serviceName: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests (RED: rate + errors).',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds (RED: duration).',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const eventsConsumed = new Counter({
    name: 'kafka_events_consumed_total',
    help: 'Kafka events consumed, labelled by topic and result (ok/duplicate/dlq).',
    labelNames: ['topic', 'result'] as const,
    registers: [registry],
  });

  const eventsPublished = new Counter({
    name: 'kafka_events_published_total',
    help: 'Kafka events published, labelled by topic.',
    labelNames: ['topic'] as const,
    registers: [registry],
  });

  return { registry, httpRequests, httpDuration, eventsConsumed, eventsPublished };
}
