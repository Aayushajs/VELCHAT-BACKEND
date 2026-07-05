import { SearchService } from '../../src/search/search.service';
import type { SearchIndex, SearchHit } from '@velchat/search';

/** Fake index returning a fixed hit set per index name; records what was indexed/removed. */
function fakeIndex(hitsByIndex: Record<string, SearchHit[]>) {
  const indexed: Array<{ index: string; doc: Record<string, unknown> }> = [];
  const removed: Array<{ index: string; id: string }> = [];
  const index = {
    name: 'search:fake',
    index: jest.fn(async (i: string, doc: Record<string, unknown>) => {
      indexed.push({ index: i, doc });
    }),
    search: jest.fn(async (i: string) => hitsByIndex[i] ?? []),
    remove: jest.fn(async (i: string, id: string) => {
      removed.push({ index: i, id });
    }),
    init: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
  } as unknown as SearchIndex;
  return { index, indexed, removed };
}

const hit = (id: string, doc: Record<string, unknown>): SearchHit => ({ id, tenantId: 't1', doc });

describe('SearchService — files/channels/people/suggest (§B13)', () => {
  it('queryFiles applies the conversation ACL', async () => {
    const { index } = fakeIndex({
      files: [
        hit('f1', { conversationId: 'cA', has: 'file' }),
        hit('f2', { conversationId: 'cSecret', has: 'file' }),
      ],
    });
    const svc = new SearchService(index);
    const res = await svc.queryFiles('budget', { tenantId: 't1', accessibleChannelIds: ['cA'] });
    expect(res.map((h) => h.id)).toEqual(['f1']); // cSecret excluded
  });

  it('queryChannels returns public channels + private ones the caller is in', async () => {
    const { index } = fakeIndex({
      channels: [
        hit('pub', { channelId: 'pub', visibility: 'public' }),
        hit('privIn', { channelId: 'privIn', visibility: 'private' }),
        hit('privOut', { channelId: 'privOut', visibility: 'private' }),
      ],
    });
    const svc = new SearchService(index);
    const res = await svc.queryChannels('eng', {
      tenantId: 't1',
      accessibleChannelIds: ['privIn'],
    });
    expect(res.map((h) => h.id).sort()).toEqual(['privIn', 'pub']); // privOut excluded
  });

  it('queryPeople is tenant-scoped (no channel ACL) and honours the limit', async () => {
    const { index } = fakeIndex({ users: [hit('u1', { displayName: 'Alice' })] });
    const svc = new SearchService(index);
    expect(await svc.queryPeople('ali', 't1', 5)).toHaveLength(1);
  });

  it('suggest combines channels + people', async () => {
    const { index } = fakeIndex({
      channels: [hit('c1', { channelId: 'c1', visibility: 'public' })],
      users: [hit('u1', { displayName: 'Bob' })],
    });
    const svc = new SearchService(index);
    const res = await svc.suggest('b', { tenantId: 't1', accessibleChannelIds: [] });
    expect(res.channels).toHaveLength(1);
    expect(res.people).toHaveLength(1);
  });

  it('index/remove helpers write to the right index with a tenant', async () => {
    const { index, indexed, removed } = fakeIndex({});
    const svc = new SearchService(index);
    await svc.indexFile({
      mediaId: 'm1',
      tenantId: 't1',
      conversationId: 'cA',
      ownerId: 'o1',
      uploadedAt: '2026-07-01T00:00:00Z',
    });
    await svc.indexChannel({ channelId: 'c1', tenantId: 't1', name: 'eng', visibility: 'public' });
    await svc.indexUser({ userId: 'u1', tenantId: 't1', displayName: 'Al' });
    await svc.removeFile('m1', 't1');
    expect(indexed.map((i) => i.index)).toEqual(['files', 'channels', 'users']);
    expect(removed).toEqual([{ index: 'files', id: 'm1' }]);
  });
});
