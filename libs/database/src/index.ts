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
export * as mailCampaignSchema from './entities/mail-campaign.schema';
export type {
  MailCampaignRow,
  MailCampaignSendRow,
  CampaignMode,
  CampaignStatus,
  CampaignTemplate,
  CampaignRecurrence,
} from './entities/mail-campaign.schema';
export * as aiSchema from './entities/ai.schema';
export type { UserLanguageRow, ChatTranslatePrefRow, TranslateMode } from './entities/ai.schema';
export * as automationSchema from './entities/automation.schema';
export type {
  BotRow,
  SlashCommandRow,
  WorkflowRow,
  WebhookOutboundRow,
  AutomationJobRow,
  JobKind,
} from './entities/automation.schema';
export * as oprfSchema from './entities/oprf.schema';
export type { OprfKeyRow, OprfDiscoverableRow } from './entities/oprf.schema';
