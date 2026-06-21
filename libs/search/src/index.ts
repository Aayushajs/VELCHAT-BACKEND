export type { SearchIndex, SearchDoc, SearchHit } from './search.port';
export { AtlasSearchIndex } from './adapters/atlas-search.index';
export { OpenSearchIndex } from './adapters/opensearch.index';
export { createSearchIndex } from './create-search';
export { OpenSearchClient } from './opensearch.client';
