import { RateLimitError } from '@velchat/common';
import type { SocialGraphResolver } from '@velchat/feature-contracts';
import { StatusService } from '../../src/status/status.service';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';

function setup(allow: boolean) {
  const repo = {
    create: jest.fn(async () => undefined),
    findActive: jest.fn(async () => null),
  } as unknown as StatusRepository;
  const events = { statusPosted: jest.fn(async () => undefined) } as unknown as StatusEvents;
  const social = {
    relationship: jest.fn(async () => ({ isContact: true, isBlocked: false })),
  } as unknown as SocialGraphResolver;
  const limiter = { allow: jest.fn(async () => allow) };
  const svc = new StatusService(repo, events, social, { limiter, limits: { create: 30 } });
  return { svc, repo, limiter };
}

describe('StatusService rate limiting', () => {
  it('rejects a create once the per-account limit is exceeded', async () => {
    const { svc, repo } = setup(false);
    await expect(svc.post('author', { kind: 'text', text: 'ct' })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('allows a create while under the limit, and keys the bucket per account', async () => {
    const { svc, repo, limiter } = setup(true);
    await svc.post('author', { kind: 'text', text: 'ct' });
    expect(repo.create).toHaveBeenCalled();
    expect(limiter.allow).toHaveBeenCalledWith(
      expect.stringContaining('author'),
      30,
      expect.any(Number),
    );
  });

  // Availability over enforcement, for a control that is not an authorization decision: a Valkey
  // outage must not stop people posting. Authorization never degrades this way — it fails closed.
  it('allows the action when the limiter itself fails', async () => {
    const { svc, repo, limiter } = setup(true);
    limiter.allow.mockRejectedValue(new Error('valkey down'));
    await svc.post('author', { kind: 'text', text: 'ct' });
    expect(repo.create).toHaveBeenCalled();
  });

  it('applies no limit at all when no throttle is configured', async () => {
    const repo = {
      create: jest.fn(async () => undefined),
    } as unknown as StatusRepository;
    const events = { statusPosted: jest.fn(async () => undefined) } as unknown as StatusEvents;
    const social = {
      relationship: jest.fn(async () => ({ isContact: true, isBlocked: false })),
    } as unknown as SocialGraphResolver;
    const svc = new StatusService(repo, events, social);
    await svc.post('author', { kind: 'text', text: 'ct' });
    expect(repo.create).toHaveBeenCalled();
  });
});
