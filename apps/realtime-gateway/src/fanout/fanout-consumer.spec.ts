import type { EventBus, EventHandler } from '@velchat/event-bus';
import type { Logger } from '@velchat/common';
import type { EventEnvelope } from '@velchat/common';
import type { MessageSentPayload } from '@velchat/shared-types';
import { FanoutConsumer } from './fanout-consumer';
import type { MembershipProjection } from './membership-projection';
import type { EventRouter } from '../fabric/event-router';

function envelope<T>(payload: T): EventEnvelope<T> {
  return { payload } as unknown as EventEnvelope<T>;
}

describe('FanoutConsumer (§B9.2)', () => {
  function setup(members: string[]) {
    const handlers = new Map<string, EventHandler>();
    const bus = {
      subscribe: jest.fn((topic: string, _g: string, h: EventHandler) => handlers.set(topic, h)),
      start: jest.fn(async () => undefined),
      publish: jest.fn(),
    } as unknown as EventBus;
    const projection = {
      seed: jest.fn(async () => undefined),
      add: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
      members: jest.fn(async () => members),
    } as unknown as MembershipProjection;
    const router = { route: jest.fn(async () => members.length) } as unknown as EventRouter;
    const logger = { debug: jest.fn() } as unknown as Logger;
    const consumer = new FanoutConsumer(bus, projection, router, logger);
    consumer.register();
    return { handlers, bus, projection, router };
  }

  it('subscribes to membership + message + receipt topics', () => {
    const { handlers } = setup([]);
    expect([...handlers.keys()].sort()).toEqual([
      'channel.member.added',
      'channel.member.removed',
      'conversation.created',
      'message.delivered',
      'message.read',
      'message.sent',
    ]);
  });

  it('fans a read receipt to members as an ephemeral cue', async () => {
    const { handlers, router } = setup(['a', 'b']);
    await handlers.get('message.read')!(
      envelope({ conversation_id: 'c1', up_to_seq: 9, user_id: 'b', state: 'read', at: 'now' }),
    );
    expect(router.route).toHaveBeenCalledWith(
      ['a', 'b'],
      expect.objectContaining({ kind: 'ephemeral', type: 'receipt' }),
    );
  });

  it('routes a message to every resolved member', async () => {
    const { handlers, router } = setup(['a', 'b', 'c']);
    const payload: MessageSentPayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      seq: 7,
      sender_account_id: 'a',
      sent_at: '2026-06-21T00:00:00.000Z',
    };
    await handlers.get('message.sent')!(envelope(payload));
    expect(router.route).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      expect.objectContaining({ kind: 'durable', type: 'message' }),
    );
  });

  it('skips routing when the projection is cold (no members)', async () => {
    const { handlers, router } = setup([]);
    await handlers.get('message.sent')!(
      envelope({ conversation_id: 'cold', seq: 1 } as MessageSentPayload),
    );
    expect(router.route).not.toHaveBeenCalled();
  });

  it('keeps the projection current from membership events', async () => {
    const { handlers, projection } = setup([]);
    await handlers.get('conversation.created')!(
      envelope({ conversation_id: 'c1', member_ids: ['a', 'b'] }),
    );
    await handlers.get('channel.member.added')!(envelope({ conversation_id: 'c1', user_id: 'c' }));
    await handlers.get('channel.member.removed')!(
      envelope({ conversation_id: 'c1', user_id: 'a' }),
    );
    expect(projection.seed).toHaveBeenCalledWith('c1', ['a', 'b']);
    expect(projection.add).toHaveBeenCalledWith('c1', 'c');
    expect(projection.remove).toHaveBeenCalledWith('c1', 'a');
  });
});
