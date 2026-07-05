import { ValidationError, NotFoundError, ConflictError } from '@velchat/common';
import type { CallScreenControlRow, ScreenControlStatus } from '@velchat/database';
import { ScreenControlRepository } from './screen-control.repository';
import { ScreenControlEvents } from './screen-control.events';
import { canTransition } from './screen-control.logic';

/**
 * Screen-share remote control (§A4.4). Viewer requests control → sharer grants/denies → either
 * releases/revokes. One active grant per call. Signaling only; input relay is client-side WebRTC.
 */
export class ScreenControlService {
  constructor(
    private readonly repo: ScreenControlRepository,
    private readonly events: ScreenControlEvents,
  ) {}

  /** Viewer asks to control the sharer's screen. Rejects if a request/grant is already live. */
  async request(
    callId: string,
    controllerId: string,
    sharerId: string,
  ): Promise<CallScreenControlRow> {
    if (!callId || !controllerId || !sharerId) {
      throw new ValidationError('callId, controllerId and sharerId are required');
    }
    if (controllerId === sharerId)
      throw new ValidationError('cannot request control of your own screen');
    const live = await this.repo.current(callId);
    if (live)
      throw new ConflictError('a screen-control request/grant is already active for this call');
    const row = await this.repo.create(callId, controllerId, sharerId);
    await this.emit(row);
    return row;
  }

  grant(id: string, actorId: string): Promise<CallScreenControlRow> {
    return this.transition(id, 'active', actorId, 'sharer');
  }
  deny(id: string, actorId: string): Promise<CallScreenControlRow> {
    return this.transition(id, 'denied', actorId, 'sharer');
  }
  release(id: string, actorId: string): Promise<CallScreenControlRow> {
    return this.transition(id, 'released', actorId, 'controller');
  }
  revoke(id: string, actorId: string): Promise<CallScreenControlRow> {
    return this.transition(id, 'revoked', actorId, 'sharer');
  }

  current(callId: string): Promise<CallScreenControlRow | null> {
    return this.repo.current(callId);
  }

  private async transition(
    id: string,
    to: ScreenControlStatus,
    actorId: string,
    who: 'sharer' | 'controller',
  ): Promise<CallScreenControlRow> {
    const row = await this.repo.getById(id);
    if (!row) throw new NotFoundError('screen-control request not found');
    // Only the right party may perform the transition (sharer grants/denies/revokes; controller releases).
    const allowedActor = who === 'sharer' ? row.sharerId : row.controllerId;
    if (actorId !== allowedActor) {
      throw new ValidationError(`only the ${who} may ${to} this control session`);
    }
    if (!canTransition(row.status as ScreenControlStatus, to)) {
      throw new ConflictError(`cannot ${to} a control session in status ${row.status}`);
    }
    const updated = await this.repo.setStatus(id, to);
    if (!updated) throw new NotFoundError('screen-control request not found');
    await this.emit(updated);
    return updated;
  }

  private emit(row: CallScreenControlRow): Promise<void> {
    return this.events.emit({
      callId: row.callId,
      controllerId: row.controllerId,
      sharerId: row.sharerId,
      status: row.status as ScreenControlStatus,
    });
  }
}
