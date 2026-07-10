import mongoose, { type Connection } from 'mongoose';
import type { Logger, ManagedResource } from '@velchat/common';

/** MongoDB connection + health (chat documents). Shared; each service owns its own collections. */
export class MongoClient implements ManagedResource {
  readonly name = 'mongo';
  private conn?: Connection;

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
  ) {}

  async connect(): Promise<void> {
    // Bounded selection/connect timeouts so an unreachable cluster fails in ~10s instead of the
    // 30s mongoose default (which reads as a silent "long connection" hang during boot).
    this.conn = await mongoose
      .createConnection(this.url, {
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
      })
      .asPromise();
    // Log post-boot connection drops instead of letting them surface as unhandled errors.
    this.conn.on('error', (err: Error) => {
      this.logger.warn({ err: err.message }, 'mongo connection error');
    });
  }

  async ping(): Promise<boolean> {
    if (this.conn?.readyState !== 1) return false;
    this.logger.debug('mongo connected');
    return true;
  }

  async close(): Promise<void> {
    await this.conn?.close();
  }

  get connection(): Connection | undefined {
    return this.conn;
  }

  /**
   * The connected Mongo `Db`. Throws if the connection isn't ready. Repositories access their
   * collections via `mongo.db.collection('…')` instead of repeating the connected-guard everywhere.
   */
  get db() {
    const db = this.conn?.db;
    if (!db) throw new Error('Mongo is not connected');
    return db;
  }
}
