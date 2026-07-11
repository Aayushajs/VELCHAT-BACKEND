import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Body for a real-time call caption segment (§A26.3). Send one audio chunk (or pre-transcribed
 * text) plus the listeners + their languages; the server captions each in near-real-time. */
export class CaptionDto {
  @ApiProperty({ description: 'Call id.' })
  @IsString()
  @IsNotEmpty()
  callId!: string;

  @ApiProperty({ description: 'Speaker account_id.' })
  @IsString()
  @IsNotEmpty()
  fromUserId!: string;

  @ApiPropertyOptional({ description: 'Speaker language (ISO); omit to auto-detect.' })
  @IsOptional()
  @IsString()
  srcLang?: string;

  @ApiPropertyOptional({ description: 'One audio segment (base64) to transcribe.' })
  @IsOptional()
  @IsString()
  audioB64?: string;

  @ApiPropertyOptional({ description: 'Pre-transcribed text (skip STT).' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'false = fast partial, true/omit = final segment.' })
  @IsOptional()
  @IsBoolean()
  isFinalHint?: boolean;

  @ApiProperty({
    type: [Object],
    description: 'Listeners: [{ userId, lang, tts? }] — each captioned in their own language.',
  })
  @IsArray()
  listeners!: unknown[];
}
