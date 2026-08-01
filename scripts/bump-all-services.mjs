/**
 * bump-all-services.mjs
 * Reads latest git tags per service, bumps package.json to tag-version + 1 patch,
 * and adds a buildStamp so Render sees a file change.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = [
  'ai-service',
  'api-gateway',
  'auth-service',
  'automation-service',
  'call-service',
  'chat-service',
  'group-channel-service',
  'media-service',
  'notification-service',
  'presence-service',
  'realtime-gateway',
  'search-service',
  'user-service',
];

// Map service dir name → npm scope name used in tags
const scopeName = (dir) => {
  return `@velchat/${dir}`;
};

// Get latest tag version for a package
function latestTagVersion(pkgName) {
  try {
    const tags = execSync(`git tag -l "${pkgName}@*"`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((t) => t.replace(`${pkgName}@`, ''))
      .sort((a, b) => {
        const [a1, a2, a3] = a.split('.').map(Number);
        const [b1, b2, b3] = b.split('.').map(Number);
        return a1 - b1 || a2 - b2 || a3 - b3;
      });
    return tags.length ? tags[tags.length - 1] : null;
  } catch {
    return null;
  }
}

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

console.log('═══════════════════════════════════════════════════');
console.log('  VelChat — Bulk Service Version Bump (patch)');
console.log('═══════════════════════════════════════════════════\n');

const results = [];

for (const svc of SERVICES) {
  const pkgPath = join('apps', svc, 'package.json');
  if (!existsSync(pkgPath)) {
    console.log(`⚠  ${svc}: package.json not found — skipping`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;
  const scope = scopeName(svc);
  const tagVersion = latestTagVersion(scope);
  const baseVersion = tagVersion || oldVersion;
  const newVersion = bumpPatch(baseVersion);

  pkg.version = newVersion;

  // Add a buildStamp so the file definitely changes
  pkg.buildStamp = new Date().toISOString();

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const row = {
    service: svc,
    oldPkg: oldVersion,
    latestTag: tagVersion || '(none)',
    newVersion,
  };
  results.push(row);
  console.log(`✅ ${svc}: ${oldVersion} → ${newVersion}  (tag: ${tagVersion || 'none'})`);
}

console.log('\n───────────────────────────────────────────────────');
console.log(`  Done! ${results.length} services bumped.`);
console.log('───────────────────────────────────────────────────\n');
