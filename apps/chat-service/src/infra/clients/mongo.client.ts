import mongoose, { type Connection } from 'mongoose';
import type { Logger } from 'pino';
import type { ManagedResource } from '@velchat/shared-utils';

export class MongoClient implements ManagedResource {
  readonly name = 'mongo';
  private conn?: Connection;

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
  ) {}

  async connect(): Promise<void> {
    this.conn = await mongoose.createConnection(this.url).asPromise();
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
}
