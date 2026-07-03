import type { PushSender, PushTarget, PushPayload } from '../push.port';

/**
 * Routes each push to the right transport by platform (§B10 / §A19): web → Web Push (VAPID),
 * ios/android → FCM, and anything unrouted → the fallback (dev log). One PushSender the caller uses
 * uniformly; the notification worker doesn't care which transport a device is on.
 */
export class CompositePushSender implements PushSender {
  constructor(
    private readonly routes: { web?: PushSender; mobile?: PushSender; fallback: PushSender },
  ) {}

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    const sender =
      target.platform === 'web'
        ? this.routes.web
        : target.platform === 'ios' || target.platform === 'android'
          ? this.routes.mobile
          : undefined;
    await (sender ?? this.routes.fallback).send(target, payload);
  }
}
