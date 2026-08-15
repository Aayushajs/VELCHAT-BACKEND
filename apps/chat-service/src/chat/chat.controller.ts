import { Controller, Post, Get, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CurrentUser, actingAccountId } from '@velchat/common';
import { ChatService } from './chat.service';
import { SendMessageDto, ReactionDto, EditMessageDto, DeleteMessageDto } from './chat.dto';

/**
 * Chat REST surface (§B4 / flow C2). Content is opaque ciphertext for personal conversations.
 *
 * Every endpoint takes its acting identity from the VERIFIED token via `@CurrentUser`, never from
 * the request body (§D4). The body ids (`senderId`, `userId`, `editorId`, `actorId`) are still
 * accepted because the mobile client sends them and the global ValidationPipe runs with
 * `forbidNonWhitelisted` — but `actingAccountId` refuses any that disagree with the token.
 * Authentication itself is enforced by the global guard registered in AppModule (DEF-02).
 */
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
  send(@CurrentUser('accountId') accountId: string, @Body() body: SendMessageDto) {
    return this.chat.send({ ...body, senderId: actingAccountId(accountId, body.senderId) });
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

  @Post('messages/:id/reactions')
  @ApiOperation({
    summary: 'Add a reaction to a message',
    description: 'Idempotent per (user, emoji) (§B15). Emits message.reaction.added.',
  })
  @ApiParam({ name: 'id', description: 'Message id.' })
  react(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Body() body: ReactionDto,
  ) {
    return this.chat.react({
      messageId: id,
      conversationId: body.conversationId,
      userId: actingAccountId(accountId, body.userId),
      emoji: body.emoji,
    });
  }

  @Delete('messages/:id/reactions')
  @ApiOperation({
    summary: 'Remove a reaction from a message',
    description: 'Emits message.reaction.removed (§B15).',
  })
  @ApiParam({ name: 'id', description: 'Message id.' })
  unreact(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Body() body: ReactionDto,
  ) {
    return this.chat.unreact({
      messageId: id,
      conversationId: body.conversationId,
      userId: actingAccountId(accountId, body.userId),
      emoji: body.emoji,
    });
  }

  @Patch('messages/:id')
  @ApiOperation({
    summary: 'Edit a message',
    description:
      'Sender-only (§B15): appends the previous content to edit_history and emits message.edited. ' +
      'Plaintext is carried for search re-index only when server-readable (enterprise/channel).',
  })
  @ApiParam({ name: 'id', description: 'Message id.' })
  @ApiOkResponse({ description: 'Edit ack: { messageId, editedAt }.' })
  edit(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Body() body: EditMessageDto,
  ) {
    return this.chat.edit({
      messageId: id,
      conversationId: body.conversationId,
      editorId: actingAccountId(accountId, body.editorId),
      content: body.content,
      tenantId: body.tenantId,
      encrypted: body.encrypted,
    });
  }

  @Delete('messages/:id')
  @ApiOperation({
    summary: 'Delete a message',
    description:
      "scope 'everyone' tombstones (sender-only) and emits message.deleted; scope 'me' hides the " +
      'message per-device with no event (§B15).',
  })
  @ApiParam({ name: 'id', description: 'Message id.' })
  @ApiOkResponse({ description: 'Delete ack.' })
  del(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Body() body: DeleteMessageDto,
  ) {
    return this.chat.delete({
      messageId: id,
      conversationId: body.conversationId,
      actorId: actingAccountId(accountId, body.actorId),
      scope: body.scope,
    });
  }
}
