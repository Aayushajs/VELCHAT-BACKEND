import { NotFoundError, ValidationError } from '@velchat/common';
import { ResendRepository } from './resend.repository';
import { ResendEvents } from './resend.events';
import { decideResend, isTerminal, type ResendStatus } from './resend.logic';

export interface ResendRequestResult {
  status: ResendStatus;
  attempts: number;
  message: string;
}

/**
 * Decryption-failure resend protocol (§G1-1). A recipient device that can't decrypt a message asks
 * the sender to re-encrypt it (fresh ratchet); the sender's device fulfils by uploading a new
 * ciphertext. Bounded retries → once exhausted the message is surfaced as unrecoverable. The server
 * never sees plaintext — it only transports the request + the opaque re-encrypted ciphertext.
 */
export class ResendService {
  constructor(
    private readonly repo: ResendRepository,
    private readonly events: ResendEvents,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Recipient side: "I can't decrypt this message — ask the sender to re-send it." */
  async requestResend(
    messageId: string,
    requesterId: string,
    requesterDeviceId: string,
    ratchetHint?: string,
  ): Promise<ResendRequestResult> {
    if (!messageId || !requesterId || !requesterDeviceId) {
      throw new ValidationError('messageId, requesterId and requesterDeviceId are required');
    }
    const msg = await this.repo.findMessage(messageId);
    if (!msg) throw new NotFoundError('message not found');

    const existing = await this.repo.get(messageId, requesterDeviceId);
    if (existing && isTerminal(existing.status)) {
      return {
        status: existing.status,
        attempts: existing.attempts,
        message:
          existing.status === 'fulfilled'
            ? 'Already re-sent — try decrypting again.'
            : 'This message is unrecoverable (resend attempts exhausted). Ask the sender to share it again.',
      };
    }

    const decision = decideResend(existing?.attempts ?? 0);
    if (!decision.allowed) {
      await this.repo.setStatus(
        messageId,
        requesterDeviceId,
        'exhausted',
        this.now().toISOString(),
      );
      return {
        status: 'exhausted',
        attempts: existing?.attempts ?? 0,
        message: 'This message is unrecoverable (resend attempts exhausted).',
      };
    }

    const row = await this.repo.upsert(
      {
        message_id: messageId,
        conversation_id: msg.conversation_id,
        requester_device_id: requesterDeviceId,
        requester_id: requesterId,
        sender_id: msg.sender_id,
        ratchet_hint: ratchetHint ?? null,
        status: 'requested',
      },
      this.now().toISOString(),
    );

    await this.events.requested({
      conversationId: msg.conversation_id,
      messageId,
      senderId: msg.sender_id,
      requesterId,
      requesterDeviceId,
      ratchetHint: ratchetHint ?? null,
    });

    return {
      status: 'requested',
      attempts: row.attempts,
      message: `Resend requested (attempt ${row.attempts}). The sender's device will re-encrypt it.`,
    };
  }

  /**
   * Sender side: fulfil a pending resend by uploading the freshly re-encrypted ciphertext. The
   * ciphertext is opaque; it's routed to the requesting device via the fulfilled event + the normal
   * per-device delivery path. Marks the request fulfilled.
   */
  async fulfillResend(
    messageId: string,
    requesterDeviceId: string,
    senderId: string,
  ): Promise<{ message: string }> {
    const req = await this.repo.get(messageId, requesterDeviceId);
    if (!req) throw new NotFoundError('no pending resend request for this message/device');
    if (req.sender_id !== senderId) {
      throw new ValidationError('only the original sender can fulfil a resend request');
    }
    await this.repo.setStatus(messageId, requesterDeviceId, 'fulfilled', this.now().toISOString());
    await this.events.fulfilled({
      conversationId: req.conversation_id,
      messageId,
      requesterDeviceId,
    });
    return { message: 'Resend fulfilled — fresh ciphertext routed to the requesting device.' };
  }

  /** Sender flush-on-connect: pending resend requests its devices still need to fulfil. */
  pendingForSender(senderId: string) {
    return this.repo.pendingForSender(senderId);
  }
}
