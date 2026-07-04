import { ListsService } from '../../src/lists/lists.service';
import type { ListRow, ListItemRow } from '@velchat/database';
import type { ItemPatch } from '../../src/lists/lists.repository';

function makeRepo() {
  const lists = new Map<string, ListRow>();
  const items = new Map<string, ListItemRow>();
  let n = 0;
  const now = new Date('2026-07-05T00:00:00Z');
  return {
    _lists: lists,
    _items: items,
    lastPatch: undefined as ItemPatch | undefined,
    async createList(conversationId: string, title: string, createdBy: string) {
      const row = {
        listId: `l${++n}`,
        conversationId,
        title,
        createdBy,
        createdAt: now,
        updatedAt: now,
      } as ListRow;
      lists.set(row.listId, row);
      return row;
    },
    async getList(id: string) {
      return lists.get(id) ?? null;
    },
    async listByConversation(cid: string) {
      return [...lists.values()].filter((l) => l.conversationId === cid);
    },
    async deleteList(id: string) {
      lists.delete(id);
    },
    async items(listId: string) {
      return [...items.values()].filter((i) => i.listId === listId);
    },
    async addItem(listId: string, text: string, assignee: string | null, dueAt: Date | null) {
      const row = {
        itemId: `i${++n}`,
        listId,
        text,
        done: false,
        assignee,
        dueAt,
        position: 0,
        createdAt: now,
        updatedAt: now,
      } as ListItemRow;
      items.set(row.itemId, row);
      return row;
    },
    async updateItem(itemId: string, p: ItemPatch) {
      this.lastPatch = p;
      const cur = items.get(itemId);
      if (!cur) return null;
      const upd = { ...cur, ...p } as ListItemRow;
      items.set(itemId, upd);
      return upd;
    },
    async deleteItem(itemId: string) {
      items.delete(itemId);
    },
  };
}

describe('ListsService (§A4.7)', () => {
  it('creates a list + validates required fields', async () => {
    const repo = makeRepo();
    const svc = new ListsService(repo as never);
    const list = await svc.createList('conv1', 'Sprint tasks', 'u1');
    expect(list.title).toBe('Sprint tasks');
    await expect(svc.createList('', 't', 'u1')).rejects.toThrow(/required/);
  });

  it('getList returns the list with its items', async () => {
    const repo = makeRepo();
    const svc = new ListsService(repo as never);
    const list = await svc.createList('conv1', 'L', 'u1');
    await svc.addItem(list.listId, 'do the thing');
    const full = await svc.getList(list.listId);
    expect(full.items).toHaveLength(1);
    expect(full.items[0].text).toBe('do the thing');
  });

  it('getList throws for a missing list', async () => {
    const svc = new ListsService(makeRepo() as never);
    await expect(svc.getList('nope')).rejects.toThrow(/not found/);
  });

  it('addItem requires the list to exist + non-empty text', async () => {
    const repo = makeRepo();
    const svc = new ListsService(repo as never);
    const list = await svc.createList('c', 'L', 'u1');
    await expect(svc.addItem('missing', 'x')).rejects.toThrow(/not found/);
    await expect(svc.addItem(list.listId, '')).rejects.toThrow(/text is required/);
  });

  it('updateItem only sets assignee/dueAt when explicitly provided (clear vs leave-untouched)', async () => {
    const repo = makeRepo();
    const svc = new ListsService(repo as never);
    const list = await svc.createList('c', 'L', 'u1');
    const item = await svc.addItem(list.listId, 'task', 'u2');

    // done-only update → patch must NOT touch assignee/dueAt.
    await svc.updateItem(item.itemId, { done: true });
    expect('assignee' in (repo.lastPatch ?? {})).toBe(false);
    expect('dueAt' in (repo.lastPatch ?? {})).toBe(false);

    // explicit null assignee → patch clears it.
    await svc.updateItem(item.itemId, { assignee: null });
    expect(repo.lastPatch?.assignee).toBeNull();

    // dueAt string → coerced to Date.
    await svc.updateItem(item.itemId, { dueAt: '2026-08-01T00:00:00Z' });
    expect(repo.lastPatch?.dueAt).toBeInstanceOf(Date);
  });

  it('updateItem throws for a missing item', async () => {
    const svc = new ListsService(makeRepo() as never);
    await expect(svc.updateItem('nope', { done: true })).rejects.toThrow(/not found/);
  });
});
