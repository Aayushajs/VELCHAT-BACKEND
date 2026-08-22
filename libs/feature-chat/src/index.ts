/**
 * Chat feature — messages, per-conversation ordering, receipts, reactions, polls, the §G1-1 resend
 * protocol and chat extras (stars/pins/archive).
 *
 * This library owns NO infrastructure. Every module takes its Mongo/Valkey/event-bus handles from
 * the composition root that mounts it, which is what lets the same code run inside a combined
 * `messaging-service` or a standalone `chat-service` without changing a line.
 */
export { ChatModule, type ChatModuleDeps } from './chat/chat.module';
export { ChatController } from './chat/chat.controller';
export { ChatService } from './chat/chat.service';
export { ChatRepository, isDuplicateKey } from './chat/chat.repository';
export { ChatEvents } from './chat/chat.events';
export { SeqService } from './chat/seq.service';
export { ReceiptsRepository } from './chat/receipts.repository';
export { ReceiptsConsumer } from './chat/receipts.consumer';
export * from './chat/message.types';

export { PollsModule } from './polls/polls.module';
export { ResendModule } from './resend/resend.module';
export { ExtrasModule } from './extras/extras.module';
