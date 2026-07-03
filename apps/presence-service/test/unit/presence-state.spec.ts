import { computePresence, coarse } from '../../src/presence/presence-state';

const NOW = 1_800_000_000_000;

describe('computePresence (§A15.1 priority merge)', () => {
  it('offline when no devices + no manual status', () => {
    expect(computePresence({ onlineDeviceCount: 0, now: NOW }).status).toBe('offline');
  });
  it('available when online, no manual', () => {
    expect(computePresence({ onlineDeviceCount: 1, now: NOW }).status).toBe('available');
  });
  it('call state wins over everything', () => {
    expect(
      computePresence({
        onlineDeviceCount: 1,
        inCall: true,
        manual: { availability: 'dnd' },
        now: NOW,
      }).status,
    ).toBe('incall');
  });
  it('manual busy/dnd overrides plain online', () => {
    expect(
      computePresence({ onlineDeviceCount: 1, manual: { availability: 'dnd' }, now: NOW }).status,
    ).toBe('dnd');
  });
  it('expired manual status is ignored', () => {
    const m = { availability: 'busy' as const, expiresAt: NOW - 1000 };
    expect(computePresence({ onlineDeviceCount: 1, manual: m, now: NOW }).status).toBe('available');
  });
  it('idle → away when online with no overriding manual state', () => {
    expect(computePresence({ onlineDeviceCount: 1, idleMs: 20 * 60 * 1000, now: NOW }).status).toBe(
      'away',
    );
  });
  it('carries emoji/text from an active manual status', () => {
    const p = computePresence({
      onlineDeviceCount: 1,
      manual: { emoji: '🎯', text: 'focus' },
      now: NOW,
    });
    expect(p).toMatchObject({ status: 'available', emoji: '🎯', text: 'focus' });
  });
});

describe('coarse (fan-out bucket)', () => {
  it('maps rich → online/away/offline', () => {
    expect(coarse('incall')).toBe('online');
    expect(coarse('dnd')).toBe('online');
    expect(coarse('brb')).toBe('away');
    expect(coarse('away')).toBe('away');
    expect(coarse('offline')).toBe('offline');
  });
});
