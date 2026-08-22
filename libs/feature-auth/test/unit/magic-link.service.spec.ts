import { MagicLinkService, type MagicLinkPending } from '../../src/auth/dapt/magic-link.service';
import type { Mailer, MailMessage } from '@velchat/mail';

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

function captureMailer() {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    async send(msg) {
      sent.push(msg);
    },
  };
  return { mailer, sent };
}

describe('MagicLinkService (§B2.5 email fallback)', () => {
  it('begin stores a token and sends the link email', async () => {
    const { mailer, sent } = captureMailer();
    const svc = new MagicLinkService(fakeRedis(), mailer, 'http://x');
    const res = await svc.begin(pending);
    expect(res.sent).toBe(true);
    expect(sent[0]?.to).toBe('a@b.com');
    expect(sent[0]?.text).toMatch(/token=/);
  });

  it('consume returns the payload and is single-use', async () => {
    const { mailer, sent } = captureMailer();
    const svc = new MagicLinkService(fakeRedis(), mailer, 'http://x');
    await svc.begin(pending);
    const token = /token=([^\s]+)/.exec(sent[0]?.text ?? '')?.[1] as string;
    const got = await svc.consume(token);
    expect(got.email).toBe('a@b.com');
    await expect(svc.consume(token)).rejects.toThrow(/Invalid or expired/);
  });
});
