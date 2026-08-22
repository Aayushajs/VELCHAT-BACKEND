import { CollabService } from '../../src/collab/collab.service';
import type { CanvasRow, ClipRow } from '@velchat/database';

function makeRepo() {
  const canvases = new Map<string, CanvasRow>();
  const clips: ClipRow[] = [];
  let n = 0;
  const now = new Date('2026-07-05T00:00:00Z');
  return {
    async createClip(c: {
      conversationId: string;
      mediaId: string;
      postedBy: string;
      caption: string | null;
      durationSec: number | null;
    }) {
      const row = {
        clipId: `c${++n}`,
        conversationId: c.conversationId,
        mediaId: c.mediaId,
        postedBy: c.postedBy,
        caption: c.caption,
        durationSec: c.durationSec,
        createdAt: now,
      } as ClipRow;
      clips.push(row);
      return row;
    },
    async listClips(cid: string) {
      return clips.filter((c) => c.conversationId === cid);
    },
    async deleteClip(id: string) {
      const i = clips.findIndex((c) => c.clipId === id);
      if (i >= 0) clips.splice(i, 1);
    },
    async createCanvas(c: {
      conversationId: string;
      title: string;
      content: unknown;
      createdBy: string;
    }) {
      const row = {
        canvasId: `cv${++n}`,
        conversationId: c.conversationId,
        title: c.title,
        content: c.content,
        version: 1,
        createdBy: c.createdBy,
        updatedBy: c.createdBy,
        createdAt: now,
        updatedAt: now,
      } as CanvasRow;
      canvases.set(row.canvasId, row);
      return row;
    },
    async getCanvas(id: string) {
      return canvases.get(id) ?? null;
    },
    async listCanvases(cid: string) {
      return [...canvases.values()].filter((c) => c.conversationId === cid);
    },
    async updateCanvas(
      id: string,
      expectedVersion: number,
      patch: { title?: string; content?: unknown; updatedBy: string },
    ) {
      const cur = canvases.get(id);
      if (!cur || cur.version !== expectedVersion) return null; // version moved → concurrent edit
      const upd = {
        ...cur,
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        updatedBy: patch.updatedBy,
        version: cur.version + 1,
      } as CanvasRow;
      canvases.set(id, upd);
      return upd;
    },
  };
}

describe('CollabService (§A4.7)', () => {
  it('posts + lists + deletes clips', async () => {
    const repo = makeRepo();
    const svc = new CollabService(repo as never);
    const clip = await svc.postClip({
      conversationId: 'c1',
      mediaId: 'm1',
      postedBy: 'u1',
      caption: 'hi',
    });
    expect(await svc.listClips('c1')).toHaveLength(1);
    await svc.deleteClip(clip.clipId);
    expect(await svc.listClips('c1')).toHaveLength(0);
  });

  it('clip requires conversationId + mediaId + postedBy', async () => {
    const svc = new CollabService(makeRepo() as never);
    await expect(svc.postClip({ conversationId: '', mediaId: 'm', postedBy: 'u' })).rejects.toThrow(
      /required/,
    );
  });

  it('creates a canvas at version 1 and reads it back', async () => {
    const repo = makeRepo();
    const svc = new CollabService(repo as never);
    const cv = await svc.createCanvas({ conversationId: 'c1', title: 'Plan', createdBy: 'u1' });
    expect(cv.version).toBe(1);
    expect((await svc.getCanvas(cv.canvasId)).title).toBe('Plan');
  });

  it('canvas update bumps version when expectedVersion matches', async () => {
    const repo = makeRepo();
    const svc = new CollabService(repo as never);
    const cv = await svc.createCanvas({ conversationId: 'c1', title: 'Plan', createdBy: 'u1' });
    const updated = await svc.updateCanvas(cv.canvasId, 1, { title: 'Plan v2', updatedBy: 'u2' });
    expect(updated.version).toBe(2);
    expect(updated.title).toBe('Plan v2');
  });

  it('canvas update on a stale version → 409 conflict (§A4.7 co-editing)', async () => {
    const repo = makeRepo();
    const svc = new CollabService(repo as never);
    const cv = await svc.createCanvas({ conversationId: 'c1', title: 'Plan', createdBy: 'u1' });
    await svc.updateCanvas(cv.canvasId, 1, { updatedBy: 'u2', title: 'A' }); // now version 2
    await expect(svc.updateCanvas(cv.canvasId, 1, { updatedBy: 'u3', title: 'B' })).rejects.toThrow(
      /concurrent/,
    );
  });

  it('getCanvas / updateCanvas throw for a missing canvas', async () => {
    const svc = new CollabService(makeRepo() as never);
    await expect(svc.getCanvas('nope')).rejects.toThrow(/not found/);
    await expect(svc.updateCanvas('nope', 1, { updatedBy: 'u' })).rejects.toThrow(/not found/);
  });
});
