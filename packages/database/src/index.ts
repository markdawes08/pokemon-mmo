import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export { schema };
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 2500, idleTimeoutMillis: 10000, query_timeout: 3000, application_name: 'pokewaterblue' });
  // Idle connection failures must not crash the process. Requests still surface failures and readiness fails.
  pool.on('error', error => console.error(JSON.stringify({ level: 'error', event: 'database_pool_error', code: 'DATABASE_UNAVAILABLE', type: error.name })));
  const db = drizzle(pool, { schema });
  let closePromise: Promise<void> | undefined;
  return { pool, db, close: () => (closePromise ??= pool.end()) };
}
export type Database = ReturnType<typeof createDatabase>;
export async function checkDatabaseReady(database: Database, protocolVersion: number): Promise<void> {
  const result = await database.pool.query<{ protocol_version: number }>("SELECT protocol_version FROM runtime_metadata WHERE key = 'foundation'");
  if (result.rows[0]?.protocol_version !== protocolVersion) throw new Error('Database schema/protocol baseline mismatch; run reviewed migrations.');
}
