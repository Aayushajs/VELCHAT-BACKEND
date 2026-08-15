import { ChatRepository } from '../../src/chat/chat.repository';

interface Row {
  conversation_id: string;
  seq: number;
}

/**
 * In-memory `messages` collection that really applies the filter and sort, so these tests exercise
 * behaviour rather than asserting call arguments. A fake that only recorded `sort: {seq: -1}` would
 * still pass if the implementation read the WRONG end of the index — the exact bug that would
 * reintroduce DEF-01 by seeding the counter from the lowest seq instead of the highest.
 */
function fakeMongo(rows: Row[]) {
  return {
    db: {
      collection() {
        return {
          async findOne(filter: Partial<Row>, opts?: { sort?: Record<string, 1 | -1> }) {
            const matched = rows.filter((r) =>
              Object.entries(filter).every(([k, v]) => r[k as keyof Row] === v),
            );
            const [field, dir] = Object.entries(opts?.sort ?? {})[0] ?? ['seq', 1];
            const sorted = [...matched].sort(
              (a, b) =>
                ((a[field as keyof Row] as number) - (b[field as keyof Row] as number)) * dir,
            );
            return sorted[0] ?? null;
          },
        };
      },
    },
  } as never;
}

describe('ChatRepository.maxSeq (durable floor for SeqService — DEF-01)', () => {
  it('returns 0 for a conversation with no messages', async () => {
    const repo = new ChatRepository(fakeMongo([]));
    expect(await repo.maxSeq('conv-1')).toBe(0);
  });

  it('returns the highest persisted seq, not the lowest', async () => {
    const repo = new ChatRepository(
      fakeMongo([
        { conversation_id: 'conv-1', seq: 1 },
        { conversation_id: 'conv-1', seq: 42 },
        { conversation_id: 'conv-1', seq: 7 },
      ]),
    );
    expect(await repo.maxSeq('conv-1')).toBe(42);
  });

  it('scopes the maximum to one conversation', async () => {
    const repo = new ChatRepository(
      fakeMongo([
        { conversation_id: 'conv-1', seq: 3 },
        { conversation_id: 'conv-2', seq: 999 },
      ]),
    );
    expect(await repo.maxSeq('conv-1')).toBe(3);
  });
});
