/**
 * Forward-only SQL migration runner. Applies `src/sql/*.sql` in filename order, each in its own
 * transaction, recording applied files in `_migrations`. Expand/contract discipline (§G7): add new
 * SQL files; never edit an applied one.
 *
 *   POSTGRES_URL=... pnpm --filter @velchat/migrations migrate          # apply pending
 *   POSTGRES_URL=... pnpm --filter @velchat/migrations migrate:status   # list state
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const sqlDir = join(__dirname, 'sql');

/**
 * Load the repo-root `.env` so `pnpm db:migrate` works without exporting POSTGRES_URL first
 * (services already load it via @velchat/common). Dependency-free; never overrides a real env var.
 */
function loadRootEnv(): void {
  if (process.env.POSTGRES_URL) return;
  const envPath = join(__dirname, '..', '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main(): Promise<void> {
  loadRootEnv();
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error('POSTGRES_URL is required (set it in env or the repo-root .env)');
    process.exit(1);
  }
  const command = process.argv[2] ?? 'up';
  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const res = await client.query('SELECT name FROM _migrations');
  const applied = new Set<string>(res.rows.map((r) => String(r.name)));

  if (command === 'status') {
    for (const f of files) console.log(`${applied.has(f) ? '[x]' : '[ ]'} ${f}`);
    await client.end();
    return;
  }

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(sqlDir, f), 'utf8');
    console.log(`applying ${f} …`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`migration ${f} failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  console.log('migrations up to date');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
