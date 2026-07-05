import { Controller, Post, Delete, Get, Patch, Put, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import {
  AddMemberDto,
  CreateChannelDto,
  CreateDmDto,
  CreateGroupDto,
  UpdateChannelDto,
  JoinLeaveDto,
  SetRoleDto,
  SetNotifDto,
  CreateCommunityDto,
  AttachChannelDto,
} from './channels.dto';

/** Conversation/membership REST (§B7). Routed via the gateway: /conversations /groups /channels. */
@ApiTags('channels')
@ApiBearerAuth('access-token')
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

  @Post('groups')
  @ApiOperation({
    summary: 'Create a group',
    description: 'Creator becomes owner. Up to 1024 members.',
  })
  @ApiCreatedResponse({ description: 'The new group conversation id.' })
  createGroup(@Body() body: CreateGroupDto) {
    return this.channels.createGroup(body.creator, body.name, body.members ?? []);
  }

  @Post('channels')
  @ApiOperation({
    summary: 'Create a tenant channel',
    description: 'Public/private, optional announcement.',
  })
  @ApiCreatedResponse({ description: 'The new channel conversation id.' })
  createChannel(@Body() body: CreateChannelDto) {
    return this.channels.createChannel(
      body.tenantId,
      body.creator,
      body.name,
      body.visibility,
      body.isAnnouncement,
    );
  }

  @Post('conversations/:id/members')
  @ApiOperation({
    summary: 'Add a member',
    description: 'Owner/admin only — emits channel.member.added.',
  })
  @ApiParam({ name: 'id', description: 'Conversation id.' })
  @ApiCreatedResponse({ description: 'Member added.' })
  addMember(@Param('id') id: string, @Body() body: AddMemberDto) {
    return this.channels.addMember(id, body.actorId, body.userId, body.role);
  }

  @Delete('conversations/:id/members/:userId')
  @ApiOperation({
    summary: 'Remove a member',
    description: 'Owner/admin only — emits channel.member.removed.',
  })
  @ApiParam({ name: 'id', description: 'Conversation id.' })
  @ApiParam({ name: 'userId', description: 'Account_id to remove.' })
  @ApiQuery({ name: 'actorId', description: 'Acting user (must be owner/admin).' })
  @ApiOkResponse({ description: 'Member removed.' })
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query('actorId') actorId: string,
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

  @Patch('conversations/:id/members/:userId/role')
  @ApiOperation({ summary: 'Set a member’s role (owner/admin only)' })
  setRole(@Param('id') id: string, @Param('userId') userId: string, @Body() body: SetRoleDto) {
    return this.channels.setMemberRole(id, body.actorId, userId, body.role);
  }

  @Put('conversations/:id/notif')
  @ApiOperation({
    summary: 'Set your own notification level for a conversation (all/mentions/none)',
  })
  setNotif(@Param('id') id: string, @Body() body: SetNotifDto) {
    return this.channels.setNotifLevel(id, body.userId, body.level);
  }

  // ── channels: list / update / self-service join+leave ──
  @Get('channels')
  @ApiOperation({ summary: 'Discover channels in a tenant (public by default)' })
  @ApiQuery({ name: 'tenantId' })
  @ApiQuery({ name: 'all', required: false, description: 'true → include private channels.' })
  listChannels(@Query('tenantId') tenantId: string, @Query('all') all?: string) {
    return this.channels.listChannels(tenantId, all !== 'true');
  }

  @Patch('channels/:id')
  @ApiOperation({ summary: 'Update a channel (name/topic/visibility/announcement) — admin only' })
  updateChannel(@Param('id') id: string, @Body() body: UpdateChannelDto) {
    return this.channels.updateChannel(id, body.actorId, {
      name: body.name,
      topic: body.topic,
      avatarMediaId: body.avatarMediaId,
      visibility: body.visibility,
      isAnnouncement: body.isAnnouncement,
    });
  }

  @Post('channels/:id/join')
  @ApiOperation({ summary: 'Self-join a public channel' })
  join(@Param('id') id: string, @Body() body: JoinLeaveDto) {
    return this.channels.joinChannel(id, body.userId);
  }

  @Post('channels/:id/leave')
  @ApiOperation({ summary: 'Leave a channel' })
  leave(@Param('id') id: string, @Body() body: JoinLeaveDto) {
    return this.channels.leaveChannel(id, body.userId);
  }

  // ── communities (group-of-groups + announcement channel) ──
  @Post('communities')
  @ApiOperation({ summary: 'Create a community (auto-creates a read-only announcement channel)' })
  @ApiCreatedResponse({ description: 'Community id + announcement channel id.' })
  createCommunity(@Body() body: CreateCommunityDto) {
    return this.channels.createCommunity(body.name, body.creator, body.orgId);
  }

  @Post('communities/:id/channels')
  @ApiOperation({ summary: 'Add a channel to a community' })
  addToCommunity(@Param('id') id: string, @Body() body: AttachChannelDto) {
    return this.channels.addChannelToCommunity(id, body.conversationId, body.actorId);
  }

  @Get('communities/:id/channels')
  @ApiOperation({ summary: 'List a community’s channels' })
  communityChannels(@Param('id') id: string) {
    return this.channels.listCommunityChannels(id);
  }
}
