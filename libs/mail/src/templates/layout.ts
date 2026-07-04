/**
 * Branded, email-client-safe HTML layout for all VelChat transactional mail.
 *
 * Clean, centered, premium style (à la ChatGPT/Linear/Stripe): white background, a centered brand
 * wordmark, a big bold heading, a prominent pill CTA, and generous whitespace. Email clients strip
 * <head> styles, ignore flexbox/grid, and need table layout + inline styles — so this uses exactly
 * that. The button is "bulletproof" (VML for Outlook). A hidden preheader controls the preview line.
 */

const BRAND = {
  name: 'VelChat',
  primary: '#4F46E5', // indigo-600 (pill button + wordmark accent)
  ink: '#0D0D0D', // near-black headings (ChatGPT-like)
  body: '#3C3C43', // body text
  muted: '#8A8A8F', // footer / secondary
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
  /** Inbox preview line (hidden in the body). Keep < ~90 chars. */
  preheader: string;
  /** Big centered heading. */
  heading: string;
  /** One-line subtitle under the heading (muted). Optional. */
  subtitle?: string;
  /** Body paragraph(s) below the CTA — plain strings, rendered as centered <p>. */
  paragraphs: string[];
  /** Optional call-to-action pill button. */
  cta?: Cta;
  /** Optional monospace box (e.g. an OTP code) shown prominently. */
  code?: string;
  /** Optional small note under the CTA (e.g. "link expires in 15 minutes"). */
  note?: string;
  /** Optional footer line specific to this email (why you received it). */
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

/** Bulletproof pill button (renders in Outlook via VML, everything else via the <a>). */
function button(cta: Cta): string {
  const url = esc(cta.url);
  const label = esc(cta.label);
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:8px auto 4px;">
    <tr><td align="center" bgcolor="${BRAND.primary}" style="border-radius:999px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:240px;" arcsize="50%" fillcolor="${BRAND.primary}" stroke="f"><w:anchorlock/><center style="color:#ffffff;font-family:${FONT};font-size:16px;font-weight:600;"><![endif]-->
      <a href="${url}" target="_blank" style="display:inline-block;padding:15px 40px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
      <!--[if mso]></center></v:roundrect><![endif]-->
    </td></tr>
  </table>`;
}

function codeBox(code: string): string {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:8px auto;">
    <tr><td align="center" style="border:1px solid ${BRAND.border};border-radius:12px;padding:18px 40px;">
      <span style="font-family:'SF Mono',Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:10px;color:${BRAND.ink};">${esc(code)}</span>
    </td></tr>
  </table>`;
}

/** Render the full branded HTML email (clean, centered). */
export function renderEmail(input: EmailLayoutInput): string {
  const paras = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.65;color:${BRAND.body};">${esc(p)}</p>`,
    )
    .join('\n');

  const subtitle = input.subtitle
    ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:18px;line-height:1.5;color:${BRAND.body};">${esc(input.subtitle)}</p>`
    : '';

  const footerNote = input.footerNote
    ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${BRAND.muted};font-family:${FONT};">${esc(input.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${esc(BRAND.name)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg};">
    <tr><td align="center" style="padding:48px 20px 40px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="width:560px;max-width:100%;">

        <!-- brand wordmark (centered) -->
        <tr><td align="center" style="padding:0 0 40px;">
          <span style="font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.4px;color:${BRAND.primary};">Vel<span style="color:${BRAND.ink};">Chat</span></span>
        </td></tr>

        <!-- heading + subtitle (centered) -->
        <tr><td align="center" style="padding:0 8px;">
          <h1 style="margin:0 0 16px;font-family:${FONT};font-size:34px;line-height:1.2;font-weight:700;color:${BRAND.ink};">${esc(input.heading)}</h1>
          ${subtitle}
        </td></tr>

        <!-- code / cta (centered) -->
        <tr><td align="center" style="padding:24px 8px 0;">
          ${input.code ? codeBox(input.code) : ''}
          ${input.cta ? button(input.cta) : ''}
          ${input.note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${BRAND.muted};font-family:${FONT};">${esc(input.note)}</p>` : ''}
        </td></tr>

        <!-- body (centered, readable) -->
        <tr><td align="center" style="padding:32px 8px 0;">
          <div style="max-width:440px;margin:0 auto;">${paras}</div>
        </td></tr>

        <!-- divider -->
        <tr><td style="padding:36px 8px 0;"><div style="border-top:1px solid ${BRAND.border};height:1px;line-height:1px;">&nbsp;</div></td></tr>

        <!-- footer (centered) -->
        <tr><td align="center" style="padding:20px 8px 0;">
          ${footerNote}
          <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};font-family:${FONT};">© 2026 ${esc(BRAND.name)} — free, open-source, self-hostable messaging.<br>If this wasn't you, you can safely ignore this email.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback from the same structured input (never rely on stripping HTML). */
export function renderText(input: EmailLayoutInput): string {
  const lines: string[] = [BRAND.name, '', input.heading, ''];
  if (input.subtitle) lines.push(input.subtitle, '');
  if (input.code) lines.push(`Code: ${input.code}`, '');
  if (input.cta) lines.push(`${input.cta.label}: ${input.cta.url}`, '');
  if (input.note) lines.push(input.note, '');
  lines.push(...input.paragraphs);
  lines.push('', '—', `© 2026 ${BRAND.name}. If this wasn't you, ignore this email.`);
  return lines.join('\n');
}
