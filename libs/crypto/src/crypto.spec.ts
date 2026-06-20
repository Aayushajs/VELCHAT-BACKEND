import { asCiphertext, refuseServerSidePlaintext, type Ciphertext } from './index';

describe('@velchat/crypto (E2EE boundary §B6)', () => {
  it('wraps base64 as opaque Ciphertext', () => {
    const ct: Ciphertext = asCiphertext('AAAA');
    expect(typeof ct).toBe('string');
    expect(ct).toBe('AAAA');
  });

  it('refuses server-side plaintext access (fail-loud)', () => {
    expect(() => refuseServerSidePlaintext('chat-service.read')).toThrow(/E2EE violation/);
  });
});
