import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNotEmpty, IsString } from 'class-validator';

export class RequestResendDto {
  @ApiProperty({ description: 'Requesting account_id (the recipient who cannot decrypt).' })
  @IsString()
  @IsNotEmpty()
  requesterId!: string;

  @ApiProperty({
    description: 'Requesting device_id (the specific device that failed to decrypt).',
  })
  @IsString()
  @IsNotEmpty()
  requesterDeviceId!: string;

  @ApiPropertyOptional({
    description: 'Opaque ratchet hint to help the sender re-encrypt correctly.',
  })
  @IsOptional()
  @IsString()
  ratchetHint?: string;
}

export class FulfillResendDto {
  @ApiProperty({ description: 'The requesting device_id this fulfilment is for.' })
  @IsString()
  @IsNotEmpty()
  requesterDeviceId!: string;

  @ApiProperty({ description: 'Original sender account_id (must match the message sender).' })
  @IsString()
  @IsNotEmpty()
  senderId!: string;
}
