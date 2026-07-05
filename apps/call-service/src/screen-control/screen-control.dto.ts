import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RequestControlDto {
  @ApiProperty({ description: 'The viewer requesting control (account_id).' })
  @IsString()
  @IsNotEmpty()
  controllerId!: string;

  @ApiProperty({ description: 'The screen owner (account_id).' })
  @IsString()
  @IsNotEmpty()
  sharerId!: string;
}

export class ControlActionDto {
  @ApiProperty({
    description: 'The acting account_id (sharer for grant/deny/revoke, controller for release).',
  })
  @IsString()
  @IsNotEmpty()
  actorId!: string;
}
