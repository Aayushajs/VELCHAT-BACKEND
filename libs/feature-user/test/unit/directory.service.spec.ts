import { DirectoryService } from '../../src/directory/directory.service';
import { ValidationError, NotFoundError } from '@velchat/common';
import type { DirectoryRepository } from '../../src/directory/directory.repository';
import type { DirectoryEvents } from '../../src/directory/directory.events';

function setup(matchRows: Array<{ phone_hash: string; account_id: string }> = []) {
  const repo = {
    getProfile: jest.fn(async () => null),
    upsertProfile: jest.fn(async () => undefined),
    addContact: jest.fn(async () => undefined),
    setBlocked: jest.fn(async () => undefined),
    isBlocked: jest.fn(async () => true),
    listContacts: jest.fn(async () => []),
    registerHash: jest.fn(async () => undefined),
    matchHashes: jest.fn(async () => matchRows),
  } as unknown as DirectoryRepository;
  const events = { contactAdded: jest.fn(async () => undefined) } as unknown as DirectoryEvents;
  return { svc: new DirectoryService(repo, events), repo, events };
}

describe('DirectoryService (§B3/§A14.6)', () => {
  it('addContact rejects adding yourself', async () => {
    const { svc } = setup();
    await expect(svc.addContact('u1', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('addContact stores + emits contact.added', async () => {
    const { svc, repo, events } = setup();
    await svc.addContact('u1', 'u2', 'Bob');
    expect(repo.addContact).toHaveBeenCalledWith('u1', 'u2', 'Bob', null);
    expect(events.contactAdded).toHaveBeenCalledWith('u1', 'u2');
  });

  it('block/unblock toggle the flag', async () => {
    const { svc, repo } = setup();
    await svc.block('u1', 'u2');
    expect(repo.setBlocked).toHaveBeenCalledWith('u1', 'u2', true);
    await svc.unblock('u1', 'u2');
    expect(repo.setBlocked).toHaveBeenCalledWith('u1', 'u2', false);
  });

  it('getProfile throws NotFound when missing', async () => {
    const { svc } = setup();
    await expect(svc.getProfile('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('discover returns only matched hashes → account ids', async () => {
    const { svc, repo } = setup([
      { phone_hash: 'h1', account_id: 'acc1' },
      { phone_hash: 'h3', account_id: 'acc3' },
    ]);
    const res = await svc.discover(['h1', 'h2', 'h3', 'h1']); // h2 not registered, h1 duplicated
    expect(res.matches).toEqual({ h1: 'acc1', h3: 'acc3' });
    expect((repo.matchHashes as jest.Mock).mock.calls[0][0].sort()).toEqual(['h1', 'h2', 'h3']);
  });

  it('discover rejects an oversized batch', async () => {
    const { svc } = setup();
    const huge = Array.from({ length: 5001 }, (_, i) => `h${i}`);
    await expect(svc.discover(huge)).rejects.toBeInstanceOf(ValidationError);
  });
});
