import { uuidv7, ValidationError, NotFoundError } from '@velchat/common';
import { PollsRepository } from './polls.repository';
import { PollsCache } from './polls.cache';
import { PollsEvents } from './polls.events';
import { isPollClosed, shapeResults, type PollDoc, type PollResults } from './polls.logic';

export interface CreatePollInput {
  conversationId: string;
  options: string[];
  multi?: boolean;
  anonymous?: boolean;
  closesAt?: string;
  createdBy: string;
}

/** Polls (§B16): create, vote (single/multi), live tally (cached), close. */
export class PollsService {
  constructor(
    private readonly repo: PollsRepository,
    private readonly cache: PollsCache,
    private readonly events: PollsEvents,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPoll(input: CreatePollInput): Promise<PollDoc> {
    if (!input.conversationId) throw new ValidationError('conversationId is required');
    if (!Array.isArray(input.options) || input.options.length < 2) {
      throw new ValidationError('a poll needs at least 2 options');
    }
    const poll: PollDoc = {
      _id: uuidv7(), // the message_id this poll is attached to
      conversation_id: input.conversationId,
      options: input.options.map((text) => ({ id: uuidv7(), text })),
      multi: input.multi ?? false,
      anonymous: input.anonymous ?? false,
      closes_at: input.closesAt ?? null,
      created_by: input.createdBy,
      created_at: this.now().toISOString(),
    };
    await this.repo.createPoll(poll);
    return poll;
  }

  async vote(messageId: string, userId: string, optionIds: string[]): Promise<PollResults> {
    const poll = await this.repo.getPoll(messageId);
    if (!poll) throw new NotFoundError('poll not found');
    if (isPollClosed(poll.closes_at, this.now())) throw new ValidationError('poll is closed');
    if (!Array.isArray(optionIds) || optionIds.length === 0) {
      throw new ValidationError('optionIds is required');
    }
    const valid = new Set(poll.options.map((o) => o.id));
    for (const id of optionIds)
      if (!valid.has(id)) throw new ValidationError(`unknown option: ${id}`);
    if (!poll.multi && optionIds.length > 1) {
      throw new ValidationError('this poll allows only one choice');
    }

    const ts = this.now().toISOString();
    if (!poll.multi) await this.repo.clearUserVotes(messageId, userId); // re-vote replaces
    for (const optionId of optionIds) await this.repo.addVote(messageId, optionId, userId, ts);

    const tally = await this.repo.tally(messageId);
    await this.cache.set(messageId, tally);
    const results = shapeResults(poll, tally.counts, tally.voters, this.now());
    await this.events.pollUpdated(poll.conversation_id, results);
    return results;
  }

  async getResults(messageId: string, viewerIsAdmin = false): Promise<PollResults> {
    const poll = await this.repo.getPoll(messageId);
    if (!poll) throw new NotFoundError('poll not found');
    const cached = await this.cache.get(messageId);
    const tally = cached ?? (await this.repo.tally(messageId));
    if (!cached) await this.cache.set(messageId, tally);
    return shapeResults(poll, tally.counts, tally.voters, this.now(), viewerIsAdmin);
  }

  async close(messageId: string): Promise<PollResults> {
    const poll = await this.repo.getPoll(messageId);
    if (!poll) throw new NotFoundError('poll not found');
    await this.repo.closePoll(messageId, this.now().toISOString());
    return this.getResults(messageId);
  }
}
