import { MagicLinkService, type MagicLinkPending } from '../../src/auth/magic-link.service';
import type { MailerPort } from '../../src/auth/mailer.port';

function fakeRedis() {
  const map = new Map<string, string>();
  return {
    async set(key: string, value: string) {
      map.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async del(key: string) {
      map.delete(key);
    },
  } as never;
}

const pending: MagicLinkPending = { email: 'a@b.com', platform: 'web', devicePubkeyDer: 'AAAA' };

describe('MagicLinkService (§B2.5 email fallback)', () => {
  it('begin stores a token and sends the link', async () => {
    let sentTo = '';
    let sentLink = '';
    const mailer: MailerPort = {
      async sendMagicLink(e, l) {
        sentTo = e;
        sentLink = l;
      },
    };
    const svc = new MagicLinkService(fakeRedis(), mailer, 'http://x');
    const res = await svc.begin(pending);
    expect(res.sent).toBe(true);
    expect(sentTo).toBe('a@b.com');
    expect(sentLink).toMatch(/token=/);
  });

  it('consume returns the payload and is single-use', async () => {
    let link = '';
    const mailer: MailerPort = {
      async sendMagicLink(_e, l) {
        link = l;
      },
    };
    const svc = new MagicLinkService(fakeRedis(), mailer, 'http://x');
    await svc.begin(pending);
    const token = new URL(link).searchParams.get('token') as string;
    const got = await svc.consume(token);
    expect(got.email).toBe('a@b.com');
    await expect(svc.consume(token)).rejects.toThrow(/Invalid or expired/);
  });
});
