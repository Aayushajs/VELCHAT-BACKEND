import { loadConfig } from '@velchat/config';
import { createStorage } from './create-storage';
import { CloudinaryStorage } from './adapters/cloudinary.storage';
import { S3Storage } from './adapters/s3.storage';

describe('createStorage (provider selection)', () => {
  it('defaults to cloudinary (free tier)', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      CLOUDINARY_URL: 'cloudinary://k:s@demo',
    } as NodeJS.ProcessEnv);
    expect(createStorage(cfg)).toBeInstanceOf(CloudinaryStorage);
  });

  it('selects s3 when STORAGE_PROVIDER=s3', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      STORAGE_PROVIDER: 's3',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'velchat-media',
    } as NodeJS.ProcessEnv);
    expect(createStorage(cfg)).toBeInstanceOf(S3Storage);
  });
});
