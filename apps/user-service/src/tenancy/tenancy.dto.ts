import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Role } from './tenancy.types';

export class CreateOrgDto {
  @ApiProperty({ description: 'Creator account_id — becomes the org owner.' })
  creator!: string;

  @ApiProperty({ example: 'Acme Inc' })
  name!: string;
}

export class CreateWorkspaceDto {
  @ApiProperty({ description: 'Creator account_id — becomes the workspace owner.' })
  creator!: string;

  @ApiProperty({ example: 'Engineering' })
  name!: string;

  @ApiPropertyOptional({ description: 'Parent org id (null = standalone Slack-style workspace).' })
  orgId?: string;
}

export class CreateTeamDto {
  @ApiProperty({ description: 'Creator account_id — must be an org admin+.' })
  creator!: string;

  @ApiProperty({ description: 'Parent org id.' })
  orgId!: string;

  @ApiProperty({ example: 'Platform' })
  name!: string;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Acting user — must be admin+ in the scope.' })
  actorId!: string;

  @ApiProperty({ description: 'Account_id to add.' })
  userId!: string;

  @ApiPropertyOptional({ enum: ['admin', 'member', 'guest', 'bot'], default: 'member' })
  role?: Role;
}
