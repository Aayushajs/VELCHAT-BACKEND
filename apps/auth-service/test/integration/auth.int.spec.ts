import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgresClient } from '@velchat/database';
import { AuthRepository } from '../../src/auth/auth.repository';
import { TokenService } from '../../src/auth/token.service';
import { loadOrGenerateKeyPair } from '../../src/auth/keys';

/**
 * P1.7 — auth integration against a REAL Postgres (testcontainers). Exercises the DB layer that
 * unit tests fake: the refresh_tokens table (rotation + reuse-detection), the one-verified-phone
 * uniqueness (Sybil, §B2.8), and the atomic number-change re-point (§B2.6).
 */
const logger = pino({ level: 'silent' });
let container: StartedTestContainer;
let pg: PostgresClient;
let repo: AuthRepository;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'velchat',
      POSTGRES_PASSWORD: 'velchat',
      POSTGRES_DB: 'velchat',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const url = `postgres://velchat:velchat@${container.getHost()}:${container.getMappedPort(5432)}/velchat`;
  pg = new PostgresClient(url, 5, logger);
  await pg.connect();
  const sql = readFileSync(join(__dirname, '../../../../migrations/src/sql/0001_auth.sql'), 'utf8');
  await pg.pool.query(sql);
  repo = new AuthRepository(pg);
}, 180000);

afterAll(async () => {
  await pg?.close();
  await container?.stop();
});

function tokenService() {
  return new TokenService(repo, {
    keyPair: loadOrGenerateKeyPair({}),
    issuer: 'https://auth.velchat.test',
    accessTtlSec: 900,
  });
}

describe('auth integration (real Postgres)', () => {
  it('rotates refresh tokens and detects reuse on the real refresh_tokens table', async () => {
    const accountId = await repo.createAccount('full');
    const deviceId = await repo.addDevice({
      accountId,
      platform: 'web',
      devicePubkey: Buffer.from('device-key'),
    });
    const tokens = tokenService();

    const first = await tokens.issueRefresh(deviceId);
    const second = await tokens.rotateRefresh(first.token);
    expect(second.token).not.toBe(first.token);

    await expect(tokens.rotateRefresh(first.token)).rejects.toThrow(/reuse/i);
    await expect(tokens.rotateRefresh(second.token)).rejects.toThrow(); // family revoked
  });

  it('enforces one verified phone = one account (Sybil unique index)', async () => {
    const a = await repo.createAccount('full');
    await repo.upsertVerifiedIdentifier(a, 'phone', '+919990001111');
    const b = await repo.createAccount('full');
    await expect(repo.upsertVerifiedIdentifier(b, 'phone', '+919990001111')).rejects.toThrow();
  });

  it('re-points a phone to a new number on the SAME account (number change, §B2.6)', async () => {
    const accountId = await repo.createAccount('full');
    await repo.upsertVerifiedIdentifier(accountId, 'phone', '+919990002222');
    await repo.repointPhone(accountId, '+919990003333');

    expect(await repo.findVerifiedPhoneAccount('+919990003333')).toBe(accountId);
    expect(await repo.findVerifiedPhoneAccount('+919990002222')).toBeNull();
  });

  it('consumes a backup code only once', async () => {
    const accountId = await repo.createAccount('full');
    await repo.storeBackupCodes(accountId, ['hash-aaa', 'hash-bbb']);
    expect(await repo.consumeBackupCode(accountId, 'hash-aaa')).toBe(true);
    expect(await repo.consumeBackupCode(accountId, 'hash-aaa')).toBe(false); // already used
    expect(await repo.consumeBackupCode(accountId, 'hash-zzz')).toBe(false); // unknown
  });
});
