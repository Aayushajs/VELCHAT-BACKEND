import { createServer, type Server } from 'node:http';
import { HttpMembershipResolver } from './membership';

interface Recorded {
  url: string;
  auth: string | undefined;
}

/** Real local HTTP server — the resolver's whole job is a network call, so faking fetch would
 *  test the fake. `respond` decides each reply; `calls` records what actually arrived. */
function upstream() {
  const calls: Recorded[] = [];
  let respond: (path: string) => { status: number; body?: unknown; delayMs?: number } = () => ({
    status: 200,
    body: [],
  });
  let server: Server;
  return {
    calls,
    setResponse(fn: typeof respond) {
      respond = fn;
    },
    async start(): Promise<string> {
      server = createServer((req, res) => {
        calls.push({ url: req.url ?? '', auth: req.headers['x-velchat-internal'] as string });
        const r = respond(req.url ?? '');
        const send = () => {
          res.writeHead(r.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(r.body ?? null));
        };
        if (r.delayMs) setTimeout(send, r.delayMs);
        else send();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * DEF-07 (receipt/typing spoofing) and DEF-14 (the fanout fallback calls a guarded endpoint with no
 * credentials, so it 401s, returns [], and messages are silently not delivered whenever the Redis
 * projection is cold). Both funnel through this one port, so its failure semantics have to be
 * deliberate rather than incidental:
 *
 *   isMember  → fails CLOSED. An authorization answer that cannot be obtained is "no".
 *   members   → fails EMPTY. Live fan-out is best-effort; the client's afterSeq catch-up is the
 *               durability backstop, so an empty list delays delivery but never loses a message.
 */
describe('HttpMembershipResolver', () => {
  const svc = upstream();
  let base: string;

  beforeAll(async () => {
    base = await svc.start();
  });
  afterAll(async () => {
    await svc.stop();
  });
  beforeEach(() => {
    svc.calls.length = 0;
    svc.setResponse(() => ({ status: 200, body: ['u1', 'u2'] }));
  });

  const resolver = (over: Partial<{ secret: string; timeoutMs: number }> = {}) =>
    new HttpMembershipResolver({ baseUrl: base, secret: 'shhh', timeoutMs: 2000, ...over });

  it('returns the conversation members', async () => {
    await expect(resolver().members('conv-1')).resolves.toEqual(['u1', 'u2']);
  });

  it('authenticates itself, so a guarded upstream does not 401 (DEF-14)', async () => {
    await resolver().members('conv-1');
    expect(svc.calls[0]?.auth).toBe('shhh');
  });

  it('answers isMember from the member list', async () => {
    await expect(resolver().isMember('conv-1', 'u1')).resolves.toBe(true);
    await expect(resolver().isMember('conv-1', 'nobody')).resolves.toBe(false);
  });

  /**
   * The upstream does NOT return a bare array. `GET /conversations/:id/members` returns the
   * standard success envelope, because ResponseInterceptor wraps every non-excluded handler:
   *
   *   { success, statusCode, message, data: ['u1','u2'], requestId }
   *
   * Reading only `body` / `body.members` therefore yields [] against the REAL service — which
   * means isMember() answers "no" for genuine members, and every inbound `delivered` / `read` /
   * `typing` frame is refused. That is precisely "blue ticks and typing never work", with no
   * error anywhere: the guard is behaving exactly as designed on data it misread.
   */
  it('reads the members out of the standard response envelope', async () => {
    svc.setResponse(() => ({
      status: 200,
      body: {
        success: true,
        statusCode: 200,
        message: 'OK',
        data: ['u1', 'u2'],
        requestId: 'req-1',
      },
    }));

    await expect(resolver().members('conv-1')).resolves.toEqual(['u1', 'u2']);
    await expect(resolver().isMember('conv-1', 'u1')).resolves.toBe(true);
  });

  it('collapses concurrent lookups of the same conversation into one request', async () => {
    svc.setResponse(() => ({ status: 200, body: ['u1'], delayMs: 40 }));
    const r = resolver();

    await Promise.all(Array.from({ length: 25 }, () => r.members('conv-hot')));

    expect(svc.calls).toHaveLength(1);
  });

  it('does not collapse lookups of different conversations', async () => {
    const r = resolver();
    await Promise.all([r.members('conv-a'), r.members('conv-b')]);
    expect(svc.calls).toHaveLength(2);
  });

  it('fails EMPTY on an upstream error, so fan-out degrades instead of throwing', async () => {
    svc.setResponse(() => ({ status: 500 }));
    await expect(resolver().members('conv-1')).resolves.toEqual([]);
  });

  it('fails CLOSED on an upstream error — an unanswerable authorization is a denial', async () => {
    svc.setResponse(() => ({ status: 500 }));
    await expect(resolver().isMember('conv-1', 'u1')).resolves.toBe(false);
  });

  it('fails CLOSED when the upstream is too slow rather than hanging the caller', async () => {
    svc.setResponse(() => ({ status: 200, body: ['u1'], delayMs: 300 }));
    await expect(resolver({ timeoutMs: 50 }).isMember('conv-1', 'u1')).resolves.toBe(false);
  });

  it('percent-encodes the conversation id instead of interpolating it into the path', async () => {
    await resolver().members('../admin/secrets');
    expect(svc.calls[0]?.url).not.toContain('../');
  });

  it('refuses a base URL that is not http(s) (SSRF guard)', () => {
    expect(
      () => new HttpMembershipResolver({ baseUrl: 'file:///etc/passwd', secret: 's' }),
    ).toThrow(/http/i);
  });
});
