import { loadConfig } from '@velchat/config';
import { createSearchIndex } from './create-search';
import { AtlasSearchIndex } from './atlas-search.index';
import { OpenSearchIndex } from './opensearch.index';

describe('createSearchIndex (provider selection)', () => {
  it('defaults to atlas (free tier)', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      MONGO_URL: 'mongodb://localhost:27017/velchat',
    } as NodeJS.ProcessEnv);
    expect(createSearchIndex(cfg)).toBeInstanceOf(AtlasSearchIndex);
  });

  it('selects opensearch when SEARCH_PROVIDER=opensearch', () => {
    const cfg = loadConfig({
      SERVICE_NAME: 't',
      SEARCH_PROVIDER: 'opensearch',
      OPENSEARCH_NODE: 'http://localhost:9200',
    } as NodeJS.ProcessEnv);
    expect(createSearchIndex(cfg)).toBeInstanceOf(OpenSearchIndex);
  });
});
