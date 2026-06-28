import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import type { MemberRole } from './conversation.types';

/** Request bodies for the conversation/membership API (§B7). Classes (not interfaces) so Swagger
 * reads the @ApiProperty schema and the global ValidationPipe enforces class-validator rules. */

export class CreateDmDto {
  @ApiProperty({ description: 'First participant account_id (UUIDv7).' })
  @IsString()
  @IsNotEmpty()
  a!: string;

  @ApiProperty({ description: 'Second participant account_id (UUIDv7).' })
  @IsString()
  @IsNotEmpty()
  b!: string;
}

export class CreateGroupDto {
  @ApiProperty({ description: 'Creator account_id — becomes the group owner.' })
  @IsString()
  @IsNotEmpty()
  creator!: string;

  @ApiProperty({ description: 'Group display name.', example: 'Weekend Trip' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Initial member account_ids (creator is added automatically). Max 1024.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  members?: string[];
}

export class CreateChannelDto {
  @ApiProperty({ description: 'Owning tenant (org/workspace) id — channels are tenant-scoped.' })
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty({ description: 'Creator account_id — becomes the channel owner.' })
  @IsString()
  @IsNotEmpty()
  creator!: string;

  @ApiProperty({ description: 'Channel name.', example: 'engineering' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ enum: ['public', 'private'], default: 'public' })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Announcement channel — only admins may post.',
  })
  @IsOptional()
  @IsBoolean()
  isAnnouncement?: boolean;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Acting user — must be an owner or admin of the conversation.' })
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @ApiProperty({ description: 'Account_id of the user to add.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({ enum: ['owner', 'admin', 'member'], default: 'member' })
  @IsOptional()
  @IsIn(['owner', 'admin', 'member'])
  role?: MemberRole;
}
