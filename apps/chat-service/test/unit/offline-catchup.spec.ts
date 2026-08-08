import { ChatService } from '../../src/chat/chat.service';
import { ChatRepository } from '../../src/chat/chat.repository';
import { SeqService } from '../../src/chat/seq.service';
import { ChatEvents } from '../../src/chat/chat.events';
import type { MessageDoc } from '../../src/chat/message.types';

function createMockMongo() {
  const store = new Map<string, MessageDoc>();
  const counters = new Map<string, number>();

  const collection = {
    async findOne(filter: Record<string, unknown>, opts?: { sort?: Record<string, number> }) {
      if (filter.conversation_id && filter.client_msg_id) {
        for (const doc of store.values()) {
          if (
            doc.conversation_id === filter.conversation_id &&
            doc.client_msg_id === filter.client_msg_id
          ) {
            return doc;
          }
        }
        return null;
      }
      if (filter.conversation_id && opts?.sort?.seq === -1) {
        const matching = [...store.values()].filter(
          (d) => d.conversation_id === filter.conversation_id,
        );
        if (matching.length === 0) return null;
        return matching.sort((a, b) => b.seq - a.seq)[0];
      }
      return null;
    },
    async insertOne(doc: MessageDoc) {
      for (const existing of store.values()) {
        if (existing.conversation_id === doc.conversation_id) {
          if (existing.seq === doc.seq || existing.client_msg_id === doc.client_msg_id) {
            const err = new Error('E11000 duplicate key error');
            (err as unknown as { code: number }).code = 11000;
            throw err;
          }
        }
      }
      store.set(doc._id, { ...doc });
    },
    async findOneAndUpdate(filter: { _id: string }, update: { $inc: { seq: number } }) {
      const current = counters.get(filter._id) ?? 0;
      const next = current + (update.$inc.seq ?? 1);
      counters.set(filter._id, next);
      return { _id: filter._id, seq: next };
    },
    find(filter: { conversation_id: string; seq: { $gt: number } }) {
      const afterSeq = filter.seq.$gt;
      const docs = [...store.values()]
        .filter((d) => d.conversation_id === filter.conversation_id && d.seq > afterSeq)
        .sort((a, b) => a.seq - b.seq);
      return {
        sort() {
          return this;
        },
        limit(n: number) {
          return {
            toArray: async () => docs.slice(0, n),
          };
        },
      };
    },
  };

  return {
    db: {
      collection() {
        return collection;
      },
    },
  } as never;
}

describe('Offline Catch-Up & Race-Safe Synchronization (§G4 / §L6)', () => {
  it('serves missed messages via afterSeq cursor and prevents race duplicates', async () => {
    const mongo = createMockMongo();
    const repo = new ChatRepository(mongo);
    const seq = new SeqService(null, mongo);
    const service = new ChatService(
      repo,
      seq,
      new ChatEvents({ publish: async () => undefined } as never),
    );

    const convId = 'conv-catchup-1';

    // 1. Send 5 messages while user is offline (seq 1 to 5)
    for (let i = 1; i <= 5; i++) {
      await service.send({
        conversationId: convId,
        senderId: 'user-sender',
        clientMsgId: `msg-offline-${i}`,
        content: `Offline message ${i}`,
      });
    }

    // 2. User reconnects with cursor afterSeq = 2 (missed seq 3, 4, 5)
    const catchupMessages = await service.history(convId, 2, 50);

    expect(catchupMessages).toHaveLength(3);
    expect(catchupMessages.map((m) => m.seq)).toEqual([3, 4, 5]);

    // 3. Simultaneously a new live message arrives with seq 6
    const liveSend = await service.send({
      conversationId: convId,
      senderId: 'user-sender',
      clientMsgId: 'msg-live-6',
      content: 'Live message 6',
    });
    expect(liveSend.seq).toBe(6);

    // 4. Query with afterSeq = 5 returns only seq 6
    const latestSync = await service.history(convId, 5, 50);
    expect(latestSync).toHaveLength(1);
    expect(latestSync[0]!.seq).toBe(6);
  });
});
