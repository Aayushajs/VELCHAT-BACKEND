import { NotFoundError, ValidationError } from '@velchat/common';
import type { ListRow, ListItemRow } from '@velchat/database';
import { ListsRepository, type ItemPatch } from './lists.repository';

export interface ListWithItems extends ListRow {
  items: ListItemRow[];
}

/** Lists (§A4.7): channel-attached task/tracking lists with orderable, assignable, completable items. */
export class ListsService {
  constructor(private readonly repo: ListsRepository) {}

  async createList(conversationId: string, title: string, createdBy: string): Promise<ListRow> {
    if (!conversationId || !title || !createdBy) {
      throw new ValidationError('conversationId, title and createdBy are required');
    }
    return this.repo.createList(conversationId, title, createdBy);
  }

  listByConversation(conversationId: string): Promise<ListRow[]> {
    return this.repo.listByConversation(conversationId);
  }

  async getList(listId: string): Promise<ListWithItems> {
    const list = await this.repo.getList(listId);
    if (!list) throw new NotFoundError('list not found');
    return { ...list, items: await this.repo.items(listId) };
  }

  async deleteList(listId: string): Promise<{ message: string }> {
    if (!(await this.repo.getList(listId))) throw new NotFoundError('list not found');
    await this.repo.deleteList(listId);
    return { message: 'List deleted.' };
  }

  async addItem(
    listId: string,
    text: string,
    assignee?: string,
    dueAt?: string,
  ): Promise<ListItemRow> {
    if (!(await this.repo.getList(listId))) throw new NotFoundError('list not found');
    if (!text) throw new ValidationError('item text is required');
    return this.repo.addItem(listId, text, assignee ?? null, dueAt ? new Date(dueAt) : null);
  }

  async updateItem(
    itemId: string,
    patch: {
      text?: string;
      done?: boolean;
      assignee?: string | null;
      dueAt?: string | null;
      position?: number;
    },
  ): Promise<ListItemRow> {
    const p: ItemPatch = {
      text: patch.text,
      done: patch.done,
      position: patch.position,
    };
    if (patch.assignee !== undefined) p.assignee = patch.assignee;
    if (patch.dueAt !== undefined) p.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
    const row = await this.repo.updateItem(itemId, p);
    if (!row) throw new NotFoundError('item not found');
    return row;
  }

  async deleteItem(itemId: string): Promise<{ message: string }> {
    await this.repo.deleteItem(itemId);
    return { message: 'Item deleted.' };
  }
}
