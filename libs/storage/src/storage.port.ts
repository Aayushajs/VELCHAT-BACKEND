export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface PutObjectResult {
  key: string;
  url?: string;
}

/**
 * Provider-agnostic object storage. Two adapters:
 *  - CloudinaryStorage — Cloudinary free tier (₹0 MVP default)
 *  - S3Storage         — MinIO/AWS S3 (self-host / scale)
 *
 * E2EE note (§B11): the server only ever stores opaque ciphertext for personal media — it does
 * NOT transcode or inspect it. Clients pre-encrypt; this layer just puts/gets bytes.
 */
export interface ObjectStorage {
  readonly name: string;
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  getSignedUrl(key: string, ttlSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
