// Verify the push wiring (@velchat/push): builds the SAME platform-routing sender notification-service
// builds (createPushRouter), and — the real test — if FCM creds are set, actually MINTS a Google OAuth
// access token from the service account. A minted token proves FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY are
// valid and the project can send. VAPID presence is reported (a real web push needs a live subscription).
// §B10: payloads carry NO content for E2EE — only ids + a type.
//
//   node scripts/test-push.mjs
import { boot, ui, done } from './_shared.mjs';
import { createPushRouter, createGoogleAccessToken } from '@velchat/push';

const { config, logger } = boot('test-push');
let failed = false;

ui.title('Push (@velchat/push)');

// 1) Router builds from config (web→VAPID, mobile→FCM, else→log).
const router = createPushRouter(config, logger);
ui.ok(`Router built: ${router.constructor.name}`);

// 2) Web Push (VAPID) — report only (sending needs a browser subscription).
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
  ui.ok(`VAPID configured (subject ${config.VAPID_SUBJECT}). Web push will send to real subscriptions.`);
} else {
  ui.warn('VAPID not set — web push is logged, not sent. Set VAPID_PUBLIC_KEY/PRIVATE_KEY in .env.');
}

// 3) FCM — the meaningful check: mint a real Google OAuth token from the service account.
if (config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY) {
  ui.info(`FCM project ${config.FCM_PROJECT_ID} — minting a Google OAuth token to prove the key…`);
  try {
    const getToken = createGoogleAccessToken({
      clientEmail: config.FCM_CLIENT_EMAIL,
      privateKey: config.FCM_PRIVATE_KEY,
    });
    const token = await getToken();
    if (typeof token === 'string' && token.length > 20) {
      ui.ok(`FCM service account valid — got access token (…${token.slice(-8)}). Mobile push is live.`);
    } else {
      failed = true;
      ui.fail('FCM token endpoint returned an unexpected value.');
    }
  } catch (err) {
    failed = true;
    ui.fail(`FCM token mint failed: ${err instanceof Error ? err.message : String(err)}`);
    ui.info('Check FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY (escaped \\n) and that the key is not revoked.');
  }
} else {
  ui.warn('FCM not set — mobile push is logged, not sent. Set FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY.');
}

// 4) Exercise the router end to end with a no-content payload (uses the log fallback if unconfigured).
try {
  await router.send({ platform: 'desktop', token: 'demo' }, { type: 'message', conversationId: 'demo-conv' });
  ui.ok('Router.send() no-content payload path works (§B10).');
} catch (err) {
  failed = true;
  ui.fail(`Router.send failed: ${err instanceof Error ? err.message : String(err)}`);
}
done(failed);
