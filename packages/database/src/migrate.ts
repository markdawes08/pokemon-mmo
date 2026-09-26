import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from './index.js';

export async function migrate(database: Database, directory = resolve('packages/database/migrations')) {
  const client = await database.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(731942601)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(resolve(directory, name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query<{ sha256: string }>('SELECT sha256 FROM schema_migrations WHERE name=$1', [name]);
      if (previous.rows[0]) {
        if (previous.rows[0].sha256 !== hash) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)', [name, hash]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ event: 'migration_applied', name, sha256: hash }));
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(731942601)'); }
    finally { client.release(); }
  }
}
