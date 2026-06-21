import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from './mailer.port';

/** SMTP mailer (self-hosted Postfix, §A3.5). `smtpUrl` e.g. smtp://user:pass@host:587. */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(msg: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}
