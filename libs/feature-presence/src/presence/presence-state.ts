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

/**
 * Who may see a presence signal (last-seen / online), mirroring WhatsApp's privacy model.
 * `everyone` — anyone; `contacts` — only the owner's contacts; `nobody` — no one.
 */
export type Visibility = 'everyone' | 'contacts' | 'nobody';

export interface PresencePrivacy {
  /** Who can see the owner's last-seen timestamp. */
  lastSeen: Visibility;
  /** Who can see the owner as online / typing. */
  online: Visibility;
}

export const DEFAULT_PRIVACY: PresencePrivacy = { lastSeen: 'everyone', online: 'everyone' };

export interface VisibilityCtx {
  /** The owner's own setting for this signal. */
  owner: Visibility;
  /** The viewer's own setting for the SAME signal (drives the reciprocity rule). */
  viewer: Visibility;
  /** Whether the viewer is in the owner's contacts (resolved upstream in user-service). */
  viewerIsContact: boolean;
  /** True when the owner is looking at their own presence — always visible. */
  isSelf: boolean;
}

/**
 * Resolve whether a viewer may see one presence signal (§B8 "respect privacy flags before
 * exposure"). Pure + side-effect-free so it's exhaustively unit-testable. Fails closed.
 *
 * WhatsApp reciprocity: if you hide your own last-seen from everyone (`nobody`), you can't see
 * anyone else's either — modelled here by denying when the viewer's own setting is `nobody`.
 */
export function canSee(ctx: VisibilityCtx): boolean {
  if (ctx.isSelf) return true;
  if (ctx.owner === 'nobody') return false;
  if (ctx.viewer === 'nobody') return false; // reciprocity
  if (ctx.owner === 'contacts') return ctx.viewerIsContact;
  return true; // everyone
}
