import { PushSendError } from '../push.port';
import type { PushSender, PushTarget, PushPayload } from '../push.port';

/**
 * FCM HTTP v1 sender (Android/iOS via FCM). Free transport (§A3.5). The OAuth access token comes
 * from a service-account token provider (wired in notification-service, P7). Payload is data-only
 * for E2EE chats — no content (§B10).
 */
export class FcmSender implements PushSender {
  readonly kind = 'fcm';

  constructor(
    private readonly projectId: string,
    private readonly accessToken: () => Promise<string>,
  ) {}

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    if (!target.token) throw new Error('FCM requires a device token');
    const token = await this.accessToken();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: target.token,
            data: { type: payload.type, ...(payload.data ?? {}) },
            android: { priority: 'high' },
          },
        }),
      },
    );
    if (!res.ok) {
      // 404 = UNREGISTERED: the token belonged to an install that is gone (uninstalled, data
      // cleared, or signed out — which deletes the token). 400 = INVALID_ARGUMENT: the token is
      // malformed and will never become valid. Both mean "delete this endpoint", and FCM's own
      // guidance is to prune on them rather than keep paying for the failure.
      const gone = res.status === 404 || res.status === 400;
      throw new PushSendError(`FCM send failed: ${res.status}`, res.status, gone);
    }
  }
}
