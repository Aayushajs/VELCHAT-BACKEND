import { createHmac } from 'node:crypto';
import { buildIceServers, type TurnConfig } from '../../src/calls/ice';

const NOW = 1_800_000_000_000; // fixed clock → deterministic credential

describe('buildIceServers (§A17.1 WebRTC ICE)', () => {
  it('returns [] when nothing is configured (free/self-host default)', () => {
    const cfg: TurnConfig = { stunUrls: '', turnUrls: '', ttlSec: 86400 };
    expect(buildIceServers(cfg, 'u1', NOW)).toEqual([]);
  });

  it('includes STUN with no auth', () => {
    const cfg: TurnConfig = { stunUrls: 'stun:h:3478', turnUrls: '', ttlSec: 86400 };
    expect(buildIceServers(cfg, 'u1', NOW)).toEqual([{ urls: ['stun:h:3478'] }]);
  });

  it('builds short-lived coturn TURN credentials (HMAC-SHA1 of expiry:user)', () => {
    const cfg: TurnConfig = {
      stunUrls: '',
      turnUrls: 'turn:h:3478,turns:h:5349',
      turnSecret: 'sekret',
      ttlSec: 3600,
    };
    const [turn] = buildIceServers(cfg, 'acc-1', NOW);
    const expiry = Math.floor(NOW / 1000) + 3600;
    const expectedUser = `${expiry}:acc-1`;
    expect(turn!.urls).toEqual(['turn:h:3478', 'turns:h:5349']);
    expect(turn!.username).toBe(expectedUser);
    expect(turn!.credential).toBe(
      createHmac('sha1', 'sekret').update(expectedUser).digest('base64'),
    );
  });

  it('omits TURN credentials when the secret is missing (STUN only)', () => {
    const cfg: TurnConfig = { stunUrls: 'stun:h:3478', turnUrls: 'turn:h:3478', ttlSec: 86400 };
    const servers = buildIceServers(cfg, 'u1', NOW);
    expect(servers).toEqual([{ urls: ['stun:h:3478'] }]); // no TURN without a secret
  });
});
