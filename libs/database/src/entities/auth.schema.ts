import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  bigint,
  jsonb,
  customType,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * auth-service schema — exact per §B2.1.
 *
 * Identity = immutable `account_id` (UUIDv7, generated in app). phone/email are re-verifiable
 * ATTRIBUTES in `identifiers`, never the key (CLAUDE.md §3). These tables are GLOBAL identity —
 * not tenant-scoped — so no RLS here; tenant RLS applies to org/channel/message tables (§G6).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// THE identity. Never deleted on number change.
export const accounts = pgTable('accounts', {
  accountId: uuid('account_id').primaryKey(), // UUIDv7, app-generated
  status: text('status').notNull().default('active'), // active|limited|locked|dormant|deleted
  tier: text('tier').notNull().default('limited'), // full(phone-verified) | limited
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
});

// phone & email are ATTRIBUTES, re-verifiable. 1 verified number = 1 account.
export const identifiers = pgTable(
  'identifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.accountId),
    kind: text('kind').notNull(), // phone | email
    valueNorm: text('value_norm').notNull(), // E.164 phone / normalized email
    valueHash: text('value_hash').notNull(), // for contact discovery (phone) / lookup
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => ({
    // UNIQUE(kind, value_norm) WHERE verified_at IS NOT NULL — enforced via partial unique index.
    verifiedUnique: uniqueIndex('identifiers_verified_unique')
      .on(t.kind, t.valueNorm)
      .where(sql`verified_at IS NOT NULL`),
    byAccount: index('identifiers_account_idx').on(t.accountId),
    byHash: index('identifiers_hash_idx').on(t.valueHash),
  }),
);

export const devices = pgTable(
  'devices',
  {
    deviceId: uuid('device_id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.accountId),
    platform: text('platform').notNull(), // ios|android|web|desktop
    devicePubkey: bytea('device_pubkey').notNull(), // DAPT device key (private key in enclave)
    attestation: jsonb('attestation'), // Play Integrity / App Attest verdict at enroll
    displayName: text('display_name'),
    pushToken: text('push_token'),
    signalIdentityKey: bytea('signal_identity_key'), // Signal/E2EE identity
    trusted: boolean('trusted').notNull().default(false), // can approve new devices
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({ byAccount: index('devices_account_idx').on(t.accountId) }),
);

export const passkeys = pgTable('passkeys', {
  credId: bytea('cred_id').primaryKey(), // WebAuthn credential id
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.accountId),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
  aaguid: bytea('aaguid'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.deviceId),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(), // rotation family (reuse detection)
    cnfJkt: text('cnf_jkt'), // DPoP key thumbprint → token bound to device key
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revoked: boolean('revoked').notNull().default(false),
  },
  (t) => ({
    byHash: uniqueIndex('refresh_tokens_hash_unique').on(t.tokenHash),
    byFamily: index('refresh_tokens_family_idx').on(t.familyId),
  }),
);

export const signalPrekeys = pgTable('signal_prekeys', {
  deviceId: uuid('device_id')
    .primaryKey()
    .references(() => devices.deviceId),
  signedPrekey: bytea('signed_prekey').notNull(),
  signedPrekeySig: bytea('signed_prekey_sig').notNull(),
  oneTimePrekeys: jsonb('one_time_prekeys'), // pool; consumed one per recipient-device
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const totpSecrets = pgTable('totp_secrets', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.accountId),
  secretEnc: bytea('secret_enc').notNull(), // encrypted at rest
  enabled: boolean('enabled').notNull().default(false),
});

export const recoveryBackupCodes = pgTable(
  'recovery_backup_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.accountId),
    codeHash: text('code_hash').notNull(),
    used: boolean('used').notNull().default(false),
  },
  (t) => ({ byAccount: index('recovery_codes_account_idx').on(t.accountId) }),
);

// append-only audit
export const authAudit = pgTable(
  'auth_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id'),
    event: text('event').notNull(),
    ip: text('ip'),
    deviceId: uuid('device_id'),
    riskScore: text('risk_score'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byAccount: index('auth_audit_account_idx').on(t.accountId, t.ts) }),
);
