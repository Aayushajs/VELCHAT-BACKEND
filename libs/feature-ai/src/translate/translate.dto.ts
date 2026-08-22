import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TranslateDto {
  @ApiProperty({ description: 'Text to translate (ENTERPRISE/server-readable content only).' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiProperty({ description: 'Target language code (e.g. "hi", "en", "fr").' })
  @IsString()
  @IsNotEmpty()
  target!: string;

  @ApiPropertyOptional({ description: 'Source language code; omit to auto-detect.' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class DetectDto {
  @ApiProperty({ description: 'Text to language-detect.' })
  @IsString()
  @IsNotEmpty()
  text!: string;
}

export class SetUserLangDto {
  @ApiProperty({ description: 'Owner account_id.' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiPropertyOptional({ description: 'UI language.' })
  @IsOptional()
  @IsString()
  uiLang?: string;

  @ApiPropertyOptional({ description: 'Preferred message language (for auto-translate).' })
  @IsOptional()
  @IsString()
  preferredMsgLang?: string;

  @ApiPropertyOptional({ description: 'Auto-translate incoming messages.' })
  @IsOptional()
  @IsBoolean()
  autoTranslate?: boolean;

  @ApiPropertyOptional({ description: 'Caption language for call translation.' })
  @IsOptional()
  @IsString()
  captionLang?: string;

  @ApiPropertyOptional({ description: 'Spoken (TTS) language for call translation.' })
  @IsOptional()
  @IsString()
  voiceLang?: string;
}

export class SetChatPrefDto {
  @ApiProperty({ description: 'Owner account_id.' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiProperty({ description: 'Conversation id.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ enum: ['off', 'auto', 'manual'] })
  @IsIn(['off', 'auto', 'manual'])
  mode!: string;

  @ApiPropertyOptional({ description: 'Target language for this chat.' })
  @IsOptional()
  @IsString()
  targetLang?: string;
}
