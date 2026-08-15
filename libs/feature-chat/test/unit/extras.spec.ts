import { isMuted, muteUntilFrom } from '../../src/extras/extras.logic';

const NOW = new Date('2026-07-05T12:00:00.000Z');

describe('mute logic (§A4.8)', () => {
  it('isMuted: false when null / past, true when future', () => {
    expect(isMuted(null, NOW)).toBe(false);
    expect(isMuted('2026-07-05T11:00:00.000Z', NOW)).toBe(false); // past
    expect(isMuted('2026-07-05T13:00:00.000Z', NOW)).toBe(true); // future
  });

  it('muteUntilFrom: off → null (unmute)', () => {
    expect(muteUntilFrom('off', NOW)).toBeNull();
  });

  it('muteUntilFrom: 8h → 8 hours out', () => {
    expect(muteUntilFrom('8h', NOW)).toBe('2026-07-05T20:00:00.000Z');
  });

  it('muteUntilFrom: 1w → 7 days out', () => {
    expect(muteUntilFrom('1w', NOW)).toBe('2026-07-12T12:00:00.000Z');
  });

  it('muteUntilFrom: always → far future, and isMuted reports true', () => {
    const until = muteUntilFrom('always', NOW);
    expect(until).toBe('2999-12-31T00:00:00.000Z');
    expect(isMuted(until, NOW)).toBe(true);
  });

  it('round-trip: an 8h mute is active now but expired 9h later', () => {
    const until = muteUntilFrom('8h', NOW);
    expect(isMuted(until, NOW)).toBe(true);
    expect(isMuted(until, new Date('2026-07-05T21:00:00.000Z'))).toBe(false);
  });
});
