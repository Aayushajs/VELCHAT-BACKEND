import webpush from 'web-push';
import { PushSendError } from '../push.port';
import type { PushSender, PushTarget, PushPayload } from '../push.port';

/** Web Push (VAPID) — open standard, no third party (§A3.5). */
export class WebPushSender implements PushSender {
  readonly kind = 'webpush';

  constructor(vapid: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    if (!target.subscription) throw new Error('Web Push requires a subscription');
    try {
      await webpush.sendNotification(target.subscription, JSON.stringify(payload));
    } catch (err) {
      // 404/410 Gone is how a browser reports a subscription the user has revoked — the Web Push
      // equivalent of FCM's UNREGISTERED, and equally permanent.
      const status = Number((err as { statusCode?: number }).statusCode ?? 0);
      throw new PushSendError(
        `Web Push send failed: ${status || 'network'}`,
        status,
        status === 404 || status === 410,
      );
    }
  }
}
