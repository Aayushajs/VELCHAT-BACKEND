import { HealthController, createMetrics, type ObservabilityOptions } from '@velchat/shared-utils';

describe('realtime-gateway health', () => {
  const opts: ObservabilityOptions = {
    serviceName: 'realtime-gateway',
    version: '0.1.0',
    metrics: createMetrics('realtime-gateway-test'),
  };

  it('liveness reports ok', () => {
    const ctrl = new HealthController(opts);
    expect(ctrl.health().status).toBe('ok');
    expect(ctrl.health().service).toBe('realtime-gateway');
  });

  it('readiness defaults to ready when no probe configured', async () => {
    const ctrl = new HealthController(opts);
    expect((await ctrl.ready()).status).toBe('ready');
  });
});
