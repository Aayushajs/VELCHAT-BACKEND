import { Controller, Post, Get, Body, HttpCode, UseGuards } from '@nestjs/common';
import { AuthService, type RegisterInput } from './auth.service';
import type { InboundProof } from './reverse-otp/reverse-otp.service';
import type { RecoveryFactor } from './recovery/recovery.service';
import { JwtAuthGuard, Public, CurrentUser } from '@velchat/common';

/**
 * REST surface for auth (§B2 / flow C1). gRPC contract lives in libs/proto (P-later).
 *
 * Principal binding: every protected endpoint derives the accountId/deviceId from the
 * VERIFIED JWT (via @CurrentUser), not from the request body — defeats IDOR (§D4).
 */
@UseGuards(JwtAuthGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Cold-start: enter number → start Reverse-OTP (§B2.4). */
  @Public()
  @Post('register')
  register(@Body() body: RegisterInput): Promise<{ sessionId: string; expiresIn: number }> {
    return this.auth.register(body);
  }

  /**
   * Asterisk/FreeSWITCH webhook contract (§B2.2). Server-to-server only — in prod this edge is
   * locked down by NetworkPolicy + a shared secret (platform task). Runs all anti-spoof rules.
   */
  @Public()
  @Post('revotp/webhook')
  @HttpCode(200)
  webhook(@Body() proof: InboundProof): Promise<{ verified: true }> {
    return this.auth.handleReverseOtpWebhook(proof);
  }

  /** Client fetches its provisioned tokens once its device completed the missed-call/SMS. */
  @Public()
  @Post('session')
  session(@Body() body: { sessionId: string }) {
    return this.auth.getSession(body.sessionId);
  }

  // ── 2Factor.in SMS OTP (additive auth method) ──
  /** Send an SMS OTP (2Factor AUTOGEN). Dev-mode restricts sends to the configured dev phone. */
  @Public()
  @Post('otp/send')
  otpSend(
    @Body() body: { phone: string },
  ): Promise<{ message: string; resendAfter: number; expiresIn: number }> {
    return this.auth.sendOtp(body.phone);
  }

  /** Verify an SMS OTP the user typed (2Factor VERIFY3) → provision a session + return tokens. */
  @Public()
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
  account(@CurrentUser('accountId') accountId: string) {
    return this.auth.getAccountById(accountId);
  }

  /**
   * Attach/confirm the account's email (§B2.1). @gmail.com only for now, globally unique
   * (409 on a duplicate). accountId comes from the verified token — a caller can only set its
   * own. Persisted so the client never re-prompts for email after the first time.
   */
  @Post('email')
  @HttpCode(200)
  setEmail(
    @CurrentUser('accountId') accountId: string,
    @Body() body: { email: string },
  ): Promise<{ email: string }> {
    return this.auth.setEmail(accountId, body.email);
  }

  /** §B2.5 same-device login (step 1): get a nonce to sign with the device key. */
  @Public()
  @Post('challenge')
  challenge(@Body() body: { deviceId: string }) {
    return this.auth.challenge(body.deviceId);
  }

  /** §B2.5 same-device login (step 2): present the device-key signature → tokens (no OTP). */
  @Public()
  @Post('login/device-key')
  loginDeviceKey(@Body() body: { deviceId: string; signature: string }) {
    return this.auth.loginWithDeviceKey(body.deviceId, body.signature);
  }

  /** Rotating refresh + reuse-detection + DPoP (§B2.3). */
  @Public()
  @Post('token/refresh')
  refresh(@Body() body: { refreshToken: string; cnfJkt?: string }) {
    return this.auth.refresh(body.refreshToken, body.cnfJkt);
  }

  /** List devices for the authenticated account — principal from JWT (no IDOR). */
  @Get('devices')
  devices(@CurrentUser('accountId') accountId: string) {
    return this.auth.listDevices(accountId);
  }

  /** Explicit sign-out — revoke the presented refresh token family server-side (§B2.3). */
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: { refreshToken: string }): Promise<{ loggedOut: true }> {
    return this.auth.logout(body.refreshToken);
  }

  /**
   * Remotely revoke a device (lost/stolen / sign-out that device) — kills its key + sessions.
   * accountId from JWT; deviceId from body (the TARGET device to revoke).
   */
  @Post('device/revoke')
  revokeDevice(
    @CurrentUser('accountId') accountId: string,
    @Body() body: { deviceId: string },
  ): Promise<{ revoked: true }> {
    return this.auth.revokeDevice(accountId, body.deviceId);
  }

  // ── DAPT fallback: email magic-link (§B2.5) ──
  @Public()
  @Post('magic/begin')
  magicBegin(@Body() body: { email: string; platform: string; devicePubkeyBase64: string }) {
    return this.auth.magicLinkBegin(body);
  }

  @Public()
  @Post('magic/verify')
  magicVerify(@Body() body: { token: string }) {
    return this.auth.magicLinkVerify(body.token);
  }

  // ── DAPT fallback: approve-on-trusted-device (QR + signed approval, §B2.5) ──
  @Public()
  @Post('link/request')
  linkRequest(@Body() body: { devicePubkeyBase64: string; platform: string }) {
    return this.auth.linkRequest(body.devicePubkeyBase64, body.platform);
  }

  @Public()
  @Post('link/approve')
  linkApprove(@Body() body: { linkId: string; approverDeviceId: string; signature: string }) {
    return this.auth.linkApprove(body.linkId, body.approverDeviceId, body.signature);
  }

  @Public()
  @Post('link/poll')
  linkPoll(@Body() body: { linkId: string }) {
    return this.auth.linkPoll(body.linkId);
  }

  // ── DAPT fallback: passkey / WebAuthn (§B2.5) ──
  /** accountId from JWT — passkey registration is bound to the authenticated principal. */
  @Post('passkey/register/options')
  passkeyRegisterOptions(
    @CurrentUser('accountId') accountId: string,
    @Body() body: { userName: string },
  ) {
    return this.auth.passkeyRegisterOptions(accountId, body.userName);
  }

  @Post('passkey/register/verify')
  passkeyRegisterVerify(
    @CurrentUser('accountId') accountId: string,
    @Body() body: { response: unknown },
  ) {
    return this.auth.passkeyRegisterVerify(accountId, body.response);
  }

  @Post('passkey/login/options')
  passkeyLoginOptions(@CurrentUser('accountId') accountId: string) {
    return this.auth.passkeyAuthOptions(accountId);
  }

  @Post('passkey/login/verify')
  passkeyLoginVerify(
    @CurrentUser('accountId') accountId: string,
    @CurrentUser('deviceId') deviceId: string,
    @Body() body: { response: unknown },
  ) {
    return this.auth.passkeyAuthVerify(accountId, body.response, deviceId);
  }

  // ── Number change (§B2.6) — trusted device + Reverse-OTP verify NEW number ──
  /** accountId from JWT — only the authenticated account can change its own number. */
  @Post('number-change/begin')
  numberChangeBegin(
    @CurrentUser('accountId') accountId: string,
    @CurrentUser('deviceId') deviceId: string,
    @Body() body: { newPhone: string },
  ) {
    return this.auth.numberChangeBegin(accountId, body.newPhone, deviceId);
  }

  // ── Recovery (§B2.7) — 2 factors + cooling-off + full session revocation ──
  /** accountId from JWT — only the authenticated account can begin its own recovery. */
  @Post('recovery/begin')
  recoveryBegin(@CurrentUser('accountId') accountId: string) {
    return this.auth.recoveryBegin(accountId);
  }

  @Public()
  @Post('recovery/factor')
  recoveryFactor(@Body() body: { recoveryId: string; factor: RecoveryFactor }) {
    return this.auth.recoveryAddFactor(body.recoveryId, body.factor);
  }

  /** accountId from JWT — backup code validation bound to authenticated principal. */
  @Post('recovery/backup-code')
  recoveryBackupCode(
    @CurrentUser('accountId') accountId: string,
    @Body() body: { recoveryId: string; code: string },
  ) {
    return this.auth.recoveryUseBackupCode(body.recoveryId, accountId, body.code);
  }

  @Public()
  @Post('recovery/complete')
  recoveryComplete(@Body() body: { recoveryId: string }) {
    return this.auth.recoveryComplete(body.recoveryId);
  }

  /** accountId from JWT — only the authenticated account can issue its own backup codes. */
  @Post('backup-codes/issue')
  backupCodes(@CurrentUser('accountId') accountId: string) {
    return this.auth.issueBackupCodes(accountId);
  }
}

/** Public JWKS for resource servers to verify RS256 access tokens (§B2.3). */
@Controller()
export class JwksController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('.well-known/jwks.json')
  jwks(): { keys: Array<Record<string, unknown>> } {
    return this.auth.jwks();
  }
}
