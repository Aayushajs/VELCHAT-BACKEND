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
 * §B10 / §A19: for E2EE personal chats the payload carries NO content — only a type and ids
 * (e.g. conversation id). The device fetches + decrypts locally on wake.
 */
export interface PushPayload {
  type: string;
  data?: Record<string, string>;
}

export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}
