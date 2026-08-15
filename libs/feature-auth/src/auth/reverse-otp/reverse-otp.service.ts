import { randomInt } from 'node:crypto';
import { AppError } from '@velchat/common';

export type OriginationClass = 'mobile' | 'voip' | 'sip-gateway' | 'landline' | 'unknown';
export type AttestationVerdict = 'genuine' | 'unevaluated' | 'failed';

/** Ephemeral verification session — lives in Valkey under `revotp:{sessionId}` with a short TTL. */
export interface ReverseOtpSession {
  sessionId: string;
  phone: string;
  token: string;
  expiresAt: number;
}

export interface ReverseOtpStore {
  put(session: ReverseOtpSession, ttlSec: number): Promise<void>;
  get(sessionId: string): Promise<ReverseOtpSession | null>;
  del(sessionId: string): Promise<void>;
}

/** What the Asterisk/FreeSWITCH webhook delivers when the user initiates verification (§B2.2). */
export interface InboundProof {
  sessionId: string;
  cli: string; // caller-ID (missed-call) or SMS sender, E.164
  path: 'missed-call' | 'sms';
  token?: string; // SMS path
  originationClass: OriginationClass;
  attestation: AttestationVerdict;
  riskScore: number; // 0..100; lower is safer
  ts: number;
}

export interface ReverseOtpOptions {
  ttlSec?: number;
  riskThreshold?: number;
  voipPrefixes?: string[];
}

/** Distinct, machine-readable rejection per anti-spoof rule. */
export class ReverseOtpRejected extends AppError {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`REVOTP_${rule.toUpperCase().replace(/-/g, '_')}`, message, 401);
  }
}

// Stub — the real list comes from carrier/number-intelligence data (platform task).
const DEFAULT_VOIP_PREFIXES = ['+1800', '+1888', '+1877', '+1866'];

/**
 * Reverse-OTP (₹0 per verification, §B2.2). The user initiates from their own device; the webhook
 * reports the proof; we verify ALL anti-spoof rules before marking the number verified:
 *  1. CLI/sender == the phone typed in this session
 *  2. (SMS) token matches + within the time-window
 *  3. origination is a REAL MOBILE (reject VoIP/SIP-gateway/known-spoof ranges)
 *  4. device attestation verdict is genuine
 *  5. risk score below threshold
 */
export class ReverseOtpService {
  private readonly ttlSec: number;
  private readonly riskThreshold: number;
  private readonly voipPrefixes: string[];

  constructor(
    private readonly store: ReverseOtpStore,
    opts: ReverseOtpOptions = {},
  ) {
    this.ttlSec = opts.ttlSec ?? 300;
    this.riskThreshold = opts.riskThreshold ?? 70;
    this.voipPrefixes = opts.voipPrefixes ?? DEFAULT_VOIP_PREFIXES;
  }

  async start(phone: string, sessionId: string): Promise<{ token: string; expiresAt: number }> {
    const token = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = Date.now() + this.ttlSec * 1000;
    await this.store.put({ sessionId, phone: normalize(phone), token, expiresAt }, this.ttlSec);
    return { token, expiresAt };
  }

  async verify(proof: InboundProof): Promise<{ verified: true; phone: string }> {
    const session = await this.store.get(proof.sessionId);
    if (!session) throw new ReverseOtpRejected('session', 'No pending verification session');

    if (normalize(proof.cli) !== normalize(session.phone)) {
      throw new ReverseOtpRejected(
        'cli-match',
        'Caller-ID/sender does not match the session phone',
      );
    }
    if (proof.path === 'sms' && (!proof.token || proof.token !== session.token)) {
      throw new ReverseOtpRejected('token', 'Token does not match');
    }
    if (proof.ts > session.expiresAt) {
      throw new ReverseOtpRejected('time-window', 'Verification window expired');
    }
    if (proof.originationClass !== 'mobile') {
      throw new ReverseOtpRejected('origination', `Rejected ${proof.originationClass} origination`);
    }
    if (this.voipPrefixes.some((p) => normalize(proof.cli).startsWith(p))) {
      throw new ReverseOtpRejected('voip-range', 'Number is in a known VoIP/SIP-gateway range');
    }
    if (proof.attestation !== 'genuine') {
      throw new ReverseOtpRejected('attestation', 'Device attestation verdict is not genuine');
    }
    if (proof.riskScore >= this.riskThreshold) {
      throw new ReverseOtpRejected('risk', 'Risk score above threshold');
    }

    await this.store.del(proof.sessionId);
    return { verified: true, phone: session.phone };
  }
}

/** Normalize to E.164-ish: keep a leading '+' and digits only. */
function normalize(phone: string): string {
  const plus = phone.trim().startsWith('+') ? '+' : '';
  return plus + phone.replace(/[^\d]/g, '');
}
