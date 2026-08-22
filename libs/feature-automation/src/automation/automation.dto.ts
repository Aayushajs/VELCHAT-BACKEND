import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBotDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
  @ApiPropertyOptional({ description: 'Webhook the platform POSTs slash commands to.' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

export class RegisterCommandDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceId!: string;
  @ApiProperty({ description: 'Command name (with or without leading /).' })
  @IsString()
  @IsNotEmpty()
  command!: string;
  @ApiProperty() @IsString() @IsNotEmpty() botId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class DispatchSlashDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() command!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() args?: string;
  @ApiProperty() @IsString() @IsNotEmpty() userId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
}

export class CreateReminderDto {
  @ApiProperty() @IsString() @IsNotEmpty() text!: string;
  @ApiProperty({ description: 'When to fire (ISO datetime).' }) @IsISO8601() remindAt!: string;
  @ApiProperty() @IsString() @IsNotEmpty() userId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
}

export class CreateWorkflowDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ description: 'Trigger: { type: manual|keyword|schedule, ... }' })
  trigger!: Record<string, unknown>;
  @ApiProperty({
    type: [Object],
    description: 'Ordered steps: { type: emit_event|webhook|delay, ... }',
  })
  @IsArray()
  steps!: Record<string, unknown>[];
}

export class TriggerWorkflowDto {
  @ApiPropertyOptional({ description: 'Trigger context passed to steps.' })
  @IsOptional()
  context?: Record<string, unknown>;
}
