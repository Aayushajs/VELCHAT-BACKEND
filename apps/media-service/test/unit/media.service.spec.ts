import { MediaService } from '../../src/media/media.service';
import { NotFoundError, ValidationError } from '@velchat/common';
import type { MediaRepository } from '../../src/media/media.repository';
import type { MediaEvents } from '../../src/media/media.events';
import type { ObjectStorage } from '@velchat/storage';
import type { MediaObject } from '../../src/media/media.types';

function pending(mediaId: string): MediaObject {
  return {
    media_id: mediaId,
    owner_id: 'alice',
    conversation_id: null,
    tenant_id: null,
    content_hash: null,
    mime: 'image/jpeg',
    size: null,
    status: 'pending',
    encrypted: false,
    storage_key: null,
    view_once: false,
    created_at: '2026-06-22T00:00:00.000Z',
  };
}

function setup(opts: { existsByHash?: boolean; existsInStore?: boolean } = {}) {
  const puts: string[] = [];
  const repo = {
    create: jest.fn(async () => undefined),
    markReady: jest.fn(async () => undefined),
    findById: jest.fn(async (id: string) => pending(id)),
    findReadyByContentHash: jest.fn(async () => (opts.existsByHash ? pending('other') : null)),
  } as unknown as MediaRepository;
  const storage = {
    putObject: jest.fn(async (i: { key: string }) => {
      puts.push(i.key);
      return { key: i.key };
    }),
    exists: jest.fn(async () => opts.existsInStore ?? false),
    getSignedUrl: jest.fn(async (k: string) => `https://signed/${k}`),
    deleteObject: jest.fn(async () => undefined),
    name: 'fake',
  } as unknown as ObjectStorage;
  const events = { fileUploaded: jest.fn(async () => undefined) } as unknown as MediaEvents;
  return { svc: new MediaService(repo, storage, events), repo, storage, events, puts };
}

describe('MediaService (§B11)', () => {
  it('initUpload reserves an id and returns the upload path', async () => {
    const { svc, repo } = setup();
    const res = await svc.initUpload({ ownerId: 'alice', mime: 'image/jpeg' });
    expect(res.uploadPath).toBe(`/media/uploads/${res.mediaId}`);
    expect(repo.create).toHaveBeenCalled();
  });

  it('completeUpload stores new bytes, marks ready, emits file.uploaded', async () => {
    const { svc, storage, events, puts } = setup();
    const res = await svc.completeUpload('m1', Buffer.from('hello'));
    expect(res.deduped).toBe(false);
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(puts[0]).toMatch(/^media\/[0-9a-f]{64}$/); // content-addressed key
    expect(events.fileUploaded).toHaveBeenCalled();
  });

  it('dedupes identical bytes (no second put)', async () => {
    const { svc, storage } = setup({ existsByHash: true });
    const res = await svc.completeUpload('m2', Buffer.from('hello'));
    expect(res.deduped).toBe(true);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects an empty upload', async () => {
    const { svc } = setup();
    await expect(svc.completeUpload('m3', Buffer.alloc(0))).rejects.toBeInstanceOf(ValidationError);
  });

  it('completeUpload on an unknown media id throws NotFound', async () => {
    const { svc, repo } = setup();
    (repo.findById as jest.Mock).mockResolvedValueOnce(null);
    await expect(svc.completeUpload('ghost', Buffer.from('x'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('downloadUrl returns a signed url for ready media', async () => {
    const { svc, repo } = setup();
    (repo.findById as jest.Mock).mockResolvedValueOnce({
      ...pending('m4'),
      status: 'ready',
      storage_key: 'media/abc',
    });
    const res = await svc.downloadUrl('m4');
    expect(res.url).toBe('https://signed/media/abc');
  });
});
