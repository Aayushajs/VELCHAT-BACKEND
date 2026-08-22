import { uuidv7, ValidationError, NotFoundError } from '@velchat/common';
import type { ObjectStorage } from '@velchat/storage';
import { BackupRepository } from './backup.repository';

const MAX_BACKUP_BYTES = 500 * 1024 * 1024; // 500MB cap per backup version

export interface UploadBackupInput {
  accountId: string;
  ciphertext: Buffer;
  /** Base64 KDF salt (not secret) so the client can re-derive its key on restore. */
  salt: string;
  kdf?: string;
}

/**
 * E2EE chat backup (§C21). The server only ever receives ciphertext — the client derives the
 * encryption key from a passphrase / recovery key (Argon2id) on-device. Each upload is a new
 * version; restore fetches the latest ciphertext + salt and decrypts locally. The passphrase and
 * the derived key NEVER reach the server, so a lost passphrase means an unrecoverable backup.
 */
export class BackupService {
  constructor(
    private readonly repo: BackupRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(input: UploadBackupInput): Promise<{ version: number; size: number }> {
    if (!input.accountId) throw new ValidationError('accountId is required');
    if (!input.salt) throw new ValidationError('salt is required (client KDF salt)');
    if (input.ciphertext.length === 0) throw new ValidationError('empty backup');
    if (input.ciphertext.length > MAX_BACKUP_BYTES) throw new ValidationError('backup too large');

    const version = await this.repo.nextVersion(input.accountId);
    const storageKey = `backups/${input.accountId}/${version}`;
    await this.storage.putObject({
      key: storageKey,
      body: input.ciphertext,
      contentType: 'application/octet-stream',
    });
    await this.repo.insert({
      backup_id: uuidv7(),
      account_id: input.accountId,
      version,
      storage_key: storageKey,
      size: input.ciphertext.length,
      kdf: input.kdf ?? 'argon2id',
      salt: input.salt,
    });
    return { version, size: input.ciphertext.length };
  }

  /** Restore: hand back the latest ciphertext (signed URL) + the KDF params to re-derive the key. */
  async latest(
    accountId: string,
    ttlSeconds = 300,
  ): Promise<{
    version: number;
    size: number;
    kdf: string;
    salt: string;
    downloadUrl: string;
    createdAt: string;
  }> {
    const b = await this.repo.latest(accountId);
    if (!b) throw new NotFoundError('no backup for this account');
    return {
      version: b.version,
      size: b.size,
      kdf: b.kdf,
      salt: b.salt,
      downloadUrl: await this.storage.getSignedUrl(b.storage_key, ttlSeconds),
      createdAt: b.created_at,
    };
  }
}
