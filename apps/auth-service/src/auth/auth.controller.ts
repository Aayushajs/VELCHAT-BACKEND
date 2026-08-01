import { Controller, Post, Get, Body, Query, Headers, HttpCode } from '@nestjs/common';
import { AuthService, type RegisterInput } from './auth.service';
import type { InboundProof } from './reverse-otp/reverse-otp.service';
import type { RecoveryFactor } from './recovery/recovery.service';

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

  // ── 2Factor.in SMS OTP (additive auth method) ──
  /** Send an SMS OTP (2Factor AUTOGEN). Dev-mode restricts sends to the configured dev phone. */
  @Post('otp/send')
  otpSend(
    @Body() body: { phone: string },
  ): Promise<{ message: string; resendAfter: number; expiresIn: number }> {
    return this.auth.sendOtp(body.phone);
  }

  /** Verify an SMS OTP the user typed (2Factor VERIFY3) → provision a session + return tokens. */
  @Post('otp/verify')
  otpVerify(
    @Body() body: { phone: string; otp: string; platform: string; devicePubkeyBase64: string },
  ) {
    return this.auth.verifyOtp(body.phone, body.otp, body.platform, body.devicePubkeyBase64);
  }

  /**
   * Read-only account snapshot for the profile header — verified phone/email + the
   * account's created/last-active timestamps (member-since + last-login). The account is
   * taken from the VERIFIED access token (Authorization header), so a caller can only read
   * its own account — no IDOR. No migration, no token-path change.
   */
  @Get('account')
  account(@Headers('authorization') authorization?: string) {
    return this.auth.getAccount(authorization);
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

  /** Explicit sign-out — revoke the presented refresh token family server-side (§B2.3). */
  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: { refreshToken: string }): Promise<{ loggedOut: true }> {
    return this.auth.logout(body.refreshToken);
  }

  /** Remotely revoke a device (lost/stolen / sign-out that device) — kills its key + sessions. */
  @Post('device/revoke')
  revokeDevice(@Body() body: { accountId: string; deviceId: string }): Promise<{ revoked: true }> {
    return this.auth.revokeDevice(body.accountId, body.deviceId);
  }

  // ── DAPT fallback: email magic-link (§B2.5) ──
  @Post('magic/begin')
  magicBegin(@Body() body: { email: string; platform: string; devicePubkeyBase64: string }) {
    return this.auth.magicLinkBegin(body);
  }

  @Post('magic/verify')
  magicVerify(@Body() body: { token: string }) {
    return this.auth.magicLinkVerify(body.token);
  }

  // ── DAPT fallback: approve-on-trusted-device (QR + signed approval, §B2.5) ──
  @Post('link/request')
  linkRequest(@Body() body: { devicePubkeyBase64: string; platform: string }) {
    return this.auth.linkRequest(body.devicePubkeyBase64, body.platform);
  }

  @Post('link/approve')
  linkApprove(@Body() body: { linkId: string; approverDeviceId: string; signature: string }) {
    return this.auth.linkApprove(body.linkId, body.approverDeviceId, body.signature);
  }

  @Post('link/poll')
  linkPoll(@Body() body: { linkId: string }) {
    return this.auth.linkPoll(body.linkId);
  }

  // ── DAPT fallback: passkey / WebAuthn (§B2.5) ──
  @Post('passkey/register/options')
  passkeyRegisterOptions(@Body() body: { accountId: string; userName: string }) {
    return this.auth.passkeyRegisterOptions(body.accountId, body.userName);
  }

  @Post('passkey/register/verify')
  passkeyRegisterVerify(@Body() body: { accountId: string; response: unknown }) {
    return this.auth.passkeyRegisterVerify(body.accountId, body.response);
  }

  @Post('passkey/login/options')
  passkeyLoginOptions(@Body() body: { accountId: string }) {
    return this.auth.passkeyAuthOptions(body.accountId);
  }

  @Post('passkey/login/verify')
  passkeyLoginVerify(@Body() body: { accountId: string; deviceId: string; response: unknown }) {
    return this.auth.passkeyAuthVerify(body.accountId, body.response, body.deviceId);
  }

  // ── Number change (§B2.6) — trusted device + Reverse-OTP verify NEW number ──
  @Post('number-change/begin')
  numberChangeBegin(
    @Body() body: { accountId: string; newPhone: string; trustedDeviceId: string },
  ) {
    return this.auth.numberChangeBegin(body.accountId, body.newPhone, body.trustedDeviceId);
  }

  // ── Recovery (§B2.7) — 2 factors + cooling-off + full session revocation ──
  @Post('recovery/begin')
  recoveryBegin(@Body() body: { accountId: string }) {
    return this.auth.recoveryBegin(body.accountId);
  }

  @Post('recovery/factor')
  recoveryFactor(@Body() body: { recoveryId: string; factor: RecoveryFactor }) {
    return this.auth.recoveryAddFactor(body.recoveryId, body.factor);
  }

  @Post('recovery/backup-code')
  recoveryBackupCode(@Body() body: { recoveryId: string; accountId: string; code: string }) {
    return this.auth.recoveryUseBackupCode(body.recoveryId, body.accountId, body.code);
  }

  @Post('recovery/complete')
  recoveryComplete(@Body() body: { recoveryId: string }) {
    return this.auth.recoveryComplete(body.recoveryId);
  }

  @Post('backup-codes/issue')
  backupCodes(@Body() body: { accountId: string }) {
    return this.auth.issueBackupCodes(body.accountId);
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
