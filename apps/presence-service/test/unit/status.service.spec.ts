import { StatusService } from '../../src/status/status.service';
import { audienceAllows } from '../../src/status/status.types';
import { ForbiddenError, NotFoundError } from '@velchat/common';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';
import type { StatusPost } from '../../src/status/status.types';

function activePost(over: Partial<StatusPost> = {}): StatusPost {
  return {
    status_id: 's1',
    user_id: 'author',
    kind: 'text',
    media_id: null,
    text: 'ct',
    bg: null,
    caption: null,
    audience: { mode: 'contacts', list: ['alice', 'bob'] },
    e2ee: true,
    view_once: false,
    created_at: '2026-06-22T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

function setup() {
  const created: Array<{ statusId: string }> = [];
  const repo = {
    create: jest.fn(async (statusId: string) => {
      created.push({ statusId });
    }),
    findActive: jest.fn(async () => activePost()),
    recordView: jest.fn(async () => undefined),
    viewers: jest.fn(async () => [{ viewer_id: 'alice', viewed_at: 't' }]),
    react: jest.fn(async () => undefined),
    delete: jest.fn(async () => true),
  } as unknown as StatusRepository;
  const events = { statusPosted: jest.fn(async () => undefined) } as unknown as StatusEvents;
  return { svc: new StatusService(repo, events), repo, events };
}

describe('audienceAllows (§B8)', () => {
  const contacts = new Set(['alice', 'bob', 'carol']);
  it('contacts → any contact', () => {
    expect(audienceAllows({ mode: 'contacts' }, 'alice', contacts)).toBe(true);
    expect(audienceAllows({ mode: 'contacts' }, 'stranger', contacts)).toBe(false);
  });
  it('except → contacts minus the list', () => {
    expect(audienceAllows({ mode: 'except', list: ['bob'] }, 'alice', contacts)).toBe(true);
    expect(audienceAllows({ mode: 'except', list: ['bob'] }, 'bob', contacts)).toBe(false);
  });
  it('only → exactly the list', () => {
    expect(audienceAllows({ mode: 'only', list: ['carol'] }, 'carol', contacts)).toBe(true);
    expect(audienceAllows({ mode: 'only', list: ['carol'] }, 'alice', contacts)).toBe(false);
  });
});

describe('StatusService (§B8/§C11)', () => {
  it('resolves the audience from contacts and emits status.posted', async () => {
    const { svc, events } = setup();
    const res = await svc.post({
      userId: 'author',
      kind: 'text',
      text: 'ciphertext',
      audience: { mode: 'except', list: ['bob'] },
      contacts: ['alice', 'bob', 'carol'],
    });
    expect(res.audience.sort()).toEqual(['alice', 'carol']); // bob excluded
    expect(events.statusPosted).toHaveBeenCalledWith(
      res.statusId,
      'author',
      'text',
      expect.arrayContaining(['alice', 'carol']),
      res.expiresAt,
    );
  });

  it('blocks a view from outside the audience', async () => {
    const { svc } = setup();
    await expect(svc.view('s1', 'stranger')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('records a view for an audience member', async () => {
    const { svc, repo } = setup();
    await svc.view('s1', 'alice');
    expect(repo.recordView).toHaveBeenCalledWith('s1', 'alice');
  });

  it('only the author can see the viewer list', async () => {
    const { svc } = setup();
    await expect(svc.viewers('s1', 'alice')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.viewers('s1', 'author')).resolves.toEqual([
      { viewerId: 'alice', viewedAt: 't' },
    ]);
  });

  it('404 on viewing an expired/missing status', async () => {
    const { svc, repo } = setup();
    (repo.findActive as jest.Mock).mockResolvedValueOnce(null);
    await expect(svc.view('gone', 'alice')).rejects.toBeInstanceOf(NotFoundError);
  });
});
