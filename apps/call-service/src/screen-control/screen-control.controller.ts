import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { ScreenControlService } from './screen-control.service';
import { RequestControlDto, ControlActionDto } from './screen-control.dto';

/**
 * Screen-share remote control (§A4.4, Teams-style). Routed via the gateway under /calls. A viewer
 * requests control of the sharer's screen; the sharer grants/denies; either releases/revokes. The
 * server only signals state transitions + emits events — actual input relay is client-side WebRTC.
 */
@ApiTags('screen-control')
@ApiBearerAuth('access-token')
@Controller('calls/:callId/screen-control')
export class ScreenControlController {
  constructor(private readonly svc: ScreenControlService) {}

  @Post('request')
  @ApiOperation({ summary: 'Request control of the sharer’s screen' })
  @ApiCreatedResponse({ description: 'Control request created (status=requested).' })
  request(@Param('callId') callId: string, @Body() body: RequestControlDto) {
    return this.svc.request(callId, body.controllerId, body.sharerId);
  }

  @Get()
  @ApiOperation({ summary: 'Current control request/grant for a call (if any)' })
  @ApiOkResponse({ description: 'The live control session, or null.' })
  current(@Param('callId') callId: string) {
    return this.svc.current(callId);
  }

  @Post(':id/grant')
  @ApiOperation({ summary: 'Sharer grants control' })
  grant(@Param('id') id: string, @Body() body: ControlActionDto) {
    return this.svc.grant(id, body.actorId);
  }

  @Post(':id/deny')
  @ApiOperation({ summary: 'Sharer denies control' })
  deny(@Param('id') id: string, @Body() body: ControlActionDto) {
    return this.svc.deny(id, body.actorId);
  }

  @Post(':id/release')
  @ApiOperation({ summary: 'Controller releases control' })
  release(@Param('id') id: string, @Body() body: ControlActionDto) {
    return this.svc.release(id, body.actorId);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Sharer revokes an active control grant' })
  revoke(@Param('id') id: string, @Body() body: ControlActionDto) {
    return this.svc.revoke(id, body.actorId);
  }
}
