import { Controller, Get, Put, Post, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { RequestExportDto, SetRetentionDto } from './admin.dto';

/**
 * Admin console / compliance REST (§A14). Admin+ only (enforced in the service). Routed via the
 * gateway under the admin-scoped prefix. `actorId` identifies the acting admin (from the JWT in prod).
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/orgs/:orgId')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('audit')
  @ApiOperation({ summary: 'Audit log (append-only)', description: 'Filter by actor/action/date.' })
  @ApiParam({ name: 'orgId' })
  @ApiQuery({ name: 'actorId', description: 'Acting admin (authz).' })
  @ApiQuery({ name: 'filterActor', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: '{ rows, total }.' })
  audit(
    @Param('orgId') orgId: string,
    @Query('actorId') actorId: string,
    @Query('filterActor') filterActor?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.auditLog(actorId, orgId, {
      actorId: filterActor,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('retention')
  @ApiOperation({ summary: 'Get retention policy' })
  @ApiParam({ name: 'orgId' })
  @ApiQuery({ name: 'actorId', description: 'Acting admin (authz).' })
  @ApiOkResponse({ description: 'Retention policy.' })
  getRetention(@Param('orgId') orgId: string, @Query('actorId') actorId: string) {
    return this.admin.getRetention(actorId, orgId);
  }

  @Put('retention')
  @ApiOperation({ summary: 'Set retention + legal hold' })
  @ApiParam({ name: 'orgId' })
  @ApiQuery({ name: 'actorId', description: 'Acting admin (authz).' })
  @ApiOkResponse({ description: 'Updated policy.' })
  setRetention(
    @Param('orgId') orgId: string,
    @Query('actorId') actorId: string,
    @Body() body: SetRetentionDto,
  ) {
    return this.admin.setRetention(actorId, orgId, body.retentionDays ?? null, body.legalHold);
  }

  @Post('exports')
  @ApiOperation({ summary: 'Request a compliance export (eDiscovery)' })
  @ApiParam({ name: 'orgId' })
  @ApiQuery({ name: 'actorId', description: 'Acting admin (authz).' })
  @ApiCreatedResponse({ description: '{ exportId, status }.' })
  requestExport(
    @Param('orgId') orgId: string,
    @Query('actorId') actorId: string,
    @Body() body: RequestExportDto,
  ) {
    return this.admin.requestExport(actorId, orgId, body.scope ?? null);
  }

  @Get('exports')
  @ApiOperation({ summary: 'List compliance export jobs' })
  @ApiParam({ name: 'orgId' })
  @ApiQuery({ name: 'actorId', description: 'Acting admin (authz).' })
  @ApiOkResponse({ description: 'Export jobs.' })
  listExports(@Param('orgId') orgId: string, @Query('actorId') actorId: string) {
    return this.admin.listExports(actorId, orgId);
  }

  @Get('exports/:exportId')
  @ApiOperation({ summary: 'Get a compliance export job' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'exportId' })
  @ApiQuery({ name: 'actorId', description: 'Acting admin (authz).' })
  @ApiOkResponse({ description: 'Export job.' })
  getExport(
    @Param('orgId') orgId: string,
    @Param('exportId') exportId: string,
    @Query('actorId') actorId: string,
  ) {
    return this.admin.getExport(actorId, orgId, exportId);
  }
}
