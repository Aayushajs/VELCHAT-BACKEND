import type { Logger } from '@velchat/common';
import { SkdmService, type SkdmTarget } from './skdm.service';
import type { EventRouter } from '../fabric/event-router';
import type { MembershipProjection } from './membership-projection';
import type { SkdmStore } from './skdm-store';

function setup(opts: { online?: Set<string>; members?: string[] } = {}) {
  const online = opts.online ?? new Set<string>();
  const enqueued: Array<{ userId: string; deviceId: string }> = [];
  const store = {
    enqueue: jest.fn(async (userId: string, deviceId: string) => {
      enqueued.push({ userId, deviceId });
    }),
    drain: jest.fn(async () => [] as unknown[]),
  } as unknown as SkdmStore;
  const toDevice: Array<{ userId: string; deviceId: string }> = [];
  const toUsers: string[][] = [];
  const router = {
    routeToDevice: jest.fn(async (userId: string, deviceId: string) => {
      toDevice.push({ userId, deviceId });
      return online.has(`${userId}:${deviceId}`) ? 1 : 0;
    }),
    route: jest.fn(async (users: string[]) => {
      toUsers.push(users);
      return users.length;
    }),
  } as unknown as EventRouter;
  const projection = {
    members: jest.fn(async () => opts.members ?? []),
  } as unknown as MembershipProjection;
  const logger = { debug: jest.fn() } as unknown as Logger;
  const svc = new SkdmService(store, router, projection, logger);
  return { svc, store, router, projection, enqueued, toDevice, toUsers };
}

describe('SkdmService (§G1-2)', () => {
  it('delivers to online devices and queues offline ones', async () => {
    const { svc, enqueued, router } = setup({ online: new Set(['u1:devOn']) });
    const targets: SkdmTarget[] = [
      { userId: 'u1', deviceId: 'devOn', ciphertext: 'x' },
      { userId: 'u2', deviceId: 'devOff', ciphertext: 'y' },
    ];
    await svc.distribute('c1', 3, 'sender', targets);
    expect(router.routeToDevice).toHaveBeenCalledTimes(2);
    expect(enqueued).toEqual([{ userId: 'u2', deviceId: 'devOff' }]); // only the offline one queued
  });

  it('asks the other members to re-send on an skdm-request', async () => {
    const { svc, toUsers } = setup({ members: ['alice', 'bob', 'carol'] });
    await svc.request('c1', 3, 'alice', 'devA');
    expect(toUsers).toEqual([['bob', 'carol']]); // excludes the requester
  });

  it('replays the queue to a device on reconnect', async () => {
    const { svc, store, router } = setup();
    (store.drain as jest.Mock).mockResolvedValueOnce([
      { epoch: 3, ciphertext: 'a' },
      { epoch: 3, ciphertext: 'b' },
    ]);
    await svc.flushOnConnect('u1', 'devA');
    expect(router.routeToDevice).toHaveBeenCalledTimes(2);
  });
});
