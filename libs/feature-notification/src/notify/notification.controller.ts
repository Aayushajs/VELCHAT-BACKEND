import { Controller, Get, Put, Post, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { Public } from '@velchat/common';
import { NotificationService } from './notification.service';
import { DeviceAckDto, RegisterEndpointDto, SetPrefsDto } from './notification.dto';

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

  /**
   * Is push actually wired on this deployment?
   *
   * `@Public()` and boolean-only: no key, no id, no count. It exists because the two ways this
   * silently does nothing — missing `FCM_*` env (the router degrades to a log sender and every
   * push "succeeds") and a missing event bus (acks return `acked:false`) — are both invisible
   * from outside, and diagnosing them by asking someone to read server logs has already cost
   * more than this endpoint.
   */
  @Public()
  @Get('push-status')
  @ApiOperation({
    summary: 'Whether push transports are configured (diagnostics)',
    description: 'Booleans only — reveals no credentials, ids or counts.',
  })
  @ApiOkResponse({ description: '{ transport, delivers, canAck }' })
  pushStatus() {
    return this.notify.pushDiagnostics();
  }

  /**
   * A device acknowledging a push it received (§B4.4).
   *
   * `@Public()` on purpose: this is the one call a phone makes when it has been woken from a
   * KILLED state, where the access token has long expired and refreshing one from native would
   * rotate the refresh-token family behind the JS side's back — a silent logout, which is
   * strictly worse than a missing tick. Authentication is possession of the push token
   * registered for this device, compared in constant time; the service then re-checks
   * conversation membership and fails closed.
   *
   * Without this route "delivered" was unreachable whenever the recipient's app was closed —
   * i.e. a permanent single tick for someone who is plainly online.
   */
  @Public()
  @Post('ack')
  @ApiOperation({
    summary: 'Acknowledge a push from the device (delivered/read)',
    description:
      'Authenticated by the registered push token, not a JWT — the calling app may have been ' +
      'woken from a killed state. Advances a monotonic watermark only; exposes no content.',
  })
  @ApiCreatedResponse({ description: 'Receipt published.' })
  ack(@Body() body: DeviceAckDto) {
    return this.notify.ackFromDevice(body);
  }
}
