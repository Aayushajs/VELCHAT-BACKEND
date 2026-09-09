import { NotificationRepository } from '../../src/notify/notification.repository';
import { OutboxWorker } from '../../src/notify/outbox.worker';
import type { PushSender } from '@velchat/push';

/**
 * A `pg` pool that answers the way the real driver does: columns come back with their DATABASE
 * names, snake_case, not the camelCase the drizzle-inferred row types promise.
 *
 * That gap is the whole subject of this file. `claimPending` used `RETURNING *` and cast the
 * result `as OutboxRow[]`, so `row.userId` type-checked and was `undefined` at run time — the
 * worker then looked up endpoints for nobody, found none, and marked the row `sent` under the
 * comment "no device to push to". Every push in the system was recorded as delivered and none
 * was ever handed to FCM.
 */
function fakePool(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: sql.trim().toUpperCase().startsWith('UPDATE') ? rows : [] };
      },
    },
  };
}

const DB_ROW = {
  id: 'row-1',
  user_id: 'user-1',
  type: 'message',
  payload: { conversationId: 'c1', seq: '7' },
  dedupe_key: 'msg:m1:user-1',
  status: 'pending',
  attempts: 1,
  next_attempt_at: new Date('2026-01-01T00:00:00Z'),
  last_error: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

describe('NotificationRepository.claimPending (§G4)', () => {
  it('returns rows whose fields match the type it promises', async () => {
    const pg = fakePool([{ ...DB_ROW }]);
    const repo = new NotificationRepository(pg as never);

    const [row] = await repo.claimPending(10);

    // The one that mattered: without it the worker asks for the endpoints of `undefined`.
    expect(row?.userId).toBe('user-1');
    expect(row?.dedupeKey).toBe('msg:m1:user-1');
    expect(row?.nextAttemptAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(row?.id).toBe('row-1');
    expect(row?.attempts).toBe(1);
    expect(row?.payload).toEqual({ conversationId: 'c1', seq: '7' });
  });
});

describe('NotificationRepository.endpointsFor', () => {
  it('returns endpoints whose fields match the type it promises', async () => {
    const pg = {
      pool: {
        query: async () => ({
          rows: [
            {
              device_id: 'dev-1',
              user_id: 'user-1',
              platform: 'android',
              token: 'tok',
              voip_token: null,
              subscription: null,
              updated_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        }),
      },
    };
    const repo = new NotificationRepository(pg as never);

    const [ep] = await repo.endpointsFor('user-1');

    expect(ep?.deviceId).toBe('dev-1');
    expect(ep?.userId).toBe('user-1');
    expect(ep?.platform).toBe('android');
    expect(ep?.token).toBe('tok');
  });
});

describe('OutboxWorker delivery (§G4)', () => {
  function setup(endpoints: unknown[]) {
    const sent: { target: unknown; payload: unknown }[] = [];
    const marked: string[] = [];
    const push: PushSender = {
      kind: 'fcm',
      send: async (target, payload) => {
        sent.push({ target, payload });
      },
    };
    const repo = {
      claimPending: async () => [
        {
          id: 'row-1',
          userId: 'user-1',
          type: 'message',
          payload: { conversationId: 'c1', seq: '7' },
          attempts: 1,
        },
      ],
      endpointsFor: async (userId: string) => (userId === 'user-1' ? endpoints : []),
      markSent: async (id: string) => {
        marked.push(id);
      },
      markRetryOrDead: async () => undefined,
      deleteEndpoint: async () => undefined,
    };
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    return { sent, marked, worker: new OutboxWorker(repo as never, push, logger as never) };
  }

  it('hands a claimed row to the transport', async () => {
    // The end-to-end contract in one assertion: a row that was claimed reaches a real send. It
    // passed before this fix only because the worker never got as far as looking for a device.
    const { sent, marked, worker } = setup([
      { deviceId: 'dev-1', userId: 'user-1', platform: 'android', token: 'tok' },
    ]);

    await worker.tick();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toMatchObject({ platform: 'android', token: 'tok' });
    expect(sent[0]?.payload).toMatchObject({
      type: 'message',
      data: { conversationId: 'c1', seq: '7' },
    });
    expect(marked).toEqual(['row-1']);
  });

  it('still marks a row sent when the user genuinely has no device', async () => {
    const { sent, marked, worker } = setup([]);
    await worker.tick();
    expect(sent).toHaveLength(0);
    expect(marked).toEqual(['row-1']);
  });
});
