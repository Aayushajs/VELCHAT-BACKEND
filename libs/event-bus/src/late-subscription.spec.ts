import { pendingSubscriptions } from './late-subscription';

/**
 * A consumer that subscribes AFTER the bus has started must still receive events.
 *
 * This is not hypothetical. In the consolidated single-process build the composition root starts
 * the bus during application bootstrap, and the realtime fan-out consumer is wired afterwards —
 * it needs the HTTP server, which does not exist until the app is created. `start()` returned
 * early on the second call, so those subscriptions never got a reader: `message.sent`,
 * `message.read` and `conversation.created` were published and consumed by nobody.
 *
 * The symptom is the worst kind. Messages are stored, the POST returns 201, the socket stays open
 * and healthy, health checks are green — and not one frame is ever pushed. Realtime looks broken
 * with nothing anywhere reporting an error.
 */
describe('pendingSubscriptions', () => {
  const sub = (topic: string, groupId: string) => ({ topic, groupId });

  it('reports subscriptions that no reader covers yet', () => {
    const all = [sub('message.sent', 'realtime'), sub('message.read', 'realtime')];
    expect(pendingSubscriptions(all, [])).toEqual(all);
  });

  it('reports nothing once every topic is covered', () => {
    const all = [sub('message.sent', 'realtime')];
    expect(pendingSubscriptions(all, [{ groupId: 'realtime', topics: ['message.sent'] }])).toEqual(
      [],
    );
  });

  it('reports only the topics added after the bus started', () => {
    const all = [sub('chat.indexed', 'search'), sub('message.sent', 'realtime')];
    const started = [{ groupId: 'search', topics: ['chat.indexed'] }];
    expect(pendingSubscriptions(all, started)).toEqual([sub('message.sent', 'realtime')]);
  });

  it('treats the same topic in a DIFFERENT group as uncovered', () => {
    // Consumer groups read independently: search having a reader for a topic says nothing about
    // whether realtime does.
    const all = [sub('message.sent', 'realtime')];
    const started = [{ groupId: 'search', topics: ['message.sent'] }];
    expect(pendingSubscriptions(all, started)).toEqual(all);
  });

  it('does not report a duplicate subscription twice', () => {
    const all = [sub('message.sent', 'realtime'), sub('message.sent', 'realtime')];
    expect(pendingSubscriptions(all, [])).toEqual([sub('message.sent', 'realtime')]);
  });
});
