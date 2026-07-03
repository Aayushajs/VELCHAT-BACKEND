import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class SetPrefsDto {
  @ApiProperty({ description: 'Owner account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: ['conversation', 'channel', 'global'] })
  @IsIn(['conversation', 'channel', 'global'])
  scopeType!: string;

  @ApiProperty({ description: 'Scope id (conversation/channel id, or "global").' })
  @IsString()
  @IsNotEmpty()
  scopeId!: string;

  @ApiPropertyOptional({ enum: ['all', 'mentions', 'none'] })
  @IsOptional()
  @IsIn(['all', 'mentions', 'none'])
  level?: string;

  @ApiPropertyOptional({ description: 'Mute until this ISO time (omit to clear).' })
  @IsOptional()
  @IsISO8601()
  mutedUntil?: string;

  @ApiPropertyOptional({ type: [String], description: 'Keyword alerts.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ description: 'DND window { tz, from: "22:00", to: "07:00" }.' })
  @IsOptional()
  @IsObject()
  dndSchedule?: Record<string, unknown>;
}

export class RegisterEndpointDto {
  @ApiProperty({ description: 'Device id (owns this push handle).' })
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiProperty({ description: 'Owner account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: ['web', 'ios', 'android'] })
  @IsIn(['web', 'ios', 'android'])
  platform!: string;

  @ApiPropertyOptional({ description: 'FCM/APNs device token (mobile).' })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({ description: 'VoIP token (CallKit/ConnectionService).' })
  @IsOptional()
  @IsString()
  voipToken?: string;

  @ApiPropertyOptional({ description: 'Web Push subscription { endpoint, keys }.' })
  @IsOptional()
  @IsObject()
  subscription?: Record<string, unknown>;
}
