/**
 * Ready-to-send VelChat email templates. Each returns { subject, html, text } so callers do:
 *   await mailer.send({ to, ...verificationCodeEmail({ code, expiresMinutes: 10 }) })
 * All content flows through the branded layout (layout.ts) for a consistent, professional look.
 */
import { renderEmail, renderText, type EmailContent, type EmailLayoutInput } from './layout';

export { renderEmail, renderText } from './layout';
export type { EmailContent, EmailLayoutInput, Cta } from './layout';

function build(subject: string, layout: EmailLayoutInput): EmailContent {
  return { subject, html: renderEmail(layout), text: renderText(layout) };
}

/** One-time verification / OTP code (§B2 email fallback). */
export function verificationCodeEmail(input: {
  code: string;
  expiresMinutes?: number;
}): EmailContent {
  const mins = input.expiresMinutes ?? 10;
  return build('Your VelChat verification code', {
    preheader: `Your code is ${input.code} — expires in ${mins} minutes.`,
    heading: 'Verify your account',
    subtitle: 'Enter this code in the app to continue signing in.',
    code: input.code,
    note: `This code expires in ${mins} minutes and can be used once.`,
    paragraphs: ['Never share this code with anyone — VelChat staff will never ask for it.'],
    footerNote: 'You received this because someone requested a sign-in code for your account.',
  });
}

/** Passwordless magic sign-in link (§B2.5 DAPT fallback). */
export function magicLinkEmail(input: { url: string; expiresMinutes?: number }): EmailContent {
  const mins = input.expiresMinutes ?? 15;
  return build('Your VelChat sign-in link', {
    preheader: `Tap to sign in to VelChat — link expires in ${mins} minutes.`,
    heading: 'Sign in to VelChat',
    subtitle: 'Tap the button below to securely sign in to your account.',
    cta: { label: 'Sign in to VelChat', url: input.url },
    note: `This link expires in ${mins} minutes and works only once.`,
    paragraphs: ["If you didn't request this, you can safely ignore this email."],
    footerNote: 'You received this because a sign-in link was requested for your account.',
  });
}

/** Welcome after first successful registration. */
export function welcomeEmail(input: { name?: string } = {}): EmailContent {
  const hi = input.name ? `Welcome, ${input.name}!` : 'Welcome to VelChat!';
  return build('Welcome to VelChat', {
    preheader: 'Your VelChat account is ready — encrypted messaging, calls and more.',
    heading: hi,
    subtitle: 'Your account is ready to go.',
    paragraphs: [
      'VelChat gives you end-to-end encrypted chats, voice & video calls, status, and workspaces — all in one place.',
      'Add a profile photo and start a conversation to get going.',
    ],
    footerNote: 'You received this because a VelChat account was created with this email.',
  });
}

/** Security alert (new device, recovery started, number change, etc.). */
export function securityAlertEmail(input: {
  event: string;
  when: string;
  ip?: string;
}): EmailContent {
  return build('VelChat security alert', {
    preheader: `Security alert: ${input.event}`,
    heading: 'Security alert',
    subtitle: input.event,
    paragraphs: [
      `When: ${input.when}${input.ip ? `  ·  IP: ${input.ip}` : ''}`,
      "If this was you, no action is needed. If it wasn't, secure your account immediately from a trusted device.",
    ],
    footerNote: 'You received this because your account has security notifications enabled.',
  });
}

/** Generic notification with an optional CTA (used by notification-service digests, etc.). */
export function notificationEmail(input: {
  title: string;
  message: string;
  ctaText?: string;
  ctaUrl?: string;
}): EmailContent {
  return build(input.title, {
    preheader: input.message.slice(0, 90),
    heading: input.title,
    subtitle: input.message,
    cta: input.ctaText && input.ctaUrl ? { label: input.ctaText, url: input.ctaUrl } : undefined,
    paragraphs: [],
    footerNote: 'You received this based on your VelChat notification preferences.',
  });
}
