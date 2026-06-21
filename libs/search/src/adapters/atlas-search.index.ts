import mongoose, { type Connection } from 'mongoose';
import type { SearchIndex, SearchDoc, SearchHit } from '../search.port';

/**
 * MongoDB Atlas Search adapter (free tier). Documents live in `search_<indexName>` collections;
 * queries use the `$search` aggregation with a server-injected tenant filter (§G6-3).
 * (Requires an Atlas Search index named `default` on each collection — created in the Atlas UI/API.)
 */
export class AtlasSearchIndex implements SearchIndex {
  readonly name = 'search:atlas';
  private conn?: Connection;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.conn = await mongoose.createConnection(this.url).asPromise();
  }

  async ping(): Promise<boolean> {
    return this.conn?.readyState === 1;
  }

  async close(): Promise<void> {
    await this.conn?.close();
  }

  private collection(indexName: string) {
    if (!this.conn) throw new Error('AtlasSearchIndex is not connected');
    return this.conn.collection(`search_${indexName}`);
  }

  async index(indexName: string, doc: SearchDoc): Promise<void> {
    await this.collection(indexName).updateOne(
      { _id: doc.id as never },
      { $set: { ...doc, tenant_id: doc.tenantId } },
      { upsert: true },
    );
  }

  async search(
    indexName: string,
    query: string,
    tenantId: string,
    limit = 20,
  ): Promise<SearchHit[]> {
    const rows = await this.collection(indexName)
      .aggregate([
        { $search: { index: 'default', text: { query, path: { wildcard: '*' } } } },
        { $match: { tenant_id: tenantId } }, // §G6-3 tenant filter — always injected
        { $limit: limit },
        { $project: { _id: 1, tenant_id: 1, score: { $meta: 'searchScore' }, doc: '$$ROOT' } },
      ])
      .toArray();

    return rows.map((r) => ({
      id: String(r._id),
      tenantId: String(r.tenant_id),
      score: typeof r.score === 'number' ? r.score : undefined,
      doc: (r.doc ?? {}) as Record<string, unknown>,
    }));
  }

  async remove(indexName: string, id: string, tenantId: string): Promise<void> {
    await this.collection(indexName).deleteOne({ _id: id as never, tenant_id: tenantId });
  }
}
