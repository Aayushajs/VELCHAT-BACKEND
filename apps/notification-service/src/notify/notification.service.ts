import { uuidv7, type Logger } from '@velchat/common';
import type { MessageSentPayload, CallStartedPayload } from '@velchat/shared-types';
import { NotificationRepository, type PrefPatch } from './notification.repository';
import { MembersProjection } from './members.projection';
import { decideNotify, type NotifyPrefs } from './notify-policy';

const DEFAULT_PREFS: NotifyPrefs = { level: 'all' };

/**
 * Notification routing (§A19 / §B10). On a durable event it resolves recipients, applies each
 * recipient's prefs + presence via the pure policy, and enqueues a NO-CONTENT push into the durable
 * outbox (idempotent per event+user). Push is a best-effort hint; the outbox worker delivers it and
 * cursor sync remains the source of truth for unread/badges (§G4).
 */
export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly members: MembersProjection,
    private readonly logger: Logger,
  ) {}

  async onMessageSent(m: MessageSentPayload): Promise<void> {
    const recipients = (await this.members.members(m.conversation_id)).filter(
      (u) => u !== m.sender_account_id,
    );
    for (const userId of recipients) {
      const pref = await this.repo.getPref(userId, 'conversation', m.conversation_id);
      const prefs: NotifyPrefs = pref
        ? {
            level: pref.level as NotifyPrefs['level'],
            mutedUntil: pref.mutedUntil,
            dndSchedule: pref.dndSchedule as NotifyPrefs['dndSchedule'],
          }
        : DEFAULT_PREFS;
      const isOnline = await this.members.isOnline(userId);
      // mention.created (chat-service) will set isMention; message.sent alone can't tell → false.
      const decision = decideNotify(prefs, { isMention: false, isOnline });
      if (!decision.notify) {
        this.logger.debug(
          { userId, messageId: m.message_id, reason: decision.reason },
          'push skipped',
        );
        continue;
      }
      // Privacy: NO message content in the payload — just ids. The device fetches + decrypts (§A19).
      const queued = await this.repo.enqueue({
        id: uuidv7(),
        userId,
        type: 'message',
        payload: { conversationId: m.conversation_id, messageId: m.message_id, seq: String(m.seq) },
        dedupeKey: `msg:${m.message_id}:${userId}`,
      });
      this.logger.debug({ userId, messageId: m.message_id, queued }, 'push enqueued');
    }
  }

  /** Ring conversation members on an incoming call (§C8). Calls notify regardless of chat presence. */
  async onCallStarted(c: CallStartedPayload): Promise<void> {
    if (!c.conversation_id) return; // ad-hoc rooms carry their own invite list (handled elsewhere)
    const recipients = (await this.members.members(c.conversation_id)).filter(
      (u) => u !== c.host_id,
    );
    for (const userId of recipients) {
      await this.repo.enqueue({
        id: uuidv7(),
        userId,
        type: 'call',
        payload: { callId: c.call_id, roomName: c.room_name, callType: c.type },
        dedupeKey: `call:${c.call_id}:${userId}`,
      });
    }
  }

  setPref(userId: string, scopeType: string, scopeId: string, patch: PrefPatch): Promise<void> {
    return this.repo.upsertPref(userId, scopeType, scopeId, patch);
  }

  registerEndpoint(e: {
    deviceId: string;
    userId: string;
    platform: string;
    token?: string;
    voipToken?: string;
    subscription?: unknown;
  }): Promise<void> {
    return this.repo.registerEndpoint(e);
  }

  getPref(userId: string, scopeType: string, scopeId: string) {
    return this.repo.getPref(userId, scopeType, scopeId);
  }
}
