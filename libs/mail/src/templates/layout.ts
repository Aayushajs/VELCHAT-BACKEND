/**
 * Branded, deliverability-optimized HTML layout for VelChat transactional mail.
 *
 * Kept intentionally LEAN to lower spam score:
 *  - no hidden/preheader text (display:none + opacity:0 is a known spam trigger),
 *  - no Outlook VML button / MSO conditional comments (flagged by naive filters),
 *  - minimal nesting + inline CSS, valid HTML, and a strong plain-text alternative (renderText),
 *  - one clear link whose visible text matches its purpose.
 * Still clean + centered (brand wordmark, big heading, subtitle, pill CTA) and email-client-safe.
 */

const BRAND = {
  name: 'VelChat',
  primary: '#4F46E5',
  ink: '#0D0D0D',
  body: '#3C3C43',
  muted: '#8A8A8F',
  border: '#ECECF1',
  bg: '#FFFFFF',
} as const;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface Cta {
  label: string;
  url: string;
}

export interface EmailLayoutInput {
  /** Kept for API compatibility; NOT rendered as hidden text (avoids spam trigger). */
  preheader?: string;
  heading: string;
  subtitle?: string;
  paragraphs: string[];
  cta?: Cta;
  code?: string;
  note?: string;
  footerNote?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Brand header: a logo <img> when MAIL_LOGO_URL is set (read at render time — .env is loaded by
 * @velchat/config before any mail is sent), else the "VelChat" text wordmark. A single small hosted
 * logo is deliverability-safe; a data-URI/oversized image is not, so we require a hosted URL.
 */
function brandHeader(): string {
  const logo = process.env.MAIL_LOGO_URL;
  const wordmark = `<span style="font-size:22px;font-weight:800;color:${BRAND.primary};vertical-align:middle;">Vel<span style="color:${BRAND.ink};">Chat</span></span>`;
  if (logo && /^https?:\/\//.test(logo)) {
    // Circular logo + wordmark side by side (like ChatGPT's header). border-radius rounds the image.
    return `<img src="${esc(logo)}" alt="VelChat" width="48" height="48" style="width:48px;height:48px;border-radius:50%;vertical-align:middle;border:0;outline:none;">&nbsp;&nbsp;${wordmark}`;
  }
  return wordmark;
}

/** Footer: a circular logo (→ website) + LinkedIn icon, and a support link (→ website). */
function footerLinks(): string {
  const web = process.env.MAIL_WEBSITE_URL || 'https://velcart.netlify.app/';
  const linkedin = process.env.MAIL_LINKEDIN_URL || 'https://www.linkedin.com/company/velcart/';
  const support = process.env.MAIL_SUPPORT_TEXT || 'support@velcart.com';
  const logo = process.env.MAIL_LOGO_URL;
  const webIcon =
    logo && /^https?:\/\//.test(logo)
      ? `<img src="${esc(logo)}" alt="Website" width="24" height="24" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;border:0;outline:none;">`
      : `<span style="font-size:20px;vertical-align:middle;">🌐</span>`;
  return `
  <div style="margin:0 0 12px;">
    <a href="${esc(web)}" title="Website" style="text-decoration:none;vertical-align:middle;">${webIcon}</a>
    &nbsp;&nbsp;
    <a href="${esc(linkedin)}" title="LinkedIn" style="text-decoration:none;vertical-align:middle;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;background:#0A66C2;color:#ffffff;border-radius:6px;font-size:13px;font-weight:700;text-align:center;font-family:${FONT};">in</span></a>
  </div>
  <p style="margin:0 0 12px;font-size:13px;">
    <a href="${esc(web)}" style="color:${BRAND.muted};text-decoration:underline;">${esc(support)}</a>
  </p>`;
}

/** Render a lean, centered HTML email (no hidden text, no VML). */
export function renderEmail(input: EmailLayoutInput): string {
  const paras = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BRAND.body};">${esc(p)}</p>`,
    )
    .join('');

  const subtitle = input.subtitle
    ? `<p style="margin:0 0 24px;font-size:17px;line-height:1.5;color:${BRAND.body};">${esc(input.subtitle)}</p>`
    : '';

  const code = input.code
    ? `<div style="margin:8px 0 20px;padding:16px 32px;border:1px solid ${BRAND.border};border-radius:10px;font-family:Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};">${esc(input.code)}</div>`
    : '';

  const cta = input.cta
    ? `<a href="${esc(input.cta.url)}" style="display:inline-block;margin:4px 0 8px;padding:14px 36px;background:${BRAND.primary};color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:999px;">${esc(input.cta.label)}</a>`
    : '';

  const note = input.note
    ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:${BRAND.muted};">${esc(input.note)}</p>`
    : '';

  const footerNote = input.footerNote
    ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${BRAND.muted};">${esc(input.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
    <tr><td align="center" style="padding:44px 20px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;text-align:center;">
        <tr><td style="padding-bottom:36px;">${brandHeader()}</td></tr>
        <tr><td>
          <h1 style="margin:0 0 14px;font-size:30px;line-height:1.25;font-weight:700;color:${BRAND.ink};">${esc(input.heading)}</h1>
          ${subtitle}
          ${code}
          ${cta}
          ${note}
          <div style="max-width:420px;margin:24px auto 0;">${paras}</div>
        </td></tr>
        <tr><td style="padding-top:32px;border-top:1px solid ${BRAND.border};"></td></tr>
        <tr><td style="padding-top:16px;">
          ${footerNote}
          ${footerLinks()}
          <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">© 2026 ${esc(BRAND.name)} — free, open-source, self-hostable messaging.<br>If this wasn't you, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Plain-text alternative — a good text part improves the text/HTML ratio and lowers spam score. */
export function renderText(input: EmailLayoutInput): string {
  const lines: string[] = [BRAND.name, '', input.heading, ''];
  if (input.subtitle) lines.push(input.subtitle, '');
  if (input.code) lines.push(`Code: ${input.code}`, '');
  if (input.cta) lines.push(`${input.cta.label}: ${input.cta.url}`, '');
  if (input.note) lines.push(input.note, '');
  lines.push(...input.paragraphs);
  const web = process.env.MAIL_WEBSITE_URL || 'https://velcart.netlify.app/';
  const support = process.env.MAIL_SUPPORT_TEXT || 'support@velcart.com';
  lines.push(
    '',
    '—',
    `${support}: ${web}`,
    `© 2026 ${BRAND.name}. If this wasn't you, ignore this email.`,
  );
  return lines.join('\n');
}
