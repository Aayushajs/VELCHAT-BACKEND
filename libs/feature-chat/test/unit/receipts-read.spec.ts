import { ReceiptsRepository } from '../../src/chat/receipts.repository';
import { ChatService } from '../../src/chat/chat.service';
import type { ChatRepository } from '../../src/chat/chat.repository';
import type { SeqService } from '../../src/chat/seq.service';
import type { ChatEvents } from '../../src/chat/chat.events';
import type { MongoClient } from '@velchat/database';

/**
 * The durable receipt store has always been WRITTEN and never read.
 *
 * Ticks travel as live socket events. If the sender's socket happens to be down at the moment the
 * peer's receipt is published — a reconnect, a network flip, an app the OS just restarted — that
 * event is gone, and nothing re-derives it: the message keeps one tick for the rest of its life,
 * however long ago it was actually read. The repository's own comment says the store exists "so
 * that other devices and reconnects pick the ticks up", and that pickup was never implemented.
 *
 * These tests are the read side of that store.
 */
function fakeMongo(docs: Record<string, unknown>[]) {
  const calls: { filter: unknown; options: unknown }[] = [];
  const collection = {
    find: (filter: unknown, options: unknown) => {
      calls.push({ filter, options });
      return { toArray: async () => docs };
    },
    createIndex: async () => undefined,
    updateOne: async () => undefined,
  };
  return {
    calls,
    mongo: { db: { collection: () => collection } } as unknown as MongoClient,
  };
}

describe('ReceiptsRepository.forConversation (§B4.4)', () => {
  it('returns every member watermark for the conversation', async () => {
    const { mongo, calls } = fakeMongo([
      { conversation_id: 'c1', user_id: 'u2', state: 'delivered', up_to_seq: 12, ts: 't1' },
      { conversation_id: 'c1', user_id: 'u2', state: 'read', up_to_seq: 9, ts: 't2' },
    ]);
    const repo = new ReceiptsRepository(mongo);

    const rows = await repo.forConversation('c1');

    expect(rows).toEqual([
      { userId: 'u2', state: 'delivered', upToSeq: 12, at: 't1' },
      { userId: 'u2', state: 'read', upToSeq: 9, at: 't2' },
    ]);
    // Scoped to the conversation in the QUERY, not filtered afterwards: this collection holds
    // every conversation on the deployment.
    expect(calls[0]?.filter).toEqual({ conversation_id: 'c1' });
  });

  it('is empty for a conversation with no receipts yet', async () => {
    const { mongo } = fakeMongo([]);
    expect(await new ReceiptsRepository(mongo).forConversation('c9')).toEqual([]);
  });
});

describe('ChatService.receipts', () => {
  function service(rows: Record<string, unknown>[]) {
    const { mongo } = fakeMongo(rows);
    return new ChatService(
      {} as unknown as ChatRepository,
      {} as unknown as SeqService,
      {} as unknown as ChatEvents,
      new ReceiptsRepository(mongo),
    );
  }

  it("excludes the caller's own watermarks", async () => {
    // The caller already knows what they have read. What they cannot know — and the whole reason
    // this endpoint exists — is what the OTHER side has.
    const svc = service([
      { conversation_id: 'c1', user_id: 'me', state: 'read', up_to_seq: 30, ts: 't' },
      { conversation_id: 'c1', user_id: 'peer', state: 'read', up_to_seq: 12, ts: 't' },
      { conversation_id: 'c1', user_id: 'peer', state: 'delivered', up_to_seq: 20, ts: 't' },
    ]);

    const out = await svc.receipts('c1', 'me');

    expect(out).toEqual([
      { userId: 'peer', state: 'read', upToSeq: 12, at: 't' },
      { userId: 'peer', state: 'delivered', upToSeq: 20, at: 't' },
    ]);
  });

  it('reports nothing rather than failing when no store is wired', async () => {
    // A deployment that runs without the receipt store must not 500 on this route — the client
    // treats an empty answer as "no news", which is exactly right.
    const svc = new ChatService(
      {} as unknown as ChatRepository,
      {} as unknown as SeqService,
      {} as unknown as ChatEvents,
    );
    expect(await svc.receipts('c1', 'me')).toEqual([]);
  });
});
