import type { Logger } from 'pino';
import { kafkaBrokers, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { EventBus } from './event-bus.port';
import { RedisStreamsEventBus } from './adapters/redis-streams.bus';
import { KafkaEventBus } from './adapters/kafka.bus';
import { InMemoryEventBus } from './adapters/in-memory.bus';

/**
 * Selects the event-bus adapter from config.
 * - `redis-streams`: Upstash / Valkey free tier
 * - `kafka`: self-hosted scale profile
 * - `memory`: in-process zero-dependency execution for dev / monolith / offline testing
 */
export function createEventBus(config: AppConfig, logger: Logger): EventBus {
  if (config.EVENT_BUS === 'memory') {
    return new InMemoryEventBus(logger);
  }
  if (config.EVENT_BUS === 'kafka') {
    if (!config.KAFKA_BROKERS) {
      throw new Error('EVENT_BUS=kafka requires KAFKA_BROKERS to be set');
    }
    return new KafkaEventBus(
      {
        clientId: config.KAFKA_CLIENT_ID,
        brokers: kafkaBrokers(config),
        redisUrl: config.VALKEY_URL,
      },
      logger,
    );
  }
  return new RedisStreamsEventBus(requireValkeyUrl(config), logger);
}
