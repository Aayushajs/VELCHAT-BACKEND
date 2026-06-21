import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import type { SendMessageInput } from './message.types';

/** Chat REST surface (§B4 / flow C2). Content is opaque ciphertext for personal conversations. */
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('messages')
  send(@Body() body: SendMessageInput) {
    return this.chat.send(body);
  }

  /** Cursor pagination by seq (§B4.3): pass ?afterSeq=&limit=. */
  @Get('conversations/:id/messages')
  history(
    @Param('id') id: string,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.history(id, afterSeq ? Number(afterSeq) : 0, limit ? Number(limit) : 50);
  }
}
