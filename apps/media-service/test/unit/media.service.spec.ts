import { MediaService } from '../../src/media/media.service';
import { NotFoundError, ValidationError, ForbiddenError, GoneError } from '@velchat/common';
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
    renditions: null,
    thumb_key: null,
    blurhash: null,
    width: null,
    height: null,
    duration: null,
    view_once: false,
    viewed_at: null,
    created_at: '2026-06-22T00:00:00.000Z',
  };
}

function ready(mediaId: string, over: Partial<MediaObject> = {}): MediaObject {
  return { ...pending(mediaId), status: 'ready', storage_key: 'media/abc', ...over };
}

function setup(opts: { existsByHash?: boolean; existsInStore?: boolean; others?: number } = {}) {
  const puts: string[] = [];
  const repo = {
    create: jest.fn(async () => undefined),
    markReady: jest.fn(async () => undefined),
    findById: jest.fn(async (id: string) => pending(id)),
    findReadyByContentHash: jest.fn(async () => (opts.existsByHash ? pending('other') : null)),
    listByConversation: jest.fn(async () => [ready('g1'), ready('g2')]),
    deleteById: jest.fn(async () => undefined),
    countOthersByStorageKey: jest.fn(async () => opts.others ?? 0),
    claimViewOnce: jest.fn(async () => true),
    applyRenditions: jest.fn(async () => undefined),
    ownerUsageByType: jest.fn(async () => [
      { key: 'video', count: 2, bytes: 3000 },
      { key: 'image', count: 5, bytes: 1000 },
    ]),
    ownerUsageByConversation: jest.fn(async () => [{ key: 'c1', count: 7, bytes: 4000 }]),
    conversationUsageByType: jest.fn(async () => [{ key: 'image', count: 3, bytes: 1500 }]),
    availability: jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ mediaId: id, available: id !== 'gone' })),
    ),
  } as unknown as MediaRepository;
  const storage = {
    putObject: jest.fn(async (i: { key: string }) => {
      puts.push(i.key);
      return { key: i.key };
    }),
    // Drain the stream so the service's hash/size meter runs to completion (real adapters consume it).
    putObjectStream: jest.fn(async (i: { key: string; body: import('node:stream').Readable }) => {
      puts.push(i.key);
      for await (const _ of i.body) void _;
      return { key: i.key };
    }),
    exists: jest.fn(async () => opts.existsInStore ?? false),
    getSignedUrl: jest.fn(async (k: string) => `https://signed/${k}`),
    deleteObject: jest.fn(async () => undefined),
    name: 'fake',
  } as unknown as ObjectStorage;
  const events = {
    fileUploaded: jest.fn(async () => undefined),
    fileTranscoded: jest.fn(async () => undefined),
    fileDeleted: jest.fn(async () => undefined),
  } as unknown as MediaEvents;
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
    (repo.findById as jest.Mock).mockResolvedValueOnce(ready('m4'));
    const res = await svc.downloadUrl('m4');
    expect(res.url).toBe('https://signed/media/abc');
  });

  it('streamUpload pipes to storage, hashes on the fly, marks ready + emits (no buffering)', async () => {
    const { svc, storage, events, repo } = setup();
    (repo.findById as jest.Mock).mockResolvedValueOnce(pending('s1'));
    const { Readable } = await import('node:stream');
    const src = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    const res = await svc.streamUpload('s1', src, 'image/jpeg', 11);
    expect(res).toMatchObject({ mediaId: 's1', status: 'ready', size: 11, storageKey: 'media/s1' });
    expect(storage.putObjectStream).toHaveBeenCalledTimes(1);
    expect(storage.putObject).not.toHaveBeenCalled(); // streamed, never buffered
    expect(repo.markReady).toHaveBeenCalled();
    expect(events.fileUploaded).toHaveBeenCalled();
  });

  it('streamUpload rejects when Content-Length exceeds the cap (before streaming)', async () => {
    const { svc } = setup();
    const { Readable } = await import('node:stream');
    await expect(
      svc.streamUpload('s2', Readable.from([Buffer.from('x')]), 'video/mp4', 999 * 1024 * 1024),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('ownerUsage totals bytes/count and returns breakdowns (Manage Storage)', async () => {
    const { svc } = setup();
    const u = await svc.ownerUsage('alice');
    expect(u.totalBytes).toBe(4000); // 3000 + 1000
    expect(u.totalCount).toBe(7);
    expect(u.byConversation[0]).toMatchObject({ key: 'c1', bytes: 4000 });
    await expect(svc.ownerUsage('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('conversationUsage totals per-chat bytes/count', async () => {
    const { svc } = setup();
    const u = await svc.conversationUsage('c1');
    expect(u).toMatchObject({ conversationId: 'c1', totalBytes: 1500, totalCount: 3 });
  });

  it('availability reports which media are still fetchable (re-download check)', async () => {
    const { svc } = setup();
    const res = await svc.availability(['m1', 'gone']);
    expect(res).toEqual([
      { mediaId: 'm1', available: true },
      { mediaId: 'gone', available: false },
    ]);
  });

  it('gallery lists a conversation’s media and requires conversationId', async () => {
    const { svc } = setup();
    expect(await svc.gallery('c1')).toHaveLength(2);
    await expect(svc.gallery('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('deleteMedia: owner deletes, blob GC’d when refcount 0', async () => {
    const { svc, repo, storage, events } = setup({ others: 0 });
    (repo.findById as jest.Mock).mockResolvedValueOnce(ready('m5'));
    const res = await svc.deleteMedia('m5', 'alice');
    expect(res).toEqual({ deleted: true, blobRemoved: true });
    expect(storage.deleteObject).toHaveBeenCalledWith('media/abc');
    expect(events.fileDeleted).toHaveBeenCalled();
  });

  it('deleteMedia: keeps blob when another object still references it', async () => {
    const { svc, repo, storage } = setup({ others: 2 });
    (repo.findById as jest.Mock).mockResolvedValueOnce(ready('m6'));
    const res = await svc.deleteMedia('m6', 'alice');
    expect(res.blobRemoved).toBe(false);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('deleteMedia: non-owner is forbidden', async () => {
    const { svc, repo } = setup();
    (repo.findById as jest.Mock).mockResolvedValueOnce(ready('m7'));
    await expect(svc.deleteMedia('m7', 'mallory')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('consumeViewOnce: first view returns url + deletes; replay is 410 Gone', async () => {
    const { svc, repo, storage } = setup({ others: 0 });
    (repo.findById as jest.Mock).mockResolvedValue(ready('v1', { view_once: true }));
    const first = await svc.consumeViewOnce('v1');
    expect(first.url).toBe('https://signed/media/abc');
    expect(storage.deleteObject).toHaveBeenCalled();
    // second attempt: claim fails → Gone
    (repo.claimViewOnce as jest.Mock).mockResolvedValueOnce(false);
    await expect(svc.consumeViewOnce('v1')).rejects.toBeInstanceOf(GoneError);
  });

  it('consumeViewOnce: rejects non-view-once media', async () => {
    const { svc, repo } = setup();
    (repo.findById as jest.Mock).mockResolvedValueOnce(ready('v2', { view_once: false }));
    await expect(svc.consumeViewOnce('v2')).rejects.toBeInstanceOf(ValidationError);
  });

  it('applyRenditions: sets output + emits file.transcoded; rejects encrypted media', async () => {
    const { svc, repo, events } = setup();
    (repo.findById as jest.Mock).mockResolvedValue(ready('t1'));
    await svc.applyRenditions('t1', { blurhash: 'LKO2', width: 100 });
    expect(repo.applyRenditions).toHaveBeenCalled();
    expect(events.fileTranscoded).toHaveBeenCalled();

    (repo.findById as jest.Mock).mockResolvedValueOnce(ready('t2', { encrypted: true }));
    await expect(svc.applyRenditions('t2', {})).rejects.toBeInstanceOf(ValidationError);
  });
});
