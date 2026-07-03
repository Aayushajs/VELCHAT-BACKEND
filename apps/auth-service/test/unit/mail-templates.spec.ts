import {
  verificationCodeEmail,
  magicLinkEmail,
  welcomeEmail,
  securityAlertEmail,
  notificationEmail,
} from '@velchat/mail';

describe('mail templates (@velchat/mail)', () => {
  it('verification code email carries the code in subject/html/text', () => {
    const m = verificationCodeEmail({ code: '481920', expiresMinutes: 10 });
    expect(m.subject).toMatch(/verification code/i);
    expect(m.html).toContain('481920');
    expect(m.html).toContain('<!DOCTYPE html>');
    expect(m.text).toContain('481920');
    expect(m.text).toContain('10 minutes');
  });

  it('magic-link email embeds the url and escapes safely', () => {
    const m = magicLinkEmail({
      url: 'https://velchat.app/auth/magic/verify?token=abc&x=1',
      expiresMinutes: 15,
    });
    expect(m.html).toContain('token=abc&amp;x=1'); // ampersand HTML-escaped
    expect(m.text).toContain('https://velchat.app/auth/magic/verify?token=abc&x=1');
  });

  it('welcome / security / notification templates render subject + html + text', () => {
    for (const m of [
      welcomeEmail({ name: 'Aayush' }),
      securityAlertEmail({
        event: 'New device linked',
        when: '2026-07-04 03:00 UTC',
        ip: '1.2.3.4',
      }),
      notificationEmail({
        title: 'You have 3 new messages',
        message: 'Open VelChat to read them.',
        ctaText: 'Open',
        ctaUrl: 'https://velchat.app',
      }),
    ]) {
      expect(m.subject.length).toBeGreaterThan(0);
      expect(m.html).toContain('VelChat');
      expect(m.text.length).toBeGreaterThan(0);
    }
  });

  it('escapes HTML in user-supplied fields (no injection)', () => {
    const m = notificationEmail({ title: '<script>alert(1)</script>', message: 'hi' });
    expect(m.html).not.toContain('<script>alert(1)</script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});
