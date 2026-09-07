import { NotificationService } from '../../src/notify/notification.service';
import type { NotificationRepository } from '../../src/notify/notification.repository';
import type { MembersProjection } from '../../src/notify/members.projection';
import type { Logger } from '@velchat/common';
import type { MessageSentPayload, CallStartedPayload } from '@velchat/shared-types';

function setup(opts: { members?: string[]; online?: Set<string> } = {}) {
  const enqueued: Array<{
    userId: string;
    type: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
  }> = [];
  const repo = {
    getPref: jest.fn(async () => null), // default prefs = level all
    enqueue: jest.fn(
      async (o: {
        userId: string;
        type: string;
        dedupeKey: string;
        payload: Record<string, unknown>;
      }) => {
        enqueued.push(o);
        return true;
      },
    ),
  } as unknown as NotificationRepository;
  const online = opts.online ?? new Set<string>();
  const members = {
    members: jest.fn(async () => opts.members ?? []),
    isOnline: jest.fn(async (u: string) => online.has(u)),
  } as unknown as MembersProjection;
  const logger = { debug: jest.fn(), warn: jest.fn() } as unknown as Logger;
  return { svc: new NotificationService(repo, members, logger), repo, enqueued };
}

const msg = (over: Partial<MessageSentPayload> = {}): MessageSentPayload => ({
  conversation_id: 'c1',
  message_id: 'm1',
  seq: 5,
  sender_account_id: 'alice',
  sent_at: '2026-07-04T00:00:00.000Z',
  ...over,
});

describe('NotificationService (§A19/§B10)', () => {
  it('enqueues one push per offline recipient, excluding the sender', async () => {
    const { svc, enqueued } = setup({ members: ['alice', 'bob', 'carol'] });
    await svc.onMessageSent(msg());
    expect(enqueued.map((e) => e.userId).sort()).toEqual(['bob', 'carol']); // not alice
    expect(enqueued[0]!.payload).toEqual({
      conversationId: 'c1',
      messageId: 'm1',
      seq: '5',
      // The sender's ID, not their name — the client resolves the name from its own mirror.
      senderId: 'alice',
      kind: 'text',
    });
    expect(enqueued[0]!.dedupeKey).toBe('msg:m1:bob');
  });

  it('carries a preview when the server already holds the plaintext', async () => {
    // This assertion used to be "ids only, never content". That was the right default for an
    // E2EE product, but personal conversations are not encrypted yet and the server already
    // stores, indexes and serves this exact text over REST — so withholding it from the
    // notification bought no privacy and cost the product a usable notification.
    const { svc, enqueued } = setup({ members: ['alice', 'bob'] });
    await svc.onMessageSent(msg({ type: 'text', content: 'on my way' }));
    expect(enqueued[0]!.payload.preview).toBe('on my way');
  });

  it('carries NO preview once a message is encrypted', async () => {
    // The guarantee that survives: the server never previews plaintext it cannot read. Turning
    // E2EE on must tighten notifications on its own, with no change needed here.
    const { svc, enqueued } = setup({ members: ['alice', 'bob'] });
    await svc.onMessageSent(
      msg({ type: 'text', ciphertext_ref: 'blob-1', content: 'must not escape' }),
    );
    expect(enqueued[0]!.payload.preview).toBeUndefined();
    expect(JSON.stringify(enqueued[0]!.payload)).not.toMatch(/must not escape/);
  });

  it('describes an image by kind alone, with no body', async () => {
    const { svc, enqueued } = setup({ members: ['alice', 'bob'] });
    await svc.onMessageSent(msg({ type: 'image', content: { caption: 'beach' } }));
    expect(enqueued[0]!.payload.kind).toBe('image');
    expect(enqueued[0]!.payload.preview).toBeUndefined();
  });

  it('skips push for online recipients (in-app delivery)', async () => {
    const { svc, enqueued } = setup({ members: ['alice', 'bob'], online: new Set(['bob']) });
    await svc.onMessageSent(msg());
    expect(enqueued).toHaveLength(0); // bob online, alice is sender
  });

  it('rings conversation members on call.started, excluding the host', async () => {
    const { svc, enqueued } = setup({ members: ['alice', 'bob'] });
    const call: CallStartedPayload = {
      call_id: 'call1',
      type: 'group',
      conversation_id: 'c1',
      host_id: 'alice',
      room_name: 'call_call1',
      started_at: '2026-07-04T00:00:00.000Z',
    };
    await svc.onCallStarted(call);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ userId: 'bob', type: 'call', dedupeKey: 'call:call1:bob' });
  });

  it('ignores ad-hoc calls without a conversation', async () => {
    const { svc, enqueued } = setup({ members: ['alice', 'bob'] });
    await svc.onCallStarted({
      call_id: 'x',
      type: 'dm',
      conversation_id: null,
      host_id: 'alice',
      room_name: 'r',
      started_at: '2026-07-04T00:00:00.000Z',
    });
    expect(enqueued).toHaveLength(0);
  });
});
