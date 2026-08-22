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

describe('createStorage — azure-blob (deploy/PORTABILITY.md)', () => {
  const base = { SERVICE_NAME: 't', STORAGE_PROVIDER: 'azure-blob' };

  it('selects the Azure adapter when the account and key are present', () => {
    const storage = createStorage(
      loadConfig({
        ...base,
        AZURE_STORAGE_ACCOUNT: 'acct',
        AZURE_STORAGE_KEY: Buffer.from('k').toString('base64'),
      } as NodeJS.ProcessEnv),
    );
    expect(storage.name).toBe('storage:azure-blob');
  });

  it('refuses to boot when the credentials are half-configured', () => {
    // A missing key must stop the service, not surface later as every upload failing.
    expect(() =>
      createStorage(loadConfig({ ...base, AZURE_STORAGE_ACCOUNT: 'acct' } as NodeJS.ProcessEnv)),
    ).toThrow(/AZURE_STORAGE_KEY/);
  });
});
