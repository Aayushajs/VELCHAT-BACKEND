import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import type { CallType } from '@velchat/database';

export class CreateCallDto {
  @ApiProperty({ enum: ['dm', 'group', 'meeting', 'huddle'] })
  @IsIn(['dm', 'group', 'meeting', 'huddle'])
  type!: CallType;

  @ApiProperty({ description: 'Host account_id (creator).' })
  @IsString()
  @IsNotEmpty()
  hostId!: string;

  @ApiPropertyOptional({ description: 'Conversation this call belongs to.' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Gate joiners behind a lobby the host admits.',
  })
  @IsOptional()
  @IsBoolean()
  lobbyEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;
}

export class JoinCallDto {
  @ApiProperty({ description: 'Joining account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

export class AdmitDto {
  @ApiProperty({ description: 'Host account_id (must be the call host).' })
  @IsString()
  @IsNotEmpty()
  hostId!: string;

  @ApiProperty({ description: 'Account_id to admit from the lobby.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

export class EndCallDto {
  @ApiProperty({ description: 'Acting account_id (must be the host).' })
  @IsString()
  @IsNotEmpty()
  actorId!: string;
}

export class ScheduleMeetingDto {
  @ApiProperty({ description: 'Organizer account_id.' })
  @IsString()
  @IsNotEmpty()
  organizerId!: string;

  @ApiPropertyOptional({ example: 'Sprint planning' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 start time.', example: '2026-07-10T15:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({ type: [String], description: 'Invitee account_ids.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  invitees?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  lobbyEnabled?: boolean;
}
