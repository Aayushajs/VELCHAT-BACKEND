/**
 * Injection token for "who belongs to this conversation".
 *
 * A plain string, deliberately: the single-process composition root resolves membership through
 * it without importing this feature at all. The alternative — a class token — would make the
 * realtime wiring depend on the group-channel package just to read its own database.
 */
export const CONVERSATION_MEMBERS_RESOLVER = 'CONVERSATION_MEMBERS_RESOLVER';

/** What that token provides. */
export type ConversationMembersResolver = (conversationId: string) => Promise<string[]>;
