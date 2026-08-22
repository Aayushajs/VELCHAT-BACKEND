import { canTransition, isTerminal } from '../../src/screen-control/screen-control.logic';

describe('screen-control state machine (§A4.4)', () => {
  it('requested → active | denied are allowed', () => {
    expect(canTransition('requested', 'active')).toBe(true);
    expect(canTransition('requested', 'denied')).toBe(true);
  });

  it('active → released | revoked are allowed', () => {
    expect(canTransition('active', 'released')).toBe(true);
    expect(canTransition('active', 'revoked')).toBe(true);
  });

  it('illegal transitions are rejected', () => {
    expect(canTransition('requested', 'released')).toBe(false); // can't release before granting
    expect(canTransition('requested', 'revoked')).toBe(false);
    expect(canTransition('denied', 'active')).toBe(false); // terminal
    expect(canTransition('released', 'active')).toBe(false);
    expect(canTransition('active', 'denied')).toBe(false);
  });

  it('terminal states', () => {
    expect(isTerminal('denied')).toBe(true);
    expect(isTerminal('released')).toBe(true);
    expect(isTerminal('revoked')).toBe(true);
    expect(isTerminal('requested')).toBe(false);
    expect(isTerminal('active')).toBe(false);
  });
});
