import jwt from 'jsonwebtoken';
import { mintLivekitToken } from '../../src/calls/livekit-token';

describe('mintLivekitToken (§A17.1)', () => {
  const KEY = 'APIkey123';
  const SECRET = 'supersecretvalue';

  it('mints an HS256 JWT with the LiveKit video grant', () => {
    const token = mintLivekitToken(KEY, SECRET, { room: 'call_1', identity: 'alice' });
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload & {
      video?: { room: string; roomJoin: boolean; canPublish: boolean; canSubscribe: boolean };
    };
    expect(decoded.iss).toBe(KEY);
    expect(decoded.sub).toBe('alice');
    expect(decoded.video?.room).toBe('call_1');
    expect(decoded.video?.roomJoin).toBe(true);
    expect(decoded.video?.canPublish).toBe(true);
  });

  it('rejects verification with a wrong secret', () => {
    const token = mintLivekitToken(KEY, SECRET, { room: 'r', identity: 'u' });
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });

  it('honours canPublish=false (view-only, e.g. live-event audience)', () => {
    const token = mintLivekitToken(KEY, SECRET, { room: 'r', identity: 'u', canPublish: false });
    const d = jwt.verify(token, SECRET) as { video?: { canPublish: boolean } };
    expect(d.video?.canPublish).toBe(false);
  });
});
