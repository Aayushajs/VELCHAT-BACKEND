import { createHmac } from 'node:crypto';
import type { Readable } from 'node:stream';
import type {
  ObjectStorage,
  PutObjectInput,
  PutObjectResult,
  PutObjectStreamInput,
} from '../storage.port';

/** REST API version the request headers and the SAS signature are built for. */
const API_VERSION = '2021-08-06';

export interface AzureBlobStorageOptions {
  /** Storage account name. */
  account: string;
  /** Base64 account key. It signs requests and is never transmitted. */
  accountKey: string;
  container: string;
  /** Endpoint override — used by tests and by Azurite. Defaults to the public blob endpoint. */
  endpoint?: string;
}

/**
 * Azure Blob Storage, over the REST API with Shared Key authentication.
 *
 * Azure Blob is the one target that is NOT S3-compatible, so the `s3` adapter cannot reach it and a
 * dedicated adapter is what makes Azure a real deployment option (deploy/PORTABILITY.md). It is
 * written against the REST API rather than `@azure/storage-blob` deliberately: the signing scheme
 * is a few dozen lines of HMAC that node's crypto already covers, so an SDK would add a dependency
 * and a second HTTP stack for no capability gain.
 *
 * E2EE note (§B11): as with every adapter here, personal media arrives already encrypted by the
 * client. This layer moves opaque bytes and never inspects or transcodes them.
 */
export class AzureBlobStorage implements ObjectStorage {
  readonly name = 'storage:azure-blob';
  private readonly key: Buffer;
  private readonly base: string;

  constructor(private readonly opts: AzureBlobStorageOptions) {
    this.key = Buffer.from(opts.accountKey, 'base64');
    this.base = (opts.endpoint ?? `https://${opts.account}.blob.core.windows.net`).replace(
      /\/+$/,
      '',
    );
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const body = Buffer.isBuffer(input.body)
      ? input.body
      : Buffer.from(input.body as Uint8Array | string);
    await this.send('PUT', input.key, {
      body,
      contentLength: body.byteLength,
      contentType: input.contentType,
      extraHeaders: { 'x-ms-blob-type': 'BlockBlob' },
    });
    return { key: input.key, url: this.blobUrl(input.key) };
  }

  async putObjectStream(input: PutObjectStreamInput): Promise<PutObjectResult> {
    // Streamed straight through: bytes are never fully buffered in the service, which is what keeps
    // large-media uploads memory-safe (§A16).
    await this.send('PUT', input.key, {
      body: input.body,
      contentLength: input.contentLength,
      contentType: input.contentType,
      extraHeaders: { 'x-ms-blob-type': 'BlockBlob' },
    });
    return { key: input.key, url: this.blobUrl(input.key) };
  }

  /**
   * Short-lived, read-only Service SAS for one blob. Read-only and blob-scoped on purpose: a
   * download link must never be usable to overwrite, delete, or enumerate the container.
   */
  async getSignedUrl(key: string, ttlSeconds = 900): Promise<string> {
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const start = iso(new Date(Date.now() - 60_000)); // small skew allowance
    const expiry = iso(new Date(Date.now() + ttlSeconds * 1000));
    const permissions = 'r';
    const resource = 'b';

    // Field order is fixed by the SAS version; every blank is a field Azure expects present-empty.
    const stringToSign = [
      permissions,
      start,
      expiry,
      `/blob/${this.opts.account}/${this.opts.container}/${key}`,
      '', // signed identifier
      '', // ip range
      '', // protocol
      API_VERSION,
      resource,
      '', // snapshot time
      '', // encryption scope
      '', // rscc
      '', // rscd
      '', // rsce
      '', // rscl
      '', // rsct
    ].join('\n');

    const qs = new URLSearchParams({
      sv: API_VERSION,
      st: start,
      se: expiry,
      sr: resource,
      sp: permissions,
      sig: createHmac('sha256', this.key).update(stringToSign, 'utf8').digest('base64'),
    });
    return `${this.blobUrl(key)}?${qs.toString()}`;
  }

  async deleteObject(key: string): Promise<void> {
    await this.send('DELETE', key, {});
  }

  async exists(key: string): Promise<boolean> {
    // HEAD, so checking a 2 GB video costs one round trip and no bytes.
    const res = await this.send('HEAD', key, { allow404: true });
    return res.status !== 404;
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /** Percent-encode each segment but keep `/`, so a key's folder structure survives. */
  private encodeKey(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  private blobUrl(key: string): string {
    return `${this.base}/${this.opts.container}/${this.encodeKey(key)}`;
  }

  private async send(
    method: 'PUT' | 'DELETE' | 'HEAD' | 'GET',
    key: string,
    opts: {
      body?: Buffer | Readable;
      contentLength?: number;
      contentType?: string;
      extraHeaders?: Record<string, string>;
      allow404?: boolean;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'x-ms-date': new Date().toUTCString(),
      'x-ms-version': API_VERSION,
      ...(opts.extraHeaders ?? {}),
    };
    if (opts.contentType) headers['content-type'] = opts.contentType;
    if (opts.contentLength !== undefined) headers['content-length'] = String(opts.contentLength);
    headers['authorization'] = this.sharedKey(method, key, headers);

    const streaming = opts.body !== undefined && !Buffer.isBuffer(opts.body);
    const res = await fetch(this.blobUrl(key), {
      method,
      headers,
      body: opts.body as unknown as RequestInit['body'],
      // Node requires this to stream a Readable body rather than buffering it first.
      ...(streaming ? { duplex: 'half' } : {}),
    } as RequestInit);

    if (!res.ok && !(opts.allow404 && res.status === 404)) {
      throw new Error(`azure-blob ${method} ${key} failed: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  /**
   * Shared Key signature. The layout is defined by Azure and is position-sensitive — each blank
   * line is a header Azure expects to be present and empty for these calls. Note that
   * Content-Length must be empty rather than "0" when there is no body.
   */
  private sharedKey(method: string, key: string, headers: Record<string, string>): string {
    const canonicalHeaders = Object.entries(headers)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(([name]) => name.startsWith('x-ms-'))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, value]) => `${name}:${value}`)
      .join('\n');

    const stringToSign = [
      method,
      '', // Content-Encoding
      '', // Content-Language
      headers['content-length'] ?? '',
      '', // Content-MD5
      headers['content-type'] ?? '',
      '', // Date — superseded by x-ms-date
      '', // If-Modified-Since
      '', // If-Match
      '', // If-None-Match
      '', // If-Unmodified-Since
      '', // Range
      canonicalHeaders,
      `/${this.opts.account}/${this.opts.container}/${this.encodeKey(key)}`,
    ].join('\n');

    const sig = createHmac('sha256', this.key).update(stringToSign, 'utf8').digest('base64');
    return `SharedKey ${this.opts.account}:${sig}`;
  }
}
