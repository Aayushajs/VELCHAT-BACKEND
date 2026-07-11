import type { Readable } from 'node:stream';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}

/**
 * Streaming upload — the bytes flow straight from the source to storage and are NEVER fully
 * buffered in the service (industry-level memory management for large media, §A16/§B11). Provide
 * `contentLength` (from the request's Content-Length) so S3 can stream a single PUT without
 * buffering to compute the length.
 */
export interface PutObjectStreamInput {
  key: string;
  body: Readable;
  contentType?: string;
  contentLength?: number;
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
  /** Streaming upload — no full-file buffering (memory-safe for large media). */
  putObjectStream(input: PutObjectStreamInput): Promise<PutObjectResult>;
  getSignedUrl(key: string, ttlSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
