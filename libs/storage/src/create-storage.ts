import { requireCloudinaryUrl, requireS3Endpoint, type AppConfig } from '@velchat/config';
import type { ObjectStorage } from './storage.port';
import { CloudinaryStorage } from './cloudinary.storage';
import { S3Storage } from './s3.storage';

/** Selects the storage adapter from config. Default `cloudinary` (free); `s3` for MinIO/AWS. */
export function createStorage(config: AppConfig): ObjectStorage {
  if (config.STORAGE_PROVIDER === 's3') {
    return new S3Storage({
      endpoint: requireS3Endpoint(config),
      region: config.S3_REGION,
      bucket: config.S3_BUCKET ?? 'velchat-media',
      accessKey: config.S3_ACCESS_KEY,
      secretKey: config.S3_SECRET_KEY,
    });
  }
  return new CloudinaryStorage(requireCloudinaryUrl(config));
}
