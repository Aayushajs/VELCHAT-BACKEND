import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EvaluateDto {
  @ApiProperty({ description: 'Requesting account_id (rate-limited).' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiProperty({
    type: [String],
    description: 'Blinded values (base64url), one per candidate contact number. Max 2000.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  blinded!: string[];

  @ApiPropertyOptional({
    description: 'OPRF key version to evaluate against (defaults to active).',
  })
  @IsOptional()
  @IsInt()
  keyVersion?: number;
}

export class RegisterOprfDto {
  @ApiProperty({ description: 'This account_id (opting in to discovery).' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiProperty({ description: 'The OPRF token this account derived for its own number.' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: 'OPRF key version the token was derived against.' })
  @IsInt()
  keyVersion!: number;
}

export class MatchOprfDto {
  @ApiProperty({ description: 'Requesting account_id (rate-limited).' })
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @ApiProperty({ type: [String], description: 'OPRF tokens derived client-side. Max 2000.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tokens!: string[];
}
