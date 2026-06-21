import type { Logger } from '@velchat/shared-utils';
import type { Mailer, MailMessage } from './mailer.port';

/** Dev mailer — logs the email instead of sending. Never logs secret content in production. */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(msg: MailMessage): Promise<void> {
    this.logger.info({ to: msg.to, subject: msg.subject }, 'email (dev: not sent)');
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug({ text: msg.text, html: msg.html }, 'email body (dev only)');
    }
  }
}
