import type { Logger } from 'pino';
import { kafkaBrokers, requireValkeyUrl, type AppConfig } from '@velchat/config';
import type { EventBus } from './event-bus.port';
import { RedisStreamsEventBus } from './adapters/redis-streams.bus';
import { KafkaEventBus } from './adapters/kafka.bus';

/**
 * Selects the event-bus adapter from config. Default `redis-streams` (Upstash free tier);
 * `kafka` for the self-hosted scale profile. Adding a provider is a new adapter + a case here.
 */
export function createEventBus(config: AppConfig, logger: Logger): EventBus {
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
