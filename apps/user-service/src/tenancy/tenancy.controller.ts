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
import { TenancyService } from './tenancy.service';
import { AddMemberDto, CreateOrgDto, CreateTeamDto, CreateWorkspaceDto } from './tenancy.dto';
import type { Role, ScopeType } from './tenancy.types';

/** Org / workspace / team + membership REST (§B3). Routed via the gateway: /orgs /workspaces /teams. */
@ApiTags('tenancy')
@ApiBearerAuth('access-token')
@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Post('orgs')
  @ApiOperation({ summary: 'Create an organization', description: 'Creator becomes owner.' })
  @ApiCreatedResponse({ description: '{ orgId }.' })
  createOrg(@Body() body: CreateOrgDto) {
    return this.tenancy.createOrg(body.creator, body.name);
  }

  @Post('workspaces')
  @ApiOperation({
    summary: 'Create a workspace',
    description: 'Optionally under an org; creator owns it.',
  })
  @ApiCreatedResponse({ description: '{ workspaceId }.' })
  createWorkspace(@Body() body: CreateWorkspaceDto) {
    return this.tenancy.createWorkspace(body.creator, body.name, body.orgId ?? null);
  }

  @Post('teams')
  @ApiOperation({ summary: 'Create a team', description: 'Org admins+ only.' })
  @ApiCreatedResponse({ description: '{ teamId }.' })
  createTeam(@Body() body: CreateTeamDto) {
    return this.tenancy.createTeam(body.creator, body.orgId, body.name);
  }

  @Post(':scopeType/:scopeId/members')
  @ApiOperation({ summary: 'Add a member', description: 'Admin+ only; cannot grant owner.' })
  @ApiParam({ name: 'scopeType', enum: ['org', 'workspace', 'team'] })
  @ApiParam({ name: 'scopeId', description: 'Scope id.' })
  @ApiCreatedResponse({ description: 'Member added.' })
  addMember(
    @Param('scopeType') scopeType: ScopeType,
    @Param('scopeId') scopeId: string,
    @Body() body: AddMemberDto,
  ) {
    return this.tenancy.addMember(body.actorId, scopeType, scopeId, body.userId, body.role);
  }

  @Delete(':scopeType/:scopeId/members/:userId')
  @ApiOperation({ summary: 'Remove a member', description: 'Admin+ only.' })
  @ApiParam({ name: 'scopeType', enum: ['org', 'workspace', 'team'] })
  @ApiParam({ name: 'scopeId', description: 'Scope id.' })
  @ApiParam({ name: 'userId', description: 'Account_id to remove.' })
  @ApiQuery({ name: 'actorId', description: 'Acting user (admin+).' })
  @ApiOkResponse({ description: 'Member removed.' })
  removeMember(
    @Param('scopeType') scopeType: ScopeType,
    @Param('scopeId') scopeId: string,
    @Param('userId') userId: string,
    @Query('actorId') actorId: string,
  ) {
    return this.tenancy.removeMember(actorId, scopeType, scopeId, userId);
  }

  @Get(':scopeType/:scopeId/members')
  @ApiOperation({ summary: 'List members of a scope' })
  @ApiParam({ name: 'scopeType', enum: ['org', 'workspace', 'team'] })
  @ApiParam({ name: 'scopeId', description: 'Scope id.' })
  @ApiOkResponse({ description: 'Memberships in this scope.' })
  members(@Param('scopeType') scopeType: ScopeType, @Param('scopeId') scopeId: string) {
    return this.tenancy.members(scopeType, scopeId);
  }

  @Get('memberships')
  @ApiOperation({ summary: "A user's memberships across all scopes" })
  @ApiQuery({ name: 'userId', description: 'Account_id.' })
  @ApiOkResponse({ description: 'All memberships for the user.' })
  memberships(@Query('userId') userId: string) {
    return this.tenancy.myMemberships(userId);
  }

  @Get('authorize')
  @ApiOperation({
    summary: 'Check a role (RBAC)',
    description: 'Is the user >= min role in the scope?',
  })
  @ApiQuery({ name: 'userId' })
  @ApiQuery({ name: 'scopeType', enum: ['org', 'workspace', 'team'] })
  @ApiQuery({ name: 'scopeId' })
  @ApiQuery({ name: 'min', enum: ['owner', 'admin', 'member', 'guest', 'bot'] })
  @ApiOkResponse({ description: '{ allowed, role }.' })
  authorize(
    @Query('userId') userId: string,
    @Query('scopeType') scopeType: ScopeType,
    @Query('scopeId') scopeId: string,
    @Query('min') min: Role,
  ) {
    return this.tenancy.authorize(userId, scopeType, scopeId, min);
  }
}
