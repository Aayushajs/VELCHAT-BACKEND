import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import type { MessageType, Mention } from './message.types';

const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'file',
  'location',
  'contact',
  'poll',
  'system',
] as const;

/** Request body for sending a message (§B4.2, flow C2). For personal conversations `content` is an
 * opaque ciphertext string — the server never sees plaintext (§A14.3). */
export class SendMessageDto {
  @ApiProperty({ description: 'Target conversation id.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ description: 'Sender account_id.' })
  @IsString()
  @IsNotEmpty()
  senderId!: string;

  @ApiProperty({ description: 'Client-generated UUID — enables optimistic UI + server dedupe.' })
  @IsString()
  @IsNotEmpty()
  clientMsgId!: string;

  @ApiPropertyOptional({ enum: MESSAGE_TYPES, default: 'text' })
  @IsOptional()
  @IsIn(MESSAGE_TYPES as unknown as string[])
  type?: MessageType;

  @ApiProperty({
    description: 'Plaintext (enterprise) or ciphertext (personal E2EE). Object or string.',
    oneOf: [{ type: 'string' }, { type: 'object' }],
  })
  // Union string | object — presence is enforced; shape stays flexible (ciphertext is opaque).
  @IsDefined()
  content!: string | Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Message id this is a reply to.' })
  @IsOptional()
  @IsString()
  replyTo?: string;

  @ApiPropertyOptional({ description: 'Thread root message id.' })
  @IsOptional()
  @IsString()
  threadRoot?: string;

  @ApiPropertyOptional({ description: 'Mentions (@user / @channel / @here / @everyone).' })
  @IsOptional()
  @IsArray()
  mentions?: Mention[];

  @ApiPropertyOptional({
    description:
      'Owning tenant for enterprise/workspace channel messages. Present ⇒ server-readable (indexed ' +
      'for search + mention routing). Omit for personal chats (E2EE, never indexed).',
  })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'True for personal E2EE — content is opaque ciphertext; never indexed server-side.',
  })
  @IsOptional()
  @IsBoolean()
  encrypted?: boolean;
}

/** Add/remove a reaction on a message (§B15). Idempotent per (user, emoji). */
export class ReactionDto {
  @ApiProperty({ description: 'Conversation the message belongs to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ description: 'Reacting user (account_id).' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ description: 'Emoji reaction (e.g. 👍).' })
  @IsString()
  @IsNotEmpty()
  emoji!: string;
}

/** Edit a message (§B15) — sender-only. `content` is opaque (ciphertext for personal E2EE). */
export class EditMessageDto {
  @ApiProperty({ description: 'Conversation the message belongs to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ description: 'Editor account_id — must be the original sender.' })
  @IsString()
  @IsNotEmpty()
  editorId!: string;

  @ApiProperty({
    description: 'New content — plaintext (enterprise) or ciphertext (personal E2EE).',
    oneOf: [{ type: 'string' }, { type: 'object' }],
  })
  @IsDefined()
  content!: string | Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Owning tenant (enterprise/channel). Present ⇒ server-readable; the edit is re-indexed for ' +
      'search. Omit for personal chats (E2EE, never indexed).',
  })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'True for personal E2EE — content is opaque ciphertext; never indexed server-side.',
  })
  @IsOptional()
  @IsBoolean()
  encrypted?: boolean;
}

/** Delete a message (§B15). 'me' hides per-device; 'everyone' tombstones for all (sender-only). */
export class DeleteMessageDto {
  @ApiProperty({ description: 'Conversation the message belongs to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ description: 'Actor account_id. For scope=everyone must be the original sender.' })
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @ApiProperty({
    enum: ['me', 'everyone'],
    description: "'me' hides locally (per-device); 'everyone' tombstones for all.",
  })
  @IsIn(['me', 'everyone'])
  scope!: 'me' | 'everyone';
}
