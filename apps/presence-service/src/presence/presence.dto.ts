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
