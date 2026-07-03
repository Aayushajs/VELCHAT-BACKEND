// Readiness report: which env-driven integrations are configured (from .env), and which fall back
// to a safe dev stub. This never sends/connects — it only reads config. Run it first.
//
//   pnpm --filter @velchat/scripts check      (or: node scripts/check-integrations.mjs)
import { boot, ui } from './_shared.mjs';

const { config } = boot('check-integrations');

/** Each row: name, whether it's configured, and a one-line detail. Order = data tier → features. */
const rows = [
  ['PostgreSQL', !!config.POSTGRES_URL, config.POSTGRES_URL ? 'POSTGRES_URL set' : 'POSTGRES_URL missing'],
  ['MongoDB', !!config.MONGO_URL, config.MONGO_URL ? 'MONGO_URL set' : 'MONGO_URL missing'],
  ['Valkey/Redis', !!config.VALKEY_URL, config.VALKEY_URL ? 'VALKEY_URL set' : 'VALKEY_URL missing'],
  ['OpenSearch', !!config.OPENSEARCH_NODE, config.OPENSEARCH_NODE ? 'OPENSEARCH_NODE set' : 'search disabled'],
  [
    'Object storage',
    !!(config.S3_ENDPOINT || config.CLOUDINARY_URL),
    config.CLOUDINARY_URL ? 'Cloudinary' : config.S3_ENDPOINT ? 'S3/MinIO' : 'none (media disabled)',
  ],
  [
    'Event bus',
    config.EVENT_BUS === 'kafka' ? !!config.KAFKA_BROKERS : !!config.VALKEY_URL,
    config.EVENT_BUS === 'kafka' ? 'kafka' : 'redis-streams (Valkey)',
  ],
  ['Mail (SMTP)', !!config.SMTP_URL, config.SMTP_URL ? `from ${config.MAIL_FROM}` : 'LogMailer (logs, not sent)'],
  [
    'Web Push (VAPID)',
    !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
    config.VAPID_PUBLIC_KEY ? `subject ${config.VAPID_SUBJECT}` : 'not set (web push logged)',
  ],
  [
    'Mobile Push (FCM)',
    !!(config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY),
    config.FCM_PROJECT_ID ? `project ${config.FCM_PROJECT_ID}` : 'not set (mobile push logged)',
  ],
  [
    'Calls (LiveKit)',
    !!(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET),
    config.LIVEKIT_URL ? config.LIVEKIT_URL : 'not set (calls return 503)',
  ],
  [
    'Reverse-OTP DID',
    !!config.REVOTP_WEBHOOK_SECRET,
    config.REVOTP_DID ? `DID ${config.REVOTP_DID}` : 'webhook secret only / dev',
  ],
];

ui.title(`Integration readiness (env: ${config.NODE_ENV})`);
let configured = 0;
for (const [name, ok, detail] of rows) {
  const label = name.padEnd(18);
  if (ok) {
    configured++;
    ui.ok(`${label} ${detail}`);
  } else {
    ui.warn(`${label} ${detail}`);
  }
}
ui.line();
ui.info(`${configured}/${rows.length} integrations configured. '!' = safe dev fallback, not a failure.`);
ui.info('Set the missing keys in .env (see .env.example) to switch on real transports.');
process.exit(0);
