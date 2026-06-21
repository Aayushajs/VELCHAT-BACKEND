import type { AppConfig } from '@velchat/config';
import type { Logger } from '@velchat/shared-utils';
import type { PushSender } from './push.port';
import { WebPushSender } from './adapters/webpush.sender';
import { LogPushSender } from './adapters/log.sender';

/**
 * Web Push sender from config: real VAPID sender when keys are set, else a dev log sender.
 * (Mobile FCM/APNs senders are constructed in notification-service with their token providers, P7.)
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
