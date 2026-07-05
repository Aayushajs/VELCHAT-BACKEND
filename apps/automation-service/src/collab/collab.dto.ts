import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PostClipDto {
  @ApiProperty({ description: 'Channel/DM the clip is posted to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ description: 'media_id of the recording (uploaded via media-service).' })
  @IsString()
  @IsNotEmpty()
  mediaId!: string;

  @ApiProperty({ description: 'Poster account_id.' })
  @IsString()
  @IsNotEmpty()
  postedBy!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() caption?: string;
  @ApiPropertyOptional({ description: 'Clip length in seconds.' })
  @IsOptional()
  @IsInt()
  durationSec?: number;
}

export class CreateCanvasDto {
  @ApiProperty({ description: 'Channel/DM the canvas is attached to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty() @IsString() @IsNotEmpty() title!: string;

  @ApiPropertyOptional({ type: [Object], description: 'Initial content blocks.' })
  @IsOptional()
  @IsArray()
  content?: unknown[];

  @ApiProperty({ description: 'Creator account_id.' })
  @IsString()
  @IsNotEmpty()
  createdBy!: string;
}

export class UpdateCanvasDto {
  @ApiProperty({ description: 'Version you last read (optimistic concurrency).' })
  @IsInt()
  expectedVersion!: number;

  @ApiProperty({ description: 'Editor account_id.' })
  @IsString()
  @IsNotEmpty()
  updatedBy!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  content?: unknown[];
}
