import { monoEventBusDefault } from './event-bus-default';

/**
 * `mono` is ONE process. Every event it publishes is consumed by itself.
 *
 * The default provider is `redis-streams`, which is right for a split deployment and wrong here:
 * it sends every event out to Redis and reads it back through a consumer group, so a single
 * process depends on stream creation, group creation and an XREADGROUP loop to talk to itself.
 * If any of that does not deliver, the symptom is silent and total — messages are stored and
 * acknowledged, but nothing is ever fanned out to a socket, so realtime "just does not work"
 * while every REST call looks perfectly healthy.
 *
 * Correct by default rather than by runbook: nothing about deploying a single-process build
 * should require an operator to know this.
 */
describe('mono event-bus default', () => {
  it('uses the in-process bus when nothing is configured', () => {
    expect(monoEventBusDefault({})).toBe('memory');
  });

  it('never overrides an explicit choice', () => {
    // A deliberate split deployment (or a debugging session) must still get what it asked for.
    expect(monoEventBusDefault({ EVENT_BUS: 'redis-streams' })).toBe('redis-streams');
    expect(monoEventBusDefault({ EVENT_BUS: 'kafka' })).toBe('kafka');
  });

  it('ignores an empty value, which is how an unset compose variable arrives', () => {
    expect(monoEventBusDefault({ EVENT_BUS: '' })).toBe('memory');
    expect(monoEventBusDefault({ EVENT_BUS: '   ' })).toBe('memory');
  });
});
