import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() avatarMediaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() about?: string;

  @ApiPropertyOptional({ enum: ['everyone', 'contacts', 'nobody'] })
  @IsOptional()
  @IsIn(['everyone', 'contacts', 'nobody'])
  presencePrivacy?: string;

  @ApiPropertyOptional({ enum: ['everyone', 'contacts', 'nobody'] })
  @IsOptional()
  @IsIn(['everyone', 'contacts', 'nobody'])
  lastseenPrivacy?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() readreceiptsEnabled?: boolean;
}

export class AddContactDto {
  @ApiProperty({ description: 'Resolved contact account_id.' })
  @IsString()
  @IsNotEmpty()
  contactUserId!: string;

  @ApiPropertyOptional({ description: 'Local display name for the contact.' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ description: 'Salted hash the owner uploaded.' })
  @IsOptional()
  @IsString()
  contactHash?: string;
}

export class RegisterHashDto {
  @ApiProperty({ description: 'Salted hash of this user’s E.164 phone (client-computed).' })
  @IsString()
  @IsNotEmpty()
  phoneHash!: string;
}

export class DiscoverDto {
  @ApiProperty({ type: [String], description: 'Salted phone hashes of the address book (≤5000).' })
  @IsArray()
  @IsString({ each: true })
  hashes!: string[];
}
