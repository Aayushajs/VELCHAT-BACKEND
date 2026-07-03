import { ValidationError } from '@velchat/common';
import { PresenceRepository } from './presence.repository';
import { PresenceEvents } from './presence.events';
import { computePresence, coarse, type ManualStatus, type Presence } from './presence-state';

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

  /** Resolve a user's current rich presence (call state wiring lands with §C20). */
  async get(userId: string): Promise<Presence & { lastSeen: number | null }> {
    const [onlineDeviceCount, manual, lastSeen] = await Promise.all([
      this.repo.onlineCount(userId),
      this.repo.getManual(userId),
      this.repo.lastSeen(userId),
    ]);
    const presence = computePresence({ onlineDeviceCount, manual });
    return { ...presence, lastSeen: presence.status === 'offline' ? lastSeen : null };
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
