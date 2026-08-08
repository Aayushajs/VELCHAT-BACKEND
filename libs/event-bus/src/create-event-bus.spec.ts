import { loadConfig } from '@velchat/config';
import { createEventBus } from './create-event-bus';
import { RedisStreamsEventBus } from './adapters/redis-streams.bus';
import { KafkaEventBus } from './adapters/kafka.bus';
import { InMemoryEventBus } from './adapters/in-memory.bus';

const logger = { error() {}, warn() {}, info() {}, debug() {}, fatal() {} } as never;

describe('createEventBus (provider selection)', () => {
  it('defaults to redis-streams (free tier)', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      VALKEY_URL: 'redis://localhost:6379',
    } as NodeJS.ProcessEnv);
    const bus = createEventBus(cfg, logger);
    expect(bus).toBeInstanceOf(RedisStreamsEventBus);
    expect(bus.name).toBe('event-bus:redis-streams');
  });

  it('selects kafka when EVENT_BUS=kafka', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      EVENT_BUS: 'kafka',
      KAFKA_BROKERS: 'localhost:9092',
    } as NodeJS.ProcessEnv);
    const bus = createEventBus(cfg, logger);
    expect(bus).toBeInstanceOf(KafkaEventBus);
  });

  it('selects memory when EVENT_BUS=memory', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      EVENT_BUS: 'memory',
    } as NodeJS.ProcessEnv);
    const bus = createEventBus(cfg, logger);
    expect(bus).toBeInstanceOf(InMemoryEventBus);
    expect(bus.name).toBe('event-bus:in-memory');
  });

  it('fails closed when redis-streams selected without VALKEY_URL', () => {
    const cfg = loadConfig({ SERVICE_NAME: 't' } as NodeJS.ProcessEnv);
    expect(() => createEventBus(cfg, logger)).toThrow(/VALKEY_URL/);
  });
});
