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
      if (filter._id && filter.conversation_id) {
        return store.get(filter._id as string) ?? null;
      }
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
          if (existing.seq === doc.seq) {
            const err = new Error(
              'E11000 duplicate key error collection: messages index: conv_seq',
            );
            (err as unknown as { code: number }).code = 11000;
            throw err;
          }
          if (existing.client_msg_id === doc.client_msg_id) {
            const err = new Error(
              'E11000 duplicate key error collection: messages index: conv_client_msg',
            );
            (err as unknown as { code: number }).code = 11000;
            throw err;
          }
        }
      }
      store.set(doc._id, { ...doc });
    },
    async findOneAndUpdate(
      filter: { _id: string },
      update: Array<{ $set: { seq: { $add: [{ $max: [string, number] }, number] } } }>,
    ) {
      // SeqService issues an aggregation-pipeline update, not `{$inc}`: MongoDB rejects two
      // operators on one field, so raise-to-floor and increment have to happen in one pipeline.
      if (!Array.isArray(update)) {
        throw new Error('counters update must be an aggregation pipeline, not {$inc}/{$max}');
      }
      const floor = update[0].$set.seq.$add[0].$max[1];
      const next = Math.max(counters.get(filter._id) ?? 0, floor) + 1;
      counters.set(filter._id, next);
      return { _id: filter._id, seq: next };
    },
    async updateOne(filter: { _id: string }, update: { $max: { seq: number } }) {
      const current = counters.get(filter._id) ?? 0;
      const next = Math.max(current, update.$max.seq);
      counters.set(filter._id, next);
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
    createIndex: async () => undefined,
  };

  return {
    db: {
      collection() {
        return collection;
      },
    },
    _store: store,
  } as never;
}

function createMockEventBus() {
  const published: Array<{ topic: string; envelope: unknown }> = [];
  return {
    publish: async (topic: string, envelope: unknown) => {
      published.push({ topic, envelope });
    },
    subscribe: () => undefined,
    _published: published,
  } as never;
}

describe('Chat Concurrency & Idempotency Hardening (§B4)', () => {
  let mongo: ReturnType<typeof createMockMongo>;
  let repo: ChatRepository;
  let seq: SeqService;
  let bus: ReturnType<typeof createMockEventBus>;
  let service: ChatService;

  beforeEach(() => {
    mongo = createMockMongo();
    repo = new ChatRepository(mongo);
    seq = new SeqService(null, mongo);
    bus = createMockEventBus();
    service = new ChatService(repo, seq, new ChatEvents(bus));
  });

  it('handles 100 concurrent messages in the same conversation with strictly monotonic sequences', async () => {
    const conversationId = 'conv-concurrency-test';
    const totalMessages = 100;

    const sends = Array.from({ length: totalMessages }, (_, i) =>
      service.send({
        conversationId,
        senderId: `user-${i % 5}`,
        clientMsgId: `client-msg-${i}`,
        content: `Message ${i}`,
      }),
    );

    const acks = await Promise.all(sends);

    expect(acks).toHaveLength(totalMessages);

    // Verify all sequence numbers are unique and contiguous from 1 to 100
    const sequenceNumbers = acks.map((a) => a.seq).sort((a, b) => a - b);
    for (let i = 0; i < totalMessages; i++) {
      expect(sequenceNumbers[i]!).toBe(i + 1);
    }

    // Verify history pagination returns them in strictly ascending order
    const history = await service.history(conversationId, 0, 100);
    expect(history).toHaveLength(totalMessages);
    expect(history.map((m) => m.seq)).toEqual(sequenceNumbers);
  });

  it('guarantees idempotency on concurrent retry with identical clientMsgId', async () => {
    const conversationId = 'conv-dedup-test';
    const clientMsgId = 'client-msg-duplicate-uuid';

    // 10 concurrent requests with the SAME clientMsgId
    const concurrentSends = Array.from({ length: 10 }, () =>
      service.send({
        conversationId,
        senderId: 'user-sender',
        clientMsgId,
        content: 'Original message text',
      }),
    );

    const results = await Promise.all(concurrentSends);

    const firstAck = results[0]!;
    for (const ack of results) {
      expect(ack.messageId).toBe(firstAck.messageId);
      expect(ack.seq).toBe(firstAck.seq);
    }

    const history = await service.history(conversationId, 0, 10);
    expect(history).toHaveLength(1);
    expect(history[0]!.client_msg_id).toBe(clientMsgId);
  });
});
