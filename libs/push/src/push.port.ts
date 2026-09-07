export type Platform = 'web' | 'ios' | 'android';

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushTarget {
  platform: Platform;
  /** Mobile (FCM/APNs) device token. */
  token?: string;
  /** Web Push subscription (VAPID). */
  subscription?: WebPushSubscription;
}

/**
 * §B10 / §A19.
 *
 * The rule is not "never any content" — it is **never content the server cannot already read**.
 * For an E2EE personal chat the server holds only ciphertext, so the payload is a type plus ids
 * and the device fetches + decrypts locally on wake. Where the server already stores and indexes
 * the plaintext, a short preview is included so the notification can say something useful;
 * `feature-notification/src/notify/preview.ts` owns that decision and drops the preview the
 * moment a message is encrypted.
 *
 * Values are always strings — an FCM data payload carries no other type on the wire.
 */
export interface PushPayload {
  type: string;
  data?: Record<string, string>;
}

export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}
