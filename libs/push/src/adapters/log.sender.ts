import type { Logger } from '@velchat/common';
import type { PushSender, PushTarget, PushPayload } from '../push.port';

/** Dev push sender — logs instead of sending (no transport configured). */
export class LogPushSender implements PushSender {
  constructor(private readonly logger: Logger) {}

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    this.logger.info({ platform: target.platform, type: payload.type }, 'push (dev: not sent)');
  }
}
