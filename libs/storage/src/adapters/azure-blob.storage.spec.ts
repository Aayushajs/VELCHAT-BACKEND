import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { AzureBlobStorage } from './azure-blob.storage';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
}

/**
 * Azure is exercised against a local server that stands in for the Blob endpoint, because the whole
 * job of this adapter is what it puts on the wire: the REST verb, the `x-ms-*` headers, and a
 * Shared Key signature computed over them. Mocking an SDK would test the mock — and there is no SDK
 * here on purpose, since adding one would mean a new dependency for a ~100-line signing scheme that
 * node's crypto already covers.
 */
function fakeBlobService() {
  const seen: Seen[] = [];
  let status = 201;
  let server: Server;
  return {
    seen,
    setStatus(s: number) {
      status = s;
    },
    async start(): Promise<string> {
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
          seen.push({
            method: req.method ?? '',
            url: req.url ?? '',
            headers: req.headers as Record<string, string | undefined>,
            body: Buffer.concat(chunks).toString(),
          });
          res.writeHead(status);
          res.end();
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const a = server.address();
      return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    },
    async stop() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const KEY = Buffer.from('super-secret-account-key').toString('base64');

describe('AzureBlobStorage', () => {
  const svc = fakeBlobService();
  let endpoint: string;
  const store = () =>
    new AzureBlobStorage({
      account: 'velchatacct',
      accountKey: KEY,
      container: 'velchat-media',
      endpoint,
    });

  beforeAll(async () => {
    endpoint = await svc.start();
  });
  afterAll(() => svc.stop());
  beforeEach(() => {
    svc.seen.length = 0;
    svc.setStatus(201);
  });

  it('identifies itself so logs and health output name the real provider', () => {
    expect(store().name).toBe('storage:azure-blob');
  });

  it('PUTs a block blob to /container/key with the required Azure headers', async () => {
    await store().putObject({ key: 'a/b.png', body: Buffer.from('hi'), contentType: 'image/png' });

    const r = svc.seen[0];
    expect(r?.method).toBe('PUT');
    expect(r?.url).toBe('/velchat-media/a/b.png');
    expect(r?.headers['x-ms-blob-type']).toBe('BlockBlob');
    expect(r?.headers['content-type']).toBe('image/png');
    expect(r?.headers['x-ms-version']).toBeTruthy();
    expect(r?.headers['x-ms-date']).toBeTruthy();
    expect(r?.body).toBe('hi');
  });

  it('signs with Shared Key naming the account, not the raw key', async () => {
    await store().putObject({ key: 'k', body: 'x' });

    const auth = svc.seen[0]?.headers['authorization'] ?? '';
    expect(auth).toMatch(/^SharedKey velchatacct:/);
    expect(auth).not.toContain(KEY); // the key signs; it is never transmitted
  });

  it('produces a different signature per request, so a captured header cannot be replayed', async () => {
    const s = store();
    await s.putObject({ key: 'one', body: 'x' });
    await s.putObject({ key: 'two', body: 'x' });

    expect(svc.seen[0]?.headers['authorization']).not.toBe(svc.seen[1]?.headers['authorization']);
  });

  it('streams an upload without buffering the whole body', async () => {
    await store().putObjectStream({
      key: 'big.bin',
      body: Readable.from([Buffer.from('chunk-1'), Buffer.from('chunk-2')]),
      contentLength: 14,
    });

    const r = svc.seen[0];
    expect(r?.method).toBe('PUT');
    expect(r?.body).toBe('chunk-1chunk-2');
  });

  it('mints a read-only SAS URL that expires', async () => {
    const url = new URL(await store().getSignedUrl('a/b.png', 600));

    expect(url.pathname).toBe('/velchat-media/a/b.png');
    expect(url.searchParams.get('sp')).toBe('r'); // read only — never write/delete
    expect(url.searchParams.get('sr')).toBe('b'); // scoped to this blob
    expect(url.searchParams.get('sig')).toBeTruthy();
    const expiry = Date.parse(url.searchParams.get('se') ?? '');
    expect(expiry).toBeGreaterThan(Date.now());
    expect(expiry).toBeLessThanOrEqual(Date.now() + 601_000);
  });

  it('DELETEs a blob', async () => {
    svc.setStatus(202);
    await store().deleteObject('gone.png');
    expect(svc.seen[0]?.method).toBe('DELETE');
    expect(svc.seen[0]?.url).toBe('/velchat-media/gone.png');
  });

  it('reports existence with HEAD, not by downloading the blob', async () => {
    svc.setStatus(200);
    await expect(store().exists('there.png')).resolves.toBe(true);
    expect(svc.seen[0]?.method).toBe('HEAD');

    svc.setStatus(404);
    await expect(store().exists('nope.png')).resolves.toBe(false);
  });

  it('raises a useful error when Azure rejects the write', async () => {
    svc.setStatus(403);
    await expect(store().putObject({ key: 'k', body: 'x' })).rejects.toThrow(/403/);
  });

  it('encodes each path segment but keeps the key hierarchy', async () => {
    await store().putObject({ key: 'a b/c+d.png', body: 'x' });
    const url = svc.seen[0]?.url ?? '';
    expect(url).toBe('/velchat-media/a%20b/c%2Bd.png');
    expect(url).not.toContain(' ');
  });
});
