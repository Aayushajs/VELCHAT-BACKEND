import { createHmac } from 'node:crypto';
import { HttpAiGateway } from '../../src/ai-gateway/http-ai.gateway';

describe('HttpAiGateway (self-hosted AI server client)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('POSTs to the right path and HMAC-signs the body', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        json: async () => ({ text: 'bonjour', detectedSource: 'en' }),
      } as Response;
    }) as unknown as typeof fetch;

    const gw = new HttpAiGateway({ baseUrl: 'http://ai', hmacSecret: 'sek', timeoutMs: 1000 });
    const r = await gw.translate('hello', 'fr', 'en');

    expect(r.text).toBe('bonjour');
    expect(captured!.url).toBe('http://ai/translate');
    const body = captured!.init.body as string;
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-velchat-signature']).toBe(
      createHmac('sha256', 'sek').update(body).digest('hex'),
    );
  });

  it('throws on a non-ok response (degrades gracefully upstream)', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 503 }) as Response,
    ) as unknown as typeof fetch;
    const gw = new HttpAiGateway({ baseUrl: 'http://ai', timeoutMs: 1000 });
    await expect(gw.detect('x')).rejects.toThrow(/503/);
  });

  it('sends a Bearer token when an api key is set', async () => {
    let headers: Record<string, string> = {};
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: true, json: async () => ({ vector: [1, 2, 3] }) } as Response;
    }) as unknown as typeof fetch;
    const gw = new HttpAiGateway({ baseUrl: 'http://ai', apiKey: 'k', timeoutMs: 1000 });
    await gw.embed('hi');
    expect(headers['authorization']).toBe('Bearer k');
  });
});
