/**
 * Notification previews — deciding what, if anything, a push may say about a message.
 *
 * ## The trade this makes
 *
 * §A19's original position was that a push carries ids and nothing else, so the notification could
 * only ever read "New message". That is the right default for an end-to-end-encrypted product and
 * it is what WhatsApp does — but it is a real product cost today, and personal conversations are
 * not yet E2EE: the server already holds this plaintext, indexes it, and serves it over REST.
 *
 * So a preview is included, with one hard rule: **the server never invents plaintext it does not
 * already hold.** The moment a conversation is genuinely encrypted (`ciphertext_ref` set, or a
 * `content` the server cannot read), this returns no text and the notification falls back to
 * "New message" on its own. Turning E2EE on therefore tightens notifications automatically
 * instead of leaking through a path someone forgot to close.
 *
 * The consequence to be honest about: a preview transits FCM, so Google can see it. That is the
 * difference between this and WhatsApp, and it is the price of showing the text at all before
 * E2EE exists. `messagePreview` takes an explicit `allowPreview` flag, so a per-account
 * "show preview" preference is a wiring change here rather than a redesign.
 *
 * PURE — no I/O, so every one of those rules is unit tested rather than discovered in production.
 */
import type { MessageSentPayload } from '@velchat/shared-types';

/**
 * Cap on the preview body.
 *
 * An FCM data message is capped at 4 KB TOTAL and the payload also carries ids. 140 characters is
 * comfortably more than the two lines a notification will ever show, so a longer preview would
 * spend the budget on text nobody reads — and an oversized payload fails the whole send, not just
 * the preview.
 */
export const PREVIEW_MAX_CHARS = 140;

export interface PushPreview {
  /**
   * The message type, passed through so the CLIENT localises "Photo" / "Voice message" itself.
   * Sending an English label from here would ship an untranslatable string to every device.
   */
  kind: string;
  /** The plaintext body, condensed and truncated. Absent whenever the server must not read it. */
  text?: string;
}

/** Types whose whole content IS the text. Anything else is described by its `kind` alone. */
const TEXTUAL = new Set(['text', 'system']);

/** Control characters, including the newlines and tabs a single-line surface cannot show. */
const CONTROL_CHARS = new RegExp('[\u0000-\u001F\u007F]+', 'g');

/**
 * Pull a display string out of a `content` that may be a string OR an object.
 *
 * `MessageSentPayload.content` is typed `string | Record<string, unknown>` and both shapes are
 * real: the mobile client sends a bare string, richer senders send `{ text }`. Reading only one
 * of them would make previews work for some clients and silently not for others.
 */
function contentText(content: MessageSentPayload['content']): string | undefined {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return undefined;
  for (const key of ['text', 'body', 'caption', 'content_plain', 'contentPlain']) {
    const v = (content as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/**
 * Flatten to one line and bound the length.
 *
 * Control characters are stripped rather than passed through: a notification is a single-line
 * surface, and a raw newline inside a JSON payload is the kind of thing that breaks a parser
 * three hops downstream. Truncation prefers a nearby word boundary, because cutting mid-word
 * reads as corruption rather than as "there is more".
 */
function condense(raw: string): string | undefined {
  const flat = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  if (flat.length <= PREVIEW_MAX_CHARS) return flat;

  const cut = flat.slice(0, PREVIEW_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour a word boundary in the last quarter — otherwise one long token would throw most
  // of the preview away.
  const body = lastSpace > PREVIEW_MAX_CHARS * 0.75 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * What this push may say about the message.
 *
 * `kind` is always returned (so the client can render "Photo" for a photo); `text` only when all
 * of these hold: previews are allowed, the type is textual, and the server genuinely holds the
 * plaintext.
 */
export function messagePreview(m: MessageSentPayload, allowPreview = true): PushPreview {
  const kind = typeof m.type === 'string' && m.type !== '' ? m.type : 'text';
  if (!allowPreview) return { kind };

  // Encrypted: the server holds a ciphertext blob it must never interpret. No preview, ever —
  // this is the check that makes enabling E2EE tighten notifications automatically.
  if (typeof m.ciphertext_ref === 'string' && m.ciphertext_ref !== '') return { kind };

  if (!TEXTUAL.has(kind)) return { kind };

  // `text` is the explicitly server-readable body (enterprise/channel, set for search indexing);
  // `content` is the message itself. Prefer the former — it is the one the server is documented
  // to be allowed to read.
  const raw = (typeof m.text === 'string' ? m.text : undefined) ?? contentText(m.content);
  if (raw === undefined) return { kind };

  const text = condense(raw);
  return text === undefined ? { kind } : { kind, text };
}
