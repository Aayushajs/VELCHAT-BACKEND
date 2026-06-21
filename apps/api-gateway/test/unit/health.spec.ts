import { HealthController, createMetrics, type ObservabilityOptions } from '@velchat/common';

describe('api-gateway health', () => {
  const opts: ObservabilityOptions = {
    serviceName: 'api-gateway',
    version: '0.1.0',
    metrics: createMetrics('api-gateway-test'),
  };

  it('liveness reports ok', () => {
    const ctrl = new HealthController(opts);
    expect(ctrl.health().status).toBe('ok');
    expect(ctrl.health().service).toBe('api-gateway');
  });

  it('readiness defaults to ready when no probe configured', async () => {
    const ctrl = new HealthController(opts);
    expect((await ctrl.ready()).status).toBe('ready');
  });
});
