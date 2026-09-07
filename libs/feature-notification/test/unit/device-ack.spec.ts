import { NotificationService } from '../../src/notify/notification.service';
import type { NotificationRepository } from '../../src/notify/notification.repository';
import type { MembersProjection } from '../../src/notify/members.projection';
import type { DeviceReceiptEmitter } from '../../src/notify/push-ack';
import type { Logger } from '@velchat/common';

type Emitted = { state: string; userId: string; conversationId: string; upToSeq: number };

function setup(
  opts: {
    /** What `accountForPushToken` resolves the (deviceId, token) pair to. */
    owner?: string | null;
    members?: string[];
    withEmitter?: boolean;
  } = {},
) {
  const emitted: Emitted[] = [];
  const repo = {
    accountForPushToken: jest.fn(async () => opts.owner ?? null),
  } as unknown as NotificationRepository;
  const members = {
    members: jest.fn(async () => opts.members ?? []),
    isOnline: jest.fn(async () => false),
  } as unknown as MembersProjection;
  const logger = { debug: jest.fn(), warn: jest.fn() } as unknown as Logger;
  const receipts: DeviceReceiptEmitter = {
    emit: jest.fn(async (state, userId, conversationId, upToSeq) => {
      emitted.push({ state, userId, conversationId, upToSeq });
    }),
  };
  const svc = new NotificationService(
    repo,
    members,
    logger,
    opts.withEmitter === false ? undefined : receipts,
  );
  return { svc, repo, members, emitted, logger };
}

const ACK = {
  deviceId: 'dev-1',
  pushToken: 'tok-1',
  conversationId: 'c1',
  upToSeq: 12,
  state: 'delivered' as const,
};

describe('NotificationService.ackFromDevice (§B4.4 — the closed-app tick)', () => {
  it('publishes delivered for the device that holds the registered token', async () => {
    const { svc, emitted, repo } = setup({ owner: 'bob', members: ['alice', 'bob'] });

    await expect(svc.ackFromDevice(ACK)).resolves.toEqual({ acked: true });

    expect(repo.accountForPushToken).toHaveBeenCalledWith('dev-1', 'tok-1');
    expect(emitted).toEqual([
      { state: 'delivered', userId: 'bob', conversationId: 'c1', upToSeq: 12 },
    ]);
  });

  it('publishes read when the user acted on the notification', async () => {
    const { svc, emitted } = setup({ owner: 'bob', members: ['bob'] });
    await svc.ackFromDevice({ ...ACK, state: 'read' });
    expect(emitted[0]?.state).toBe('read');
  });

  it('accepts the string seq an FCM data payload actually carries', async () => {
    const { svc, emitted } = setup({ owner: 'bob', members: ['bob'] });
    await svc.ackFromDevice({ ...ACK, upToSeq: '12' });
    expect(emitted[0]?.upToSeq).toBe(12);
  });

  it('rejects a malformed body without touching the database', async () => {
    const { svc, repo, emitted } = setup({ owner: 'bob', members: ['bob'] });
    await expect(svc.ackFromDevice({ deviceId: 'dev-1' })).rejects.toThrow();
    expect(repo.accountForPushToken).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it('rejects a token that matches no endpoint — the whole authentication step', async () => {
    const { svc, emitted } = setup({ owner: null, members: ['alice', 'bob'] });
    await expect(svc.ackFromDevice(ACK)).rejects.toThrow(/endpoint/i);
    expect(emitted).toHaveLength(0);
  });

  it('rejects a member who has since been removed from the conversation', async () => {
    // The endpoint row outlives the membership that justified it, so this is a real state, not
    // a hypothetical: a removed user must not keep advancing a group's watermarks.
    const { svc, emitted } = setup({ owner: 'bob', members: ['alice', 'carol'] });
    await expect(svc.ackFromDevice(ACK)).rejects.toThrow(/member/i);
    expect(emitted).toHaveLength(0);
  });

  it('fails CLOSED on a cold membership projection', async () => {
    // "Cannot confirm" is not "allow" — the same reasoning as ReceiptPublisher.mayPublish.
    const { svc, emitted } = setup({ owner: 'bob', members: [] });
    await expect(svc.ackFromDevice(ACK)).rejects.toThrow(/member/i);
    expect(emitted).toHaveLength(0);
  });

  it('reports acked:false rather than pretending, when no emitter is wired', async () => {
    const { svc, logger } = setup({ owner: 'bob', members: ['bob'], withEmitter: false });
    await expect(svc.ackFromDevice(ACK)).resolves.toEqual({ acked: false });
    expect(logger.warn).toHaveBeenCalled();
  });
});
