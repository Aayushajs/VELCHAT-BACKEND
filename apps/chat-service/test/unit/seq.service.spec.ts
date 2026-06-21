import { SeqService } from '../../src/chat/seq.service';

function fakeRedis() {
  const counters = new Map<string, number>();
  return {
    async incr(key: string) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
  } as never;
}

describe('SeqService (§B4.3 per-conversation order)', () => {
  it('returns a monotonic seq per conversation', async () => {
    const seq = new SeqService(fakeRedis());
    expect(await seq.next('conv-1')).toBe(1);
    expect(await seq.next('conv-1')).toBe(2);
    expect(await seq.next('conv-1')).toBe(3);
  });

  it('tracks conversations independently', async () => {
    const seq = new SeqService(fakeRedis());
    expect(await seq.next('conv-a')).toBe(1);
    expect(await seq.next('conv-b')).toBe(1);
    expect(await seq.next('conv-a')).toBe(2);
  });
});
