import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorage, PutObjectInput, PutObjectResult } from './storage.port';

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
}

/** S3-compatible object storage (MinIO self-host / AWS S3). */
export class S3Storage implements ObjectStorage {
  readonly name = 'storage:s3';
  private readonly s3: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    this.s3 = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: true,
      credentials: opts.accessKey
        ? { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey ?? '' }
        : undefined,
    });
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const body = typeof input.body === 'string' ? Buffer.from(input.body) : Buffer.from(input.body);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }

  async getSignedUrl(key: string, ttlSeconds = 3600): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
