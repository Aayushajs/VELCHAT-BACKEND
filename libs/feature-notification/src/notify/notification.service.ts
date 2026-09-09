import { uuidv7, UnauthorizedError, ValidationError, type Logger } from '@velchat/common';
import type { MessageSentPayload, CallStartedPayload } from '@velchat/shared-types';
import { NotificationRepository, type PrefPatch } from './notification.repository';
import { MembersProjection } from './members.projection';
import { decideNotify, type NotifyPrefs } from './notify-policy';
import { parseDeviceAck, type DeviceAck, type DeviceReceiptEmitter } from './push-ack';
import { messagePreview } from './preview';

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
    /**
     * Publishes the durable receipt event for a device ack. Optional so a deployment that has
     * not wired the bus into this feature still boots — `ackFromDevice` then reports the ack as
     * unsupported instead of silently pretending it succeeded.
     */
    private readonly receipts?: DeviceReceiptEmitter,
    /** The transport, for diagnostics only — this service never sends through it. */
    private readonly push?: { readonly kind: string },
    /**
     * Ask the outbox worker to deliver immediately instead of at its next poll. Optional so a
     * deployment that has not wired it still works — just with the poll interval's latency.
     */
    private readonly kickOutbox?: () => void,
  ) {}

  /**
   * A woken device acknowledging a push (§B4.4). This is the ONLY receipt path that works while
   * the recipient's app is closed, which is exactly the case where a sender otherwise stares at
   * one tick forever. Authenticated by the push token, not a JWT — see `push-ack.ts` for why,
   * and for the blast radius of that choice.
   *
   * Fails CLOSED at every step. Membership is re-checked here even though the push was addressed
   * to this user, because the endpoint row outlives the membership that justified it: a user
   * removed from a group must not keep advancing its watermarks.
   */
  async ackFromDevice(body: unknown): Promise<{ acked: boolean }> {
    const ack: DeviceAck | null = parseDeviceAck(body);
    if (!ack) throw new ValidationError('deviceId, pushToken, conversationId, upToSeq, state');

    const userId = await this.repo.accountForPushToken(ack.deviceId, ack.pushToken);
    if (!userId) {
      // Unknown device, no stored token, or a mismatch — indistinguishable on purpose.
      this.logger.debug({ deviceId: ack.deviceId }, 'device ack rejected: unknown endpoint');
      throw new UnauthorizedError('Unknown push endpoint');
    }

    const members = await this.members.members(ack.conversationId);
    if (!members.includes(userId)) {
      // Empty projection lands here too, and that is the correct answer: "cannot confirm" is not
      // "allow". The same reasoning as ReceiptPublisher.mayPublish.
      this.logger.debug(
        { userId, conversationId: ack.conversationId },
        'device ack rejected: not a member',
      );
      throw new UnauthorizedError('Not a member of this conversation');
    }

    if (!this.receipts) {
      this.logger.warn('device ack received but no receipt emitter is wired');
      return { acked: false };
    }

    await this.receipts.emit(ack.state, userId, ack.conversationId, ack.upToSeq);
    this.logger.debug(
      { userId, conversationId: ack.conversationId, upToSeq: ack.upToSeq, state: ack.state },
      'device ack published',
    );
    return { acked: true };
  }

  async onMessageSent(m: MessageSentPayload): Promise<void> {
    const recipients = (await this.members.members(m.conversation_id)).filter(
      (u) => u !== m.sender_account_id,
    );
    // Computed ONCE per message, not once per recipient: it is pure and identical for everyone
    // in the conversation, and a group of 200 would otherwise redo the same truncation 200 times.
    const preview = messagePreview(m);
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
      // Every FCM data value is a STRING on the wire, so ids and seq are stringified here rather
      // than left for the sender to coerce.
      const queued = await this.repo.enqueue({
        id: uuidv7(),
        userId,
        type: 'message',
        payload: {
          conversationId: m.conversation_id,
          messageId: m.message_id,
          seq: String(m.seq),
          // The sender's ID, not their name. The client already mirrors display names locally
          // (`PushStore.putConversationNames`), so resolving it there costs the server no lookup
          // and keeps one more piece of personal data off the push.
          senderId: m.sender_account_id,
          // `kind` lets the client render "Photo" in ITS language. `preview` is present only
          // when the server genuinely holds readable plaintext — see `preview.ts` for the rule,
          // and for why enabling E2EE tightens this automatically rather than needing a change.
          kind: preview.kind,
          ...(preview.text !== undefined ? { preview: preview.text } : {}),
        },
        dedupeKey: `msg:${m.message_id}:${userId}`,
      });
      this.logger.debug({ userId, messageId: m.message_id, queued }, 'push enqueued');
      // Deliver on the spot. The worker's timer is the safety net, not the delivery path — a
      // notification that arrives seconds late has usually been overtaken by the user opening
      // the app, which reads as never having arrived at all.
      if (queued) this.kickOutbox?.();
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

  /**
   * What transport pushes will really go out on, and whether a device ack can be published.
   *
   * Diagnostics only, and deliberately boolean — it exposes no key, no id and no count. It
   * exists because both of these failures are INVISIBLE from outside: with no `FCM_*` env the
   * router silently becomes a log sender and every push "succeeds" while no phone ever hears
   * anything, and with no event bus wired the ack returns `acked:false`. Answering both in one
   * unauthenticated GET turns a day of guessing into one request.
   */
  pushDiagnostics(): { transport: string; delivers: boolean; canAck: boolean } {
    const transport = this.push?.kind ?? 'unknown';
    return {
      transport,
      // A composite reports what it routes to, so "mobile:none" and "log" both mean undelivered.
      delivers:
        transport !== 'log' && transport !== 'unknown' && !transport.includes('mobile:none'),
      canAck: this.receipts !== undefined,
    };
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
