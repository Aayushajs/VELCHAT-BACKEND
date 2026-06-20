import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { ManagedResource } from '@velchat/shared-utils';

export class ValkeyClient implements ManagedResource {
  readonly name = 'valkey';
  readonly redis: Redis;

  constructor(
    url: string,
    private readonly logger: Logger,
  ) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'valkey ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
