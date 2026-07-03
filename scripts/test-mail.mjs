// Verify the mail wiring (@velchat/mail): builds the SAME mailer a service builds from config and
// sends one message. With SMTP_URL set → a real email is delivered; without it → LogMailer logs the
// message (so this always demonstrates the code path, and proves real delivery once keys are set).
//
//   node scripts/test-mail.mjs [recipient@example.com]
import { boot, ui, done } from './_shared.mjs';
import { createMailer, welcomeEmail, verificationCodeEmail, magicLinkEmail } from '@velchat/mail';

const { config, logger } = boot('test-mail');
const to = process.argv[2] || config.MAIL_FROM || 'test@example.com';
// Which branded template to preview: welcome (default) | verify | magic
const which = (process.argv[3] || 'welcome').toLowerCase();
const template =
  which === 'verify'
    ? verificationCodeEmail({ code: '481920', expiresMinutes: 10 })
    : which === 'magic'
      ? magicLinkEmail({ url: 'https://velchat.app/auth/magic/verify?token=demo', expiresMinutes: 15 })
      : welcomeEmail({ name: 'there' });

ui.title('Mail (@velchat/mail)');
ui.info(`template: ${which}  ·  subject: "${template.subject}"`);
const mode = config.SMTP_URL ? 'SMTP (real send)' : 'LogMailer (dev — logs only)';
ui.info(`transport: ${mode}  →  to: ${to}`);

let failed = false;
let mailer;
try {
  // A malformed SMTP_URL throws here (in the transport constructor), not on send — catch it cleanly.
  mailer = createMailer(config, logger);
} catch (err) {
  ui.fail(`Bad SMTP_URL: ${err instanceof Error ? err.message : String(err)}`);
  ui.info('Format: smtp://USER:PASS@host:587 — URL-encode any @ / : in USER or PASS (@ → %40).');
  done(true);
}

try {
  await mailer.send({ to, ...template });
  if (config.SMTP_URL) {
    ui.ok(`Sent via SMTP — check the inbox for ${to}.`);
  } else {
    ui.ok('LogMailer path works. Set SMTP_URL in .env to send real email.');
  }
} catch (err) {
  failed = true;
  ui.fail(`SMTP send failed: ${err instanceof Error ? err.message : String(err)}`);
  ui.info('Check SMTP_URL (smtps://user:pass@host:465) and that the host allows this sender.');
}
done(failed);
