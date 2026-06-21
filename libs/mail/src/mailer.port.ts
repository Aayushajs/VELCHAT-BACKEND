export interface MailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

/** Transactional email port. Adapters: SMTP (Postfix, prod) and Log (dev). */
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}
