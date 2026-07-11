import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Feature-flag admin + evaluation bodies (§7). `tenantId` optional (omitted ⇒ global/platform
 * scope); `actorId` is recorded in the audit log. Nested shapes (rollout/rules/variants) are
 * accepted as objects — the domain types validate their contents in the service/engine.
 */
const FLAG_TYPES = ['boolean', 'config', 'experiment'] as const;

class ScopedActorDto {
  @ApiPropertyOptional({ description: 'Tenant scope (omit for a global/platform flag).' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ description: 'Acting account_id (recorded in the audit log).' })
  @IsOptional()
  @IsString()
  actorId?: string;
}

export class CreateFlagDto extends ScopedActorDto {
  @ApiProperty({ description: 'Stable flag key, e.g. "new-chat-ui".' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiPropertyOptional({ enum: FLAG_TYPES, default: 'boolean' })
  @IsOptional()
  @IsIn(FLAG_TYPES as unknown as string[])
  type?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ description: 'Remote-config payload (type=config).' })
  @IsOptional()
  value?: unknown;
  @ApiPropertyOptional({ description: 'Value returned when off/not targeted.' })
  @IsOptional()
  defaultValue?: unknown;
  @ApiPropertyOptional({ type: [Object], description: 'Experiment variants [{key,value,weight}].' })
  @IsOptional()
  @IsArray()
  variants?: unknown[];
  @ApiPropertyOptional({ description: 'Rollout {percentage,segmentIds,rules,userOverrides}.' })
  @IsOptional()
  @IsObject()
  rollout?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [String], description: 'Dependency flag keys.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencies?: string[];
}

export class UpdateFlagDto extends ScopedActorDto {
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
  @ApiPropertyOptional({ enum: FLAG_TYPES })
  @IsOptional()
  @IsIn(FLAG_TYPES as unknown as string[])
  type?: string;
  @ApiPropertyOptional() @IsOptional() value?: unknown;
  @ApiPropertyOptional() @IsOptional() defaultValue?: unknown;
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() variants?: unknown[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencies?: string[];
}

export class SetRolloutDto extends ScopedActorDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  segmentIds?: string[];
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() rules?: unknown[];
  @ApiPropertyOptional({ description: 'userId → value|variantKey|boolean.' })
  @IsOptional()
  @IsObject()
  userOverrides?: Record<string, unknown>;
}

export class ScheduleDto extends ScopedActorDto {
  @ApiProperty({ enum: ['enable', 'disable'] })
  @IsIn(['enable', 'disable'])
  action!: string;

  @ApiProperty({ description: 'When to apply (ISO 8601).' })
  @IsString()
  @IsNotEmpty()
  runAt!: string;
}

export class RollbackDto extends ScopedActorDto {
  @ApiProperty({ description: 'Version to restore.' })
  @IsInt()
  @Min(1)
  toVersion!: number;
}

export class CreateSegmentDto extends ScopedActorDto {
  @ApiProperty() @IsString() @IsNotEmpty() key!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ type: [Object], description: 'Targeting rules [{attribute,op,values}].' })
  @IsArray()
  rules!: unknown[];
}

export class UpdateSegmentDto extends ScopedActorDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() rules?: unknown[];
}

export class MaintenanceDto extends ScopedActorDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() message?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowlistFlagKeys?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowRoles?: string[];
}

export class AnnouncementDto extends ScopedActorDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional({ enum: ['info', 'warn', 'critical'], default: 'info' })
  @IsOptional()
  @IsIn(['info', 'warn', 'critical'])
  level?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endsAt?: string;
}

export class EvaluateDto {
  @ApiPropertyOptional({ description: 'Tenant scope (omit for global-only evaluation).' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty({
    description: 'Evaluation context { userId?, country?, platform?, appVersion?, role?, attrs? }.',
  })
  @IsObject()
  context!: Record<string, unknown>;
}
