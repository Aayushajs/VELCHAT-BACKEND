import { ValidationError, NotFoundError } from '@velchat/common';
import {
  DirectoryRepository,
  type Contact,
  type Profile,
  type ProfilePatch,
} from './directory.repository';
import { DirectoryEvents } from './directory.events';

/**
 * Directory: profiles, contacts, block, and privacy-preserving contact discovery (§B3 / §A14.6).
 * Discovery never stores raw phone numbers — clients upload SALTED hashes and the server returns
 * only the matches against opted-in discoverable users; non-matches are discarded (§G2 upgrades to OPRF).
 */
export class DirectoryService {
  constructor(
    private readonly repo: DirectoryRepository,
    private readonly events: DirectoryEvents,
  ) {}

  async getProfile(userId: string): Promise<Profile> {
    const p = await this.repo.getProfile(userId);
    if (!p) throw new NotFoundError('profile not found');
    return p;
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
    if (!userId) throw new ValidationError('userId is required');
    await this.repo.upsertProfile(userId, patch);
    return this.getProfile(userId);
  }

  async addContact(
    userId: string,
    contactUserId: string,
    displayName?: string,
    contactHash?: string,
  ): Promise<void> {
    if (!userId || !contactUserId) throw new ValidationError('userId and contactUserId required');
    if (userId === contactUserId) throw new ValidationError('cannot add yourself');
    await this.repo.addContact(userId, contactUserId, displayName ?? null, contactHash ?? null);
    await this.events.contactAdded(userId, contactUserId);
  }

  async block(userId: string, contactUserId: string): Promise<void> {
    await this.repo.setBlocked(userId, contactUserId, true);
  }

  async unblock(userId: string, contactUserId: string): Promise<void> {
    await this.repo.setBlocked(userId, contactUserId, false);
  }

  async isBlocked(userId: string, contactUserId: string): Promise<{ blocked: boolean }> {
    return { blocked: await this.repo.isBlocked(userId, contactUserId) };
  }

  async listContacts(userId: string): Promise<Contact[]> {
    return this.repo.listContacts(userId);
  }

  /** Opt in to discovery by registering a salted phone hash (client computes it). */
  async registerDiscoveryHash(accountId: string, phoneHash: string): Promise<void> {
    if (!accountId || !phoneHash) throw new ValidationError('accountId and phoneHash required');
    await this.repo.registerHash(accountId, phoneHash);
  }

  /**
   * Contact discovery: upload salted phone hashes → get back which are registered VelChat users.
   * Returns only matches as { hash → accountId }; unmatched hashes are never stored.
   */
  async discover(hashes: string[]): Promise<{ matches: Record<string, string> }> {
    const unique = [
      ...new Set((hashes ?? []).filter((h) => typeof h === 'string' && h.length > 0)),
    ];
    if (unique.length > 5000) throw new ValidationError('too many hashes in one request');
    const rows = await this.repo.matchHashes(unique);
    const matches: Record<string, string> = {};
    for (const r of rows) matches[r.phone_hash] = r.account_id;
    return { matches };
  }
}
