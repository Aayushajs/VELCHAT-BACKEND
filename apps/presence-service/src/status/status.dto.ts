import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Audience, StatusKind } from './status.types';

export class PostStatusDto {
  @ApiProperty({ description: 'Author account_id.' })
  userId!: string;

  @ApiProperty({ enum: ['text', 'image', 'video', 'voice'] })
  kind!: StatusKind;

  @ApiPropertyOptional({ description: 'Media id (image/video/voice status).' })
  mediaId?: string;

  @ApiPropertyOptional({ description: 'Text — ciphertext for personal (e2ee) status.' })
  text?: string;

  @ApiPropertyOptional({ description: 'Background color/gradient for text status.' })
  bg?: string;

  @ApiPropertyOptional()
  caption?: string;

  @ApiPropertyOptional({
    description: 'Audience rule: {mode: contacts|except|only, list?}. Defaults to contacts.',
  })
  audience?: Audience;

  @ApiPropertyOptional({
    type: [String],
    description: 'Author contact account_ids (resolve audience).',
  })
  contacts?: string[];

  @ApiPropertyOptional({ default: true, description: 'Personal status is E2EE by default.' })
  e2ee?: boolean;

  @ApiPropertyOptional({ default: false })
  viewOnce?: boolean;
}

export class ReactStatusDto {
  @ApiProperty({ description: 'Reacting account_id.' })
  viewerId!: string;

  @ApiProperty({ example: '👍' })
  emoji!: string;
}
