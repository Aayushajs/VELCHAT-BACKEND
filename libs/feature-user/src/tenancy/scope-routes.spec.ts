import { SCOPE_SEGMENTS, scopeRoute } from './scope-routes';

/**
 * The one property that matters: a tenancy route must not be able to capture another feature's
 * path. `GET /conversations/:id/members` being swallowed by `:scopeType/:scopeId/members` is what
 * broke the realtime membership auto-heal, and with it fan-out.
 */
describe('tenancy scope routes', () => {
  it('never begins with a bare parameter', () => {
    const route = scopeRoute(':scopeId/members');
    expect(route.startsWith(':scopeType(')).toBe(true);
    expect(route).not.toMatch(/^:scopeType\//);
  });

  it('enumerates the scopes rather than matching anything', () => {
    const route = scopeRoute(':scopeId/members');
    for (const seg of SCOPE_SEGMENTS) expect(route).toContain(seg);
  });

  it('would not match another feature collection', () => {
    // Emulate the matcher: the alternation is the whole guarantee.
    const alternation = scopeRoute(':scopeId/members').slice(
      ':scopeType('.length,
      scopeRoute(':scopeId/members').indexOf(')'),
    );
    const allowed = new Set(alternation.split('|'));
    expect(allowed.has('conversations')).toBe(false);
    expect(allowed.has('users')).toBe(false);
    expect(allowed.has('orgs')).toBe(true);
  });

  it('keeps both spellings, so narrowing the route serves the same requests as before', () => {
    expect(SCOPE_SEGMENTS).toContain('orgs');
    expect(SCOPE_SEGMENTS).toContain('org');
  });
});
