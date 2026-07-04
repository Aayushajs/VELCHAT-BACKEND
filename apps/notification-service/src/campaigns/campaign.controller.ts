import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto, BulkSendDto } from './campaign.dto';

/**
 * Bulk mail campaigns + scheduler. Routed via the gateway under /mail/campaigns.
 *  - POST /            create (immediate | scheduled | recurring)
 *  - POST /bulk        shorthand: send to many recipients right now
 *  - GET  /            list · GET /:id detail
 *  - POST /:id/pause · /resume · /send-now   ·   DELETE /:id  (cancel)
 */
@ApiTags('mail-campaigns')
@ApiBearerAuth('access-token')
@Controller('mail/campaigns')
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a mail campaign',
    description:
      'mode=immediate sends now; scheduled sends at scheduledAt; recurring repeats on a cadence ' +
      '(recurrence.everyDays and/or daysOfWeek[]) until endsAt / maxOccurrences.',
  })
  @ApiCreatedResponse({ description: 'Campaign created.' })
  create(@Body() body: CreateCampaignDto) {
    return this.campaigns.createCampaign(body);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Send a bulk email now',
    description: 'Shorthand for an immediate campaign.',
  })
  @ApiCreatedResponse({ description: 'Bulk send queued.' })
  bulk(@Body() body: BulkSendDto) {
    return this.campaigns.createCampaign({
      name: `Bulk: ${body.subject}`,
      subject: body.subject,
      template: body.template ?? 'notification',
      text: body.text,
      html: body.html,
      recipients: body.recipients,
      mode: 'immediate',
    });
  }

  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  @ApiOkResponse({ description: 'Recent campaigns.' })
  list() {
    return this.campaigns.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a campaign' })
  get(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a campaign' })
  pause(@Param('id') id: string) {
    return this.campaigns.pause(id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused campaign' })
  resume(@Param('id') id: string) {
    return this.campaigns.resume(id);
  }

  @Post(':id/send-now')
  @ApiOperation({ summary: 'Send a campaign immediately (next tick)' })
  sendNow(@Param('id') id: string) {
    return this.campaigns.sendNow(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a campaign' })
  cancel(@Param('id') id: string) {
    return this.campaigns.cancel(id);
  }
}
