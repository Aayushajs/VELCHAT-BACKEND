/**
 * In-memory Redis Streams, enough of it to test consumer semantics deterministically.
 *
 * Testing this against a real server would mean either burning a metered cloud Redis or requiring
 * Docker in CI, and neither gives what these tests actually need: the ability to *stage* a crash
 * mid-processing and inspect the pending-entries list afterwards. The behaviours modelled here are
 * the ones the bus depends on — group creation, `>` vs pending reads, XACK removing from the PEL,
 * and XAUTOCLAIM handing an abandoned entry to another consumer.
 *
 * Test-only. Not exported from the package barrel.
 */
interface Entry {
  id: string;
  fields: string[];
}

interface Pending {
  id: string;
  consumer: string;
  deliveredAt: number;
}

interface Group {
  name: string;
  lastDelivered: string;
  pending: Map<string, Pending>;
}

export class FakeRedisStreams {
  private readonly streams = new Map<string, Entry[]>();
  private readonly groups = new Map<string, Map<string, Group>>();
  private seq = 0;
  /** Every command name observed, so a test can assert on call shape (e.g. idle command count). */
  readonly calls: string[] = [];
  /** Set to make the next XACK throw — models a crash between handling and acknowledging. */
  failNextAck = false;

  private entriesOf(stream: string): Entry[] {
    let e = this.streams.get(stream);
    if (!e) {
      e = [];
      this.streams.set(stream, e);
    }
    return e;
  }

  private groupsOf(stream: string): Map<string, Group> {
    let g = this.groups.get(stream);
    if (!g) {
      g = new Map();
      this.groups.set(stream, g);
    }
    return g;
  }

  async xadd(stream: string, ...args: unknown[]): Promise<string> {
    this.calls.push('xadd');
    // Accept both `xadd(key, '*', f, v)` and `xadd(key, 'MAXLEN', '~', n, '*', f, v)`.
    const idIdx = args.findIndex((a) => a === '*');
    const fields = args.slice(idIdx + 1).map(String);
    this.seq += 1;
    const id = `${Date.now()}-${this.seq}`;
    this.entriesOf(stream).push({ id, fields });
    return id;
  }

  async xgroup(action: string, stream: string, group: string): Promise<string> {
    this.calls.push('xgroup');
    const gs = this.groupsOf(stream);
    if (action === 'CREATE' && gs.has(group)) {
      throw new Error('BUSYGROUP Consumer Group name already exists');
    }
    gs.set(group, { name: group, lastDelivered: '0', pending: new Map() });
    return 'OK';
  }

  /** `xreadgroup('GROUP', g, c, 'COUNT', n, 'BLOCK', ms, 'STREAMS', s1, s2, '>', '>')` */
  async xreadgroup(...args: unknown[]): Promise<Array<[string, Array<[string, string[]]>]> | null> {
    this.calls.push('xreadgroup');
    const a = args.map(String);
    const group = a[1] ?? '';
    const consumer = a[2] ?? '';
    const streamsAt = a.indexOf('STREAMS');
    const rest = a.slice(streamsAt + 1);
    const names = rest.slice(0, rest.length / 2);

    const blockAt = a.indexOf('BLOCK');
    const blockMs = blockAt >= 0 ? Number(a[blockAt + 1]) : 0;

    const out: Array<[string, Array<[string, string[]]>]> = [];
    for (const stream of names) {
      const g = this.groupsOf(stream).get(group);
      if (!g) continue;
      const fresh = this.entriesOf(stream).filter((e) => e.id > g.lastDelivered);
      if (fresh.length === 0) continue;
      for (const e of fresh) {
        g.lastDelivered = e.id;
        g.pending.set(e.id, { id: e.id, consumer, deliveredAt: Date.now() });
      }
      out.push([stream, fresh.map((e) => [e.id, e.fields] as [string, string[]])]);
    }
    if (out.length > 0) return out;

    // Honour BLOCK. Without this a caller that loops on `null` spins the CPU — which is both
    // unfaithful to Redis and the very hot-loop the bus is supposed to avoid. Capped so a test
    // never waits the full production block interval.
    if (blockMs > 0) await new Promise((r) => setTimeout(r, Math.min(blockMs, 25)));
    return null;
  }

  async xack(stream: string, group: string, id: string): Promise<number> {
    this.calls.push('xack');
    if (this.failNextAck) {
      this.failNextAck = false;
      throw new Error('simulated crash before XACK');
    }
    const g = this.groupsOf(stream).get(group);
    return g?.pending.delete(id) ? 1 : 0;
  }

  /** `xautoclaim(stream, group, consumer, minIdleMs, start, 'COUNT', n)` */
  async xautoclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
  ): Promise<[string, Array<[string, string[]]>]> {
    this.calls.push('xautoclaim');
    const g = this.groupsOf(stream).get(group);
    if (!g) return ['0-0', []];
    const now = Date.now();
    const claimed: Array<[string, string[]]> = [];
    for (const p of [...g.pending.values()]) {
      if (now - p.deliveredAt < minIdleMs) continue;
      const entry = this.entriesOf(stream).find((e) => e.id === p.id);
      if (!entry) continue;
      p.consumer = consumer;
      p.deliveredAt = now;
      claimed.push([entry.id, entry.fields]);
    }
    return ['0-0', claimed];
  }

  // ── plumbing the bus uses ─────────────────────────────────────────────────────────────────
  duplicate(): this {
    return this; // one shared keyspace is what we want to observe
  }
  async connect(): Promise<void> {}
  async quit(): Promise<string> {
    return 'OK';
  }
  disconnect(): void {}
  async ping(): Promise<string> {
    return 'PONG';
  }
  /** Plain keyspace, so IdempotencyStore's SET NX / EXISTS behave for real. */
  private readonly kv = new Map<string, string>();
  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    this.calls.push('set');
    const nx = args.map(String).includes('NX');
    if (nx && this.kv.has(key)) return null; // SET NX must fail on an existing key
    this.kv.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }
  async exists(key: string): Promise<number> {
    this.calls.push('exists');
    return this.kv.has(key) ? 1 : 0;
  }

  // ── test helpers ──────────────────────────────────────────────────────────────────────────
  /** Entries still unacknowledged for a group — i.e. the pending-entries list. */
  pendingIds(stream: string, group: string): string[] {
    return [...(this.groupsOf(stream).get(group)?.pending.keys() ?? [])];
  }
  /** Everything written to a stream, e.g. to inspect a DLQ. */
  entries(stream: string): Entry[] {
    return [...this.entriesOf(stream)];
  }
  /** Make every pending entry look abandoned, so XAUTOCLAIM will pick it up. */
  ageOutPending(stream: string, group: string, byMs: number): void {
    for (const p of this.groupsOf(stream).get(group)?.pending.values() ?? []) {
      p.deliveredAt -= byMs;
    }
  }
}
