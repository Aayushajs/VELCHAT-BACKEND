import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { Audience, StatusKind } from './status.types';

/**
 * A new status. Deliberately contains NO identity and NO contact list: the author comes from the
 * verified token, and the audience is resolved server-side from the directory. Accepting either
 * from the client made impersonation and audience-widening trivial.
 *
 * The global ValidationPipe runs with `forbidNonWhitelisted`, so a client still sending the old
 * `userId`/`contacts` fields is now REJECTED with 400 rather than silently ignored.
 */
export class PostStatusDto {
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

  @ApiPropertyOptional({ description: 'Caption — ciphertext for personal (e2ee) status.' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({
    description: 'Audience RULE: {mode: contacts|except|only, list?}. Defaults to contacts.',
  })
  @IsOptional()
  @IsObject()
  audience?: Audience;

  @ApiPropertyOptional({ default: true, description: 'Personal status is E2EE by default.' })
  @IsOptional()
  @IsBoolean()
  e2ee?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;
}

/** The reacting account comes from the token, never the body. */
export class ReactStatusDto {
  @ApiProperty({ example: '👍' })
  @IsString()
  @IsNotEmpty()
  emoji!: string;
}

/**
 * Cursor pagination over the viewer list.
 *
 * Both fields stay strings: the global ValidationPipe sets `enableImplicitConversion: false`, so
 * query params arrive as strings, and `class-transformer` is not a dependency of this package.
 * `limit` is converted by the controller and clamped by the service; `after` is validated as a
 * timestamp here because it reaches Postgres as `$2::timestamptz`, where a malformed value would
 * surface as a 500 instead of a 400.
 */
export class ViewersQueryDto {
  @ApiPropertyOptional({ default: 50, description: 'Page size (clamped to 100).' })
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @ApiPropertyOptional({ description: 'Cursor: the previous page’s nextCursor (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  after?: string;
}
