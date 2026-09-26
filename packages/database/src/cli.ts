import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, checkDatabaseReady, schema } from './index.js';
import { migrate } from './migrate.js';
import { eq } from 'drizzle-orm';

const command = process.argv[2];
const connectionString = command === 'test' ? process.env['TEST_DATABASE_URL'] : process.env['DATABASE_URL'];
if (!connectionString) throw new Error(`${command === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is required; no fallback database is used.`);
if (command === 'test' && !new URL(connectionString).pathname.endsWith('_test')) throw new Error('Database smoke tests require a database name ending in _test.');
const database = createDatabase(connectionString);
try {
  await migrate(database);
  await migrate(database); // Applying the same reviewed migrations must be idempotent.
  await checkDatabaseReady(database, 1);
  if (command === 'test') {
    const key = `smoke-${randomUUID()}`;
    await assert.rejects(database.db.transaction(async tx => {
      await tx.insert(schema.runtimeMetadata).values({ key, protocolVersion: 1, value: { smoke: true } });
      throw new Error('intentional-rollback');
    }), /intentional-rollback/);
    assert.equal((await database.db.select().from(schema.runtimeMetadata).where(eq(schema.runtimeMetadata.key, key))).length, 0, 'Rolled-back row must not persist');
    await assert.rejects(database.db.insert(schema.runtimeMetadata).values({ key, protocolVersion: 0, value: {} }), error => {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code === '23514';
    });
    await database.db.insert(schema.runtimeMetadata).values({ key, protocolVersion: 1, value: { durable: true } });
    const second = createDatabase(connectionString);
    try {
      assert.deepEqual((await second.db.select().from(schema.runtimeMetadata).where(eq(schema.runtimeMetadata.key, key)))[0]?.value, { durable: true });
    } finally { await second.close(); await database.db.delete(schema.runtimeMetadata).where(eq(schema.runtimeMetadata.key, key)); }
    console.log(JSON.stringify({ event: 'database_smoke_passed', assertions: ['migration-idempotency', 'schema-ready', 'rollback', 'check-constraint', 'cross-connection-persistence'] }));
  }
} finally { await database.close(); }
