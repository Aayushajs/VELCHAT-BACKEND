import { PresenceService } from '../../src/presence/presence.service';
import type { PresenceRepository } from '../../src/presence/presence.repository';
import type { PresenceEvents } from '../../src/presence/presence.events';
import { ValidationError } from '@velchat/common';

function setup(state: { online?: number; manual?: unknown; lastSeen?: number | null } = {}) {
  let online = state.online ?? 0;
  const repo = {
    addDevice: jest.fn(async () => {
      online += 1;
    }),
    removeDevice: jest.fn(async () => {
      online = Math.max(0, online - 1);
      return online;
    }),
    heartbeat: jest.fn(async () => undefined),
    onlineCount: jest.fn(async () => online),
    getManual: jest.fn(async () => state.manual ?? null),
    lastSeen: jest.fn(async () => state.lastSeen ?? null),
    setManual: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
  } as unknown as PresenceRepository;
  const changed: Array<{ userId: string; status: string }> = [];
  const events = {
    changed: jest.fn(async (userId: string, status: string) => {
      changed.push({ userId, status });
    }),
  } as unknown as PresenceEvents;
  return { svc: new PresenceService(repo, events), repo, changed };
}

describe('PresenceService (§A15/§B8)', () => {
  it('online → available + fans presence.changed(online)', async () => {
    const { svc, changed } = setup();
    await svc.online('u1', 'd1');
    expect(changed).toEqual([{ userId: 'u1', status: 'online' }]);
  });

  it('online requires userId + deviceId', async () => {
    await expect(setup().svc.online('', 'd1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('offline of the last device fans offline + returns last-seen on get', async () => {
    const { svc, changed } = setup({ online: 1, lastSeen: 123 });
    await svc.offline('u1', 'd1');
    expect(changed).toEqual([{ userId: 'u1', status: 'offline' }]);
    const p = await svc.get('u1');
    expect(p.status).toBe('offline');
    expect(p.lastSeen).toBe(123);
  });

  it('get resolves rich presence (dnd) and hides last-seen while online', async () => {
    const { svc } = setup({ online: 1, manual: { availability: 'dnd' }, lastSeen: 99 });
    const p = await svc.get('u1');
    expect(p.status).toBe('dnd');
    expect(p.lastSeen).toBeNull();
  });

  it('subscribe counts targets', async () => {
    const { svc } = setup();
    expect(await svc.subscribe('watcher', ['a', 'b', ''])).toEqual({ subscribed: 2 });
  });
});
