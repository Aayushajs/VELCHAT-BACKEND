import { HttpSocialGraphResolver } from './social-graph';

const OPTS = { baseUrl: 'http://identity:3003', secret: 's3cret', timeoutMs: 50 };

/** Responses are enveloped by ResponseInterceptor: { success, statusCode, message, data }. */
function envelope(data: unknown) {
  return { ok: true, json: async () => ({ success: true, statusCode: 200, message: 'OK', data }) };
}

describe('HttpSocialGraphResolver', () => {
  let fetchMock: jest.SpyInstance;
  afterEach(() => fetchMock?.mockRestore());

  function mockFetch(handler: (url: string) => unknown) {
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(((url: string) => Promise.resolve(handler(url))) as never);
  }

  it('rejects a non-http base URL so a mis-set env var cannot become an SSRF primitive', () => {
    expect(() => new HttpSocialGraphResolver({ ...OPTS, baseUrl: 'file:///etc/passwd' })).toThrow();
  });

  it('reads the contact list out of the response envelope', async () => {
    mockFetch((url) =>
      url.includes('/contacts/') // reverse block probe
        ? envelope({ blocked: false })
        : envelope([{ contact_user_id: 'viewer', display_name: null, blocked: false }]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: true,
      isBlocked: false,
    });
  });

  it('is not a contact when absent from the owner list', async () => {
    mockFetch((url) => (url.includes('/contacts/') ? envelope({ blocked: false }) : envelope([])));
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'stranger')).resolves.toEqual({
      isContact: false,
      isBlocked: false,
    });
  });

  it('blocks when the OWNER blocked the viewer (blocked flag on the contact row)', async () => {
    mockFetch((url) =>
      url.includes('/contacts/')
        ? envelope({ blocked: false })
        : envelope([{ contact_user_id: 'viewer', display_name: null, blocked: true }]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: true,
      isBlocked: true,
    });
  });

  it('blocks when the VIEWER blocked the owner (reverse direction)', async () => {
    mockFetch((url) =>
      url.includes('/contacts/')
        ? envelope({ blocked: true })
        : envelope([{ contact_user_id: 'viewer', display_name: null, blocked: false }]),
    );
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: true,
      isBlocked: true,
    });
  });

  // The single most important behaviour in this file: an answer we could not obtain must never
  // read as permission.
  it('fails CLOSED when the upstream errors', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: false,
      isBlocked: true,
    });
  });

  it('fails CLOSED on a non-2xx upstream response', async () => {
    mockFetch(() => ({ ok: false, json: async () => ({}) }));
    const r = new HttpSocialGraphResolver(OPTS);
    await expect(r.relationship('owner', 'viewer')).resolves.toEqual({
      isContact: false,
      isBlocked: true,
    });
  });

  it('sends the internal shared secret', async () => {
    mockFetch(() => envelope([]));
    const r = new HttpSocialGraphResolver(OPTS);
    await r.relationship('owner', 'viewer');
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['x-velchat-internal']).toBe('s3cret');
  });

  it('encodes ids so a caller-supplied id cannot walk the path', async () => {
    mockFetch(() => envelope([]));
    const r = new HttpSocialGraphResolver(OPTS);
    await r.relationship('../../admin', 'viewer');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('../..');
  });
});
