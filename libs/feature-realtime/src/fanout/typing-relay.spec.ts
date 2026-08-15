import { TypingRelay } from './typing-relay';
import type { MembershipProjection } from './membership-projection';
import type { EventRouter } from '../fabric/event-router';

function setup(members: string[]) {
  const routed: Array<{ recipients: string[]; frame: unknown }> = [];
  const projection = { members: jest.fn(async () => members) } as unknown as MembershipProjection;
  const router = {
    route: jest.fn(async (recipients: string[], frame: unknown) => {
      routed.push({ recipients, frame });
      return recipients.length;
    }),
  } as unknown as EventRouter;
  return { relay: new TypingRelay(projection, router), routed };
}

describe('TypingRelay (§C4 ephemeral typing)', () => {
  it('fans a started signal to everyone except the sender', async () => {
    const { relay, routed } = setup(['alice', 'bob', 'carol']);
    const n = await relay.relay('alice', 'c1', 'start');
    expect(n).toBe(2);
    expect(routed[0]?.recipients.sort()).toEqual(['bob', 'carol']);
    expect(routed[0]?.frame).toMatchObject({
      kind: 'ephemeral',
      type: 'typing.started',
      data: { conversationId: 'c1', userId: 'alice' },
    });
  });

  it('emits typing.stopped for a stop signal', async () => {
    const { relay, routed } = setup(['alice', 'bob']);
    await relay.relay('alice', 'c1', 'stop');
    expect(routed[0]?.frame).toMatchObject({ type: 'typing.stopped' });
  });

  it('no-ops when the sender is the only member', async () => {
    const { relay, routed } = setup(['alice']);
    expect(await relay.relay('alice', 'c1', 'start')).toBe(0);
    expect(routed).toHaveLength(0);
  });
});
