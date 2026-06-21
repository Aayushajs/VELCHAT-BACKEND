export { PostgresClient } from './postgres.client';
export { MongoClient } from './mongo.client';

// Per-domain schemas (centralized; each service owns its own — §A10).
export * as authSchema from './entities/auth.schema';
