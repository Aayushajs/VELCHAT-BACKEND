/**
 * Branded, email-client-safe HTML layout for all VelChat transactional mail.
 *
 * Email clients (Gmail, Outlook, Apple Mail) strip <head> styles, ignore flexbox/grid, and need
 * table-based layout + inline styles to render consistently — so this uses exactly that. The button
 * is "bulletproof" (VML for Outlook). A hidden preheader controls the inbox preview line.
 */

const BRAND = {
  name: 'VelChat',
  primary: '#4F46E5', // indigo-600
  primaryDark: '#4338CA',
  ink: '#0F172A', // slate-900
  body: '#334155', // slate-700
  muted: '#64748B', // slate-500
  border: '#E2E8F0', // slate-200
  bg: '#F1F5F9', // slate-100
  card: '#FFFFFF',
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
  /** Big heading at the top of the card. */
  heading: string;
  /** Intro paragraph(s) — plain strings, rendered as <p>. */
  paragraphs: string[];
  /** Optional call-to-action button. */
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

/** Bulletproof button (renders in Outlook via VML, everything else via the <a>). */
function button(cta: Cta): string {
  const url = esc(cta.url);
  const label = esc(cta.label);
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
    <tr><td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:280px;" arcsize="17%" fillcolor="${BRAND.primary}" stroke="f"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;"><![endif]-->
      <a href="${url}" target="_blank" style="display:inline-block;padding:13px 32px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
      <!--[if mso]></center></v:roundrect><![endif]-->
    </td></tr>
  </table>`;
}

function codeBox(code: string): string {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:24px 0;">
    <tr><td align="center" bgcolor="${BRAND.bg}" style="border:1px solid ${BRAND.border};border-radius:10px;padding:20px;">
      <span style="font-family:'Courier New',Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};">${esc(code)}</span>
    </td></tr>
  </table>`;
}

/** Render the full branded HTML email. */
export function renderEmail(input: EmailLayoutInput): string {
  const paras = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:${BRAND.body};">${esc(p)}</p>`,
    )
    .join('\n');

  const year = '2026'; // server-authoritative; avoids Date in shared code paths
  const footerNote = input.footerNote
    ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${BRAND.muted};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(input.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(BRAND.name)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="width:600px;max-width:100%;">
        <!-- header -->
        <tr><td style="padding:0 0 20px;">
          <span style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:${BRAND.primary};letter-spacing:-0.5px;">Vel<span style="color:${BRAND.ink};">Chat</span></span>
        </td></tr>
        <!-- card -->
        <tr><td bgcolor="${BRAND.card}" style="border:1px solid ${BRAND.border};border-radius:14px;padding:36px 36px 32px;">
          <h1 style="margin:0 0 18px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${BRAND.ink};">${esc(input.heading)}</h1>
          ${paras}
          ${input.code ? codeBox(input.code) : ''}
          ${input.cta ? button(input.cta) : ''}
          ${input.note ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:${BRAND.muted};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${esc(input.note)}</p>` : ''}
        </td></tr>
        <!-- footer -->
        <tr><td style="padding:24px 8px 0;">
          ${footerNote}
          <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">© ${year} ${esc(BRAND.name)} — a free, open-source, self-hostable messaging platform.<br>You received this email because an action was requested for your account. If it wasn't you, you can safely ignore it.</p>
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
  lines.push(...input.paragraphs);
  if (input.code) lines.push('', `Code: ${input.code}`);
  if (input.cta) lines.push('', `${input.cta.label}: ${input.cta.url}`);
  if (input.note) lines.push('', input.note);
  lines.push('', '—', `© 2026 ${BRAND.name}. If this wasn't you, ignore this email.`);
  return lines.join('\n');
}
