import { HealthController, createMetrics, type ObservabilityOptions } from '@velchat/shared-utils';

describe('group-channel-service health', () => {
  const opts: ObservabilityOptions = {
    serviceName: 'group-channel-service',
    version: '0.1.0',
    metrics: createMetrics('group-channel-service-test'),
  };

  it('liveness reports ok', () => {
    const ctrl = new HealthController(opts);
    expect(ctrl.health().status).toBe('ok');
    expect(ctrl.health().service).toBe('group-channel-service');
  });

  it('readiness defaults to ready when no probe configured', async () => {
    const ctrl = new HealthController(opts);
    expect((await ctrl.ready()).status).toBe('ready');
  });
});
