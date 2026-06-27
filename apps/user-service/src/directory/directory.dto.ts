import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional() displayName?: string;
  @ApiPropertyOptional() avatarMediaId?: string;
  @ApiPropertyOptional() about?: string;
  @ApiPropertyOptional({ enum: ['everyone', 'contacts', 'nobody'] }) presencePrivacy?: string;
  @ApiPropertyOptional({ enum: ['everyone', 'contacts', 'nobody'] }) lastseenPrivacy?: string;
  @ApiPropertyOptional() readreceiptsEnabled?: boolean;
}

export class AddContactDto {
  @ApiProperty({ description: 'Resolved contact account_id.' })
  contactUserId!: string;

  @ApiPropertyOptional({ description: 'Local display name for the contact.' })
  displayName?: string;

  @ApiPropertyOptional({ description: 'Salted hash the owner uploaded.' })
  contactHash?: string;
}

export class RegisterHashDto {
  @ApiProperty({ description: 'Salted hash of this user’s E.164 phone (client-computed).' })
  phoneHash!: string;
}

export class DiscoverDto {
  @ApiProperty({ type: [String], description: 'Salted phone hashes of the address book (≤5000).' })
  hashes!: string[];
}
