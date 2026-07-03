export type Availability = 'available' | 'busy' | 'dnd' | 'away' | 'brb' | 'incall' | 'offline';

export interface ManualStatus {
  availability?: Availability;
  emoji?: string;
  text?: string;
  expiresAt?: number; // epoch ms; expired manual status is ignored
}

export interface PresenceInput {
  onlineDeviceCount: number;
  manual?: ManualStatus | null;
  inCall?: boolean;
  idleMs?: number;
  now?: number;
}

export interface Presence {
  status: Availability;
  emoji?: string;
  text?: string;
}

const IDLE_AWAY_MS = 10 * 60 * 1000;

/**
 * Rich presence resolution (§A15.1) — a pure priority merge of {call-state, manual status, idle,
 * connection}. Call state wins, then an explicit manual status (unless expired), then idle→away,
 * then online→available, else offline. Side-effect-free so it's exhaustively unit-testable.
 */
export function computePresence(i: PresenceInput): Presence {
  const now = i.now ?? Date.now();
  const manual = i.manual && (!i.manual.expiresAt || i.manual.expiresAt > now) ? i.manual : null;
  const label = { emoji: manual?.emoji, text: manual?.text };

  if (i.inCall) return { status: 'incall', ...label };
  if (manual?.availability && manual.availability !== 'available') {
    return { status: manual.availability, ...label };
  }
  if (i.onlineDeviceCount <= 0) return { status: 'offline' };
  if (i.idleMs !== undefined && i.idleMs > IDLE_AWAY_MS) return { status: 'away', ...label };
  return { status: 'available', ...label };
}

/** Coarse bucket for the presence.changed fan-out event (online | away | offline). */
export function coarse(status: Availability): 'online' | 'away' | 'offline' {
  if (status === 'offline') return 'offline';
  if (status === 'away' || status === 'brb') return 'away';
  return 'online';
}
