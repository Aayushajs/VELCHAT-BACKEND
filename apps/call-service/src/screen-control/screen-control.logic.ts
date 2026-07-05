import type { ScreenControlStatus } from '@velchat/database';

/**
 * Screen-share remote-control state machine (§A4.4). A viewer requests control of the sharer's
 * screen; the sharer grants/denies; either side can release/revoke. Terminal states (denied/
 * released/revoked) end a grant — a new request starts a fresh row. PURE + unit-testable.
 *
 *   requested → active   (sharer grants)
 *   requested → denied   (sharer denies)
 *   active    → released (controller gives it up)
 *   active    → revoked  (sharer takes it back)
 */
const ALLOWED: Record<ScreenControlStatus, ScreenControlStatus[]> = {
  requested: ['active', 'denied'],
  active: ['released', 'revoked'],
  denied: [],
  released: [],
  revoked: [],
};

export function canTransition(from: ScreenControlStatus, to: ScreenControlStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function isTerminal(status: ScreenControlStatus): boolean {
  return status === 'denied' || status === 'released' || status === 'revoked';
}
