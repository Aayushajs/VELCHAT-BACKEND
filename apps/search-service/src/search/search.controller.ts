import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { ValidationError } from '@velchat/common';
import { SearchService } from './search.service';

/** Search query REST (§A18 / §B13). Routed via the gateway: /search. */
@ApiTags('search')
@ApiBearerAuth('access-token')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search (tenant + ACL scoped)',
    description:
      'Query supports from:/in:/has:/before:/after: filters. Tenant + accessible channels scope the results (§G6-3) — in production these come from the verified identity + membership, not the client.',
  })
  @ApiQuery({ name: 'q', description: 'Query, e.g. "from:alice in:eng has:file budget".' })
  @ApiQuery({ name: 'tenantId', description: 'Tenant to search within.' })
  @ApiQuery({
    name: 'channels',
    required: false,
    description: 'CSV of accessible channel ids (ACL).',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Ranked, ACL-filtered hits.' })
  query(
    @Query('q') q: string,
    @Query('tenantId') tenantId: string,
    @Query('channels') channels?: string,
    @Query('limit') limit?: string,
  ) {
    if (!tenantId) throw new ValidationError('tenantId is required');
    return this.search.query(q ?? '', {
      tenantId,
      accessibleChannelIds: (channels ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      limit: limit ? Number(limit) : 20,
    });
  }
}
