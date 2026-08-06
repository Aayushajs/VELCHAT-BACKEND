import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
} from 'class-validator';
import type { MemberRole } from './conversation.types';

/** Request bodies for the conversation/membership API (§B7). Classes (not interfaces) so Swagger
 * reads the @ApiProperty schema and the global ValidationPipe enforces class-validator rules.
 *
 * §D4 principal binding: `actorId` / `creator` / self-action `userId` fields have been REMOVED.
 * The acting user is now derived from the VERIFIED JWT (@CurrentUser decorator) — never from the
 * request body. Fields that remain in DTOs are TARGET identifiers (e.g., the user to add/remove).
 */

export class CreateDmDto {
  @ApiProperty({ description: 'First participant account_id (UUIDv7).' })
  @IsUUID()
  a!: string;

  @ApiProperty({ description: 'Second participant account_id (UUIDv7).' })
  @IsUUID()
  b!: string;
}

export class CreateGroupDto {
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
  @IsUUID(undefined, { each: true })
  members?: string[];
}

export class CreateChannelDto {
  @ApiProperty({ description: 'Owning tenant (org/workspace) id — channels are tenant-scoped.' })
  @IsUUID()
  tenantId!: string;

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
  @ApiProperty({ description: 'Account_id of the user to add.' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ enum: ['owner', 'admin', 'member'], default: 'member' })
  @IsOptional()
  @IsIn(['owner', 'admin', 'member'])
  role?: MemberRole;
}

export class UpdateChannelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() topic?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() avatarMediaId?: string;
  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: string;
  @ApiPropertyOptional({ description: 'Announcement (admins-only posting).' })
  @IsOptional()
  @IsBoolean()
  isAnnouncement?: boolean;
}

export class SetRoleDto {
  @ApiProperty({ enum: ['owner', 'admin', 'member'] })
  @IsIn(['owner', 'admin', 'member'])
  role!: MemberRole;
}

export class SetNotifDto {
  @ApiProperty({ enum: ['all', 'mentions', 'none'] })
  @IsIn(['all', 'mentions', 'none'])
  level!: string;
}

export class CreateCommunityDto {
  @ApiProperty({ description: 'Community name (an announcement channel is auto-created).' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Owning org id (optional).' })
  @IsOptional()
  @IsUUID()
  orgId?: string;
}

export class AttachChannelDto {
  @ApiProperty({ description: 'Channel (conversation) id to add to the community.' })
  @IsUUID()
  conversationId!: string;
}
