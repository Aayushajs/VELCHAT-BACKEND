import type { ManagedResource } from '@velchat/shared-utils';

export interface SearchDoc {
  id: string;
  tenantId: string;
  [field: string]: unknown;
}

export interface SearchHit {
  id: string;
  tenantId: string;
  score?: number;
  doc: Record<string, unknown>;
}

/**
 * Provider-agnostic search index. Two adapters:
 *  - AtlasSearchIndex  — MongoDB Atlas Search (₹0 MVP default)
 *  - OpenSearchIndex   — self-hosted OpenSearch (scale)
 *
 * §G6-3: every query MUST be tenant-scoped — the tenant filter is injected here, server-side,
 * and cannot be bypassed. Personal E2EE content is never indexed server-side (clients index locally).
 */
export interface SearchIndex extends ManagedResource {
  index(indexName: string, doc: SearchDoc): Promise<void>;
  search(indexName: string, query: string, tenantId: string, limit?: number): Promise<SearchHit[]>;
  remove(indexName: string, id: string, tenantId: string): Promise<void>;
}
