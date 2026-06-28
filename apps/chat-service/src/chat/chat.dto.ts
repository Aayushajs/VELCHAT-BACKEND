import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDefined, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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
}
