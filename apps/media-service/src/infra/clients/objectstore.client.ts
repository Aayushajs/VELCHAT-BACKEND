import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Logger } from 'pino';
import type { ManagedResource } from '@velchat/shared-utils';

export class ObjectStoreClient implements ManagedResource {
  readonly name = 's3';
  readonly s3: S3Client;

  constructor(
    private readonly opts: {
      endpoint: string;
      region: string;
      accessKey?: string;
      secretKey?: string;
      bucket?: string;
    },
    private readonly logger: Logger,
  ) {
    this.s3 = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: true,
      credentials: opts.accessKey
        ? { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey ?? '' }
        : undefined,
    });
  }

  async connect(): Promise<void> {
    await this.ping();
  }

  async ping(): Promise<boolean> {
    if (!this.opts.bucket) return true;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.opts.bucket }));
      return true;
    } catch (err) {
      this.logger.debug({ err: String(err) }, 's3 ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    this.s3.destroy();
  }
}
