import { Controller, Post, Get, Patch, Put, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';
import type {
  EvalContext,
  MaintenanceConfig,
  AnnouncementConfig,
  Rollout,
  RolloutRule,
} from './flag.types';
import {
  AnnouncementDto,
  CreateFlagDto,
  CreateSegmentDto,
  EvaluateDto,
  MaintenanceDto,
  RollbackDto,
  ScheduleDto,
  SetRolloutDto,
  UpdateFlagDto,
  UpdateSegmentDto,
} from './feature-flags.dto';

const scope = (t?: string): string | null => t ?? null;

/**
 * Feature Flag & Remote-Config REST (docs/FEATURE-FLAGS.md §7). Routed via the gateway:
 * `/feature-flags`. Static sub-paths (segments/platform/evaluate) are declared before `:key`.
 * In production admin routes are RBAC-gated at the gateway; `actorId` is recorded for audit.
 */
@ApiTags('feature-flags')
@ApiBearerAuth('access-token')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  // ── evaluation (client hot path) ──
  @Post('evaluate')
  @ApiOperation({ summary: 'Evaluate all flags for a context (cached, low-latency)' })
  @ApiOkResponse({
    description: '{ flags: {key: {on,value,variant?,reason}}, announcement, maintenance }.',
  })
  evaluate(@Body() body: EvaluateDto) {
    return this.flags.evaluateAll(scope(body.tenantId), body.context as EvalContext);
  }

  @Get('evaluate/:key')
  @ApiOperation({ summary: 'Evaluate a single flag for a context' })
  @ApiParam({ name: 'key' })
  evaluateOne(
    @Param('key') key: string,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
    @Query('country') country?: string,
    @Query('platform') platform?: string,
    @Query('appVersion') appVersion?: string,
    @Query('role') role?: string,
  ) {
    return this.flags.evaluateOne(scope(tenantId), key, {
      userId,
      country,
      platform,
      appVersion,
      role,
    });
  }

  // ── segments ──
  @Post('segments')
  @ApiOperation({ summary: 'Create a reusable targeting segment' })
  createSegment(@Body() body: CreateSegmentDto) {
    return this.flags.createSegment(
      scope(body.tenantId),
      body.key,
      body.name,
      body.rules as RolloutRule[],
    );
  }
  @Get('segments')
  @ApiOperation({ summary: 'List segments in a scope' })
  @ApiQuery({ name: 'tenantId', required: false })
  listSegments(@Query('tenantId') tenantId?: string) {
    return this.flags.listSegments(scope(tenantId));
  }
  @Patch('segments/:key')
  @ApiOperation({ summary: 'Update a segment' })
  updateSegment(@Param('key') key: string, @Body() body: UpdateSegmentDto) {
    return this.flags.updateSegment(scope(body.tenantId), key, {
      name: body.name,
      rules: body.rules as RolloutRule[] | undefined,
    });
  }
  @Delete('segments/:key')
  @ApiOperation({ summary: 'Delete a segment' })
  @ApiQuery({ name: 'tenantId', required: false })
  deleteSegment(@Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.flags.deleteSegment(scope(tenantId), key);
  }

  // ── platform: maintenance + announcement ──
  @Get('platform')
  @ApiOperation({ summary: 'Get platform config (maintenance + announcement)' })
  @ApiQuery({ name: 'tenantId', required: false })
  getPlatform(@Query('tenantId') tenantId?: string) {
    return this.flags.getPlatform(scope(tenantId));
  }
  @Put('platform/maintenance')
  @ApiOperation({ summary: 'Set global maintenance mode' })
  setMaintenance(@Body() body: MaintenanceDto) {
    const maintenance: MaintenanceConfig = {
      enabled: body.enabled,
      message: body.message,
      allowlistFlagKeys: body.allowlistFlagKeys ?? [],
      allowRoles: body.allowRoles ?? [],
    };
    return this.flags.setMaintenance(scope(body.tenantId), body.actorId ?? null, maintenance);
  }
  @Put('platform/announcement')
  @ApiOperation({ summary: 'Set the announcement/banner' })
  setAnnouncement(@Body() body: AnnouncementDto) {
    const announcement: AnnouncementConfig = {
      enabled: body.enabled,
      level: (body.level as AnnouncementConfig['level']) ?? 'info',
      text: body.text,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
    };
    return this.flags.setAnnouncement(scope(body.tenantId), body.actorId ?? null, announcement);
  }

  // ── flags ──
  @Post()
  @ApiOperation({ summary: 'Create a feature flag / remote-config entry' })
  create(@Body() body: CreateFlagDto) {
    return this.flags.create(scope(body.tenantId), body.actorId ?? null, {
      key: body.key,
      type: body.type as never,
      description: body.description,
      tags: body.tags,
      enabled: body.enabled,
      value: body.value,
      defaultValue: body.defaultValue,
      variants: body.variants as never,
      rollout: body.rollout as Partial<Rollout> | undefined,
      dependencies: body.dependencies,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List flags in a scope' })
  @ApiQuery({ name: 'tenantId', required: false })
  @ApiQuery({ name: 'includeArchived', required: false })
  list(@Query('tenantId') tenantId?: string, @Query('includeArchived') includeArchived?: string) {
    return this.flags.list(scope(tenantId), includeArchived === 'true');
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a flag' })
  @ApiParam({ name: 'key' })
  @ApiQuery({ name: 'tenantId', required: false })
  get(@Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.flags.get(scope(tenantId), key);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Update a flag (metadata/value/variants/deps)' })
  update(@Param('key') key: string, @Body() body: UpdateFlagDto) {
    return this.flags.update(scope(body.tenantId), body.actorId ?? null, key, {
      description: body.description,
      tags: body.tags,
      type: body.type as never,
      value: body.value,
      defaultValue: body.defaultValue,
      variants: body.variants as never,
      dependencies: body.dependencies,
    });
  }

  @Post(':key/enable')
  @ApiOperation({ summary: 'Enable a flag' })
  enable(@Param('key') key: string, @Body() body: UpdateFlagDto) {
    return this.flags.setEnabled(scope(body.tenantId), body.actorId ?? null, key, true);
  }
  @Post(':key/disable')
  @ApiOperation({ summary: 'Disable a flag (kill switch)' })
  disable(@Param('key') key: string, @Body() body: UpdateFlagDto) {
    return this.flags.setEnabled(scope(body.tenantId), body.actorId ?? null, key, false);
  }

  @Post(':key/rollout')
  @ApiOperation({ summary: 'Set rollout (percentage/segments/rules/overrides)' })
  rollout(@Param('key') key: string, @Body() body: SetRolloutDto) {
    return this.flags.setRollout(scope(body.tenantId), body.actorId ?? null, key, {
      percentage: body.percentage,
      segmentIds: body.segmentIds,
      rules: body.rules as RolloutRule[] | undefined,
      userOverrides: body.userOverrides,
    });
  }

  @Post(':key/schedule')
  @ApiOperation({ summary: 'Schedule an enable/disable' })
  schedule(@Param('key') key: string, @Body() body: ScheduleDto) {
    return this.flags.schedule(
      scope(body.tenantId),
      body.actorId ?? null,
      key,
      body.action as never,
      body.runAt,
    );
  }
  @Delete(':key/schedule/:id')
  @ApiOperation({ summary: 'Cancel a schedule' })
  cancelSchedule(@Param('id') id: string) {
    return this.flags.cancelSchedule(id);
  }
  @Get(':key/schedules')
  @ApiOperation({ summary: 'List a flag’s schedules' })
  @ApiQuery({ name: 'tenantId', required: false })
  schedules(@Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.flags.listSchedules(scope(tenantId), key);
  }

  @Post(':key/rollback')
  @ApiOperation({ summary: 'Emergency rollback to a prior version' })
  rollback(@Param('key') key: string, @Body() body: RollbackDto) {
    return this.flags.rollback(scope(body.tenantId), body.actorId ?? null, key, body.toVersion);
  }

  @Get(':key/versions')
  @ApiOperation({ summary: 'Version history' })
  @ApiQuery({ name: 'tenantId', required: false })
  versions(@Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.flags.versions(scope(tenantId), key);
  }
  @Get(':key/audit')
  @ApiOperation({ summary: 'Audit log for a flag' })
  @ApiQuery({ name: 'tenantId', required: false })
  auditLog(@Param('key') key: string, @Query('tenantId') tenantId?: string) {
    return this.flags.audit(scope(tenantId), key);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Archive a flag (soft delete)' })
  archive(
    @Param('key') key: string,
    @Query('tenantId') tenantId?: string,
    @Query('actorId') actorId?: string,
  ) {
    return this.flags.archive(scope(tenantId), actorId ?? null, key);
  }
}
