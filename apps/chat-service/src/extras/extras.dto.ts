import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsString } from 'class-validator';

export class PinDto {
  @ApiProperty({ description: 'Who is pinning (account_id).' })
  @IsString()
  @IsNotEmpty()
  by!: string;
}

export class StarDto {
  @ApiProperty({ description: 'Conversation the message belongs to.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;
}

export class ArchiveDto {
  @ApiProperty({ description: 'Archive (true) or unarchive (false).' })
  @IsBoolean()
  archived!: boolean;
}

export class PinChatDto {
  @ApiProperty({ description: 'Pin the chat to top (true) or unpin (false).' })
  @IsBoolean()
  pinned!: boolean;
}

export class MuteDto {
  @ApiProperty({
    enum: ['8h', '1w', 'always', 'off'],
    description: 'Mute duration (off = unmute).',
  })
  @IsIn(['8h', '1w', 'always', 'off'])
  duration!: '8h' | '1w' | 'always' | 'off';
}
