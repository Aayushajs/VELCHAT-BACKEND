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

/**
 * A send that failed, carrying enough for the caller to decide what to do about it.
 *
 * The distinction that matters is `gone`: FCM answers 404/`UNREGISTERED` for a token belonging to
 * an app that was uninstalled, cleared, or signed out (which deletes the token). That endpoint
 * will NEVER succeed, so retrying it re-fails the whole notification on every attempt — and since
 * the sends run in parallel, each retry re-delivers to the endpoints that DID work. One stale row
 * therefore turns into a stream of duplicate notifications on the user's live phone.
 *
 * `retryable` is the opposite case — a 5xx or a network blip — where the same send later is the
 * correct response.
 */
export class PushSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The endpoint is permanently invalid and should be removed. */
    readonly gone: boolean,
  ) {
    super(message);
    this.name = 'PushSendError';
  }

  /** Anything that is not `gone` and not a client error is worth another attempt. */
  get retryable(): boolean {
    return !this.gone && (this.status === 0 || this.status >= 500);
  }
}

export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<void>;

  /**
   * Which transport this actually is — `fcm`, `webpush`, `log`, or a composite's summary.
   *
   * Exists because a misconfigured deployment is INVISIBLE from the outside: with no `FCM_*`
   * env, `createPushRouter` silently returns `LogPushSender`, every push is "sent" successfully,
   * and no device ever hears anything. That failure has cost real debugging time, so the
   * answer is now something a caller can read and report.
   */
  readonly kind: string;
}
