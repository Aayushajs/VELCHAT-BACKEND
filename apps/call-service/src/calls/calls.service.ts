import { uuidv7, ValidationError, NotFoundError, ForbiddenError, AppError } from '@velchat/common';
import type { CallType } from '@velchat/database';
import { CallsRepository } from './calls.repository';
import { CallsEvents } from './calls.events';
import { mintLivekitToken } from './livekit-token';

export interface LivekitConfig {
  url?: string;
  apiKey?: string;
  apiSecret?: string;
  ttlSec: number;
}

export interface CreateCallInput {
  type: CallType;
  hostId: string;
  conversationId?: string;
  lobbyEnabled?: boolean;
  recordingEnabled?: boolean;
}

export interface ScheduleMeetingInput {
  organizerId: string;
  title?: string;
  scheduledAt?: string; // ISO
  invitees?: string[];
  conversationId?: string;
  lobbyEnabled?: boolean;
}

export interface JoinResult {
  status: 'joined' | 'lobby';
  roomName: string;
  url?: string;
  token?: string;
}

/**
 * Call/meeting signaling (§B12 / §A17). Creates rooms, mints LiveKit join tokens, tracks
 * participants + lobby, and emits call.* events. The media itself flows peer → coturn → LiveKit SFU
 * and never through this service. E2EE personal calls keep media encrypted end-to-end (server relays
 * only signaling); enterprise meetings can be recorded/transcribed downstream.
 */
export class CallsService {
  constructor(
    private readonly repo: CallsRepository,
    private readonly events: CallsEvents,
    private readonly livekit: LivekitConfig,
  ) {}

  private token(room: string, identity: string, canPublish = true): string {
    if (!this.livekit.apiKey || !this.livekit.apiSecret) {
      throw new AppError(
        'CALLS_NOT_CONFIGURED',
        'Calls are not configured — set LIVEKIT_API_KEY and LIVEKIT_API_SECRET',
        503,
      );
    }
    return mintLivekitToken(this.livekit.apiKey, this.livekit.apiSecret, {
      room,
      identity,
      canPublish,
      ttlSec: this.livekit.ttlSec,
    });
  }

  /** Start a live 1:1/group/huddle room; host joins immediately with a token. */
  async createCall(
    input: CreateCallInput,
  ): Promise<{ callId: string; roomName: string; url?: string; token: string }> {
    if (!input.hostId) throw new ValidationError('hostId is required');
    const callId = uuidv7();
    const roomName = `call_${callId}`;
    await this.repo.createCall({
      callId,
      type: input.type,
      roomName,
      hostId: input.hostId,
      conversationId: input.conversationId ?? null,
      lobbyEnabled: input.lobbyEnabled ?? false,
      recordingEnabled: input.recordingEnabled ?? false,
    });
    await this.repo.addParticipant(callId, input.hostId, 'host');
    const token = this.token(roomName, input.hostId);
    await this.events.callStarted(
      callId,
      input.type,
      input.hostId,
      roomName,
      input.conversationId ?? null,
    );
    await this.events.participant('joined', callId, input.hostId, 'host');
    return { callId, roomName, url: this.livekit.url, token };
  }

  /** Join an existing call. Lobby-gated joiners wait until the host admits them. */
  async join(callId: string, userId: string): Promise<JoinResult> {
    if (!userId) throw new ValidationError('userId is required');
    const call = await this.repo.getCall(callId);
    if (!call) throw new NotFoundError('call not found');
    if (call.endedAt) throw new ValidationError('call has ended');
    if (call.locked && userId !== call.hostId) throw new ForbiddenError('call is locked');

    const isHost = userId === call.hostId;
    const alreadyIn = (await this.repo.listParticipants(callId)).some(
      (p) => p.userId === userId && p.leftAt === null,
    );
    if (call.lobbyEnabled && !isHost && !alreadyIn) {
      return { status: 'lobby', roomName: call.roomName }; // host must admit (see admit())
    }

    await this.repo.addParticipant(callId, userId, isHost ? 'host' : 'attendee');
    await this.repo.markStarted(callId);
    await this.events.participant('joined', callId, userId, isHost ? 'host' : 'attendee');
    return {
      status: 'joined',
      roomName: call.roomName,
      url: this.livekit.url,
      token: this.token(call.roomName, userId),
    };
  }

  /** Host admits a lobby waiter → they become an active participant and can then join with a token. */
  async admit(callId: string, hostId: string, userId: string): Promise<{ admitted: true }> {
    const call = await this.repo.getCall(callId);
    if (!call) throw new NotFoundError('call not found');
    if (call.hostId !== hostId) throw new ForbiddenError('only the host can admit');
    await this.repo.addParticipant(callId, userId, 'attendee');
    await this.events.participant('joined', callId, userId, 'attendee');
    return { admitted: true };
  }

  async leave(callId: string, userId: string): Promise<void> {
    const call = await this.repo.getCall(callId);
    if (!call) throw new NotFoundError('call not found');
    await this.repo.markLeft(callId, userId);
    await this.events.participant(
      'left',
      callId,
      userId,
      userId === call.hostId ? 'host' : 'attendee',
    );
  }

  /** End the call for everyone — host only. */
  async end(callId: string, actorId: string): Promise<{ ended: boolean }> {
    const call = await this.repo.getCall(callId);
    if (!call) throw new NotFoundError('call not found');
    if (call.hostId !== actorId) throw new ForbiddenError('only the host can end the call');
    const ended = await this.repo.endCall(callId);
    if (ended) await this.events.callEnded(callId);
    return { ended };
  }

  async info(callId: string): Promise<{ call: unknown; participants: unknown[] }> {
    const call = await this.repo.getCall(callId);
    if (!call) throw new NotFoundError('call not found');
    return { call, participants: await this.repo.listParticipants(callId) };
  }

  /** Schedule a meeting (§A17.3) — creates the room + meeting metadata, emits meeting.scheduled. */
  async scheduleMeeting(
    input: ScheduleMeetingInput,
  ): Promise<{ meetingId: string; callId: string; joinPath: string }> {
    if (!input.organizerId) throw new ValidationError('organizerId is required');
    const callId = uuidv7();
    const meetingId = uuidv7();
    const roomName = `meet_${callId}`;
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (input.scheduledAt && Number.isNaN(scheduledAt!.getTime())) {
      throw new ValidationError('scheduledAt must be a valid ISO date');
    }
    await this.repo.createCall({
      callId,
      type: 'meeting',
      roomName,
      hostId: input.organizerId,
      conversationId: input.conversationId ?? null,
      scheduledAt,
      lobbyEnabled: input.lobbyEnabled ?? true, // meetings default to a waiting room
    });
    const invitees = input.invitees ?? [];
    await this.repo.createMeeting({
      meetingId,
      callId,
      title: input.title ?? null,
      organizerId: input.organizerId,
      invitees,
    });
    await this.events.meetingScheduled(
      meetingId,
      callId,
      input.organizerId,
      scheduledAt ? scheduledAt.toISOString() : null,
      invitees,
    );
    return { meetingId, callId, joinPath: `/calls/${callId}/join` };
  }
}
