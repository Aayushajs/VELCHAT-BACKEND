// Verify the calls wiring (LiveKit, §A17.1): mint a join token exactly like call-service's
// livekit-token.ts (HS256 JWT with a `video` grant, signed by the API secret — no SDK needed),
// then verify + decode it with the same secret. A round-trip proves LIVEKIT_API_KEY/SECRET are
// consistent and clients can be issued working join tokens for LIVEKIT_URL.
//
//   node scripts/test-livekit.mjs
import jwt from 'jsonwebtoken';
import { boot, ui, done } from './_shared.mjs';

const { config } = boot('test-livekit');
ui.title('Calls (LiveKit)');

if (!(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET)) {
  ui.warn('LiveKit not set — call-service returns 503 CALLS_NOT_CONFIGURED until keys are present.');
  ui.info('Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env (self-hosted LiveKit).');
  done(false);
}

let failed = false;
try {
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.LIVEKIT_TOKEN_TTL_SECONDS ?? 3600;
  const token = jwt.sign(
    {
      iss: config.LIVEKIT_API_KEY,
      sub: 'script-check-identity',
      nbf: now,
      exp: now + ttl,
      name: 'Integration Check',
      video: { room: 'integration-check-room', roomJoin: true, canPublish: true, canSubscribe: true },
    },
    config.LIVEKIT_API_SECRET,
    { algorithm: 'HS256' },
  );
  ui.ok(`Minted a join token (…${token.slice(-8)}) for ${config.LIVEKIT_URL}.`);

  const decoded = jwt.verify(token, config.LIVEKIT_API_SECRET);
  if (decoded && typeof decoded === 'object' && decoded.video?.room === 'integration-check-room') {
    ui.ok(`Verified with the API secret — grant OK (room=${decoded.video.room}, ttl=${ttl}s).`);
  } else {
    failed = true;
    ui.fail('Token verified but the video grant was not what we minted.');
  }
} catch (err) {
  failed = true;
  ui.fail(`LiveKit token round-trip failed: ${err instanceof Error ? err.message : String(err)}`);
  ui.info('LIVEKIT_API_KEY/SECRET must match your LiveKit server config.');
}
done(failed);
