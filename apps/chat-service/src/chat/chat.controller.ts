import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { SendMessageDto } from './chat.dto';

/** Chat REST surface (§B4 / flow C2). Content is opaque ciphertext for personal conversations. */
@ApiTags('chat')
@ApiBearerAuth('access-token')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('messages')
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Hot path (§B4.2): validate → dedupe by clientMsgId → assign per-conversation seq → persist → emit message.sent → ACK.',
  })
  @ApiCreatedResponse({ description: 'Send ack: { messageId, seq, serverTs }.' })
  send(@Body() body: SendMessageDto) {
    return this.chat.send(body);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary: 'Fetch message history',
    description: 'Cursor pagination by seq (§B4.3) — never offset.',
  })
  @ApiParam({ name: 'id', description: 'Conversation id.' })
  @ApiQuery({ name: 'afterSeq', required: false, description: 'Return messages with seq > this.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max messages (default 50).' })
  @ApiOkResponse({ description: 'Ordered messages with seq > afterSeq.' })
  history(
    @Param('id') id: string,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.history(id, afterSeq ? Number(afterSeq) : 0, limit ? Number(limit) : 50);
  }
}
