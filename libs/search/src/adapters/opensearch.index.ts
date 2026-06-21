import { Client } from '@opensearch-project/opensearch';
import type { SearchIndex, SearchDoc, SearchHit } from '../search.port';

/** Self-hosted OpenSearch adapter. Tenant filter injected on every query (§G6-3). */
export class OpenSearchIndex implements SearchIndex {
  readonly name = 'search:opensearch';
  private readonly client: Client;

  constructor(node: string, auth: { username?: string; password?: string }) {
    this.client = new Client({
      node,
      auth: auth.username ? { username: auth.username, password: auth.password ?? '' } : undefined,
      ssl: { rejectUnauthorized: false },
    });
  }

  async connect(): Promise<void> {
    await this.client.ping();
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async index(indexName: string, doc: SearchDoc): Promise<void> {
    await this.client.index({
      index: indexName,
      id: doc.id,
      body: { ...doc, tenant_id: doc.tenantId },
      refresh: true,
    });
  }

  async search(
    indexName: string,
    query: string,
    tenantId: string,
    limit = 20,
  ): Promise<SearchHit[]> {
    const res = await this.client.search({
      index: indexName,
      body: {
        size: limit,
        query: {
          bool: {
            filter: [{ term: { tenant_id: tenantId } }], // §G6-3 tenant filter
            must: [{ multi_match: { query, fields: ['*'] } }],
          },
        },
      },
    });
    const body = res.body as {
      hits?: { hits?: Array<{ _id: string; _score?: number; _source?: Record<string, unknown> }> };
    };
    const hits = body.hits?.hits ?? [];
    return hits.map((h) => ({ id: h._id, tenantId, score: h._score, doc: h._source ?? {} }));
  }

  async remove(indexName: string, id: string, _tenantId: string): Promise<void> {
    await this.client.delete({ index: indexName, id });
  }
}
