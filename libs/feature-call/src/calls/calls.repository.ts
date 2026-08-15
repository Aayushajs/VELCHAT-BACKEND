import type { PostgresClient } from '@velchat/database';
import type {
  CallRow,
  CallParticipantRow,
  MeetingRow,
  CallType,
  ParticipantRole,
} from '@velchat/database';

export interface NewCall {
  callId: string;
  type: CallType;
  roomName: string;
  hostId: string;
  conversationId?: string | null;
  scheduledAt?: Date | null;
  lobbyEnabled?: boolean;
  recordingEnabled?: boolean;
}

/** Call/meeting metadata (§B12, Postgres). Signaling only — the media plane never touches the DB. */
export class CallsRepository {
  constructor(private readonly pg: PostgresClient) {}

  async createCall(c: NewCall): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO calls(call_id, type, room_name, host_id, conversation_id, scheduled_at,
         started_at, lobby_enabled, recording_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        c.callId,
        c.type,
        c.roomName,
        c.hostId,
        c.conversationId ?? null,
        c.scheduledAt ?? null,
        c.scheduledAt ? null : new Date(), // live calls start now; meetings start on first join
        c.lobbyEnabled ?? false,
        c.recordingEnabled ?? false,
      ],
    );
  }

  async getCall(callId: string): Promise<CallRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM calls WHERE call_id = $1', [callId]);
    return (res.rows[0] as CallRow | undefined) ?? null;
  }

  async endCall(callId: string): Promise<boolean> {
    const res = await this.pg.pool.query(
      'UPDATE calls SET ended_at = now() WHERE call_id = $1 AND ended_at IS NULL',
      [callId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markStarted(callId: string): Promise<void> {
    await this.pg.pool.query(
      'UPDATE calls SET started_at = COALESCE(started_at, now()) WHERE call_id = $1',
      [callId],
    );
  }

  async addParticipant(callId: string, userId: string, role: ParticipantRole): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO call_participants(call_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (call_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now(), role = $3`,
      [callId, userId, role],
    );
  }

  async markLeft(callId: string, userId: string): Promise<void> {
    await this.pg.pool.query(
      'UPDATE call_participants SET left_at = now() WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL',
      [callId, userId],
    );
  }

  async listParticipants(callId: string): Promise<CallParticipantRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM call_participants WHERE call_id = $1 ORDER BY joined_at ASC',
      [callId],
    );
    return res.rows as CallParticipantRow[];
  }

  async activeParticipantCount(callId: string): Promise<number> {
    const res = await this.pg.pool.query(
      'SELECT count(*)::int AS n FROM call_participants WHERE call_id = $1 AND left_at IS NULL',
      [callId],
    );
    return (res.rows[0] as { n: number } | undefined)?.n ?? 0;
  }

  async createMeeting(m: {
    meetingId: string;
    callId: string;
    title?: string | null;
    organizerId: string;
    invitees: string[];
  }): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO meetings(meeting_id, call_id, title, organizer_id, invitees)
       VALUES ($1, $2, $3, $4, $5)`,
      [m.meetingId, m.callId, m.title ?? null, m.organizerId, JSON.stringify(m.invitees)],
    );
  }

  async getMeeting(meetingId: string): Promise<MeetingRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM meetings WHERE meeting_id = $1', [
      meetingId,
    ]);
    return (res.rows[0] as MeetingRow | undefined) ?? null;
  }
}
