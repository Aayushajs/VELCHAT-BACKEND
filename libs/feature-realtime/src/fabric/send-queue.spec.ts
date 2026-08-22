import { SendQueue, type Frame } from './send-queue';

const durable = (n: number): Frame => ({ kind: 'durable', type: 'message', data: { n } });
const typing = (who: string): Frame => ({ kind: 'ephemeral', type: 'typing', data: { who } });

describe('SendQueue backpressure (§B9.4)', () => {
  it('never drops durable frames, even over the high-watermark', () => {
    const q = new SendQueue(2);
    expect(q.enqueue(durable(1))).toBe(true);
    expect(q.enqueue(durable(2))).toBe(true);
    expect(q.enqueue(durable(3))).toBe(true); // over watermark, still kept
    expect(q.size).toBe(3);
  });

  it('coalesces ephemeral frames of the same type to the latest', () => {
    const q = new SendQueue(10);
    q.enqueue(typing('a'));
    q.enqueue(typing('b'));
    expect(q.size).toBe(1);
    expect((q.drain()[0]?.data as { who: string }).who).toBe('b');
  });

  it('drops a new ephemeral frame under pressure (durable backlog)', () => {
    const q = new SendQueue(2);
    q.enqueue(durable(1));
    q.enqueue(durable(2));
    expect(q.enqueue(typing('a'))).toBe(false); // dropped — no same-type to coalesce, at watermark
  });
});
