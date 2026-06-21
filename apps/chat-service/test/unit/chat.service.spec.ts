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
});
