import { HealthController, createMetrics, type ObservabilityOptions } from '@velchat/shared-utils';

describe('user-service health', () => {
  const opts: ObservabilityOptions = {
    serviceName: 'user-service',
    version: '0.1.0',
    metrics: createMetrics('user-service-test'),
  };

  it('liveness reports ok', () => {
    const ctrl = new HealthController(opts);
    expect(ctrl.health().status).toBe('ok');
    expect(ctrl.health().service).toBe('user-service');
  });

  it('readiness defaults to ready when no probe configured', async () => {
    const ctrl = new HealthController(opts);
    expect((await ctrl.ready()).status).toBe('ready');
  });
});
