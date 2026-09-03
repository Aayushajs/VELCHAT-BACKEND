import { Controller, Post, Get, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CurrentUser } from '@velchat/common';
import { StatusService } from './status.service';
import { PostStatusDto, ReactStatusDto, ViewersQueryDto } from './status.dto';

/**
 * Status / stories REST (§B8 / §C11). Routed via the gateway: /status → content-service.
 *
 * Every endpoint takes its acting identity from the VERIFIED token via `@CurrentUser`, never from
 * the body or query. The previous version read `userId`/`viewerId`/`requesterId` off the request,
 * which let any caller delete another user's status, read their viewer list, or post as them
 * (§D4 IDOR). Paths and methods are unchanged — only the spoofable parameters are gone.
 */
@ApiTags('status')
@ApiBearerAuth('access-token')
@Controller('status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Post()
  @ApiOperation({
    summary: 'Post a status',
    description:
      'Author is the authenticated account. 24h server-set expiry. Personal `text`/`caption` are ' +
      'ciphertext — the server never reads them. Audience is a RULE resolved server-side.',
  })
  @ApiCreatedResponse({ description: '{ statusId, expiresAt }.' })
  post(@CurrentUser('accountId') accountId: string, @Body() body: PostStatusDto) {
    return this.status.post(accountId, body);
  }

  @Post(':id/view')
  @ApiOperation({ summary: 'Record a view', description: 'Idempotent. Audience-checked.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiOkResponse({ description: 'View recorded.' })
  @ApiForbiddenResponse({ description: 'Not in this status audience.' })
  view(@Param('id') id: string, @CurrentUser('accountId') accountId: string) {
    return this.status.view(id, accountId);
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: 'React to a status (emoji)', description: 'Idempotent per account.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiForbiddenResponse({ description: 'Not in this status audience.' })
  react(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Body() body: ReactStatusDto,
  ) {
    return this.status.react(id, accountId, body.emoji);
  }

  @Get(':id/viewers')
  @ApiOperation({ summary: 'Viewer list (author only)', description: 'Cursor-paginated.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiOkResponse({ description: '{ viewers, nextCursor }.' })
  @ApiForbiddenResponse({ description: 'Only the author can see viewers.' })
  viewers(
    @Param('id') id: string,
    @CurrentUser('accountId') accountId: string,
    @Query() query: ViewersQueryDto,
  ) {
    // Left undefined when absent so the service applies its own default; it clamps the value.
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    return this.status.viewers(id, accountId, limit, query.after);
  }

  @Get('feed/:authorId')
  @ApiOperation({
    summary: 'An author’s active statuses visible to the caller',
    description: 'Audience-filtered server-side; oldest first for sequential playback.',
  })
  @ApiParam({ name: 'authorId', description: 'Author account_id.' })
  @ApiOkResponse({ description: 'Visible active statuses (may be empty).' })
  feed(@Param('authorId') authorId: string, @CurrentUser('accountId') accountId: string) {
    return this.status.feedOf(authorId, accountId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a status (author only)', description: 'Soft delete.' })
  @ApiParam({ name: 'id', description: 'Status id.' })
  @ApiOkResponse({ description: 'Deleted.' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours.' })
  remove(@Param('id') id: string, @CurrentUser('accountId') accountId: string) {
    return this.status.remove(id, accountId);
  }
}
