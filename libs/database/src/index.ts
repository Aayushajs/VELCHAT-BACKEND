export { PostgresClient } from './postgres.client';
export { MongoClient } from './mongo.client';

// Per-domain schemas (centralized; each service owns its own — §A10).
export * as authSchema from './entities/auth.schema';
export * as callSchema from './entities/call.schema';
export type {
  CallRow,
  CallParticipantRow,
  MeetingRow,
  CallType,
  ParticipantRole,
} from './entities/call.schema';
export * as notificationSchema from './entities/notification.schema';
export type {
  NotificationPrefRow,
  PushEndpointRow,
  OutboxRow,
  NotifyLevel,
} from './entities/notification.schema';
