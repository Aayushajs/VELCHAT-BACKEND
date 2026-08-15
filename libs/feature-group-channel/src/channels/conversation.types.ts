export type ConversationType = 'dm' | 'group' | 'channel' | 'broadcast' | 'community';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface NewConversation {
  conversationId: string;
  type: ConversationType;
  tenantId?: string | null;
  name?: string | null;
  visibility?: string | null;
  isAnnouncement?: boolean;
  createdBy: string;
}

export const MAX_GROUP_MEMBERS = 1024;
