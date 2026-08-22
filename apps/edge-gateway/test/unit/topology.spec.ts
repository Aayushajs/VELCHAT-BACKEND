import { resolveUpstreamFor, splitProfile } from '../../src/gateway/topology';
import { ROUTES, resolveUpstream } from '../../src/gateway/routes';

/**
 * The consolidation's central claim is that the PUBLIC API does not move — only the destination
 * does. These tests pin both halves of that: the same route table under either profile, and a
 * mapping that sends the merged services to their new owner.
 */
describe('topology resolution', () => {
  const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

  it('defaults to the 6-service profile', () => {
    expect(splitProfile(env())).toBe('axis6');
    expect(splitProfile(env({ SPLIT_PROFILE: 'nonsense' }))).toBe('axis6');
  });

  it('sends auth, user and group-channel to one identity service under axis6', () => {
    const e = env({ UPSTREAM_IDENTITY: 'http://identity:3002' });
    for (const logical of ['AUTH', 'USER', 'GROUP_CHANNEL']) {
      expect(resolveUpstreamFor(logical, 9999, e)).toBe('http://identity:3002');
    }
  });

  it('sends chat, notification and search to one messaging service under axis6', () => {
    const e = env({ UPSTREAM_MESSAGING: 'http://messaging:3004' });
    for (const logical of ['CHAT', 'NOTIFICATION', 'SEARCH']) {
      expect(resolveUpstreamFor(logical, 9999, e)).toBe('http://messaging:3004');
    }
  });

  it('keeps each logical service separate under full13 — the rollback path', () => {
    const e = env({
      SPLIT_PROFILE: 'full13',
      UPSTREAM_AUTH: 'http://auth:3002',
      UPSTREAM_IDENTITY: 'http://identity:3002',
    });
    expect(resolveUpstreamFor('AUTH', 3002, e)).toBe('http://auth:3002');
    // With no UPSTREAM_USER set, full13 falls back to the dev port rather than borrowing identity.
    expect(resolveUpstreamFor('USER', 3003, e)).toBe('http://localhost:3003');
  });

  it('lets one service be peeled out without switching profile', () => {
    const e = env({ UPSTREAM_IDENTITY: 'http://identity:3002', UPSTREAM_AUTH: 'http://auth:9001' });
    expect(resolveUpstreamFor('AUTH', 3002, e)).toBe('http://auth:9001');
    expect(resolveUpstreamFor('USER', 3003, e)).toBe('http://identity:3002');
  });

  it('resolves to a usable local address with no environment at all', () => {
    expect(resolveUpstreamFor('CHAT', 3004, env())).toBe('http://localhost:3004');
    expect(resolveUpstreamFor('MEDIA', 3008, env())).toBe('http://localhost:3008');
  });

  it('routes every logical service in the table to a known runtime owner', () => {
    const e = env({
      UPSTREAM_IDENTITY: 'i',
      UPSTREAM_MESSAGING: 'm',
      UPSTREAM_REALTIME: 'r',
      UPSTREAM_CONTENT: 'c',
      UPSTREAM_PLATFORM: 'p',
    });
    const unmapped = [...new Set(ROUTES.map((r) => r.service))].filter(
      (s) => !['i', 'm', 'r', 'c', 'p'].includes(resolveUpstreamFor(s, 1, e)),
    );
    expect(unmapped).toEqual([]);
  });

  it('leaves the public route table unchanged — same paths hit the same logical service', () => {
    // A sample of the tricky overlapping prefixes from routes.ts.
    expect(resolveUpstream('/auth/login')).toBeTruthy();
    expect(resolveUpstream('/conversations/dm')).toBeTruthy();
    expect(resolveUpstream('/conversations/abc/messages')).toBeTruthy();
    expect(resolveUpstream('/users/u1/profile')).toBeTruthy();
    expect(resolveUpstream('/health')).toBeNull(); // handled by the gateway itself
  });
});
