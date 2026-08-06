import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser, ForbiddenError } from '@velchat/common';
import { ChannelsService } from './channels.service';
import {
  AddMemberDto,
  CreateChannelDto,
  CreateDmDto,
  CreateGroupDto,
  UpdateChannelDto,
  SetRoleDto,
  SetNotifDto,
  CreateCommunityDto,
  AttachChannelDto,
} from './channels.dto';

/**
 * Conversation/membership REST (§B7). Routed via the gateway: /conversations /groups /channels.
 *
 * §D4 principal binding: every mutating endpoint derives the actor from the VERIFIED JWT
 * (@CurrentUser) — never from the request body. This eliminates IDOR, spoofed ownership,
 * and unauthorized membership changes.
 */
@ApiTags('channels')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post('conversations/dm')
  @ApiOperation({
    summary: 'Open (or reuse) a 1:1 DM',
    description: 'Deterministic id from the sorted member pair — created at most once (dedupe).',
  })
  @ApiCreatedResponse({ description: 'The DM conversation id and whether it was newly created.' })
  createDm(@Body() body: CreateDmDto) {
    return this.channels.createDm(body.a, body.b);
  }

  /** Inbox: list conversations the AUTHENTICATED user belongs to. userId from JWT — no IDOR. */
  @Get('users/me/conversations')
  @ApiOperation({
    summary: "List the authenticated user's conversations (inbox)",
    description:
      'Every DM/group the user is a member of — lets a fresh install re-discover its chats. ' +
      'No messages here; the client backfills per conversation via chat-service afterSeq.',
  })
  @ApiOkResponse({ description: 'Conversation rows the user belongs to.' })
  listMyConversations(@CurrentUser('accountId') userId: string) {
    return this.channels.listUserConversations(userId);
  }

  /**
   * Legacy route preserved for backward-compat. The userId in the path is VALIDATED against the
   * JWT principal — you can only list YOUR OWN inbox (defeats IDOR).
   */
  @Get('users/:userId/conversations')
  @ApiParam({ name: 'userId', description: 'Account_id (must match JWT principal).' })
  @ApiOkResponse({ description: 'Conversation rows the user belongs to.' })
  listUserConversations(
    @Param('userId') userId: string,
    @CurrentUser('accountId') principalId: string,
  ) {
    // IDOR defense: reject if path userId ≠ JWT principal.
    if (userId !== principalId) {
      throw new ForbiddenError("Cannot access another user's conversations");
    }
    return this.channels.listUserConversations(userId);
  }

  /** Creator from JWT — no body-supplied creator field. */
  @Post('groups')
  @ApiOperation({
    summary: 'Create a group',
    description: 'Creator becomes owner. Up to 1024 members.',
  })
  @ApiCreatedResponse({ description: 'The new group conversation id.' })
  createGroup(@CurrentUser('accountId') creator: string, @Body() body: CreateGroupDto) {
    return this.channels.createGroup(creator, body.name, body.members ?? []);
  }

  /** Creator from JWT — channel ownership bound to the authenticated principal. */
  @Post('channels')
  @ApiOperation({
    summary: 'Create a tenant channel',
    description: 'Public/private, optional announcement.',
  })
  @ApiCreatedResponse({ description: 'The new channel conversation id.' })
  createChannel(@CurrentUser('accountId') creator: string, @Body() body: CreateChannelDto) {
    return this.channels.createChannel(
      body.tenantId,
      creator,
      body.name,
      body.visibility,
      body.isAnnouncement,
    );
  }

  /** Actor from JWT — only an admin/owner can add members. */
  @Post('conversations/:id/members')
  @ApiOperation({
    summary: 'Add a member',
    description: 'Owner/admin only — emits channel.member.added.',
  })
  @ApiParam({ name: 'id', description: 'Conversation id.' })
  @ApiCreatedResponse({ description: 'Member added.' })
  addMember(
    @Param('id') id: string,
    @CurrentUser('accountId') actorId: string,
    @Body() body: AddMemberDto,
  ) {
    return this.channels.addMember(id, actorId, body.userId, body.role);
  }

  /** Actor from JWT — only an admin/owner can remove members. */
  @Delete('conversations/:id/members/:userId')
  @ApiOperation({
    summary: 'Remove a member',
    description: 'Owner/admin only — emits channel.member.removed.',
  })
  @ApiParam({ name: 'id', description: 'Conversation id.' })
  @ApiParam({ name: 'userId', description: 'Account_id to remove.' })
  @ApiOkResponse({ description: 'Member removed.' })
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('accountId') actorId: string,
  ) {
    return this.channels.removeMember(id, actorId, userId);
  }

  @Get('conversations/:id/members')
  @ApiOperation({ summary: 'List member account_ids' })
  @ApiParam({ name: 'id', description: 'Conversation id.' })
  @ApiOkResponse({ description: 'Array of member account_ids.' })
  members(@Param('id') id: string) {
    return this.channels.members(id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get conversation details' })
  @ApiParam({ name: 'id' })
  getConversation(@Param('id') id: string) {
    return this.channels.getConversation(id);
  }

  /** Actor from JWT — only an admin/owner can change roles. */
  @Patch('conversations/:id/members/:userId/role')
  @ApiOperation({ summary: 'Set a member\u2019s role (owner/admin only)' })
  setRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('accountId') actorId: string,
    @Body() body: SetRoleDto,
  ) {
    return this.channels.setMemberRole(id, actorId, userId, body.role);
  }

  /** Self-action — userId from JWT, not body (defeats IDOR on notification preferences). */
  @Put('conversations/:id/notif')
  @ApiOperation({
    summary: 'Set your own notification level for a conversation (all/mentions/none)',
  })
  setNotif(
    @Param('id') id: string,
    @CurrentUser('accountId') userId: string,
    @Body() body: SetNotifDto,
  ) {
    return this.channels.setNotifLevel(id, userId, body.level);
  }

  // ── channels: list / update / self-service join+leave ──
  @Get('channels')
  @ApiOperation({ summary: 'Discover channels in a tenant (public by default)' })
  @ApiQuery({ name: 'tenantId' })
  @ApiQuery({ name: 'all', required: false, description: 'true → include private channels.' })
  listChannels(@Query('tenantId') tenantId: string, @Query('all') all?: string) {
    return this.channels.listChannels(tenantId, all !== 'true');
  }

  /** Actor from JWT — only an admin/owner can update channel settings. */
  @Patch('channels/:id')
  @ApiOperation({ summary: 'Update a channel (name/topic/visibility/announcement) — admin only' })
  updateChannel(
    @Param('id') id: string,
    @CurrentUser('accountId') actorId: string,
    @Body() body: UpdateChannelDto,
  ) {
    return this.channels.updateChannel(id, actorId, {
      name: body.name,
      topic: body.topic,
      avatarMediaId: body.avatarMediaId,
      visibility: body.visibility,
      isAnnouncement: body.isAnnouncement,
    });
  }

  /** Self-join — userId from JWT. */
  @Post('channels/:id/join')
  @ApiOperation({ summary: 'Self-join a public channel' })
  join(@Param('id') id: string, @CurrentUser('accountId') userId: string) {
    return this.channels.joinChannel(id, userId);
  }

  /** Self-leave — userId from JWT. */
  @Post('channels/:id/leave')
  @ApiOperation({ summary: 'Leave a channel' })
  leave(@Param('id') id: string, @CurrentUser('accountId') userId: string) {
    return this.channels.leaveChannel(id, userId);
  }

  // ── communities (group-of-groups + announcement channel) ──
  /** Creator from JWT. */
  @Post('communities')
  @ApiOperation({ summary: 'Create a community (auto-creates a read-only announcement channel)' })
  @ApiCreatedResponse({ description: 'Community id + announcement channel id.' })
  createCommunity(@CurrentUser('accountId') creator: string, @Body() body: CreateCommunityDto) {
    return this.channels.createCommunity(body.name, creator, body.orgId);
  }

  /** Actor from JWT — must be admin/owner of the channel to attach it. */
  @Post('communities/:id/channels')
  @ApiOperation({ summary: 'Add a channel to a community' })
  addToCommunity(
    @Param('id') id: string,
    @CurrentUser('accountId') actorId: string,
    @Body() body: AttachChannelDto,
  ) {
    return this.channels.addChannelToCommunity(id, body.conversationId, actorId);
  }

  @Get('communities/:id/channels')
  @ApiOperation({ summary: 'List a community\u2019s channels' })
  communityChannels(@Param('id') id: string) {
    return this.channels.listCommunityChannels(id);
  }
}
