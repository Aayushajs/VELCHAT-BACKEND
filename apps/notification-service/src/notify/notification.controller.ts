import { Controller, Get, Put, Post, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { RegisterEndpointDto, SetPrefsDto } from './notification.dto';

/** Notification prefs + device registration (§B10). Routed via the gateway: /notifications. */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notify: NotificationService) {}

  @Put('prefs')
  @ApiOperation({
    summary: 'Set notification prefs for a scope',
    description: 'level (all/mentions/none) + mute window + DND schedule + keyword alerts.',
  })
  @ApiOkResponse({ description: 'Prefs saved.' })
  setPrefs(@Body() body: SetPrefsDto) {
    return this.notify.setPref(body.userId, body.scopeType, body.scopeId, {
      level: body.level,
      mutedUntil: body.mutedUntil ? new Date(body.mutedUntil) : null,
      keywords: body.keywords,
      dndSchedule: body.dndSchedule,
    });
  }

  @Get('prefs')
  @ApiOperation({ summary: 'Get notification prefs for a scope' })
  @ApiQuery({ name: 'userId' })
  @ApiQuery({ name: 'scopeType' })
  @ApiQuery({ name: 'scopeId' })
  @ApiOkResponse({ description: 'Prefs (or null default = all).' })
  getPrefs(
    @Query('userId') userId: string,
    @Query('scopeType') scopeType: string,
    @Query('scopeId') scopeId: string,
  ) {
    return this.notify.getPref(userId, scopeType, scopeId);
  }

  @Post('endpoints')
  @ApiOperation({
    summary: 'Register a device push endpoint',
    description: 'Mobile token (FCM/APNs), VoIP token, or Web Push subscription.',
  })
  @ApiCreatedResponse({ description: 'Endpoint registered.' })
  registerEndpoint(@Body() body: RegisterEndpointDto) {
    return this.notify.registerEndpoint(body);
  }
}
