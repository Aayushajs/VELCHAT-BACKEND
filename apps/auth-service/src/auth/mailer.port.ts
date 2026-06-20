import type { Logger } from 'pino';

/** Mailer port — prod: nodemailer → self-hosted Postfix SMTP (§A3.5). Dev: log only. */
export interface MailerPort {
  sendMagicLink(email: string, link: string): Promise<void>;
}

export class LogMailer implements MailerPort {
  constructor(private readonly logger: Logger) {}

  async sendMagicLink(email: string, link: string): Promise<void> {
    this.logger.info({ email }, 'magic-link issued');
    // Never log the link in production (it is a bearer credential).
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug({ link }, 'magic link (dev only)');
    }
  }
}
