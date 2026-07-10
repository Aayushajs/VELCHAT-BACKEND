import Redis from 'ioredis';
import type { Logger, ManagedResource } from '@velchat/common';

/** Give up connecting after ~10 tries so a missing/unreachable Valkey fails fast at boot instead of
 * ioredis reconnecting forever and spamming "Unhandled error event" in the terminal. */
const MAX_CONNECT_ATTEMPTS = 10;
const CONNECT_TIMEOUT_MS = 10_000;

/** Valkey/Redis client — connection + health. Shared by every service (no per-service copy). */
export class ValkeyClient implements ManagedResource {
  readonly name = 'valkey';
  readonly redis: Redis;
  private connectErrorLogged = false;

  constructor(
    url: string,
    private readonly logger: Logger,
  ) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Bounded reconnect: back off up to 2s, then give up (return null) so we never hang forever.
      retryStrategy: (times) => (times > MAX_CONNECT_ATTEMPTS ? null : Math.min(times * 200, 2000)),
    });
    // Without an 'error' listener ioredis throws "Unhandled error event" and floods the terminal on
    // every failed reconnect. Log once at warn, then stay quiet — health/readiness reports the truth.
    this.redis.on('error', (err: Error) => {
      if (!this.connectErrorLogged) {
        this.logger.warn({ err: err.message }, 'valkey connection error');
        this.connectErrorLogged = true;
      }
    });
    this.redis.on('ready', () => {
      this.connectErrorLogged = false;
    });
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
