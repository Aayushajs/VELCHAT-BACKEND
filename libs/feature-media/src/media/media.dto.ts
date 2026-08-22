import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/** Body to check which media are still fetchable server-side (re-download strategy). */
export class AvailabilityDto {
  @ApiProperty({ type: [String], description: 'Media ids to check (max 500).' })
  @IsArray()
  @IsString({ each: true })
  mediaIds!: string[];
}

/** Body to reserve a media object before uploading its bytes (§B11). */
export class InitUploadDto {
  @ApiProperty({ description: 'Uploader account_id.' })
  @IsString()
  @IsNotEmpty()
  ownerId!: string;

  @ApiPropertyOptional({ description: 'MIME type, e.g. image/jpeg.' })
  @IsOptional()
  @IsString()
  mime?: string;

  @ApiPropertyOptional({ description: 'Conversation this media belongs to.' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Tenant id for enterprise/channel media.' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'True for personal E2EE — bytes are ciphertext; the server never inspects them.',
  })
  @IsOptional()
  @IsBoolean()
  encrypted?: boolean;

  @ApiPropertyOptional({ default: false, description: 'View-once media (§C22).' })
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;
}

/** Transcode/thumbnail write-back from a worker (§B11 async pipeline, enterprise only). */
export class RenditionsDto {
  @ApiPropertyOptional({ description: 'Rendition map {hls, 720p, 480p, webp...}.' })
  @IsOptional()
  @IsObject()
  renditions?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Thumbnail storage key.' })
  @IsOptional()
  @IsString()
  thumbKey?: string;

  @ApiPropertyOptional({ description: 'Blurhash placeholder.' })
  @IsOptional()
  @IsString()
  blurhash?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() width?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() height?: number;
  @ApiPropertyOptional({ description: 'Duration in seconds (audio/video).' })
  @IsOptional()
  @IsInt()
  duration?: number;
}
