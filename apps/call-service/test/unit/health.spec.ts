import { HealthController, createMetrics, type ObservabilityOptions } from '@velchat/common';

describe('call-service health', () => {
  const opts: ObservabilityOptions = {
    serviceName: 'call-service',
    version: '0.1.0',
    metrics: createMetrics('call-service-test'),
  };

  it('liveness reports ok', () => {
    const ctrl = new HealthController(opts);
    expect(ctrl.health().status).toBe('ok');
    expect(ctrl.health().service).toBe('call-service');
  });

  it('readiness defaults to ready when no probe configured', async () => {
    const ctrl = new HealthController(opts);
    expect((await ctrl.ready()).status).toBe('ready');
  });
});
