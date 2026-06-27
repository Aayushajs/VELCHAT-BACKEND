import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetRetentionDto {
  @ApiPropertyOptional({ description: 'Days to retain content; null/omitted = keep forever.' })
  retentionDays?: number | null;

  @ApiProperty({ description: 'Legal hold — when true, all purges are suspended.' })
  legalHold!: boolean;
}

export class RequestExportDto {
  @ApiPropertyOptional({
    description: 'Export scope filter, e.g. {channels:[...], from, to}. Omit for the whole org.',
    type: Object,
  })
  scope?: Record<string, unknown>;
}
