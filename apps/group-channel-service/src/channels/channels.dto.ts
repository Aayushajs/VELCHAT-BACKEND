import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MemberRole } from './conversation.types';

/** Request bodies for the conversation/membership API (§B7). Classes (not interfaces) so Swagger
 * reads the @ApiProperty schema at runtime. */

export class CreateDmDto {
  @ApiProperty({ description: 'First participant account_id (UUIDv7).' })
  a!: string;

  @ApiProperty({ description: 'Second participant account_id (UUIDv7).' })
  b!: string;
}

export class CreateGroupDto {
  @ApiProperty({ description: 'Creator account_id — becomes the group owner.' })
  creator!: string;

  @ApiProperty({ description: 'Group display name.', example: 'Weekend Trip' })
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Initial member account_ids (creator is added automatically). Max 1024.',
  })
  members?: string[];
}

export class CreateChannelDto {
  @ApiProperty({ description: 'Owning tenant (org/workspace) id — channels are tenant-scoped.' })
  tenantId!: string;

  @ApiProperty({ description: 'Creator account_id — becomes the channel owner.' })
  creator!: string;

  @ApiProperty({ description: 'Channel name.', example: 'engineering' })
  name!: string;

  @ApiPropertyOptional({ enum: ['public', 'private'], default: 'public' })
  visibility?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Announcement channel — only admins may post.',
  })
  isAnnouncement?: boolean;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Acting user — must be an owner or admin of the conversation.' })
  actorId!: string;

  @ApiProperty({ description: 'Account_id of the user to add.' })
  userId!: string;

  @ApiPropertyOptional({ enum: ['owner', 'admin', 'member'], default: 'member' })
  role?: MemberRole;
}
