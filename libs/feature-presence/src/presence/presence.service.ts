import { ValidationError } from '@velchat/common';
import { PresenceRepository } from './presence.repository';
import { PresenceEvents } from './presence.events';
import {
  computePresence,
  coarse,
  canSee,
  type ManualStatus,
  type Presence,
  type PresencePrivacy,
} from './presence-state';

/** Optional viewer context so `get` can honour the owner's last-seen/online privacy (§B8). */
export interface ViewerCtx {
  viewerId: string;
  /** Whether the viewer is one of the owner's contacts (resolved upstream in user-service). */
  viewerIsContact?: boolean;
}

/**
 * Presence service (§A15 / §B8). Tracks per-device connections + last-seen, resolves rich presence
 * (call/manual/idle/online), and fans changes ONLY to active subscribers (§A15.2 — avoids the
 * N×contacts blast). The realtime gateway calls online/offline/heartbeat as sockets open/close.
 */
export class PresenceService {
  constructor(
    private readonly repo: PresenceRepository,
    private readonly events: PresenceEvents,
  ) {}

  async online(userId: string, deviceId: string): Promise<void> {
    if (!userId || !deviceId) throw new ValidationError('userId and deviceId are required');
    await this.repo.addDevice(userId, deviceId);
    await this.fanout(userId);
  }

  async heartbeat(userId: string): Promise<void> {
    await this.repo.heartbeat(userId);
  }

  async offline(userId: string, deviceId: string): Promise<void> {
    const remaining = await this.repo.removeDevice(userId, deviceId);
    if (remaining === 0) await this.fanout(userId); // fully offline → notify subscribers + set last-seen
  }

  /** Set a manual rich status (available/busy/dnd/away/…) with optional emoji/text/expiry. */
  async setStatus(userId: string, status: ManualStatus): Promise<Presence> {
    await this.repo.setManual(userId, status);
    return this.fanout(userId);
  }

  /**
   * Resolve a user's current rich presence + last-seen (call state wiring lands with §C20).
   * When a `viewer` is supplied, the owner's last-seen/online privacy is enforced (§B8): a hidden
   * `online` collapses the visible status to `offline`, and a hidden `last-seen` is stripped —
   * with the WhatsApp reciprocity rule (a viewer who hides their own signal can't see others').
   */
  async get(userId: string, viewer?: ViewerCtx): Promise<Presence & { lastSeen: number | null }> {
    const [onlineDeviceCount, manual, lastSeen] = await Promise.all([
      this.repo.onlineCount(userId),
      this.repo.getManual(userId),
      this.repo.lastSeen(userId),
    ]);
    const presence = computePresence({ onlineDeviceCount, manual });
    const base = { ...presence, lastSeen: presence.status === 'offline' ? lastSeen : null };
    if (!viewer) return base;

    const isSelf = viewer.viewerId === userId;
    const [ownerP, viewerP] = await Promise.all([
      this.repo.getPrivacy(userId),
      isSelf ? Promise.resolve(null) : this.repo.getPrivacy(viewer.viewerId),
    ]);
    const viewerIsContact = viewer.viewerIsContact ?? false;

    const onlineVisible = canSee({
      isSelf,
      owner: ownerP.online,
      viewer: viewerP?.online ?? 'everyone',
      viewerIsContact,
    });
    const lastSeenVisible = canSee({
      isSelf,
      owner: ownerP.lastSeen,
      viewer: viewerP?.lastSeen ?? 'everyone',
      viewerIsContact,
    });

    return {
      // If the viewer may not see me online, I appear offline to them (no online/away/typing leak).
      status: onlineVisible ? base.status : 'offline',
      ...(onlineVisible ? { emoji: base.emoji, text: base.text } : {}),
      lastSeen: lastSeenVisible ? base.lastSeen : null,
    };
  }

  /** Update the owner's last-seen/online privacy (§B8). */
  async setPrivacy(userId: string, privacy: PresencePrivacy): Promise<PresencePrivacy> {
    if (!userId) throw new ValidationError('userId is required');
    await this.repo.setPrivacy(userId, privacy);
    return privacy;
  }

  /** Read the owner's current privacy settings. */
  getPrivacy(userId: string): Promise<PresencePrivacy> {
    return this.repo.getPrivacy(userId);
  }

  /** A client subscribes to the presence of the contacts currently on screen (§A15.2). */
  async subscribe(watcher: string, targets: string[]): Promise<{ subscribed: number }> {
    if (!watcher) throw new ValidationError('watcher is required');
    const list = (targets ?? []).filter(Boolean);
    if (list.length > 0) await this.repo.subscribe(watcher, list);
    return { subscribed: list.length };
  }

  /** Recompute + emit presence.changed to this user's subscribers. */
  private async fanout(userId: string): Promise<Presence> {
    const presence = await this.get(userId);
    await this.events.changed(userId, coarse(presence.status));
    return presence;
  }
}
