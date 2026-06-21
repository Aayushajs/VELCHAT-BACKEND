import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import type { MemberRole } from './conversation.types';

/** Conversation/membership REST (§B7). Routed via the gateway: /conversations /groups /channels. */
@Controller()
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post('conversations/dm')
  createDm(@Body() body: { a: string; b: string }) {
    return this.channels.createDm(body.a, body.b);
  }

  @Post('groups')
  createGroup(@Body() body: { creator: string; name: string; members?: string[] }) {
    return this.channels.createGroup(body.creator, body.name, body.members ?? []);
  }

  @Post('channels')
  createChannel(
    @Body()
    body: {
      tenantId: string;
      creator: string;
      name: string;
      visibility?: string;
      isAnnouncement?: boolean;
    },
  ) {
    return this.channels.createChannel(
      body.tenantId,
      body.creator,
      body.name,
      body.visibility,
      body.isAnnouncement,
    );
  }

  @Post('conversations/:id/members')
  addMember(
    @Param('id') id: string,
    @Body() body: { actorId: string; userId: string; role?: MemberRole },
  ) {
    return this.channels.addMember(id, body.actorId, body.userId, body.role);
  }

  @Delete('conversations/:id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Query('actorId') actorId: string,
  ) {
    return this.channels.removeMember(id, actorId, userId);
  }

  @Get('conversations/:id/members')
  members(@Param('id') id: string) {
    return this.channels.members(id);
  }
}
