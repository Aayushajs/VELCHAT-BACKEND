import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateListDto {
  @ApiProperty({ description: 'Channel/DM the list is attached to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  @ApiProperty({ description: 'List title.' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ description: 'Creator account_id.' })
  @IsString()
  @IsNotEmpty()
  createdBy!: string;
}

export class AddItemDto {
  @ApiProperty({ description: 'Item text.' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiPropertyOptional({ description: 'Assignee account_id.' })
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional({ description: 'Due date (ISO).' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class UpdateItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() text?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() done?: boolean;
  @ApiPropertyOptional({ description: 'Assignee account_id (null to clear).' })
  @IsOptional()
  @IsString()
  assignee?: string | null;
  @ApiPropertyOptional({ description: 'Due date ISO (null to clear).' })
  @IsOptional()
  @IsString()
  dueAt?: string | null;
  @ApiPropertyOptional({ description: 'Order position within the list.' })
  @IsOptional()
  @IsInt()
  position?: number;
}
