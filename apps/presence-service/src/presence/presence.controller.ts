import { Controller, Post, Put, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { PresenceService } from './presence.service';
import { ConnDto, HeartbeatDto, SetStatusDto, SubscribeDto } from './presence.dto';

/** Rich presence REST (§A15 / §B8). Routed via the gateway: /presence. */
@ApiTags('presence')
@ApiBearerAuth('access-token')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post('online')
  @ApiOperation({ summary: 'Mark a device online (realtime-gw calls this on connect)' })
  @ApiOkResponse({ description: 'Online recorded.' })
  online(@Body() body: ConnDto) {
    return this.presence.online(body.userId, body.deviceId);
  }

  @Post('offline')
  @ApiOperation({ summary: 'Mark a device offline (on disconnect)' })
  @ApiOkResponse({ description: 'Offline recorded.' })
  offline(@Body() body: ConnDto) {
    return this.presence.offline(body.userId, body.deviceId);
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'Refresh online TTL (periodic ping)' })
  @ApiOkResponse({ description: 'Heartbeat refreshed.' })
  heartbeat(@Body() body: HeartbeatDto) {
    return this.presence.heartbeat(body.userId);
  }

  @Put('status')
  @ApiOperation({
    summary: 'Set a manual rich status',
    description: 'availability + emoji/text/expiry.',
  })
  @ApiOkResponse({ description: 'Resolved presence after the update.' })
  setStatus(@Body() body: SetStatusDto) {
    return this.presence.setStatus(body.userId, {
      availability: body.availability as never,
      emoji: body.emoji,
      text: body.text,
      expiresAt: body.expiresAt,
    });
  }

  @Post('subscribe')
  @ApiOperation({
    summary: 'Subscribe to contacts’ presence',
    description: 'Only the on-screen/recent contacts — fan-out goes to subscribers only (§A15.2).',
  })
  @ApiOkResponse({ description: '{ subscribed }.' })
  subscribe(@Body() body: SubscribeDto) {
    return this.presence.subscribe(body.watcher, body.targets);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Resolve a user’s rich presence + last-seen' })
  @ApiParam({ name: 'userId', description: 'Account_id.' })
  @ApiOkResponse({ description: '{ status, emoji?, text?, lastSeen }.' })
  get(@Param('userId') userId: string) {
    return this.presence.get(userId);
  }
}
