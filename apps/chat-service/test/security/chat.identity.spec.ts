import { ForbiddenError } from '@velchat/common';
import { ChatController } from '../../src/chat/chat.controller';

/**
 * DEF-02: `POST /chat/messages` took `senderId` from the REQUEST BODY and chat-service had no
 * guard at all, so anyone could post as anyone into any conversation. These tests pin the rule
 * that the acting identity comes from the verified token — for every endpoint on this controller,
 * not just `send`, because the same body-supplied-identity shape appears on all of them.
 */
function makeController() {
  const chat = {
    send: jest.fn(async () => ({ messageId: 'm-1', seq: 1, serverTs: 'ts' })),
    react: jest.fn(async () => ({ message: 'ok' })),
    unreact: jest.fn(async () => ({ message: 'ok' })),
    edit: jest.fn(async () => ({ messageId: 'm-1', editedAt: 'ts' })),
    delete: jest.fn(async () => ({ message: 'ok' })),
    history: jest.fn(async () => []),
  };
  return { ctrl: new ChatController(chat as never), chat };
}

const ME = 'acc-me';
const VICTIM = 'acc-victim';

/**
 * Assert the call is refused, whether it throws synchronously or rejects. What matters is that the
 * request is refused and never reaches the service — not which of the two shapes Nest sees, since
 * its exception filter maps both to the same 403.
 */
async function expectRefused(call: () => unknown): Promise<void> {
  await expect(Promise.resolve().then(call)).rejects.toBeInstanceOf(ForbiddenError);
}

describe('ChatController — identity comes from the token, never the body (DEF-02)', () => {
  it('sends as the authenticated account when the body agrees', async () => {
    const { ctrl, chat } = makeController();
    await ctrl.send(ME, {
      conversationId: 'conv-1',
      senderId: ME,
      clientMsgId: 'cm-1',
      content: 'x',
    } as never);
    expect(chat.send.mock.calls[0]?.[0]).toMatchObject({ senderId: ME });
  });

  it('sends as the authenticated account when the body omits senderId', async () => {
    const { ctrl, chat } = makeController();
    await ctrl.send(ME, { conversationId: 'conv-1', clientMsgId: 'cm-1', content: 'x' } as never);
    expect(chat.send.mock.calls[0]?.[0]).toMatchObject({ senderId: ME });
  });

  it('refuses a send that claims someone else as the sender', async () => {
    const { ctrl, chat } = makeController();
    await expectRefused(() =>
      ctrl.send(ME, {
        conversationId: 'conv-1',
        senderId: VICTIM,
        clientMsgId: 'cm-1',
        content: 'x',
      } as never),
    );
    expect(chat.send).not.toHaveBeenCalled();
  });

  it('refuses a reaction attributed to someone else', async () => {
    const { ctrl, chat } = makeController();
    await expectRefused(() =>
      ctrl.react('m-1', ME, { conversationId: 'conv-1', userId: VICTIM, emoji: '👍' } as never),
    );
    expect(chat.react).not.toHaveBeenCalled();
  });

  it('refuses removing a reaction attributed to someone else', async () => {
    const { ctrl, chat } = makeController();
    await expectRefused(() =>
      ctrl.unreact('m-1', ME, { conversationId: 'conv-1', userId: VICTIM, emoji: '👍' } as never),
    );
    expect(chat.unreact).not.toHaveBeenCalled();
  });

  it('refuses an edit attributed to someone else', async () => {
    const { ctrl, chat } = makeController();
    await expectRefused(() =>
      ctrl.edit('m-1', ME, { conversationId: 'conv-1', editorId: VICTIM, content: 'x' } as never),
    );
    expect(chat.edit).not.toHaveBeenCalled();
  });

  it('refuses a delete attributed to someone else', async () => {
    const { ctrl, chat } = makeController();
    await expectRefused(() =>
      ctrl.del('m-1', ME, {
        conversationId: 'conv-1',
        actorId: VICTIM,
        scope: 'everyone',
      } as never),
    );
    expect(chat.delete).not.toHaveBeenCalled();
  });

  it('passes the authenticated account through on edit and delete', async () => {
    const { ctrl, chat } = makeController();
    await ctrl.edit('m-1', ME, { conversationId: 'conv-1', content: 'x' } as never);
    await ctrl.del('m-1', ME, { conversationId: 'conv-1', scope: 'me' } as never);
    expect(chat.edit.mock.calls[0]?.[0]).toMatchObject({ editorId: ME });
    expect(chat.delete.mock.calls[0]?.[0]).toMatchObject({ actorId: ME });
  });
});
