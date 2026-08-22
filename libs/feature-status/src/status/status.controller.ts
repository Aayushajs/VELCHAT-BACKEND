import { Controller, Post, Get, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { StatusService } from './status.service';
import { PostStatusDto, ReactStatusDto } from './status.dto';

/** Status / stories REST (§B8 / §C11). Routed via the gateway: /status. */
@ApiTags('status')
@ApiBearerAuth('access-token')
@Controller('status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Post()
  @ApiOperation({
    summary: 'Post a status',
    description:
      '24h expiry. Personal status `text` is ciphertext. Audience resolved from contacts.',
  })
  @ApiCreatedResponse({ description: '{ statusId, audience, expiresAt }.' })
  post(@Body() body: PostStatusDto) {
    return this.status.post(body);
  }

  @Post(':id/view')
  @ApiOperation({
    summary: 'Record a view',
    description: 'Allowed only if the viewer is in the audience.',
  })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiQuery({ name: 'viewerId', description: 'Viewing account_id.' })
  @ApiOkResponse({ description: 'View recorded.' })
  view(@Param('id') id: string, @Query('viewerId') viewerId: string) {
    return this.status.view(id, viewerId);
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: 'React to a status (emoji)' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  react(@Param('id') id: string, @Body() body: ReactStatusDto) {
    return this.status.react(id, body.viewerId, body.emoji);
  }

  @Get(':id/viewers')
  @ApiOperation({ summary: 'Viewer list (author only)' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiQuery({ name: 'requesterId', description: 'Must be the author.' })
  @ApiOkResponse({ description: 'Ordered viewer list.' })
  viewers(@Param('id') id: string, @Query('requesterId') requesterId: string) {
    return this.status.viewers(id, requesterId);
  }

  @Get('feed/:authorId')
  @ApiOperation({ summary: 'A viewer’s feed of an author’s active statuses' })
  @ApiParam({ name: 'authorId', description: 'Author account_id.' })
  @ApiQuery({ name: 'viewerId', description: 'Viewing account_id.' })
  @ApiOkResponse({ description: 'Audience-filtered active statuses.' })
  feed(@Param('authorId') authorId: string, @Query('viewerId') viewerId: string) {
    return this.status.feedOf(authorId, viewerId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a status (author only)' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiQuery({ name: 'userId', description: 'Author account_id.' })
  @ApiOkResponse({ description: 'Deleted.' })
  remove(@Param('id') id: string, @Query('userId') userId: string) {
    return this.status.remove(id, userId);
  }
}
