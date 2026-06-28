import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
