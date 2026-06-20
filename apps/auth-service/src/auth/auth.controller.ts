import { Controller, Post, Get, Body, Query, HttpCode } from '@nestjs/common';
import { AppError } from '@velchat/shared-utils';
import { AuthService, type RegisterInput } from './auth.service';
import type { InboundProof } from './reverse-otp.service';

/** REST surface for auth (§B2 / flow C1). gRPC contract lives in libs/proto (P-later). */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Cold-start: enter number → start Reverse-OTP (§B2.4). */
  @Post('register')
  register(@Body() body: RegisterInput): Promise<{ sessionId: string; expiresIn: number }> {
    return this.auth.register(body);
  }

  /**
   * Asterisk/FreeSWITCH webhook contract (§B2.2). Server-to-server only — in prod this edge is
   * locked down by NetworkPolicy + a shared secret (platform task). Runs all anti-spoof rules.
   */
  @Post('revotp/webhook')
  @HttpCode(200)
  webhook(@Body() proof: InboundProof): Promise<{ verified: true }> {
    return this.auth.handleReverseOtpWebhook(proof);
  }

  /** Client fetches its provisioned tokens once its device completed the missed-call/SMS. */
  @Post('session')
  session(@Body() body: { sessionId: string }) {
    return this.auth.getSession(body.sessionId);
  }

  /** §B2.5 same-device login (step 1): get a nonce to sign with the device key. */
  @Post('challenge')
  challenge(@Body() body: { deviceId: string }) {
    return this.auth.challenge(body.deviceId);
  }

  /** §B2.5 same-device login (step 2): present the device-key signature → tokens (no OTP). */
  @Post('login/device-key')
  loginDeviceKey(@Body() body: { deviceId: string; signature: string }) {
    return this.auth.loginWithDeviceKey(body.deviceId, body.signature);
  }

  /** Rotating refresh + reuse-detection + DPoP (§B2.3). */
  @Post('token/refresh')
  refresh(@Body() body: { refreshToken: string; cnfJkt?: string }) {
    return this.auth.refresh(body.refreshToken, body.cnfJkt);
  }

  @Get('devices')
  devices(@Query('accountId') accountId: string) {
    return this.auth.listDevices(accountId);
  }

  // ── DAPT fallbacks — surface defined; full impl in the next P1 increments ──
  @Post('passkey/register')
  @HttpCode(501)
  passkeyRegister(): never {
    throw new AppError(
      'NOT_IMPLEMENTED',
      'Passkey (WebAuthn) registration — next P1 increment (§B2.5)',
      501,
    );
  }

  @Post('recovery/begin')
  @HttpCode(501)
  recoveryBegin(): never {
    throw new AppError('NOT_IMPLEMENTED', 'Account recovery — next P1 increment (§B2.7)', 501);
  }

  @Post('number-change/begin')
  @HttpCode(501)
  numberChangeBegin(): never {
    throw new AppError('NOT_IMPLEMENTED', 'Number change — next P1 increment (§B2.6)', 501);
  }
}

/** Public JWKS for resource servers to verify RS256 access tokens (§B2.3). */
@Controller()
export class JwksController {
  constructor(private readonly auth: AuthService) {}

  @Get('.well-known/jwks.json')
  jwks(): { keys: Array<Record<string, unknown>> } {
    return this.auth.jwks();
  }
}
