import { requireMongoUrl, requireOpenSearchNode, type AppConfig } from '@velchat/config';
import type { SearchIndex } from './search.port';
import { AtlasSearchIndex } from './adapters/atlas-search.index';
import { OpenSearchIndex } from './adapters/opensearch.index';

/** Selects the search adapter from config. Default `atlas` (free); `opensearch` self-hosted. */
export function createSearchIndex(config: AppConfig): SearchIndex {
  if (config.SEARCH_PROVIDER === 'opensearch') {
    return new OpenSearchIndex(requireOpenSearchNode(config), {
      username: config.OPENSEARCH_USERNAME,
      password: config.OPENSEARCH_PASSWORD,
    });
  }
  return new AtlasSearchIndex(requireMongoUrl(config));
}
