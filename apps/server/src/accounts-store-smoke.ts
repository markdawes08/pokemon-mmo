import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '@pokewaterblue/database';
import type { SaveProfileCommand } from '@pokewaterblue/protocol';
import { CharacterService, CharacterServiceError, type CharacterConnection, type CharacterServiceTestHooks } from './character-service.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const testUrl = process.env['TEST_DATABASE_URL'];
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Character integration requires explicit TEST_DATABASE_URL ending in _test.');
process.env['NODE_ENV'] = 'test';
const database = createDatabase(testUrl);
const observer = createDatabase(testUrl);
const users: string[] = [];
const services: CharacterService[] = [];
const checks: string[] = [];
const service = (testHooks?: CharacterServiceTestHooks) => {
  const item = new CharacterService(database, { testHooks }); services.push(item); return item;
};
const user = async () => {
  const id = `store-smoke-${randomUUID()}`; users.push(id);
  await database.pool.query('INSERT INTO auth_user (id,name,email,email_verified) VALUES ($1,$2,$3,true)', [id, 'Storage test', `${id}@example.invalid`]);
  return id;
};
const command = (connection: CharacterConnection, revision: number): SaveProfileCommand => ({ commandId: randomUUID(), type: 'save-profile', version: 1, activityId: connection.activityId, expectedRevision: revision, payload: {} });
const rejected = async (work: Promise<unknown>, code: string) => assert.rejects(work, error => error instanceof CharacterServiceError && error.code === code);
const persisted = async (id: string) => (await observer.pool.query<{ revision: string; saved_at: Date | null; map_id: string | null; position_x: number | null; position_y: number | null }>('SELECT revision,saved_at,map_id,position_x,position_y FROM characters WHERE id=$1', [id])).rows[0];

try {
  const first = service();
  const other = service();
  const accountId = await user();
  const creation = { commandId: randomUUID(), name: 'red' };
  const twins = await Promise.all([first.create(accountId, creation), other.create(accountId, creation)]);
  assert.deepEqual(twins[0], twins[1]);
  const character = twins[0];
  assert.equal(character.name, 'RED'); assert.equal(character.stage, 'awaiting-new-game'); assert.equal(character.activity, 'recovering');
  assert.deepEqual(await persisted(character.id), { revision: '0', saved_at: null, map_id: null, position_x: null, position_y: null });
  await rejected(first.create(accountId, { ...creation, name: 'BLUE' }), 'COMMAND_CONFLICT');
  await database.pool.query('DELETE FROM account_creation_receipts WHERE account_id=$1', [accountId]);
  await rejected(first.create(accountId, { commandId: randomUUID(), name: 'BLUE' }), 'CHARACTER_EXISTS');
  checks.push('concurrent-create-receipt', 'creation-payload-conflict', 'permanent-one-character-after-receipt-cleanup', 'staged-profile-no-invented-location');

  const accountB = await user();
  const characterB = await other.create(accountB, { commandId: randomUUID(), name: 'RED' });
  assert.notEqual(character.id, characterB.id); // Names intentionally are not globally unique.
  await rejected(other.acquire(accountB, character.id), 'NOT_FOUND');
  assert.deepEqual(await first.get(accountId), character);
  assert.deepEqual(await other.get(accountB), characterB);
  assert.equal(await first.get(await user()), null);
  for (const sql of ["UPDATE characters SET name='bad name' WHERE id=$1", 'UPDATE characters SET position_x=1 WHERE id=$1', 'UPDATE characters SET revision=9007199254740992 WHERE id=$1', "UPDATE characters SET map_id='PalletTown',position_x=1,position_y=1 WHERE id=$1"]) {
    await assert.rejects(database.pool.query(sql, [character.id]), (error: { code?: string }) => error.code === '23514');
  }
  await assert.rejects(database.pool.query('DELETE FROM auth_user WHERE id=$1', [accountId]), (error: { code?: string }) => error.code === '23503');
  checks.push('two-account-isolation', 'same-trainer-name-allowed', 'database-name-position-safe-counter-constraints', 'account-deletion-restrict');

  const revokedCreationUser = await user();
  const revokedCreationSession = randomUUID();
  await database.pool.query("INSERT INTO auth_session (id,user_id,token,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour')", [revokedCreationSession, revokedCreationUser, randomUUID()]);
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [revokedCreationSession]);
  await rejected(first.create(revokedCreationUser, { commandId: randomUUID(), name: 'LEAF' }, revokedCreationSession), 'AUTH_REQUIRED');
  assert.equal((await database.pool.query('SELECT 1 FROM characters WHERE account_id=$1', [revokedCreationUser])).rowCount, 0);
  assert.equal((await database.pool.query('SELECT 1 FROM account_creation_receipts WHERE account_id=$1', [revokedCreationUser])).rowCount, 0);
  checks.push('revoked-session-creation-writes-no-profile-or-receipt');

  const joined = await first.acquire(accountId, character.id);
  const save = command(joined.connection, 0);
  const results = await Promise.all([first.save(joined.connection, save), first.save(joined.connection, save)]);
  assert.equal(results[0].character.revision, 1); assert.equal(results[0].replayed, false);
  assert.equal(results[1].replayed, true); assert.deepEqual(results[0].character, results[1].character);
  const secondSave = await first.save(joined.connection, command(joined.connection, 1));
  assert.equal(secondSave.character.revision, 2);
  const replay = await first.save(joined.connection, save);
  assert.equal(replay.character.revision, 1); assert.equal(first.snapshot(joined.connection)?.character.revision, 2);
  await rejected(first.save(joined.connection, { ...save, expectedRevision: 1 }), 'COMMAND_CONFLICT');
  await rejected(first.save(joined.connection, command(joined.connection, 0)), 'STALE_REVISION');
  await rejected(first.save(joined.connection, { ...command(joined.connection, 2), activityId: randomUUID() }), 'RECONNECT_REQUIRED');
  await rejected(first.save(joined.connection, { ...command(joined.connection, 2), payload: { position: { x: 5, y: 5 } } } as unknown as SaveProfileCommand), 'INVALID_MESSAGE');
  checks.push('duplicate-save-race-once', 'original-receipt-after-newer-revision', 'replay-does-not-rewind-runtime', 'save-payload-conflict', 'stale-revision-activity-rejection', 'position-injection-rejection');

  const competing = await Promise.allSettled([first.save(joined.connection, command(joined.connection, 2)), first.save(joined.connection, command(joined.connection, 2))]);
  assert.equal(competing.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await persisted(character.id)).revision, '3');
  checks.push('serialized-distinct-command-revision-race');
  const replacement = await first.acquire(accountId, character.id);
  assert.equal(replacement.connection.connectionGeneration, joined.connection.connectionGeneration + 1);
  assert.equal(replacement.connection.leaseGeneration, joined.connection.leaseGeneration);
  for (const action of [first.save(joined.connection, command(joined.connection, 3)), first.heartbeat(joined.connection), first.release(joined.connection)]) await rejected(action, 'SESSION_REPLACED');
  await first.heartbeat(replacement.connection);
  assert.equal(first.snapshot(replacement.connection)?.character.revision, 3);
  await rejected(other.acquire(accountId, character.id), 'BUSY');
  checks.push('new-tab-connection-generation', 'stale-save-heartbeat-release-fencing', 'live-foreign-owner-rejection');

  await database.pool.query("UPDATE character_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE character_id=$1", [character.id]);
  await rejected(first.save(replacement.connection, command(replacement.connection, 3)), 'LEASE_EXPIRED');
  assert.equal(first.snapshot(replacement.connection), null);
  const takeover = await other.acquire(accountId, character.id);
  assert.equal(takeover.connection.leaseGeneration, replacement.connection.leaseGeneration + 1);
  await rejected(first.heartbeat(replacement.connection), 'SESSION_REPLACED');
  await other.save(takeover.connection, command(takeover.connection, 3));
  await other.release(takeover.connection);
  const restarted = service();
  const recovered = await restarted.acquire(accountId, character.id);
  assert.equal(recovered.snapshot.character.revision, 4);
  assert.deepEqual(recovered.snapshot.character, await restarted.get(accountId));
  assert.equal(recovered.connection.leaseGeneration, takeover.connection.leaseGeneration + 1);
  checks.push('expired-lease-stops-mutation', 'expired-foreign-owner-takeover', 'stale-owner-cannot-renew', 'release-and-new-service-recovery');

  let rollback = true;
  const rolling = service({ beforeCommit: kind => { if (kind === 'save' && rollback) { rollback = false; throw new Error('injected-before-commit'); } } });
  const rollbackUser = await user();
  const rollbackCharacter = await rolling.create(rollbackUser, { commandId: randomUUID(), name: 'LEAF' });
  const rollbackJoined = await rolling.acquire(rollbackUser, rollbackCharacter.id);
  const rollbackCommand = command(rollbackJoined.connection, 0);
  await rejected(rolling.save(rollbackJoined.connection, rollbackCommand), 'DATABASE_UNAVAILABLE');
  assert.equal((await persisted(rollbackCharacter.id)).revision, '0');
  assert.equal((await database.pool.query('SELECT 1 FROM character_command_receipts WHERE character_id=$1', [rollbackCharacter.id])).rowCount, 0);
  assert.equal(rolling.snapshot(rollbackJoined.connection), null);
  await rolling.heartbeat(rollbackJoined.connection);
  assert.equal(rolling.snapshot(rollbackJoined.connection)?.character.revision, 0);
  assert.equal((await rolling.save(rollbackJoined.connection, rollbackCommand)).character.revision, 1);
  checks.push('before-commit-rollback-no-receipt-or-publication', 'frozen-runtime-reloads-after-storage-recovery', 'rollback-same-command-retry');

  for (const commitHappened of [true, false]) {
    let injected = false;
    const uncertain = service({ commit: async (client, kind) => {
      if (kind !== 'save' || injected) { await client.query('COMMIT'); return; }
      injected = true;
      await client.query(commitHappened ? 'COMMIT' : 'ROLLBACK');
      throw new Error('injected-lost-commit-acknowledgement');
    } });
    const id = await user();
    const profile = await uncertain.create(id, { commandId: randomUUID(), name: 'MISTY' });
    const connection = (await uncertain.acquire(id, profile.id)).connection;
    const result = await uncertain.save(connection, command(connection, 0));
    assert.equal(result.character.revision, 1);
    assert.equal(result.replayed, commitHappened);
    assert.equal((await persisted(profile.id)).revision, '1');
    assert.equal((await database.pool.query('SELECT 1 FROM character_command_receipts WHERE character_id=$1', [profile.id])).rowCount, 1);
    assert.equal(uncertain.snapshot(connection)?.character.revision, 1);
    checks.push(commitHappened ? 'unknown-commit-success-receipt-reconciliation' : 'unknown-commit-absent-receipt-safe-retry');
  }

  let publicationFailed = false;
  const publication = service({ beforePublish: () => { if (!publicationFailed) { publicationFailed = true; throw new Error('injected-publication-failure'); } } });
  const publicationUser = await user();
  const publicationProfile = await publication.create(publicationUser, { commandId: randomUUID(), name: 'OAK' });
  const publicationConnection = (await publication.acquire(publicationUser, publicationProfile.id)).connection;
  const published = await publication.save(publicationConnection, command(publicationConnection, 0));
  assert.equal(publicationFailed, true); assert.equal(published.character.revision, 1);
  assert.deepEqual(publication.snapshot(publicationConnection)?.character, published.character);
  checks.push('commit-before-publication-failure-freeze-reload');

  const held: { resolve?: () => void } = {};
  let reached: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const hold = new Promise<void>(resolve => { held.resolve = resolve; });
  let holdOnce = true;
  const bounded = service({ beforeCommit: async kind => { if (kind === 'save' && holdOnce) { holdOnce = false; reached?.(); await hold; } } });
  const boundedUser = await user();
  const boundedCharacter = await bounded.create(boundedUser, { commandId: randomUUID(), name: 'BLUE' });
  const boundedConnection = (await bounded.acquire(boundedUser, boundedCharacter.id)).connection;
  const boundedCommand = command(boundedConnection, 0);
  const pending = bounded.save(boundedConnection, boundedCommand);
  await ready;
  const queued = Array.from({ length: 34 }, () => bounded.save(boundedConnection, boundedCommand));
  const outcomes = Promise.allSettled([pending, ...queued]);
  held.resolve?.();
  const finished = await outcomes;
  assert.equal(finished.filter(result => result.status === 'rejected' && result.reason instanceof CharacterServiceError && result.reason.code === 'RATE_LIMITED').length, 3);
  assert.equal((await persisted(boundedCharacter.id)).revision, '1');
  checks.push('bounded-per-character-backpressure');

  // Revocation must wait for a save that already holds the session row; a queued later save must fail.
  let releaseAuthorized: (() => void) | undefined;
  let authorizedStarted: (() => void) | undefined;
  const authorizedReady = new Promise<void>(resolve => { authorizedStarted = resolve; });
  const authorizedHold = new Promise<void>(resolve => { releaseAuthorized = resolve; });
  let authorizeOnce = true;
  const authorized = service({ beforeCommit: async kind => {
    if (kind === 'save' && authorizeOnce) { authorizeOnce = false; authorizedStarted?.(); await authorizedHold; }
  } });
  const sessionUser = await user();
  const sessionProfile = await authorized.create(sessionUser, { commandId: randomUUID(), name: 'BROCK' });
  const sessionId = randomUUID();
  await database.pool.query("INSERT INTO auth_session (id,user_id,token,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour')", [sessionId, sessionUser, randomUUID()]);
  const sessionConnection = (await authorized.acquire(sessionUser, sessionProfile.id, sessionId)).connection;
  const authorizedSave = authorized.save(sessionConnection, command(sessionConnection, 0));
  await authorizedReady;
  const queuedAfterLogout = authorized.save(sessionConnection, command(sessionConnection, 1));
  const sessionResults = Promise.allSettled([authorizedSave, queuedAfterLogout]);
  const revoker = await observer.pool.connect();
  try {
    const pid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const deletion = revoker.query('DELETE FROM auth_session WHERE id=$1', [sessionId]);
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (await observer.pool.query<{ waiting: boolean }>("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.waiting ?? false;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, 'Session deletion must wait for the already authorized transaction.');
    releaseAuthorized?.();
    await deletion;
    const finishedSessions = await sessionResults;
    assert.equal(finishedSessions[0].status, 'fulfilled');
    assert.equal(finishedSessions[1].status, 'rejected');
    if (finishedSessions[1].status === 'rejected') assert.equal((finishedSessions[1].reason as CharacterServiceError).code, 'AUTH_REQUIRED');
    assert.equal((await persisted(sessionProfile.id)).revision, '1');
    await rejected(authorized.heartbeat(sessionConnection), 'AUTH_REQUIRED');
    assert.equal(authorized.snapshot(sessionConnection), null);
  } finally { releaseAuthorized?.(); revoker.release(); }
  checks.push('session-revocation-locks-before-character-write', 'queued-save-after-session-revocation-rejected');

  // Closing this pool is a real driver outage; observer still reads the durable committed state.
  const beforeOutage = await persisted(publicationProfile.id);
  await database.close();
  await rejected(publication.save(publicationConnection, command(publicationConnection, 1)), 'DATABASE_UNAVAILABLE');
  assert.deepEqual(await persisted(publicationProfile.id), beforeOutage);
  assert.equal(publication.snapshot(publicationConnection), null);
  await rejected(publication.get(publicationUser), 'DATABASE_UNAVAILABLE');
  checks.push('database-outage-no-partial-publish-or-acknowledgement', 'database-outage-no-in-memory-read-fallback');

  await mkdir('reports', { recursive: true });
  await writeFile('reports/accounts-store-verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), status: 'passed', database: 'explicit TEST_DATABASE_URL ending _test; only owned UUID fixtures removed', scope: 'staged trainer profiles, generation ownership, profile checkpoints; no world/economy save', failureInjection: 'Actual PostgreSQL COMMIT/ROLLBACK followed by an injected lost acknowledgement; hook before commit/publication; actual driver pool closure. No database reset, network partition, or machine crash.', checks }, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'accounts_store_smoke_passed', assertions: checks }));
} finally {
  await Promise.allSettled(services.map(item => item.dispose()));
  // No database reset or broad table cleanup. Owned fixtures are deleted in restrictive FK order.
  for (const id of users) {
    await observer.pool.query('DELETE FROM character_command_receipts WHERE character_id IN (SELECT id FROM characters WHERE account_id=$1)', [id]);
    await observer.pool.query('DELETE FROM character_leases WHERE character_id IN (SELECT id FROM characters WHERE account_id=$1)', [id]);
    await observer.pool.query('DELETE FROM account_creation_receipts WHERE account_id=$1', [id]);
    await observer.pool.query('DELETE FROM characters WHERE account_id=$1', [id]);
    await observer.pool.query('DELETE FROM auth_user WHERE id=$1', [id]);
  }
  await Promise.allSettled([database.close(), observer.close()]);
}
