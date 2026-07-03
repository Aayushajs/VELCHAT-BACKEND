import { CompositePushSender } from '@velchat/push';
import type { PushSender, PushTarget } from '@velchat/push';

function spySender(): PushSender & { calls: PushTarget[] } {
  const calls: PushTarget[] = [];
  return { calls, send: async (t: PushTarget) => void calls.push(t) };
}

describe('CompositePushSender (§B10 platform routing)', () => {
  it('routes web → web, ios/android → mobile', async () => {
    const web = spySender();
    const mobile = spySender();
    const fallback = spySender();
    const c = new CompositePushSender({ web, mobile, fallback });
    await c.send(
      { platform: 'web', subscription: { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } } },
      { type: 'message' },
    );
    await c.send({ platform: 'android', token: 't1' }, { type: 'message' });
    await c.send({ platform: 'ios', token: 't2' }, { type: 'call' });
    expect(web.calls).toHaveLength(1);
    expect(mobile.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
  });

  it('falls back when a platform has no transport configured', async () => {
    const fallback = spySender();
    const c = new CompositePushSender({ fallback });
    await c.send({ platform: 'android', token: 't' }, { type: 'message' });
    expect(fallback.calls).toHaveLength(1);
  });
});
