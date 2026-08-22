export type FrameKind = 'durable' | 'ephemeral';

export interface Frame {
  kind: FrameKind;
  /** e.g. 'message' (durable) or 'typing' / 'presence' (ephemeral). */
  type: string;
  data: unknown;
}

/**
 * Per-connection bounded send queue (§B9.4). Under backpressure (≥ high-watermark) ephemeral frames
 * (typing/presence) are dropped/coalesced; durable frames (messages) are NEVER dropped — they stay
 * re-syncable by cursor (C16). Coalescing replaces a pending ephemeral of the same type rather than
 * stacking, so a slow client gets the latest typing state, not a backlog.
 */
export class SendQueue {
  private queue: Frame[] = [];

  constructor(private readonly highWatermark = 1000) {}

  /** Returns false if the frame was dropped (only ever happens for ephemeral under pressure). */
  enqueue(frame: Frame): boolean {
    if (frame.kind === 'ephemeral') {
      const existing = this.queue.findIndex((f) => f.kind === 'ephemeral' && f.type === frame.type);
      if (existing >= 0) {
        this.queue[existing] = frame; // coalesce to latest
        return true;
      }
      if (this.queue.length >= this.highWatermark) return false; // drop under pressure
    }
    this.queue.push(frame);
    return true;
  }

  drain(): Frame[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  get size(): number {
    return this.queue.length;
  }
}
