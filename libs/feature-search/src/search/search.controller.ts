import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { ValidationError } from '@velchat/common';
import { SearchService, type QueryContext } from './search.service';

/** Search query REST (§A18 / §B13). Routed via the gateway: /search. */
@ApiTags('search')
@ApiBearerAuth('access-token')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Build the tenant + ACL context. In production tenant + channels come from the verified
   * identity + membership projection (§G6-3), never trusted from the client. */
  private ctx(tenantId: string, channels?: string, limit?: string): QueryContext {
    if (!tenantId) throw new ValidationError('tenantId is required');
    return {
      tenantId,
      accessibleChannelIds: (channels ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      limit: limit ? Number(limit) : 20,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Search messages (tenant + ACL scoped)',
    description:
      'Query supports from:/in:/has:/before:/after: filters. Tenant + accessible channels scope the results (§G6-3).',
  })
  @ApiQuery({ name: 'q', description: 'Query, e.g. "from:alice in:eng has:file budget".' })
  @ApiQuery({ name: 'tenantId', description: 'Tenant to search within.' })
  @ApiQuery({
    name: 'channels',
    required: false,
    description: 'CSV of accessible channel ids (ACL).',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Ranked, ACL-filtered message hits.' })
  query(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string,
    @Query('channels') channels?: string,
    @Query('limit') limit?: string,
  ) {
    return this.search.query(q ?? '', this.ctx(tenantId, channels, limit));
  }

  @Get('files')
  @ApiOperation({ summary: 'Search files/attachments (same conversation ACL as messages)' })
  @ApiQuery({ name: 'q' })
  @ApiQuery({ name: 'tenantId' })
  @ApiQuery({ name: 'channels', required: false, description: 'CSV of accessible channel ids.' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Ranked, ACL-filtered file hits.' })
  files(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string,
    @Query('channels') channels?: string,
    @Query('limit') limit?: string,
  ) {
    return this.search.queryFiles(q ?? '', this.ctx(tenantId, channels, limit));
  }

  @Get('channels')
  @ApiOperation({
    summary: 'Discover channels',
    description: 'Returns public channels + private channels the caller is a member of.',
  })
  @ApiQuery({ name: 'q' })
  @ApiQuery({ name: 'tenantId' })
  @ApiQuery({
    name: 'channels',
    required: false,
    description: 'CSV of channel ids the caller is in.',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Ranked channel hits (ACL-filtered).' })
  channels(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string,
    @Query('channels') channels?: string,
    @Query('limit') limit?: string,
  ) {
    return this.search.queryChannels(q ?? '', this.ctx(tenantId, channels, limit));
  }

  @Get('people')
  @ApiOperation({ summary: 'Search people in the org directory (tenant-scoped)' })
  @ApiQuery({ name: 'q' })
  @ApiQuery({ name: 'tenantId' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Ranked people hits within the tenant.' })
  people(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string,
    @Query('limit') limit?: string,
  ) {
    if (!tenantId) throw new ValidationError('tenantId is required');
    return this.search.queryPeople(q ?? '', tenantId, limit ? Number(limit) : 20);
  }

  @Get('suggest')
  @ApiOperation({
    summary: 'Typeahead across channels + people',
    description: 'Small, low-latency result set for the search box.',
  })
  @ApiQuery({ name: 'q' })
  @ApiQuery({ name: 'tenantId' })
  @ApiQuery({ name: 'channels', required: false })
  @ApiOkResponse({ description: '{ channels, people }.' })
  suggest(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string,
    @Query('channels') channels?: string,
  ) {
    return this.search.suggest(q ?? '', this.ctx(tenantId, channels));
  }
}
