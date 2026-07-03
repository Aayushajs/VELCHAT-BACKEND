export type { Mailer, MailMessage } from './mailer.port';
export { LogMailer } from './log.mailer';
export { SmtpMailer } from './smtp.mailer';
export { createMailer } from './create-mailer';

// Branded, email-client-safe templates (§B2 auth mails, notifications). Each returns
// { subject, html, text } → mailer.send({ to, ...template(...) }).
export {
  renderEmail,
  renderText,
  verificationCodeEmail,
  magicLinkEmail,
  welcomeEmail,
  securityAlertEmail,
  notificationEmail,
} from './templates';
export type { EmailContent, EmailLayoutInput, Cta } from './templates';
