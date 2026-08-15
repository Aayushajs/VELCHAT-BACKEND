import { BackupService } from '../../src/backup/backup.service';
import { NotFoundError, ValidationError } from '@velchat/common';
import type { BackupRepository, BackupMeta } from '../../src/backup/backup.repository';
import type { ObjectStorage } from '@velchat/storage';

function setup(latest: BackupMeta | null = null) {
  const puts: Array<{ key: string }> = [];
  let version = 0;
  const repo = {
    nextVersion: jest.fn(async () => (version += 1)),
    insert: jest.fn(async () => undefined),
    latest: jest.fn(async () => latest),
  } as unknown as BackupRepository;
  const storage = {
    putObject: jest.fn(async (i: { key: string }) => {
      puts.push(i);
      return { key: i.key };
    }),
    getSignedUrl: jest.fn(async (k: string) => `https://signed/${k}`),
    exists: jest.fn(async () => false),
    deleteObject: jest.fn(async () => undefined),
    name: 'fake',
  } as unknown as ObjectStorage;
  return { svc: new BackupService(repo, storage), repo, storage, puts };
}

describe('BackupService (§C21)', () => {
  it('stores ciphertext under backups/{account}/{version} + records metadata', async () => {
    const { svc, storage, puts, repo } = setup();
    const res = await svc.upload({
      accountId: 'acc1',
      ciphertext: Buffer.from('ct'),
      salt: 'c2FsdA==',
    });
    expect(res.version).toBe(1);
    expect(puts[0]?.key).toBe('backups/acc1/1');
    expect(storage.putObject).toHaveBeenCalled();
    expect(repo.insert).toHaveBeenCalled();
  });

  it('requires a salt (client KDF salt)', async () => {
    const { svc } = setup();
    await expect(
      svc.upload({ accountId: 'acc1', ciphertext: Buffer.from('ct'), salt: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an empty backup', async () => {
    const { svc } = setup();
    await expect(
      svc.upload({ accountId: 'acc1', ciphertext: Buffer.alloc(0), salt: 's' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('latest returns the KDF salt + a signed download URL', async () => {
    const meta: BackupMeta = {
      backup_id: 'b1',
      account_id: 'acc1',
      version: 3,
      storage_key: 'backups/acc1/3',
      size: 1024,
      kdf: 'argon2id',
      salt: 'c2FsdA==',
      created_at: '2026-06-22T00:00:00.000Z',
    };
    const { svc } = setup(meta);
    const res = await svc.latest('acc1');
    expect(res).toMatchObject({ version: 3, kdf: 'argon2id', salt: 'c2FsdA==' });
    expect(res.downloadUrl).toBe('https://signed/backups/acc1/3');
  });

  it('latest throws NotFound when the account has no backup', async () => {
    const { svc } = setup(null);
    await expect(svc.latest('nobody')).rejects.toBeInstanceOf(NotFoundError);
  });
});
