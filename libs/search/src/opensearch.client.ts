import { Client } from '@opensearch-project/opensearch';
import { currentTenantId, type Logger, type ManagedResource } from '@velchat/shared-utils';

/** OpenSearch connection + health + the §G6-3 tenant-filter guardrail. Shared self-host client. */
export class OpenSearchClient implements ManagedResource {
  readonly name = 'opensearch';
  readonly client: Client;

  constructor(
    node: string,
    auth: { username?: string; password?: string },
    private readonly logger: Logger,
  ) {
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
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'opensearch ping failed');
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** §G6-3: refuse to build a query without a tenant filter; inject it server-side. */
  withTenantFilter(query: Record<string, unknown>): Record<string, unknown> {
    const tenantId = currentTenantId();
    return { bool: { filter: [{ term: { tenant_id: tenantId } }], must: [query] } };
  }
}
