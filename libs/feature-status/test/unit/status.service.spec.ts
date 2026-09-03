import { ForbiddenError, NotFoundError } from '@velchat/common';
import { StatusService } from '../../src/status/status.service';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';
import type { StatusPost } from '../../src/status/status.types';
import type { SocialGraphResolver } from '@velchat/feature-contracts';

function activePost(over: Partial<StatusPost> = {}): StatusPost {
  return {
    status_id: 's1',
    user_id: 'author',
    kind: 'text',
    media_id: null,
    text: 'ciphertext',
    bg: null,
    caption: null,
    audience: { mode: 'contacts' },
    e2ee: true,
    view_once: false,
    state: 'active',
    deleted_at: null,
    created_at: '2026-08-22T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

function setup(
  opts: { rel?: { isContact: boolean; isBlocked: boolean }; post?: StatusPost | null } = {},
) {
  const post = opts.post === undefined ? activePost() : opts.post;
  const repo = {
    create: jest.fn(async () => undefined),
    findActive: jest.fn(async () => post),
    listActiveByUser: jest.fn(async () => (post ? [post] : [])),
    recordView: jest.fn(async () => undefined),
    viewersPage: jest.fn(async () => ({
      viewers: [{ viewer_id: 'alice', viewed_at: '2026-08-22T01:00:00.000Z' }],
      nextCursor: null,
    })),
    react: jest.fn(async () => undefined),
    softDelete: jest.fn(async () => true),
  } as unknown as StatusRepository;

  const events = { statusPosted: jest.fn(async () => undefined) } as unknown as StatusEvents;
  const social = {
    relationship: jest.fn(async () => opts.rel ?? { isContact: true, isBlocked: false }),
  } as unknown as SocialGraphResolver;

  return { svc: new StatusService(repo, events, social), repo, events, social };
}

// Each case here is a bypass that WAS exploitable because the service trusted a caller-supplied id.
describe('StatusService — security regressions', () => {
  it('refuses to delete a status the caller does not own', async () => {
    const { svc, repo } = setup();
    (repo.softDelete as jest.Mock).mockResolvedValue(false); // author-scoped predicate matches nothing
    await expect(svc.remove('s1', 'attacker')).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.softDelete).toHaveBeenCalledWith('s1', 'attacker');
  });

  it('refuses the viewer list to anyone but the author', async () => {
    const { svc } = setup();
    await expect(svc.viewers('s1', 'attacker', 50)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gives the viewer list to the author', async () => {
    const { svc } = setup();
    await expect(svc.viewers('s1', 'author', 50)).resolves.toEqual({
      viewers: [{ viewerId: 'alice', viewedAt: '2026-08-22T01:00:00.000Z' }],
      nextCursor: null,
    });
  });

  it('denies a non-contact reading an author feed', async () => {
    const { svc } = setup({ rel: { isContact: false, isBlocked: false } });
    await expect(svc.feedOf('author', 'stranger')).resolves.toEqual([]);
  });

  it('denies a blocked viewer on view, react and feed', async () => {
    const blocked = { isContact: true, isBlocked: true };
    const a = setup({ rel: blocked });
    await expect(a.svc.view('s1', 'v')).rejects.toBeInstanceOf(ForbiddenError);
    const b = setup({ rel: blocked });
    await expect(b.svc.react('s1', 'v', '👍')).rejects.toBeInstanceOf(ForbiddenError);
    const c = setup({ rel: blocked });
    await expect(c.svc.feedOf('author', 'v')).resolves.toEqual([]);
  });

  it('denies when the social graph cannot be reached (fail closed)', async () => {
    const { svc } = setup({ rel: { isContact: false, isBlocked: true } });
    await expect(svc.view('s1', 'v')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s on an expired or missing status rather than leaking existence', async () => {
    const { svc } = setup({ post: null });
    await expect(svc.view('gone', 'v')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.react('gone', 'v', '👍')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.viewers('gone', 'author', 50)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('StatusService — posting', () => {
  it('attributes the status to the acting account, not to any supplied field', async () => {
    const { svc, events } = setup();
    const res = await svc.post('acting-author', { kind: 'text', text: 'ciphertext' });
    expect(res.statusId).toBeDefined();
    expect(events.statusPosted).toHaveBeenCalledWith(
      res.statusId,
      'acting-author',
      'text',
      res.expiresAt,
    );
  });

  it('stores the audience RULE, not a materialised member list', async () => {
    const { svc, repo } = setup();
    await svc.post('author', {
      kind: 'text',
      text: 'ciphertext',
      audience: { mode: 'except', list: ['bob'] },
    });
    const stored = (repo.create as jest.Mock).mock.calls[0][1];
    expect(stored.audience).toEqual({ mode: 'except', list: ['bob'] });
  });

  it('sets a 24h server-authoritative expiry', async () => {
    const { svc } = setup();
    const before = Date.now();
    const res = await svc.post('author', { kind: 'text', text: 'ciphertext' });
    const ttl = new Date(res.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(23 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000 + 5_000);
  });

  // The E2EE boundary: content must not reach the event bus, its consumers, or a replay.
  it('never puts status content in the emitted event', async () => {
    const { svc, events } = setup();
    await svc.post('author', { kind: 'text', text: 'SECRET', caption: 'ALSO SECRET' });
    const serialised = JSON.stringify((events.statusPosted as jest.Mock).mock.calls[0]);
    expect(serialised).not.toContain('SECRET');
  });

  it('records a view for an allowed viewer and skips it for the author', async () => {
    const allowed = setup();
    await allowed.svc.view('s1', 'viewer');
    expect(allowed.repo.recordView).toHaveBeenCalledWith('s1', 'viewer');

    const own = setup();
    await own.svc.view('s1', 'author');
    expect(own.repo.recordView).not.toHaveBeenCalled();
  });
});
