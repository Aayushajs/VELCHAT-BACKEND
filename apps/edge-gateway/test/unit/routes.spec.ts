import { resolveUpstream } from '../../src/gateway/routes';

describe('status routing (Phase 1 — regression for the wrong-upstream defect)', () => {
  const ENV_KEYS = ['SPLIT_PROFILE', 'UPSTREAM_CONTENT', 'UPSTREAM_REALTIME', 'UPSTREAM_STATUS'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.UPSTREAM_CONTENT = 'http://content:3008';
    process.env.UPSTREAM_REALTIME = 'http://realtime:3006';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // The defect: /status resolved to the realtime upstream, which does not mount StatusModule.
  // Expected upstream differs per profile because `full13` deliberately does NOT consult the axis6
  // logical → runtime map: with no UPSTREAM_STATUS set it falls through to the route's own dev port
  // (3008), which is still the content process. Either way the request must not land on realtime.
  it.each([
    ['axis6', 'http://content:3008'],
    ['full13', 'http://localhost:3008'],
  ])('routes /status to the content upstream under %s', (profile, expected) => {
    process.env.SPLIT_PROFILE = profile;
    expect(resolveUpstream('/status')).toBe(expected);
    expect(resolveUpstream('/status/abc/viewers')).toBe(expected);
  });

  it('honours an explicit UPSTREAM_STATUS override under full13', () => {
    process.env.SPLIT_PROFILE = 'full13';
    process.env.UPSTREAM_STATUS = 'http://status:3013';
    expect(resolveUpstream('/status')).toBe('http://status:3013');
  });

  it('keeps /presence on the realtime upstream', () => {
    process.env.SPLIT_PROFILE = 'axis6';
    expect(resolveUpstream('/presence')).toBe('http://realtime:3006');
  });

  // /presence/status is RICH PRESENCE and legitimately belongs to realtime. Splitting the rule
  // must not steal it, which is why both rules are start-anchored.
  it('keeps /presence/status on the realtime upstream', () => {
    process.env.SPLIT_PROFILE = 'axis6';
    expect(resolveUpstream('/presence/status')).toBe('http://realtime:3006');
  });
});
