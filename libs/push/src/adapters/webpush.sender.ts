import webpush from 'web-push';
import type { PushSender, PushTarget, PushPayload } from '../push.port';

/** Web Push (VAPID) — open standard, no third party (§A3.5). */
export class WebPushSender implements PushSender {
  constructor(vapid: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    if (!target.subscription) throw new Error('Web Push requires a subscription');
    await webpush.sendNotification(target.subscription, JSON.stringify(payload));
  }
}
