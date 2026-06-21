import { DeviceListService } from '../../src/auth/devices/device-list.service';
import type { DeviceListRepository } from '../../src/auth/devices/device-list.repository';
import type { AuthEvents } from '../../src/auth/auth.events';

function setup() {
  let epoch = 1;
  const repo = {
    transition: jest.fn(async () => (epoch += 1)),
    getDeviceList: jest.fn(async () => ({ epoch, devices: [] })),
    auditChain: jest.fn(async () => true),
  } as unknown as DeviceListRepository;
  const events = { deviceListChanged: jest.fn(async () => undefined) } as unknown as AuthEvents;
  return { svc: new DeviceListService(repo, events), repo, events };
}

describe('DeviceListService (§G1-3)', () => {
  it('approve bumps the epoch and emits device.list.changed', async () => {
    const { svc, repo, events } = setup();
    const newEpoch = await svc.approveDevice('acc-1', 'd1');
    expect(repo.transition).toHaveBeenCalledWith('acc-1', 'd1', 'approved', 'active');
    expect(events.deviceListChanged).toHaveBeenCalledWith('acc-1', newEpoch);
  });

  it('propose marks a device pending (not yet active)', async () => {
    const { svc, repo } = setup();
    await svc.proposeDevice('acc-1', 'd2');
    expect(repo.transition).toHaveBeenCalledWith('acc-1', 'd2', 'proposed', 'proposed');
  });

  it('revoke transitions to revoked and bumps the epoch', async () => {
    const { svc, repo, events } = setup();
    await svc.revokeDevice('acc-1', 'd3');
    expect(repo.transition).toHaveBeenCalledWith('acc-1', 'd3', 'revoked', 'revoked');
    expect(events.deviceListChanged).toHaveBeenCalled();
  });
});
