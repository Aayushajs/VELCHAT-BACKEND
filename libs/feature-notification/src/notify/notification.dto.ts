import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class SetPrefsDto {
  @ApiProperty({ description: 'Owner account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: ['conversation', 'channel', 'global'] })
  @IsIn(['conversation', 'channel', 'global'])
  scopeType!: string;

  @ApiProperty({ description: 'Scope id (conversation/channel id, or "global").' })
  @IsString()
  @IsNotEmpty()
  scopeId!: string;

  @ApiPropertyOptional({ enum: ['all', 'mentions', 'none'] })
  @IsOptional()
  @IsIn(['all', 'mentions', 'none'])
  level?: string;

  @ApiPropertyOptional({ description: 'Mute until this ISO time (omit to clear).' })
  @IsOptional()
  @IsISO8601()
  mutedUntil?: string;

  @ApiPropertyOptional({ type: [String], description: 'Keyword alerts.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ description: 'DND window { tz, from: "22:00", to: "07:00" }.' })
  @IsOptional()
  @IsObject()
  dndSchedule?: Record<string, unknown>;
}

export class RegisterEndpointDto {
  @ApiProperty({ description: 'Device id (owns this push handle).' })
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiProperty({ description: 'Owner account_id.' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: ['web', 'ios', 'android'] })
  @IsIn(['web', 'ios', 'android'])
  platform!: string;

  @ApiPropertyOptional({ description: 'FCM/APNs device token (mobile).' })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({ description: 'VoIP token (CallKit/ConnectionService).' })
  @IsOptional()
  @IsString()
  voipToken?: string;

  @ApiPropertyOptional({ description: 'Web Push subscription { endpoint, keys }.' })
  @IsOptional()
  @IsObject()
  subscription?: Record<string, unknown>;
}

/**
 * A woken device acknowledging a push (`POST /notifications/ack`). Deliberately NOT bearer-authed
 * — the credential is `pushToken`, because a device woken from a killed state has no usable JWT
 * and refreshing one from native would rotate the refresh family out from under the JS side.
 * See `push-ack.ts` for the full rationale and threat model.
 */
export class DeviceAckDto {
  @ApiProperty({ description: 'Device id this push endpoint belongs to.' })
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiProperty({ description: 'The FCM/APNs token registered for this device — the credential.' })
  @IsString()
  @IsNotEmpty()
  pushToken!: string;

  @ApiProperty({ description: 'Conversation being acknowledged.' })
  @IsString()
  @IsNotEmpty()
  conversationId!: string;

  /**
   * Cumulative watermark: this receipt covers every message at or below `upToSeq`.
   *
   * The decorators are NOT optional here. The global pipe runs with `whitelist` AND
   * `forbidNonWhitelisted` (`libs/common/src/nest/bootstrap.ts`), so a property with no
   * class-validator decorator is not merely stripped — the whole request is rejected with 400.
   * An undecorated `upToSeq` would therefore have failed EVERY ack, and the failure would have
   * been invisible: a refused ack looks exactly like the missing-tick bug this endpoint fixes.
   *
   * `@Type(() => Number)` because a client that stringifies the seq (every value in an FCM data
   * payload is a string on the wire) must still be accepted rather than 400'd.
   */
  @ApiProperty({
    description: 'Cumulative watermark: every message at or below this seq (a string is coerced).',
    type: Number,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  upToSeq!: number;

  @ApiProperty({ enum: ['delivered', 'read'] })
  @IsIn(['delivered', 'read'])
  state!: string;
}
