import { CallsService } from '../../src/calls/calls.service';
import { NotFoundError, ForbiddenError, ValidationError, AppError } from '@velchat/common';
import type { CallsRepository } from '../../src/calls/calls.repository';
import type { CallsEvents } from '../../src/calls/calls.events';
import type { CallRow } from '@velchat/database';

function liveCall(over: Partial<CallRow> = {}): CallRow {
  return {
    callId: 'c1',
    type: 'group',
    conversationId: null,
    roomName: 'call_c1',
    hostId: 'host',
    scheduledAt: null,
    startedAt: new Date(),
    endedAt: null,
    lobbyEnabled: false,
    locked: false,
    recordingEnabled: false,
    createdAt: new Date(),
    ...over,
  } as CallRow;
}

function setup(
  call: CallRow | null = liveCall(),
  participants: Array<{ userId: string; leftAt: Date | null }> = [],
) {
  const repo = {
    createCall: jest.fn(async () => undefined),
    getCall: jest.fn(async () => call),
    endCall: jest.fn(async () => true),
    markStarted: jest.fn(async () => undefined),
    addParticipant: jest.fn(async () => undefined),
    markLeft: jest.fn(async () => undefined),
    listParticipants: jest.fn(async () => participants),
    activeParticipantCount: jest.fn(async () => participants.length),
    createMeeting: jest.fn(async () => undefined),
  } as unknown as CallsRepository;
  const events = {
    callStarted: jest.fn(async () => undefined),
    callEnded: jest.fn(async () => undefined),
    participant: jest.fn(async () => undefined),
    meetingScheduled: jest.fn(async () => undefined),
  } as unknown as CallsEvents;
  const livekit = { url: 'wss://lk', apiKey: 'k', apiSecret: 's', ttlSec: 3600 };
  const turn = {
    stunUrls: 'stun:turn.local:3478',
    turnUrls: 'turn:turn.local:3478',
    turnSecret: 'sekret',
    ttlSec: 86400,
  };
  return { svc: new CallsService(repo, events, livekit, turn), repo, events };
}

describe('CallsService (§B12/§A17)', () => {
  it('createCall makes a room, adds host, mints a token, emits call.started', async () => {
    const { svc, repo, events } = setup();
    const res = await svc.createCall({ type: 'group', hostId: 'host' });
    expect(res.token).toBeTruthy();
    expect(res.roomName).toMatch(/^call_/);
    expect(repo.addParticipant).toHaveBeenCalledWith(res.callId, 'host', 'host');
    expect(events.callStarted).toHaveBeenCalled();
  });

  it('join issues a token for a normal (no-lobby) call', async () => {
    const { svc, events } = setup();
    const res = await svc.join('c1', 'bob');
    expect(res.status).toBe('joined');
    expect(res.token).toBeTruthy();
    expect(events.participant).toHaveBeenCalledWith('joined', 'c1', 'bob', 'attendee');
  });

  it('join with lobby returns waiting (no token) until admitted', async () => {
    const { svc } = setup(liveCall({ lobbyEnabled: true }));
    const res = await svc.join('c1', 'bob');
    expect(res.status).toBe('lobby');
    expect(res.token).toBeUndefined();
  });

  it('an admitted participant bypasses the lobby on next join', async () => {
    const { svc } = setup(liveCall({ lobbyEnabled: true }), [{ userId: 'bob', leftAt: null }]);
    const res = await svc.join('c1', 'bob');
    expect(res.status).toBe('joined');
    expect(res.token).toBeTruthy();
  });

  it('join a missing call → NotFound; ended call → Validation', async () => {
    await expect(setup(null).svc.join('x', 'u')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setup(liveCall({ endedAt: new Date() })).svc.join('c1', 'u'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('only the host can end the call', async () => {
    await expect(setup().svc.end('c1', 'bob')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setup().svc.end('c1', 'host')).resolves.toEqual({ ended: true });
  });

  it('503 CALLS_NOT_CONFIGURED when LiveKit creds are missing', async () => {
    const { svc } = setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).livekit = { ttlSec: 3600 };
    await expect(svc.createCall({ type: 'dm', hostId: 'host' })).rejects.toMatchObject({
      code: 'CALLS_NOT_CONFIGURED',
      httpStatus: 503,
    });
    expect(AppError).toBeDefined();
  });

  it('scheduleMeeting creates room + meeting + emits meeting.scheduled', async () => {
    const { svc, repo, events } = setup();
    const res = await svc.scheduleMeeting({
      organizerId: 'org',
      title: 'Sync',
      invitees: ['a', 'b'],
    });
    expect(res.meetingId).toBeTruthy();
    expect(res.joinPath).toBe(`/calls/${res.callId}/join`);
    expect(repo.createMeeting).toHaveBeenCalled();
    expect(events.meetingScheduled).toHaveBeenCalled();
  });
});
