import type { AppConfig } from '@velchat/config';
import type { Logger } from '@velchat/common';
import type { Mailer } from './mailer.port';
import { LogMailer } from './log.mailer';
import { SmtpMailer } from './smtp.mailer';

/** Pick the mailer from config: SMTP (Postfix) when SMTP_URL is set, else dev log. */
export function createMailer(config: AppConfig, logger: Logger): Mailer {
  if (config.SMTP_URL) {
    return new SmtpMailer(config.SMTP_URL, config.MAIL_FROM);
  }
  logger.warn('SMTP_URL not set — using LogMailer (emails are logged, not sent)');
  return new LogMailer(logger);
}
