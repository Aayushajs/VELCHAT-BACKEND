import { ChatService } from '../../src/chat/chat.service';
import { ValidationError } from '@velchat/common';
import type { MessageDoc } from '../../src/chat/message.types';

function makeChat() {
  const repo = {
    findByClientMsgId: jest.fn(async (): Promise<MessageDoc | null> => null),
    insert: jest.fn(async () => undefined),
    history: jest.fn(async (): Promise<MessageDoc[]> => []),
  };
  const seq = { next: jest.fn(async () => 42) };
  const events = { messageSent: jest.fn(async () => undefined) };
  const svc = new ChatService(repo as never, seq as never, events as never);
  return { svc, repo, seq, events };
}

const input = {
  conversationId: 'conv-1',
  senderId: 'acc-1',
  clientMsgId: 'cm-1',
  content: 'ciphertext-b64',
};

describe('ChatService.send (§B4.2 hot path)', () => {
  it('assigns seq, persists, emits, and ACKs a new message', async () => {
    const { svc, repo, seq, events } = makeChat();
    const ack = await svc.send(input);
    expect(ack.seq).toBe(42);
    expect(ack.messageId).toMatch(/[0-9a-f-]{36}/);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(events.messageSent).toHaveBeenCalledTimes(1);
    expect(seq.next).toHaveBeenCalledWith('conv-1');
  });

  it('is idempotent — duplicate client_msg_id returns the existing message (no new seq/insert)', async () => {
    const { svc, repo, seq, events } = makeChat();
    repo.findByClientMsgId.mockResolvedValueOnce({
      _id: 'm-existing',
      seq: 7,
      server_ts: '2026-01-01T00:00:00Z',
    } as MessageDoc);
    const ack = await svc.send(input);
    expect(ack).toEqual({ messageId: 'm-existing', seq: 7, serverTs: '2026-01-01T00:00:00Z' });
    expect(seq.next).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
    expect(events.messageSent).not.toHaveBeenCalled();
  });

  it('rejects an incomplete message', async () => {
    const { svc } = makeChat();
    await expect(
      svc.send({ conversationId: '', senderId: '', clientMsgId: '', content: '' as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores content opaquely (never inspects ciphertext)', async () => {
    const { svc, repo } = makeChat();
    await svc.send({ ...input, content: 'OPAQUE_CIPHERTEXT' });
    const doc = repo.insert.mock.calls[0]?.[0] as unknown as MessageDoc;
    expect(doc.content).toBe('OPAQUE_CIPHERTEXT');
  });

  it('enterprise message carries tenant + plaintext for search indexing', async () => {
    const { svc, events } = makeChat();
    await svc.send({ ...input, content: 'quarterly budget', tenantId: 'org-1', encrypted: false });
    const [, tenantId, text] = events.messageSent.mock.calls[0] as unknown as [
      MessageDoc,
      string | null,
      string | undefined,
    ];
    expect(tenantId).toBe('org-1');
    expect(text).toBe('quarterly budget'); // server-readable → indexed
  });

  it('E2EE personal message NEVER leaks plaintext to the search index (§A18.2)', async () => {
    const { svc, events } = makeChat();
    // encrypted + no tenant → the ciphertext must not be carried as searchable text.
    await svc.send({ ...input, content: 'CIPHERTEXT', encrypted: true });
    const [, tenantId, text] = events.messageSent.mock.calls[0] as unknown as [
      MessageDoc,
      string | null,
      string | undefined,
    ];
    expect(tenantId).toBeNull();
    expect(text).toBeUndefined();
  });

  it('does not index plaintext even for a tenant conversation if it is marked encrypted', async () => {
    const { svc, events } = makeChat();
    await svc.send({ ...input, content: 'secret', tenantId: 'org-1', encrypted: true });
    const [, , text] = events.messageSent.mock.calls[0] as unknown as [
      MessageDoc,
      string | null,
      string | undefined,
    ];
    expect(text).toBeUndefined();
  });
});

/** Mongo duplicate-key error, as the driver raises it for either unique index on `messages`. */
const duplicateKey = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

describe('ChatService.send — seq collision backstop (DEF-01)', () => {
  it('retries with a fresh seq when the insert collides on (conversation_id, seq)', async () => {
    const { svc, repo, seq } = makeChat();
    // A duplicate-key with NO matching client_msg_id row can only be the seq index: the counter
    // handed out a value already taken (a cold-start race, or a counter restored behind reality).
    repo.insert.mockRejectedValueOnce(duplicateKey());
    seq.next.mockResolvedValueOnce(42).mockResolvedValueOnce(43);

    const ack = await svc.send(input);

    expect(ack.seq).toBe(43);
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });

  it('still returns the existing message when the collision IS a duplicate client_msg_id', async () => {
    const { svc, repo, seq } = makeChat();
    repo.insert.mockRejectedValueOnce(duplicateKey());
    repo.findByClientMsgId
      .mockResolvedValueOnce(null) // pre-insert dedupe check finds nothing
      .mockResolvedValueOnce({
        _id: 'm-winner',
        seq: 7,
        server_ts: '2026-01-01T00:00:00Z',
      } as MessageDoc);

    const ack = await svc.send(input);

    expect(ack).toEqual({ messageId: 'm-winner', seq: 7, serverTs: '2026-01-01T00:00:00Z' });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(seq.next).toHaveBeenCalledTimes(1);
  });

  it('gives up after bounded retries rather than looping forever', async () => {
    const { svc, repo } = makeChat();
    repo.insert.mockRejectedValue(duplicateKey());

    await expect(svc.send(input)).rejects.toThrow();

    expect(repo.insert.mock.calls.length).toBeGreaterThan(1);
    expect(repo.insert.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('does not retry a non-duplicate insert failure', async () => {
    const { svc, repo } = makeChat();
    repo.insert.mockRejectedValue(new Error('connection reset'));

    await expect(svc.send(input)).rejects.toThrow('connection reset');

    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
});
