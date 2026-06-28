import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { Audience, StatusKind } from './status.types';

export class PostStatusDto {
  @ApiProperty({ description: 'Author account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: ['text', 'image', 'video', 'voice'] })
  @IsIn(['text', 'image', 'video', 'voice'])
  kind!: StatusKind;

  @ApiPropertyOptional({ description: 'Media id (image/video/voice status).' })
  @IsOptional()
  @IsString()
  mediaId?: string;

  @ApiPropertyOptional({ description: 'Text — ciphertext for personal (e2ee) status.' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'Background color/gradient for text status.' })
  @IsOptional()
  @IsString()
  bg?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({
    description: 'Audience rule: {mode: contacts|except|only, list?}. Defaults to contacts.',
  })
  @IsOptional()
  @IsObject()
  audience?: Audience;

  @ApiPropertyOptional({
    type: [String],
    description: 'Author contact account_ids (resolve audience).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contacts?: string[];

  @ApiPropertyOptional({ default: true, description: 'Personal status is E2EE by default.' })
  @IsOptional()
  @IsBoolean()
  e2ee?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;
}

export class ReactStatusDto {
  @ApiProperty({ description: 'Reacting account_id.' })
  @IsString()
  @IsNotEmpty()
  viewerId!: string;

  @ApiProperty({ example: '👍' })
  @IsString()
  @IsNotEmpty()
  emoji!: string;
}
