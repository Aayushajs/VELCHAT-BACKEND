import { ValidationError } from '@velchat/common';
import {
  ExtrasRepository,
  type ConversationStateDoc,
  type PinDoc,
  type StarDoc,
} from './extras.repository';
import { ExtrasEvents } from './extras.events';
import { muteUntilFrom } from './extras.logic';

/** Chat extras (§A4.1 / §B15): pins, stars/saves, archive/pin-to-top/mute. */
export class ExtrasService {
  constructor(
    private readonly repo: ExtrasRepository,
    private readonly events: ExtrasEvents,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── pins ──
  async pin(conversationId: string, messageId: string, by: string): Promise<{ message: string }> {
    if (!conversationId || !messageId || !by)
      throw new ValidationError('conversationId, messageId, by required');
    await this.repo.pin(conversationId, messageId, by, this.now().toISOString());
    await this.events.pinned(conversationId, messageId, by, true);
    return { message: 'Message pinned.' };
  }

  async unpin(conversationId: string, messageId: string, by: string): Promise<{ message: string }> {
    await this.repo.unpin(conversationId, messageId);
    await this.events.pinned(conversationId, messageId, by, false);
    return { message: 'Message unpinned.' };
  }

  listPins(conversationId: string): Promise<PinDoc[]> {
    return this.repo.listPins(conversationId);
  }

  // ── stars ──
  async star(
    userId: string,
    messageId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    if (!userId || !messageId || !conversationId)
      throw new ValidationError('userId, messageId, conversationId required');
    await this.repo.star(userId, messageId, conversationId, this.now().toISOString());
    return { message: 'Message saved.' };
  }

  async unstar(userId: string, messageId: string): Promise<{ message: string }> {
    await this.repo.unstar(userId, messageId);
    return { message: 'Removed from saved.' };
  }

  listStars(userId: string): Promise<StarDoc[]> {
    return this.repo.listStars(userId);
  }

  // ── per-user conversation state ──
  async archive(
    userId: string,
    conversationId: string,
    archived: boolean,
  ): Promise<ConversationStateDoc> {
    return this.repo.setState(userId, conversationId, { archived }, this.now().toISOString());
  }

  async pinChat(
    userId: string,
    conversationId: string,
    pinned: boolean,
  ): Promise<ConversationStateDoc> {
    return this.repo.setState(userId, conversationId, { pinned }, this.now().toISOString());
  }

  /** Mute a conversation by duration keyword (8h / 1w / always / off). */
  async mute(
    userId: string,
    conversationId: string,
    duration: '8h' | '1w' | 'always' | 'off',
  ): Promise<ConversationStateDoc> {
    const mutedUntil = muteUntilFrom(duration, this.now());
    return this.repo.setState(userId, conversationId, { mutedUntil }, this.now().toISOString());
  }

  getState(userId: string, conversationId: string): Promise<ConversationStateDoc | null> {
    return this.repo.getState(userId, conversationId);
  }

  listArchived(userId: string): Promise<ConversationStateDoc[]> {
    return this.repo.listState(userId, 'archived');
  }

  listPinnedChats(userId: string): Promise<ConversationStateDoc[]> {
    return this.repo.listState(userId, 'pinned');
  }
}
