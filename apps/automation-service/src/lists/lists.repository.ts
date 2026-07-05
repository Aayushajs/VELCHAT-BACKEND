import type { PostgresClient } from '@velchat/database';
import type { ListRow, ListItemRow } from '@velchat/database';
import { uuidv7 } from '@velchat/common';

export interface ItemPatch {
  text?: string;
  done?: boolean;
  assignee?: string | null;
  dueAt?: Date | null;
  position?: number;
}

/** Lists + list-items data access (§A4.7, Postgres). Parameterized queries. */
export class ListsRepository {
  constructor(private readonly pg: PostgresClient) {}

  async createList(conversationId: string, title: string, createdBy: string): Promise<ListRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO lists(list_id, conversation_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [uuidv7(), conversationId, title, createdBy],
    );
    return res.rows[0] as ListRow;
  }

  async getList(listId: string): Promise<ListRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM lists WHERE list_id = $1', [listId]);
    return (res.rows[0] as ListRow | undefined) ?? null;
  }

  async listByConversation(conversationId: string): Promise<ListRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM lists WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId],
    );
    return res.rows as ListRow[];
  }

  async deleteList(listId: string): Promise<void> {
    await this.pg.pool.query('DELETE FROM list_items WHERE list_id = $1', [listId]);
    await this.pg.pool.query('DELETE FROM lists WHERE list_id = $1', [listId]);
  }

  async items(listId: string): Promise<ListItemRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM list_items WHERE list_id = $1 ORDER BY position, created_at',
      [listId],
    );
    return res.rows as ListItemRow[];
  }

  async addItem(
    listId: string,
    text: string,
    assignee: string | null,
    dueAt: Date | null,
  ): Promise<ListItemRow> {
    // Append at the end: next position = current max + 1.
    const res = await this.pg.pool.query(
      `INSERT INTO list_items(item_id, list_id, text, assignee, due_at, position)
       VALUES ($1, $2, $3, $4, $5,
         COALESCE((SELECT MAX(position) + 1 FROM list_items WHERE list_id = $2), 0))
       RETURNING *`,
      [uuidv7(), listId, text, assignee, dueAt],
    );
    return res.rows[0] as ListItemRow;
  }

  async updateItem(itemId: string, p: ItemPatch): Promise<ListItemRow | null> {
    const res = await this.pg.pool.query(
      `UPDATE list_items SET
         text = COALESCE($2, text),
         done = COALESCE($3, done),
         assignee = CASE WHEN $4::boolean THEN $5 ELSE assignee END,
         due_at = CASE WHEN $6::boolean THEN $7 ELSE due_at END,
         position = COALESCE($8, position),
         updated_at = now()
       WHERE item_id = $1 RETURNING *`,
      [
        itemId,
        p.text ?? null,
        p.done ?? null,
        p.assignee !== undefined,
        p.assignee ?? null,
        p.dueAt !== undefined,
        p.dueAt ?? null,
        p.position ?? null,
      ],
    );
    return (res.rows[0] as ListItemRow | undefined) ?? null;
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.pg.pool.query('DELETE FROM list_items WHERE item_id = $1', [itemId]);
  }
}
