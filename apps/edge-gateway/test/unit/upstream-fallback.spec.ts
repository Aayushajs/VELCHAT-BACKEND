import { resolveUpstreamFor } from '../../src/gateway/topology';

/**
 * What happens when `UPSTREAM_*` is missing in a MANAGED environment.
 *
 * The blueprint injects those via `fromService`, but a service created before those lines existed
 * — or a blueprint that was never re-synced — simply doesn't have them. The fallback was
 * `http://localhost:<devPort>`, which on a managed host is the gateway's OWN container: nothing is
 * listening there, so every proxied request failed instantly with 502 while each upstream was
 * perfectly healthy on its own URL. Login was impossible and the gateway's own /health said "ok",
 * which is the most misleading possible combination.
 *
 * On Render the sibling's host is our own host with the service slug swapped, so the gateway can
 * recover it from `RENDER_EXTERNAL_HOSTNAME` instead of being dead until someone edits a dashboard.
 */
describe('upstream resolution without UPSTREAM_* configured', () => {
  const render = {
    SPLIT_PROFILE: 'axis6',
    RENDER_EXTERNAL_HOSTNAME: 'velchat-edge-gateway-2aje.onrender.com',
  } as NodeJS.ProcessEnv;

  it('derives the sibling service from the gateway host', () => {
    expect(resolveUpstreamFor('AUTH', 3002, render)).toBe(
      'https://velchat-identity-service-2aje.onrender.com',
    );
    expect(resolveUpstreamFor('CHAT', 3004, render)).toBe(
      'https://velchat-messaging-service-2aje.onrender.com',
    );
    expect(resolveUpstreamFor('PRESENCE', 3006, render)).toBe(
      'https://velchat-realtime-service-2aje.onrender.com',
    );
  });

  it('still prefers an explicit UPSTREAM_* when one is configured', () => {
    expect(
      resolveUpstreamFor('AUTH', 3002, {
        ...render,
        UPSTREAM_IDENTITY: 'https://elsewhere.example',
      }),
    ).toBe('https://elsewhere.example');
  });

  it('leaves local development on localhost', () => {
    expect(resolveUpstreamFor('AUTH', 3002, { SPLIT_PROFILE: 'axis6' })).toBe(
      'http://localhost:3002',
    );
  });

  it('does not guess when the host does not follow the expected shape', () => {
    expect(
      resolveUpstreamFor('AUTH', 3002, {
        SPLIT_PROFILE: 'axis6',
        RENDER_EXTERNAL_HOSTNAME: 'something-unrelated.example.com',
      }),
    ).toBe('http://localhost:3002');
  });

  it('is irrelevant to mono, which resolves everything to one process', () => {
    expect(
      resolveUpstreamFor('AUTH', 3002, {
        SPLIT_PROFILE: 'mono',
        UPSTREAM_MONO: 'http://velchat-mono:3000',
      }),
    ).toBe('http://velchat-mono:3000');
  });
});
