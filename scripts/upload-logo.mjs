// Upload a local image (your VelChat logo) to Cloudinary and print its public URL, so you can set
// MAIL_LOGO_URL in .env and the logo shows at the top of every email. Uses the SAME CLOUDINARY_URL
// the app uses (via @velchat/storage). Emails need a HOSTED url — data-URIs get blocked by Gmail.
//
//   node scripts/upload-logo.mjs ./assets/velchat-logo.png
//   → prints a https://res.cloudinary.com/... URL → put it in .env as MAIL_LOGO_URL
import { readFileSync } from 'node:fs';
import { boot, ui, done } from './_shared.mjs';
import { CloudinaryStorage } from '@velchat/storage';

const { config } = boot('upload-logo');
const path = process.argv[2];

ui.title('Upload email logo → Cloudinary');
if (!path) {
  ui.fail('Usage: node scripts/upload-logo.mjs <path-to-image>  (png/jpg/svg)');
  done(true);
}
if (!config.CLOUDINARY_URL) {
  ui.fail('CLOUDINARY_URL not set in .env — needed to host the logo.');
  done(true);
}

const ext = (path.split('.').pop() || 'png').toLowerCase();
const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

let failed = false;
try {
  const body = readFileSync(path);
  ui.info(`uploading ${path} (${(body.length / 1024).toFixed(1)} KB, ${mime}) …`);
  const store = new CloudinaryStorage(config.CLOUDINARY_URL);
  const { url } = await store.putObject({ key: 'velchat/email-logo', body, contentType: mime });
  ui.ok('Uploaded. Set this in .env:');
  ui.line();
  ui.line(`   MAIL_LOGO_URL=${url}`);
  ui.line();
  ui.info('Then re-run test:mail — the logo appears at the top of every email.');
} catch (err) {
  failed = true;
  ui.fail(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
}
done(failed);
