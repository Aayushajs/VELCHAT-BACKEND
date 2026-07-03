import type { AppConfig } from '@velchat/config';
import type { Logger } from '@velchat/common';
import type { PushSender } from './push.port';
import { WebPushSender } from './adapters/webpush.sender';
import { FcmSender } from './adapters/fcm.sender';
import { LogPushSender } from './adapters/log.sender';
import { CompositePushSender } from './adapters/composite.sender';
import { createGoogleAccessToken } from './fcm-token';

/**
 * Web Push sender from config: real VAPID sender when keys are set, else a dev log sender.
 */
export function createWebPush(config: AppConfig, logger: Logger): PushSender {
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    return new WebPushSender({
      publicKey: config.VAPID_PUBLIC_KEY,
      privateKey: config.VAPID_PRIVATE_KEY,
      subject: config.VAPID_SUBJECT,
    });
  }
  logger.warn('VAPID keys not set — using LogPushSender (push is logged, not sent)');
  return new LogPushSender(logger);
}

/**
 * Platform-routing push sender from config (§B10): web → Web Push (VAPID), ios/android → FCM HTTP v1
 * (service-account creds from env — never the JSON in the repo), everything else → dev log. This is
 * what notification-service uses so a single sender handles every device.
 */
export function createPushRouter(config: AppConfig, logger: Logger): PushSender {
  const fallback = new LogPushSender(logger);

  const web =
    config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
      ? new WebPushSender({
          publicKey: config.VAPID_PUBLIC_KEY,
          privateKey: config.VAPID_PRIVATE_KEY,
          subject: config.VAPID_SUBJECT,
        })
      : undefined;

  const mobile =
    config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY
      ? new FcmSender(
          config.FCM_PROJECT_ID,
          createGoogleAccessToken({
            clientEmail: config.FCM_CLIENT_EMAIL,
            privateKey: config.FCM_PRIVATE_KEY,
          }),
        )
      : undefined;

  if (!web && !mobile) {
    logger.warn('no push transports configured (VAPID/FCM) — using LogPushSender');
    return fallback;
  }
  logger.info({ web: !!web, fcm: !!mobile }, 'push router configured');
  return new CompositePushSender({ web, mobile, fallback });
}
