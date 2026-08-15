import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ExtrasService } from './extras.service';
import { PinDto, StarDto, ArchiveDto, PinChatDto, MuteDto } from './extras.dto';

/**
 * Chat extras (§A4.1 / §B15): pin/unpin messages (conversation-scoped), star/save (per-user), and
 * per-user conversation state — archive, pin-to-top, mute. Routed via the gateway.
 */
@ApiTags('chat-extras')
@ApiBearerAuth('access-token')
@Controller()
export class ExtrasController {
  constructor(private readonly extras: ExtrasService) {}

  // ── message pins ──
  @Post('conversations/:conversationId/pins/:messageId')
  @ApiOperation({ summary: 'Pin a message (conversation-scoped)' })
  pin(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: PinDto,
  ) {
    return this.extras.pin(conversationId, messageId, body.by);
  }

  @Delete('conversations/:conversationId/pins/:messageId')
  @ApiOperation({ summary: 'Unpin a message' })
  unpin(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: PinDto,
  ) {
    return this.extras.unpin(conversationId, messageId, body.by);
  }

  @Get('conversations/:conversationId/pins')
  @ApiOperation({ summary: 'List pinned messages in a conversation' })
  @ApiOkResponse({ description: 'Pins, newest first.' })
  listPins(@Param('conversationId') conversationId: string) {
    return this.extras.listPins(conversationId);
  }

  // ── stars / saved messages ──
  @Put('users/:userId/stars/:messageId')
  @ApiOperation({ summary: 'Save (star) a message' })
  star(
    @Param('userId') userId: string,
    @Param('messageId') messageId: string,
    @Body() body: StarDto,
  ) {
    return this.extras.star(userId, messageId, body.conversationId);
  }

  @Delete('users/:userId/stars/:messageId')
  @ApiOperation({ summary: 'Unsave a message' })
  unstar(@Param('userId') userId: string, @Param('messageId') messageId: string) {
    return this.extras.unstar(userId, messageId);
  }

  @Get('users/:userId/stars')
  @ApiOperation({ summary: "List a user's saved messages" })
  listStars(@Param('userId') userId: string) {
    return this.extras.listStars(userId);
  }

  // ── per-user conversation state ──
  @Put('users/:userId/conversations/:conversationId/archive')
  @ApiOperation({ summary: 'Archive / unarchive a chat' })
  archive(
    @Param('userId') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: ArchiveDto,
  ) {
    return this.extras.archive(userId, conversationId, body.archived);
  }

  @Put('users/:userId/conversations/:conversationId/pin-chat')
  @ApiOperation({ summary: 'Pin / unpin a chat to the top' })
  pinChat(
    @Param('userId') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: PinChatDto,
  ) {
    return this.extras.pinChat(userId, conversationId, body.pinned);
  }

  @Put('users/:userId/conversations/:conversationId/mute')
  @ApiOperation({ summary: 'Mute a chat (8h / 1w / always / off)' })
  mute(
    @Param('userId') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: MuteDto,
  ) {
    return this.extras.mute(userId, conversationId, body.duration);
  }

  @Get('users/:userId/conversations/:conversationId/state')
  @ApiOperation({ summary: 'Get per-user conversation state (archived/pinned/muted)' })
  state(@Param('userId') userId: string, @Param('conversationId') conversationId: string) {
    return this.extras.getState(userId, conversationId);
  }

  @Get('users/:userId/conversations/archived')
  @ApiOperation({ summary: "List a user's archived chats" })
  archived(@Param('userId') userId: string) {
    return this.extras.listArchived(userId);
  }

  @Get('users/:userId/conversations/pinned')
  @ApiOperation({ summary: "List a user's pinned chats" })
  pinned(@Param('userId') userId: string) {
    return this.extras.listPinnedChats(userId);
  }
}
