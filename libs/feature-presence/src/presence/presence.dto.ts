import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConnDto {
  @ApiProperty({ description: 'Account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ description: 'Device id opening/closing the connection.' })
  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}

export class HeartbeatDto {
  @ApiProperty({ description: 'Account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  /**
   * The beating device. Optional for compatibility with clients that only send `userId`, but
   * without it a beat cannot restore a presence key whose TTL has lapsed — it can only extend one
   * that is still there. Decorated because the global ValidationPipe runs with
   * `forbidNonWhitelisted`, where an undecorated property is a 400 rather than a silent strip.
   */
  @ApiPropertyOptional({ description: 'Device id sending the heartbeat.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  deviceId?: string;
}

export class SetStatusDto {
  @ApiProperty({ description: 'Account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({ enum: ['available', 'busy', 'dnd', 'away', 'brb', 'incall', 'offline'] })
  @IsOptional()
  @IsIn(['available', 'busy', 'dnd', 'away', 'brb', 'incall', 'offline'])
  availability?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() emoji?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() text?: string;
  @ApiPropertyOptional({ description: 'Expiry epoch ms.' })
  @IsOptional()
  @IsInt()
  expiresAt?: number;
}

export class SubscribeDto {
  @ApiProperty({ description: 'Watching account_id.' })
  @IsString()
  @IsNotEmpty()
  watcher!: string;

  @ApiProperty({ type: [String], description: 'Target account_ids (on-screen contacts).' })
  @IsArray()
  @IsString({ each: true })
  targets!: string[];
}

const VISIBILITY = ['everyone', 'contacts', 'nobody'] as const;

export class SetPrivacyDto {
  @ApiProperty({ description: 'Account_id whose privacy is being set.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({
    enum: VISIBILITY,
    description: 'Who can see the last-seen timestamp (default everyone).',
  })
  @IsOptional()
  @IsIn(VISIBILITY)
  lastSeen?: string;

  @ApiPropertyOptional({
    enum: VISIBILITY,
    description: 'Who can see you as online/typing (default everyone).',
  })
  @IsOptional()
  @IsIn(VISIBILITY)
  online?: string;
}
