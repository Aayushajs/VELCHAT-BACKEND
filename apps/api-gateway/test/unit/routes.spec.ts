import { resolveUpstream, ROUTES } from '../../src/gateway/routes';

// Assert a path resolves to the upstream owned by `service` (compare by the default localhost port).
function portFor(service: string): number {
  const r = ROUTES.find((x) => x.service === service);
  if (!r) throw new Error(`no route for ${service}`);
  return r.port;
}
function upstreamPort(path: string): number | null {
  const u = resolveUpstream(path);
  return u ? Number(u.split(':').pop()) : null;
}

describe('gateway routing (§A12.1)', () => {
  it('routes each service prefix to its upstream', () => {
    expect(upstreamPort('/auth/login/device-key')).toBe(portFor('AUTH'));
    expect(upstreamPort('/.well-known/jwks.json')).toBe(portFor('AUTH'));
    expect(upstreamPort('/users/u1/profile')).toBe(portFor('USER'));
    expect(upstreamPort('/orgs')).toBe(portFor('USER'));
    expect(upstreamPort('/discovery/oprf/key')).toBe(portFor('USER'));
    expect(upstreamPort('/chat/messages')).toBe(portFor('CHAT'));
    expect(upstreamPort('/polls/m1/vote')).toBe(portFor('CHAT'));
    expect(upstreamPort('/presence/online')).toBe(portFor('PRESENCE'));
    expect(upstreamPort('/mail/campaigns')).toBe(portFor('NOTIFICATION'));
    expect(upstreamPort('/media/uploads')).toBe(portFor('MEDIA'));
    expect(upstreamPort('/search?q=x')).toBe(portFor('SEARCH'));
    expect(upstreamPort('/calls/c1/join')).toBe(portFor('CALL'));
    expect(upstreamPort('/lists')).toBe(portFor('AUTOMATION'));
    expect(upstreamPort('/canvas/x')).toBe(portFor('AUTOMATION'));
    expect(upstreamPort('/ai/translate')).toBe(portFor('AI'));
  });

  it('splits the shared /users prefix: profile→user, stars/conversations→chat', () => {
    expect(upstreamPort('/users/u1/profile')).toBe(portFor('USER'));
    expect(upstreamPort('/users/u1/contacts')).toBe(portFor('USER'));
    expect(upstreamPort('/users/u1/stars/m1')).toBe(portFor('CHAT'));
    expect(upstreamPort('/users/u1/conversations/c1/mute')).toBe(portFor('CHAT'));
    expect(upstreamPort('/users/u1/conversations/archived')).toBe(portFor('CHAT'));
  });

  it('splits the shared /conversations prefix: dm+members+role+notif+details→group-channel, rest→chat', () => {
    expect(upstreamPort('/conversations/dm')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/conversations/c1/members')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/conversations/c1/members/u1/role')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/conversations/c1/notif')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/conversations/c1')).toBe(portFor('GROUP_CHANNEL')); // bare details
    expect(upstreamPort('/conversations/c1/messages')).toBe(portFor('CHAT'));
    expect(upstreamPort('/conversations/c1/pins/m1')).toBe(portFor('CHAT'));
  });

  it('groups/channels/communities → group-channel', () => {
    expect(upstreamPort('/groups')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/channels')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/channels/c1/join')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/communities')).toBe(portFor('GROUP_CHANNEL'));
    expect(upstreamPort('/communities/c1/channels')).toBe(portFor('GROUP_CHANNEL'));
  });

  it('search sub-paths (files/people/channels/suggest) → search', () => {
    expect(upstreamPort('/search/files?q=x')).toBe(portFor('SEARCH'));
    expect(upstreamPort('/search/people?q=x')).toBe(portFor('SEARCH'));
    expect(upstreamPort('/search/channels?q=x')).toBe(portFor('SEARCH'));
    expect(upstreamPort('/search/suggest?q=x')).toBe(portFor('SEARCH'));
  });

  it('media sub-paths (gallery/view/renditions) → media', () => {
    expect(upstreamPort('/media?conversationId=c1')).toBe(portFor('MEDIA'));
    expect(upstreamPort('/media/m1/view')).toBe(portFor('MEDIA'));
    expect(upstreamPort('/media/m1/renditions')).toBe(portFor('MEDIA'));
  });

  it('presence privacy → presence', () => {
    expect(upstreamPort('/presence/privacy')).toBe(portFor('PRESENCE'));
    expect(upstreamPort('/presence/u1/privacy')).toBe(portFor('PRESENCE'));
  });

  it('unknown paths (gateway-owned) resolve to null', () => {
    expect(resolveUpstream('/health')).toBeNull();
    expect(resolveUpstream('/metrics')).toBeNull();
    expect(resolveUpstream('/docs')).toBeNull();
    expect(resolveUpstream('/')).toBeNull();
  });

  it('respects an UPSTREAM_<SERVICE> env override', () => {
    process.env.UPSTREAM_CHAT = 'http://chat-service:9999';
    expect(resolveUpstream('/chat/messages')).toBe('http://chat-service:9999');
    delete process.env.UPSTREAM_CHAT;
  });
});
