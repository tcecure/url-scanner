/**
 * Apply any SQL migration not yet recorded in `schema_migrations`.
 *
 * Migrations are plain, forward-only SQL files applied in filename order, each
 * inside a transaction, so a failed deploy leaves the schema where it was.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const DIR = join(process.cwd(), '..', 'db', 'migrations');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const applied = new Set(
      (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
        (row) => row.filename,
      ),
    );
    const files = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      process.stdout.write(`applying ${file}\n`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    process.stdout.write(count ? `${count} migration(s) applied\n` : 'schema already up to date\n');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
