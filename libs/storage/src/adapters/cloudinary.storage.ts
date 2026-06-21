import { v2 as cloudinary } from 'cloudinary';
import type { ObjectStorage, PutObjectInput, PutObjectResult } from '../storage.port';

/** Cloudinary object storage (free tier). Configured from a `cloudinary://key:secret@cloud` URL. */
export class CloudinaryStorage implements ObjectStorage {
  readonly name = 'storage:cloudinary';

  constructor(cloudinaryUrl: string) {
    // The SDK reads CLOUDINARY_URL from the environment; set it explicitly for determinism.
    process.env.CLOUDINARY_URL = cloudinaryUrl;
    cloudinary.config({ secure: true });
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const dataUri = toDataUri(input.body, input.contentType);
    const res = await cloudinary.uploader.upload(dataUri, {
      public_id: input.key,
      resource_type: 'auto',
      overwrite: true,
    });
    return { key: res.public_id, url: res.secure_url };
  }

  async getSignedUrl(key: string, _ttlSeconds = 3600): Promise<string> {
    // Signed delivery URL. (Time-bounded token auth is an account feature; enable in P4 if needed.)
    return cloudinary.url(key, { sign_url: true, secure: true });
  }

  async deleteObject(key: string): Promise<void> {
    await cloudinary.uploader.destroy(key, { invalidate: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await cloudinary.api.resource(key);
      return true;
    } catch {
      return false;
    }
  }
}

function toDataUri(body: Buffer | Uint8Array | string, contentType?: string): string {
  const buf = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
  return `data:${contentType ?? 'application/octet-stream'};base64,${buf.toString('base64')}`;
}
