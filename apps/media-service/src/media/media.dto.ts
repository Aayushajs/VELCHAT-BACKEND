import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body to reserve a media object before uploading its bytes (§B11). */
export class InitUploadDto {
  @ApiProperty({ description: 'Uploader account_id.' })
  ownerId!: string;

  @ApiPropertyOptional({ description: 'MIME type, e.g. image/jpeg.' })
  mime?: string;

  @ApiPropertyOptional({ description: 'Conversation this media belongs to.' })
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Tenant id for enterprise/channel media.' })
  tenantId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'True for personal E2EE — bytes are ciphertext; the server never inspects them.',
  })
  encrypted?: boolean;

  @ApiPropertyOptional({ default: false, description: 'View-once media (§C22).' })
  viewOnce?: boolean;
}
