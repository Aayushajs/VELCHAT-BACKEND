import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  CallStartedPayload,
  CallEndedPayload,
  CallParticipantPayload,
  MeetingScheduledPayload,
} from '@velchat/shared-types';
import type { CallType, ParticipantRole } from '@velchat/database';

/** Call events (§A11) → notification (ring), realtime (room fan-out), audit, ai (transcribe). */
export class CallsEvents {
  constructor(private readonly bus: EventBus) {}

  async callStarted(
    callId: string,
    type: CallType,
    hostId: string,
    roomName: string,
    conversationId: string | null,
  ): Promise<void> {
    await this.bus.publish<CallStartedPayload>(
      'call.started',
      buildEnvelope({
        eventType: 'call.started',
        key: callId,
        producer: 'call-service',
        tenantId: null,
        payload: {
          call_id: callId,
          type,
          conversation_id: conversationId,
          host_id: hostId,
          room_name: roomName,
          started_at: new Date().toISOString(),
        },
      }),
    );
  }

  async callEnded(callId: string): Promise<void> {
    await this.bus.publish<CallEndedPayload>(
      'call.ended',
      buildEnvelope({
        eventType: 'call.ended',
        key: callId,
        producer: 'call-service',
        tenantId: null,
        payload: { call_id: callId, ended_at: new Date().toISOString() },
      }),
    );
  }

  async participant(
    kind: 'joined' | 'left',
    callId: string,
    userId: string,
    role: ParticipantRole,
  ): Promise<void> {
    const topic = kind === 'joined' ? 'call.participant.joined' : 'call.participant.left';
    await this.bus.publish<CallParticipantPayload>(
      topic,
      buildEnvelope({
        eventType: topic,
        key: callId,
        producer: 'call-service',
        tenantId: null,
        payload: { call_id: callId, user_id: userId, role, at: new Date().toISOString() },
      }),
    );
  }

  async meetingScheduled(
    meetingId: string,
    callId: string,
    organizerId: string,
    scheduledAt: string | null,
    invitees: string[],
  ): Promise<void> {
    await this.bus.publish<MeetingScheduledPayload>(
      'meeting.scheduled',
      buildEnvelope({
        eventType: 'meeting.scheduled',
        key: meetingId,
        producer: 'call-service',
        tenantId: null,
        payload: {
          meeting_id: meetingId,
          call_id: callId,
          organizer_id: organizerId,
          scheduled_at: scheduledAt,
          invitees,
        },
      }),
    );
  }
}
