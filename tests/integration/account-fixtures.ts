import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createDatabase, type Database } from '@pokewaterblue/database';
import { migrate } from '../../packages/database/src/migrate.js';

export function accountTestDatabaseUrl() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const value = process.env['TEST_DATABASE_URL'];
  if (!value) throw new Error('Account checks require TEST_DATABASE_URL for a separate local PostgreSQL database.');
  const url = new URL(value);
  const mainUrl = process.env['DATABASE_URL'] ? new URL(process.env['DATABASE_URL']) : undefined;
  const sameDatabase = mainUrl && url.pathname === mainUrl.pathname && (url.port || '5432') === (mainUrl.port || '5432');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !url.pathname.endsWith('_test') || sameDatabase) {
    throw new Error('Account checks require a distinct loopback TEST_DATABASE_URL with a database name ending in _test.');
  }
  return value;
}

export async function migrateAccountTestDatabase(value: string) {
  const database = createDatabase(value);
  try { await migrate(database); } finally { await database.close(); }
}

export function accountFixture() {
  return { email: `accounts-qa-${randomUUID()}@example.test`, password: `Qa9-${randomUUID()}!`, name: 'Account QA' };
}

export async function removeAccountFixturesByEmails(database: Database, emails: string[]) {
  if (!emails.length) return;
  const result = await database.pool.query<{ id: string }>('SELECT id FROM auth_user WHERE email = ANY($1::text[])', [emails]);
  await removeAccountFixtures(database, result.rows.map(row => row.id));
}

// Only explicit IDs created by this test run are eligible for cleanup. Character
// FKs intentionally prohibit cascading deletion, including from auth accounts.
export async function removeAccountFixtures(database: Database, accountIds: string[]) {
  if (!accountIds.length) return;
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM account_creation_receipts WHERE account_id = ANY($1::text[])', [accountIds]);
    for (const table of ['audit_events', 'character_trainer_completions', 'character_claims', 'character_map_patches', 'character_variables', 'character_flags', 'character_wallets', 'character_inventory']) {
      await client.query(`DELETE FROM ${table} WHERE character_id IN (SELECT id FROM characters WHERE account_id = ANY($1::text[]))`, [accountIds]);
    }
    await client.query('DELETE FROM creature_moves WHERE creature_id IN (SELECT id FROM creatures WHERE owner_id IN (SELECT id FROM characters WHERE account_id = ANY($1::text[])))', [accountIds]);
    await client.query('DELETE FROM creatures WHERE owner_id IN (SELECT id FROM characters WHERE account_id = ANY($1::text[]))', [accountIds]);
    await client.query('DELETE FROM domain_outcomes WHERE character_id IN (SELECT id FROM characters WHERE account_id = ANY($1::text[]))', [accountIds]);
    for (const table of ['wild_test_command_receipts', 'character_wild_test_state', 'practice_command_receipts', 'character_practice_state', 'character_command_receipts', 'character_leases']) {
      await client.query(`DELETE FROM ${table} WHERE character_id IN (SELECT id FROM characters WHERE account_id = ANY($1::text[]))`, [accountIds]);
    }
    await client.query('DELETE FROM characters WHERE account_id = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM auth_session WHERE user_id = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM auth_account WHERE user_id = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM auth_user WHERE id = ANY($1::text[])', [accountIds]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
