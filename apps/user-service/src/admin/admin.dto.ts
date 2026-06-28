import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';

export class SetRetentionDto {
  @ApiPropertyOptional({ description: 'Days to retain content; null/omitted = keep forever.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  retentionDays?: number | null;

  @ApiProperty({ description: 'Legal hold — when true, all purges are suspended.' })
  @IsBoolean()
  legalHold!: boolean;
}

export class RequestExportDto {
  @ApiPropertyOptional({
    description: 'Export scope filter, e.g. {channels:[...], from, to}. Omit for the whole org.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;
}
