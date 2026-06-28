import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { Role } from './tenancy.types';

export class CreateOrgDto {
  @ApiProperty({ description: 'Creator account_id — becomes the org owner.' })
  @IsString()
  @IsNotEmpty()
  creator!: string;

  @ApiProperty({ example: 'Acme Inc' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class CreateWorkspaceDto {
  @ApiProperty({ description: 'Creator account_id — becomes the workspace owner.' })
  @IsString()
  @IsNotEmpty()
  creator!: string;

  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Parent org id (null = standalone Slack-style workspace).' })
  @IsOptional()
  @IsString()
  orgId?: string;
}

export class CreateTeamDto {
  @ApiProperty({ description: 'Creator account_id — must be an org admin+.' })
  @IsString()
  @IsNotEmpty()
  creator!: string;

  @ApiProperty({ description: 'Parent org id.' })
  @IsString()
  @IsNotEmpty()
  orgId!: string;

  @ApiProperty({ example: 'Platform' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Acting user — must be admin+ in the scope.' })
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @ApiProperty({ description: 'Account_id to add.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({ enum: ['admin', 'member', 'guest', 'bot'], default: 'member' })
  @IsOptional()
  @IsIn(['admin', 'member', 'guest', 'bot'])
  role?: Role;
}
