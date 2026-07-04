import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecurrenceDto {
  @ApiPropertyOptional({ description: 'Send every N days (e.g. 3 = "har 3 din me ek baar").' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  everyDays?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Weekdays to send on, 0=Sun … 6=Sat (e.g. [1,4] = "week me 2 baar").',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];
}

export class CreateCampaignDto {
  @ApiProperty({ description: 'Human-readable campaign name (for the dashboard).' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Email subject line.' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiProperty({ enum: ['welcome', 'notification', 'custom'] })
  @IsIn(['welcome', 'notification', 'custom'])
  template!: 'welcome' | 'notification' | 'custom';

  @ApiPropertyOptional({ description: 'Custom HTML body (template=custom).' })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({ description: 'Body text (notification/custom) + plain-text fallback.' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'CTA button label.' })
  @IsOptional()
  @IsString()
  ctaText?: string;

  @ApiPropertyOptional({ description: 'CTA button URL.' })
  @IsOptional()
  @IsString()
  ctaUrl?: string;

  @ApiProperty({ type: [String], description: 'Recipient email addresses (bulk).' })
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  recipients!: string[];

  @ApiProperty({
    enum: ['immediate', 'scheduled', 'recurring'],
    description: 'immediate = send now · scheduled = at scheduledAt · recurring = on a cadence.',
  })
  @IsIn(['immediate', 'scheduled', 'recurring'])
  mode!: 'immediate' | 'scheduled' | 'recurring';

  @ApiPropertyOptional({ description: 'ISO time to send (scheduled) / first run (recurring).' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({ type: RecurrenceDto, description: 'Cadence (recurring).' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;

  @ApiPropertyOptional({ description: 'ISO end date — stop recurring after this.' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ description: 'Stop recurring after this many sends.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOccurrences?: number;
}

export class BulkSendDto {
  @ApiProperty({ type: [String], description: 'Recipient email addresses.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  recipients!: string[];

  @ApiProperty({ description: 'Email subject line.' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiPropertyOptional({ enum: ['welcome', 'notification', 'custom'], default: 'notification' })
  @IsOptional()
  @IsIn(['welcome', 'notification', 'custom'])
  template?: 'welcome' | 'notification' | 'custom';

  @ApiPropertyOptional({ description: 'Body text (for notification/custom).' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'Custom HTML body.' })
  @IsOptional()
  @IsString()
  html?: string;
}
