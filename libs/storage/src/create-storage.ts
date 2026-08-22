import { requireCloudinaryUrl, requireS3Endpoint, type AppConfig } from '@velchat/config';
import type { ObjectStorage } from './storage.port';
import { CloudinaryStorage } from './adapters/cloudinary.storage';
import { S3Storage } from './adapters/s3.storage';
import { AzureBlobStorage } from './adapters/azure-blob.storage';

/**
 * Selects the storage adapter from config:
 *   cloudinary  — free tier, the MVP default
 *   s3          — MinIO, AWS S3, and Oracle Object Storage (all speak the S3 API)
 *   azure-blob  — Azure, which does not
 *
 * Adding a cloud means adding an adapter here, never touching a feature (deploy/PORTABILITY.md).
 */
export function createStorage(config: AppConfig): ObjectStorage {
  if (config.STORAGE_PROVIDER === 'azure-blob') {
    // Fail closed: a half-configured storage provider should stop the boot, not surface later as
    // failing uploads.
    if (!config.AZURE_STORAGE_ACCOUNT || !config.AZURE_STORAGE_KEY) {
      throw new Error(
        'STORAGE_PROVIDER=azure-blob requires AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_KEY',
      );
    }
    return new AzureBlobStorage({
      account: config.AZURE_STORAGE_ACCOUNT,
      accountKey: config.AZURE_STORAGE_KEY,
      container: config.AZURE_STORAGE_CONTAINER,
      endpoint: config.AZURE_BLOB_ENDPOINT,
    });
  }
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
