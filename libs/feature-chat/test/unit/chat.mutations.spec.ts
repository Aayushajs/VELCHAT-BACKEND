import { ValidationError, ForbiddenError, NotFoundError } from '@velchat/common';
import type { MongoClient } from '@velchat/database';
import { ChatService } from '../../src/chat/chat.service';
import { ChatRepository } from '../../src/chat/chat.repository';
import type { MessageDoc } from '../../src/chat/message.types';

/** Service-level mock (same style as chat.service.spec.ts): stub repo/seq/events. */
function makeChat(existing: MessageDoc | null = null) {
  const repo = {
    findById: jest.fn(async (): Promise<MessageDoc | null> => existing),
    addReaction: jest.fn(async () => undefined),
    removeReaction: jest.fn(async () => undefined),
    applyEdit: jest.fn(async () => undefined),
    tombstone: jest.fn(async () => undefined),
    deleteForMe: jest.fn(async () => undefined),
  };
  const seq = { next: jest.fn(async () => 1) };
  const events = {
    reaction: jest.fn(async () => undefined),
    edited: jest.fn(async () => undefined),
    deleted: jest.fn(async () => undefined),
  };
  const svc = new ChatService(repo as never, seq as never, events as never);
  return { svc, repo, events };
}

function message(over: Partial<MessageDoc> = {}): MessageDoc {
  return {
    _id: 'm-1',
    conversation_id: 'conv-1',
    seq: 5,
    sender_id: 'acc-1',
    client_msg_id: 'cm-1',
    type: 'text',
    content: 'old',
    reply_to: null,
    thread_root: null,
    mentions: [],
    attachments: [],
    reactions: {},
    edited_at: null,
    edit_history: [],
    deleted: false,
    deleted_scope: null,
    ephemeral_ttl: null,
    created_at: '2026-07-10T00:00:00.000Z',
    server_ts: '2026-07-10T00:00:00.000Z',
    ...over,
  };
}

const react = { conversationId: 'conv-1', messageId: 'm-1', userId: 'u-1', emoji: '👍' };

describe('ChatService reactions (§B15)', () => {
  it('react adds and emits message.reaction.added', async () => {
    const { svc, repo, events } = makeChat();
    await svc.react(react);
    expect(repo.addReaction).toHaveBeenCalledWith('conv-1', 'm-1', 'u-1', '👍');
    expect(events.reaction).toHaveBeenCalledWith(true, 'conv-1', 'm-1', 'u-1', '👍');
  });

  it('unreact removes and emits message.reaction.removed', async () => {
    const { svc, repo, events } = makeChat();
    await svc.unreact(react);
    expect(repo.removeReaction).toHaveBeenCalledWith('conv-1', 'm-1', 'u-1', '👍');
    expect(events.reaction).toHaveBeenCalledWith(false, 'conv-1', 'm-1', 'u-1', '👍');
  });

  it('rejects an incomplete reaction', async () => {
    const { svc } = makeChat();
    await expect(svc.react({ ...react, emoji: '' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ChatService.edit (§B15)', () => {
  it('only the original sender may edit → ForbiddenError otherwise', async () => {
    const { svc, repo, events } = makeChat(message({ sender_id: 'acc-1' }));
    await expect(
      svc.edit({ conversationId: 'conv-1', messageId: 'm-1', editorId: 'acc-2', content: 'new' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.applyEdit).not.toHaveBeenCalled();
    expect(events.edited).not.toHaveBeenCalled();
  });

  it('missing message → NotFoundError', async () => {
    const { svc } = makeChat(null);
    await expect(
      svc.edit({ conversationId: 'conv-1', messageId: 'm-1', editorId: 'acc-1', content: 'new' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sets edited_at and appends the previous content to edit_history', async () => {
    const { svc, repo } = makeChat(message({ content: 'old' }));
    const ack = await svc.edit({
      conversationId: 'conv-1',
      messageId: 'm-1',
      editorId: 'acc-1',
      content: 'new',
    });
    const [conv, msg, content, historyEntry, editedAt] = repo.applyEdit.mock
      .calls[0] as unknown as [
      string,
      string,
      string,
      { content: string; edited_at: string },
      string,
    ];
    expect([conv, msg, content]).toEqual(['conv-1', 'm-1', 'new']);
    expect(historyEntry).toEqual({ content: 'old', edited_at: '2026-07-10T00:00:00.000Z' });
    expect(editedAt).toBe(ack.editedAt);
    expect(ack.messageId).toBe('m-1');
  });

  it('enterprise edit carries the new plaintext for search re-index', async () => {
    const { svc, events } = makeChat(message({ content: 'old' }));
    await svc.edit({
      conversationId: 'conv-1',
      messageId: 'm-1',
      editorId: 'acc-1',
      content: 'new budget',
      tenantId: 'org-1',
      encrypted: false,
    });
    const [, tenantId, text] = events.edited.mock.calls[0] as unknown as [
      MessageDoc,
      string | null,
      string | undefined,
    ];
    expect(tenantId).toBe('org-1');
    expect(text).toBe('new budget');
  });

  it('E2EE personal edit NEVER carries plaintext text in the event (§A18.2)', async () => {
    const { svc, events } = makeChat(message({ content: 'old-ct' }));
    await svc.edit({
      conversationId: 'conv-1',
      messageId: 'm-1',
      editorId: 'acc-1',
      content: 'CIPHERTEXT',
      encrypted: true,
    });
    const [, tenantId, text] = events.edited.mock.calls[0] as unknown as [
      MessageDoc,
      string | null,
      string | undefined,
    ];
    expect(tenantId).toBeNull();
    expect(text).toBeUndefined();
  });

  it('does not carry plaintext for a tenant edit marked encrypted', async () => {
    const { svc, events } = makeChat(message({ content: 'old' }));
    await svc.edit({
      conversationId: 'conv-1',
      messageId: 'm-1',
      editorId: 'acc-1',
      content: 'secret',
      tenantId: 'org-1',
      encrypted: true,
    });
    const [, , text] = events.edited.mock.calls[0] as unknown as [
      MessageDoc,
      string | null,
      string | undefined,
    ];
    expect(text).toBeUndefined();
  });
});

describe('ChatService.delete (§B15)', () => {
  it('delete-for-everyone tombstones and emits message.deleted (sender only)', async () => {
    const { svc, repo, events } = makeChat(message({ sender_id: 'acc-1', seq: 5 }));
    const res = await svc.delete({
      conversationId: 'conv-1',
      messageId: 'm-1',
      actorId: 'acc-1',
      scope: 'everyone',
    });
    expect(repo.tombstone).toHaveBeenCalledWith('conv-1', 'm-1');
    expect(events.deleted).toHaveBeenCalledWith('conv-1', 'm-1', 5);
    expect(res.message).toMatch(/everyone/i);
  });

  it('delete-for-everyone by a non-sender → ForbiddenError (no tombstone, no event)', async () => {
    const { svc, repo, events } = makeChat(message({ sender_id: 'acc-1' }));
    await expect(
      svc.delete({
        conversationId: 'conv-1',
        messageId: 'm-1',
        actorId: 'acc-2',
        scope: 'everyone',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repo.tombstone).not.toHaveBeenCalled();
    expect(events.deleted).not.toHaveBeenCalled();
  });

  it('delete-for-everyone on a missing message → NotFoundError', async () => {
    const { svc } = makeChat(null);
    await expect(
      svc.delete({
        conversationId: 'conv-1',
        messageId: 'm-1',
        actorId: 'acc-1',
        scope: 'everyone',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete-for-me hides per-device — no global tombstone, no message.deleted event', async () => {
    const { svc, repo, events } = makeChat(message());
    await svc.delete({
      conversationId: 'conv-1',
      messageId: 'm-1',
      actorId: 'anyone',
      scope: 'me',
    });
    expect(repo.deleteForMe).toHaveBeenCalledWith('conv-1', 'm-1', 'anyone');
    expect(repo.tombstone).not.toHaveBeenCalled();
    expect(events.deleted).not.toHaveBeenCalled();
  });
});

/**
 * Repository-level proof of reaction idempotency (§B15): $addToSet never duplicates a reactor and
 * removal cleans up the emoji key once its last reactor leaves. A tiny in-memory fake applies the
 * update operators the repo issues.
 */
describe('ChatRepository reactions — idempotency + cleanup (§B15)', () => {
  type Doc = Record<string, unknown>;
  const get = (o: Doc, path: string): unknown =>
    path.split('.').reduce<unknown>((cur, k) => (cur == null ? undefined : (cur as Doc)[k]), o);
  const set = (o: Doc, path: string, val: unknown): void => {
    const parts = path.split('.');
    const last = parts.pop() as string;
    let cur: Doc = o;
    for (const p of parts) {
      if (cur[p] == null) cur[p] = {};
      cur = cur[p] as Doc;
    }
    cur[last] = val;
  };
  const unset = (o: Doc, path: string): void => {
    const parts = path.split('.');
    const last = parts.pop() as string;
    let cur: Doc = o;
    for (const p of parts) {
      if (cur[p] == null) return;
      cur = cur[p] as Doc;
    }
    delete cur[last];
  };

  function fakeMongo(doc: Doc): MongoClient {
    const matches = (filter: Doc): boolean =>
      Object.entries(filter).every(([k, v]) => {
        if (k === '_id' || k === 'conversation_id') return true;
        if (v && typeof v === 'object' && '$size' in (v as Doc)) {
          const arr = get(doc, k);
          return Array.isArray(arr) && arr.length === (v as { $size: number }).$size;
        }
        return true;
      });
    const collection = {
      updateOne: async (filter: Doc, update: Doc) => {
        if (!matches(filter)) return { matchedCount: 0 };
        const addToSet = update.$addToSet as Doc | undefined;
        if (addToSet) {
          for (const [k, val] of Object.entries(addToSet)) {
            const arr = get(doc, k);
            const list = Array.isArray(arr) ? [...(arr as unknown[])] : [];
            if (!list.includes(val)) list.push(val);
            set(doc, k, list);
          }
        }
        const pull = update.$pull as Doc | undefined;
        if (pull) {
          for (const [k, val] of Object.entries(pull)) {
            const arr = get(doc, k);
            if (Array.isArray(arr))
              set(
                doc,
                k,
                (arr as unknown[]).filter((x) => x !== val),
              );
          }
        }
        const unsetOp = update.$unset as Doc | undefined;
        if (unsetOp) for (const k of Object.keys(unsetOp)) unset(doc, k);
        return { matchedCount: 1 };
      },
    };
    return { db: { collection: () => collection } } as unknown as MongoClient;
  }

  it('adding the same (user, emoji) twice keeps a single reactor; removing the last cleans up', async () => {
    const doc: Doc = { _id: 'm1', conversation_id: 'c1', reactions: {} };
    const repo = new ChatRepository(fakeMongo(doc));

    await repo.addReaction('c1', 'm1', 'u1', '👍');
    await repo.addReaction('c1', 'm1', 'u1', '👍'); // idempotent — no duplicate
    expect((doc.reactions as Doc)['👍']).toEqual(['u1']);

    await repo.addReaction('c1', 'm1', 'u2', '👍');
    expect((doc.reactions as Doc)['👍']).toEqual(['u1', 'u2']);

    await repo.removeReaction('c1', 'm1', 'u1', '👍');
    expect((doc.reactions as Doc)['👍']).toEqual(['u2']); // key retained while reactors remain

    await repo.removeReaction('c1', 'm1', 'u2', '👍');
    expect((doc.reactions as Doc)['👍']).toBeUndefined(); // empty array cleaned up
  });
});
