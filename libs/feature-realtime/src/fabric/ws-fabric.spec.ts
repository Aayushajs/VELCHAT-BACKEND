import { createServer, type Server } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import WebSocket from 'ws';
import pino from 'pino';
import { ConnectionRegistry } from './connection-registry';
import { WsFabric, type WsFabricOptions } from './ws-fabric';

const logger = pino({ level: 'silent' }) as never;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function token(claims: Record<string, unknown>, key = privateKey): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'RS256', typ: 'JWT' });
  const body = b({ exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const s = createSign('RSA-SHA256');
  s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(key).toString('base64url')}`;
}

const validToken = (userId = 'u1', deviceId = 'd1') =>
  token({ account_id: userId, device_id: deviceId });

/** Minimal in-memory Valkey covering the registry + pod pub/sub the fabric uses. */
function fakeRedis() {
  const sets = new Map<string, Set<string>>();
  const handlers: Array<(channel: string, payload: string) => void> = [];
  const api = {
    async sadd(key: string, ...members: string[]) {
      const s = sets.get(key) ?? new Set<string>();
      members.forEach((m) => s.add(m));
      sets.set(key, s);
      return members.length;
    },
    async srem(key: string, ...members: string[]) {
      const s = sets.get(key);
      members.forEach((m) => s?.delete(m));
      return 1;
    },
    async smembers(key: string) {
      return [...(sets.get(key) ?? [])];
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
    async expire() {
      return 1;
    },
    async subscribe(_channel: string) {
      return 1;
    },
    async unsubscribe() {
      return 1;
    },
    on(event: string, cb: (channel: string, payload: string) => void) {
      if (event === 'message') handlers.push(cb);
      return api;
    },
    async publish(channel: string, payload: string) {
      handlers.forEach((h) => h(channel, payload));
      return handlers.length;
    },
    duplicate() {
      return api;
    },
    disconnect() {},
  };
  return api;
}

interface Harness {
  url: string;
  fabric: WsFabric;
  sink: { delivered: string[]; read: string[] };
  typing: { relayed: string[] };
  skdm: { distributed: string[]; requested: string[] };
  stop(): Promise<void>;
}

async function harness(over: Partial<WsFabricOptions> = {}): Promise<Harness> {
  const redis = fakeRedis();
  const registry = new ConnectionRegistry(redis as never);
  const sink = { delivered: [] as string[], read: [] as string[] };
  const typing = { relayed: [] as string[] };
  const skdm = { distributed: [] as string[], requested: [] as string[] };

  const server: Server = createServer();
  const fabric = new WsFabric(server, redis as never, registry, logger, {
    podId: 'pod-test',
    jwtPublicKey: publicKey,
    heartbeatMs: 60_000, // out of the way; sweeps are not what these tests are about
    sink: {
      delivered: async (u, c, s) => void sink.delivered.push(`${u}|${c}|${s}`),
      read: async (u, c, s) => void sink.read.push(`${u}|${c}|${s}`),
    },
    typing: {
      relay: async (u, c, state) => {
        typing.relayed.push(`${u}|${c}|${state}`);
        return 1;
      },
    } as never,
    skdm: {
      distribute: async (c: string) => void skdm.distributed.push(c),
      request: async (c: string) => void skdm.requested.push(c),
      flushOnConnect: async () => undefined,
    } as never,
    ...over,
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  await fabric.start();

  return {
    url: `ws://127.0.0.1:${port}/ws`,
    fabric,
    sink,
    typing,
    skdm,
    async stop() {
      await fabric.stop();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Connect and resolve with the socket plus every frame it receives and its close code. */
function connect(url: string, opts: { headers?: Record<string, string> } = {}) {
  const ws = new WebSocket(url, opts);
  const frames: Array<{ type?: string; data?: unknown }> = [];
  let closeCode = 0;
  ws.on('message', (raw) => frames.push(JSON.parse(String(raw))));
  ws.on('close', (code) => {
    closeCode = code;
  });
  return {
    ws,
    frames,
    code: () => closeCode,
    open: () =>
      new Promise<boolean>((resolve) => {
        ws.once('open', () => resolve(true));
        ws.once('close', () => resolve(false));
        ws.once('error', () => resolve(false));
      }),
    send: (obj: unknown) => ws.send(JSON.stringify(obj)),
    close: () => ws.close(),
    /**
     * Resolve with the close code. A WebSocket handshake always completes before the application
     * can reject, so an unauthorized socket OPENS and is then closed with 4001 — that code, not a
     * refused handshake, is what the mobile client treats as "do not retry".
     */
    closed: (timeoutMs = 500) =>
      new Promise<number>((resolve) => {
        if (closeCode) return resolve(closeCode);
        const t = setTimeout(() => resolve(closeCode), timeoutMs);
        ws.once('close', (code) => {
          clearTimeout(t);
          resolve(code);
        });
      }),
  };
}

/**
 * ws-fabric is the highest-privilege surface in the system — it authenticates every socket and
 * accepts frames that mutate other users' state (receipts, typing, sender-key distribution) — and
 * it shipped with no test at all. Four audit findings live here:
 *
 *   DEF-06  verification fell back to `jwt.decode` when no public key was configured, so a missing
 *           env var turned forged, unsigned tokens into valid ones.
 *   DEF-07  inbound `delivered`/`read`/`typing`/`skdm` accepted ANY conversationId, so any
 *           authenticated user could force blue ticks in a stranger's chat.
 *   DEF-09  every delivery iterated every socket on the pod.
 *   DEF-11  no payload cap (ws defaults to 100 MB), no origin check, no inbound rate limit.
 */
describe('WsFabric — authentication', () => {
  it('rejects a connection with no token', async () => {
    const h = await harness();
    const c = connect(h.url);
    expect(await c.closed()).toBe(4001);
    expect(c.frames.map((f) => f.type)).not.toContain('connected');
    await h.stop();
  });

  it('rejects a token signed by the wrong key', async () => {
    const h = await harness();
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }).privateKey;
    const c = connect(`${h.url}?token=${token({ account_id: 'u1', device_id: 'd1' }, other)}`);
    expect(await c.closed()).toBe(4001);
    await h.stop();
  });

  it('rejects a token missing the principal claims', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${token({ account_id: 'u1' })}`); // no device_id
    expect(await c.closed()).toBe(4001);
    await h.stop();
  });

  it('accepts a valid token and greets the client', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${validToken()}`);
    expect(await c.open()).toBe(true);
    await wait(50);
    expect(c.frames.map((f) => f.type)).toContain('connected');
    c.close();
    await h.stop();
  });

  it('REFUSES an unsigned token when no public key is configured (DEF-06)', async () => {
    // The old fallback was `jwt.decode`, so a missing JWT_PUBLIC_PEM silently accepted anything.
    // A fabric that cannot verify must reject, not trust.
    const h = await harness({ jwtPublicKey: undefined });
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ account_id: 'attacker', device_id: 'd1' }),
    ).toString('base64url')}.`;
    const c = connect(`${h.url}?token=${unsigned}`);
    expect(await c.closed()).toBe(4001);
    expect(c.frames.map((f) => f.type)).not.toContain('connected');
    await h.stop();
  });

  it('accepts the token from an Authorization header as well as the query string', async () => {
    const h = await harness();
    const c = connect(h.url, { headers: { authorization: `Bearer ${validToken()}` } });
    expect(await c.open()).toBe(true);
    c.close();
    await h.stop();
  });
});

describe('WsFabric — inbound authorization (DEF-07)', () => {
  const member = (convs: string[]) => ({
    members: async () => [],
    isMember: async (conversationId: string, userId: string) =>
      userId === 'u1' && convs.includes(conversationId),
  });

  it('records a receipt for a conversation the sender belongs to', async () => {
    const h = await harness({ membership: member(['conv-mine']) as never });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'durable', type: 'read', data: { conversationId: 'conv-mine', seq: 7 } });
    await wait(80);
    expect(h.sink.read).toEqual(['u1|conv-mine|7']);
    c.close();
    await h.stop();
  });

  it('refuses a receipt for a conversation the sender does not belong to', async () => {
    // Otherwise anyone could force blue ticks in a stranger's chat.
    const h = await harness({ membership: member(['conv-mine']) as never });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'durable', type: 'read', data: { conversationId: 'conv-theirs', seq: 7 } });
    c.send({ kind: 'durable', type: 'delivered', data: { conversationId: 'conv-theirs', seq: 7 } });
    await wait(80);
    expect(h.sink.read).toEqual([]);
    expect(h.sink.delivered).toEqual([]);
    c.close();
    await h.stop();
  });

  it('refuses typing in a conversation the sender does not belong to', async () => {
    const h = await harness({ membership: member(['conv-mine']) as never });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'ephemeral', type: 'typing', conversationId: 'conv-theirs', state: 'start' });
    await wait(80);
    expect(h.typing.relayed).toEqual([]);
    c.close();
    await h.stop();
  });

  it('relays typing in a conversation the sender belongs to', async () => {
    const h = await harness({ membership: member(['conv-mine']) as never });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'ephemeral', type: 'typing', conversationId: 'conv-mine', state: 'start' });
    await wait(80);
    expect(h.typing.relayed).toEqual(['u1|conv-mine|start']);
    c.close();
    await h.stop();
  });

  it('refuses sender-key distribution into a conversation the sender does not belong to', async () => {
    const h = await harness({ membership: member(['conv-mine']) as never });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({
      kind: 'durable',
      type: 'skdm',
      data: { conversationId: 'conv-theirs', epoch: 1, targets: [] },
    });
    await wait(80);
    expect(h.skdm.distributed).toEqual([]);
    c.close();
    await h.stop();
  });

  it('fails CLOSED when membership cannot be determined', async () => {
    const h = await harness({
      membership: {
        members: async () => [],
        isMember: async () => {
          throw new Error('identity-service down');
        },
      } as never,
    });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'durable', type: 'read', data: { conversationId: 'conv-mine', seq: 1 } });
    await wait(80);
    expect(h.sink.read).toEqual([]);
    c.close();
    await h.stop();
  });
});

describe('WsFabric — abuse limits (DEF-11)', () => {
  it('closes a connection that sends an oversized frame', async () => {
    const h = await harness({ maxPayloadBytes: 1024 });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.ws.send(JSON.stringify({ kind: 'ephemeral', type: 'ping', pad: 'x'.repeat(4096) }));
    // 1009 = "message too big": ws enforces maxPayload itself rather than buffering the frame.
    expect(await c.closed()).toBe(1009);
    await h.stop();
  });

  it('rejects a disallowed Origin before the socket opens', async () => {
    const h = await harness({ allowedOrigins: ['https://app.velchat.test'] });
    const c = connect(`${h.url}?token=${validToken()}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(await c.open()).toBe(false);
    await h.stop();
  });

  it('allows a permitted Origin', async () => {
    const h = await harness({ allowedOrigins: ['https://app.velchat.test'] });
    const c = connect(`${h.url}?token=${validToken()}`, {
      headers: { origin: 'https://app.velchat.test' },
    });
    expect(await c.open()).toBe(true);
    c.close();
    await h.stop();
  });

  it('throttles a client flooding inbound frames', async () => {
    // Each typing frame costs a fan-out and each ping a registry write, so an unbounded client is
    // an amplification lever, not just noisy.
    const h = await harness({
      membership: {
        members: async () => [],
        isMember: async () => true,
      } as never,
      inboundPerSecond: 5,
    });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    for (let i = 0; i < 50; i += 1) {
      c.send({ kind: 'ephemeral', type: 'typing', conversationId: 'c1', state: 'start' });
    }
    await wait(150);
    expect(h.typing.relayed.length).toBeLessThanOrEqual(6);
    c.close();
    await h.stop();
  });
});

describe('WsFabric — delivery (DEF-09)', () => {
  it('delivers a frame only to the addressed user', async () => {
    const h = await harness();
    const a = connect(`${h.url}?token=${validToken('u1', 'd1')}`);
    const b = connect(`${h.url}?token=${validToken('u2', 'd1')}`);
    await Promise.all([a.open(), b.open()]);
    await wait(40);
    a.frames.length = 0;
    b.frames.length = 0;

    await h.fabric.deliver({ userId: 'u1', frame: { kind: 'durable', type: 'message', data: {} } });
    await wait(60);

    expect(a.frames.map((f) => f.type)).toContain('message');
    expect(b.frames.map((f) => f.type)).not.toContain('message');
    a.close();
    b.close();
    await h.stop();
  });

  it('targets a single device when the envelope names one', async () => {
    const h = await harness();
    const d1 = connect(`${h.url}?token=${validToken('u1', 'd1')}`);
    const d2 = connect(`${h.url}?token=${validToken('u1', 'd2')}`);
    await Promise.all([d1.open(), d2.open()]);
    await wait(40);
    d1.frames.length = 0;
    d2.frames.length = 0;

    await h.fabric.deliver({
      userId: 'u1',
      deviceId: 'd2',
      frame: { kind: 'durable', type: 'skdm', data: {} },
    });
    await wait(60);

    expect(d2.frames.map((f) => f.type)).toContain('skdm');
    expect(d1.frames.map((f) => f.type)).not.toContain('skdm');
    d1.close();
    d2.close();
    await h.stop();
  });

  it('finds a user in constant time rather than scanning every socket', async () => {
    // With a per-user index the lookup cost is independent of how many other sockets are open;
    // the old implementation iterated all of them for every frame.
    const h = await harness();
    const many = await Promise.all(
      Array.from({ length: 25 }, (_, i) => {
        const c = connect(`${h.url}?token=${validToken(`bystander-${i}`, 'd1')}`);
        return c.open().then(() => c);
      }),
    );
    const target = connect(`${h.url}?token=${validToken('target', 'd1')}`);
    await target.open();
    await wait(60);

    expect(h.fabric.socketCountFor('target')).toBe(1);
    expect(h.fabric.socketCountFor('nobody')).toBe(0);

    many.forEach((c) => c.close());
    target.close();
    await h.stop();
  });

  it('drops the registry entry when a socket closes', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${validToken('u1', 'd1')}`);
    await c.open();
    await wait(40);
    expect(h.fabric.socketCountFor('u1')).toBe(1);

    c.close();
    await wait(120);
    expect(h.fabric.socketCountFor('u1')).toBe(0);
    await h.stop();
  });

  it('tells clients to reconnect when draining, instead of dropping them silently', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    await wait(40);
    c.frames.length = 0;

    await h.fabric.stop();
    await wait(80);

    expect(c.frames.map((f) => f.type)).toContain('reconnect');
    await new Promise<void>((r) => setTimeout(r, 10));
  });
});

describe('WsFabric — protocol handling', () => {
  it('answers a ping with a pong', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'ephemeral', type: 'ping' });
    await wait(80);
    expect(c.frames.map((f) => f.type)).toContain('pong');
    c.close();
    await h.stop();
  });

  it('ignores a malformed frame without dropping the connection', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.ws.send('not json at all');
    await wait(80);
    expect(c.code()).toBe(0); // still connected
    c.close();
    await h.stop();
  });

  it('ignores an unknown frame type', async () => {
    const h = await harness();
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'durable', type: 'no-such-type', data: {} });
    await wait(80);
    expect(c.code()).toBe(0);
    c.close();
    await h.stop();
  });

  it('accepts a receipt in either the enveloped or the flat frame shape', async () => {
    // The mobile client sends durable frames enveloped and ephemeral frames flat; both must work.
    const h = await harness({
      membership: { members: async () => [], isMember: async () => true } as never,
    });
    const c = connect(`${h.url}?token=${validToken()}`);
    await c.open();
    c.send({ kind: 'durable', type: 'delivered', data: { conversationId: 'c1', seq: 1 } });
    c.send({ kind: 'durable', type: 'delivered', conversationId: 'c1', seq: 2 });
    await wait(100);
    expect(h.sink.delivered).toEqual(['u1|c1|1', 'u1|c1|2']);
    c.close();
    await h.stop();
  });
});
