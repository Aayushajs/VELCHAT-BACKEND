import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
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
import { AddMemberDto, CreateChannelDto, CreateDmDto, CreateGroupDto } from './channels.dto';

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
}
