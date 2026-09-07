import { messagePreview, PREVIEW_MAX_CHARS } from '../../src/notify/preview';
import type { MessageSentPayload } from '@velchat/shared-types';

const msg = (over: Partial<MessageSentPayload> = {}): MessageSentPayload => ({
  conversation_id: 'c1',
  message_id: 'm1',
  seq: 5,
  sender_account_id: 'alice',
  sent_at: '2026-07-04T00:00:00.000Z',
  ...over,
});

describe('messagePreview', () => {
  it('previews a plain string body — what the mobile client actually sends', () => {
    expect(messagePreview(msg({ type: 'text', content: 'on my way' }))).toEqual({
      kind: 'text',
      text: 'on my way',
    });
  });

  it('previews the object form too', () => {
    // Both shapes are real: a bare string from mobile, `{ text }` from richer senders. Reading
    // only one would make previews work for some clients and silently not for others.
    expect(messagePreview(msg({ type: 'text', content: { text: 'hello' } }))).toEqual({
      kind: 'text',
      text: 'hello',
    });
  });

  it('prefers the explicitly server-readable `text` over `content`', () => {
    const p = messagePreview(msg({ type: 'text', text: 'indexed body', content: 'raw content' }));
    expect(p.text).toBe('indexed body');
  });

  it('defaults an absent type to text', () => {
    expect(messagePreview(msg({ content: 'hi' }))).toEqual({ kind: 'text', text: 'hi' });
  });

  // ── the rules that must never regress ────────────────────────────────────

  it('NEVER previews an encrypted message', () => {
    // The check that makes enabling E2EE tighten notifications automatically, instead of leaking
    // through a path someone forgot to close.
    const p = messagePreview(
      msg({ type: 'text', ciphertext_ref: 'blob-1', content: 'should not escape' }),
    );
    expect(p).toEqual({ kind: 'text' });
    expect(p.text).toBeUndefined();
  });

  it('honours allowPreview=false', () => {
    expect(messagePreview(msg({ type: 'text', content: 'secret' }), false)).toEqual({
      kind: 'text',
    });
  });

  it('describes non-textual messages by kind alone, with no body', () => {
    // The client localises "Photo"/"Voice message" from `kind`; sending an English label from
    // the server would ship an untranslatable string to every device.
    for (const kind of ['image', 'video', 'audio', 'file', 'location', 'contact', 'poll']) {
      expect(messagePreview(msg({ type: kind, content: { caption: 'beach' } }))).toEqual({
        kind,
      });
    }
  });

  it('returns kind-only rather than an empty body when there is nothing readable', () => {
    expect(messagePreview(msg({ type: 'text', content: '   ' }))).toEqual({ kind: 'text' });
    expect(messagePreview(msg({ type: 'text', content: {} }))).toEqual({ kind: 'text' });
    expect(messagePreview(msg({ type: 'text' }))).toEqual({ kind: 'text' });
  });

  // ── shaping ──────────────────────────────────────────────────────────────

  it('flattens newlines and tabs — a notification is a single-line surface', () => {
    const p = messagePreview(msg({ type: 'text', content: 'line one\nline two\t\tend' }));
    expect(p.text).toBe('line one line two end');
  });

  it('strips control characters rather than passing them into a JSON payload', () => {
    const p = messagePreview(msg({ type: 'text', content: 'a\u0001b\u0002c\u0003d' }));
    expect(p.text).toBe('a b c d');
  });

  it('truncates long bodies inside the FCM payload budget', () => {
    const long = 'word '.repeat(200);
    const p = messagePreview(msg({ type: 'text', content: long }));
    expect(p.text!.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARS + 1); // +1 for the ellipsis
    expect(p.text!.endsWith('…')).toBe(true);
  });

  it('truncates at a word boundary when one is close to the cut', () => {
    const p = messagePreview(msg({ type: 'text', content: 'word '.repeat(200) }));
    expect(p.text).not.toMatch(/wor…$/); // not sliced mid-word
  });

  it('does not throw most of the preview away for one very long token', () => {
    // A word boundary is only honoured in the last quarter, so a single long token still fills
    // the preview instead of collapsing to almost nothing.
    const p = messagePreview(msg({ type: 'text', content: 'hi ' + 'x'.repeat(400) }));
    expect(p.text!.length).toBeGreaterThan(PREVIEW_MAX_CHARS * 0.9);
  });

  it('leaves a body that already fits exactly alone', () => {
    const exact = 'a'.repeat(PREVIEW_MAX_CHARS);
    expect(messagePreview(msg({ type: 'text', content: exact })).text).toBe(exact);
  });
});
