import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePollDto {
  @ApiProperty({ description: 'Conversation the poll belongs to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ type: [String], description: 'Poll options (min 2).' })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  options!: string[];

  @ApiPropertyOptional({ description: 'Allow selecting multiple options.' })
  @IsOptional()
  @IsBoolean()
  multi?: boolean;

  @ApiPropertyOptional({ description: 'Hide voter identities from non-admins.' })
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @ApiPropertyOptional({ description: 'ISO time the poll auto-closes.' })
  @IsOptional()
  @IsISO8601()
  closesAt?: string;

  @ApiProperty({ description: 'Creator account_id.' })
  @IsString()
  @IsNotEmpty()
  createdBy!: string;
}

export class VoteDto {
  @ApiProperty({ description: 'Voter account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ type: [String], description: 'Chosen option id(s). One for single-choice polls.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  optionIds!: string[];
}
