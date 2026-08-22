import type { EventBus, EventHandler } from '@velchat/event-bus';
import type { EventEnvelope, Logger } from '@velchat/common';
import type { MessageReceiptPayload } from '@velchat/shared-types';
import { ReceiptsConsumer } from '../../src/chat/receipts.consumer';
import type { ReceiptsRepository, ReceiptDoc } from '../../src/chat/receipts.repository';

function envelope<T>(payload: T): EventEnvelope<T> {
  return { payload } as unknown as EventEnvelope<T>;
}

describe('ReceiptsConsumer (§B4.4)', () => {
  function setup() {
    const handlers = new Map<string, EventHandler>();
    const bus = {
      subscribe: jest.fn((t: string, _g: string, h: EventHandler) => handlers.set(t, h)),
    } as unknown as EventBus;
    const recorded: ReceiptDoc[] = [];
    const repo = {
      record: jest.fn(async (r: ReceiptDoc) => {
        recorded.push(r);
      }),
    } as unknown as ReceiptsRepository;
    const logger = { debug: jest.fn() } as unknown as Logger;
    new ReceiptsConsumer(bus, repo, logger).register();
    return { handlers, recorded };
  }

  it('subscribes to delivered and read', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(['message.delivered', 'message.read']);
  });

  it('records a delivered receipt with up_to_seq and ts', async () => {
    const { handlers, recorded } = setup();
    const payload: MessageReceiptPayload = {
      conversation_id: 'c1',
      up_to_seq: 12,
      user_id: 'u2',
      state: 'delivered',
      at: '2026-06-21T00:00:00.000Z',
    };
    await handlers.get('message.delivered')!(envelope(payload));
    expect(recorded).toEqual([
      { conversation_id: 'c1', user_id: 'u2', state: 'delivered', up_to_seq: 12, ts: payload.at },
    ]);
  });
});
