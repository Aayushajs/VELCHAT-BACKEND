import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MessageType, Mention } from './message.types';

/** Request body for sending a message (§B4.2, flow C2). For personal conversations `content` is an
 * opaque ciphertext string — the server never sees plaintext (§A14.3). */
export class SendMessageDto {
  @ApiProperty({ description: 'Target conversation id.' })
  conversationId!: string;

  @ApiProperty({ description: 'Sender account_id.' })
  senderId!: string;

  @ApiProperty({ description: 'Client-generated UUID — enables optimistic UI + server dedupe.' })
  clientMsgId!: string;

  @ApiPropertyOptional({
    enum: ['text', 'image', 'video', 'audio', 'file', 'location', 'contact', 'poll', 'system'],
    default: 'text',
  })
  type?: MessageType;

  @ApiProperty({
    description: 'Plaintext (enterprise) or ciphertext (personal E2EE). Object or string.',
    oneOf: [{ type: 'string' }, { type: 'object' }],
  })
  content!: string | Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Message id this is a reply to.' })
  replyTo?: string;

  @ApiPropertyOptional({ description: 'Thread root message id.' })
  threadRoot?: string;

  @ApiPropertyOptional({ description: 'Mentions (@user / @channel / @here / @everyone).' })
  mentions?: Mention[];
}
