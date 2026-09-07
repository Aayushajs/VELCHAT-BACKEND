import type { PushSender, PushTarget, PushPayload } from '../push.port';

/**
 * Routes each push to the right transport by platform (§B10 / §A19): web → Web Push (VAPID),
 * ios/android → FCM, and anything unrouted → the fallback (dev log). One PushSender the caller uses
 * uniformly; the notification worker doesn't care which transport a device is on.
 */
export class CompositePushSender implements PushSender {
  readonly kind: string;

  constructor(
    private readonly routes: { web?: PushSender; mobile?: PushSender; fallback: PushSender },
  ) {
    // Names the transports that are REALLY wired, so "log" in this string is an unambiguous
    // signal that nothing will be delivered — rather than a shrug.
    const parts = [
      routes.mobile ? `mobile:${routes.mobile.kind}` : 'mobile:none',
      routes.web ? `web:${routes.web.kind}` : 'web:none',
    ];
    this.kind = parts.join(',');
  }

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
