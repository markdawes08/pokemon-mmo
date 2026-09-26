import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { createDatabase } from '@pokewaterblue/database';
import { trainerAssetsSchema, type TrainerAssets } from '@pokewaterblue/protocol';
import { AssetService, type AssetServiceTestHooks, type SeedDevelopmentCommand } from '../../apps/server/src/asset-service.js';
import { CharacterService, CharacterServiceError } from '../../apps/server/src/character-service.js';
import { accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixtures } from './account-fixtures.js';

const databaseUrl = accountTestDatabaseUrl();
process.env['NODE_ENV'] = 'test';
await migrateAccountTestDatabase(databaseUrl);
const database = createDatabase(databaseUrl);
const observer = createDatabase(databaseUrl);
const characters = new CharacterService(database);
const assets = new AssetService(database);
const users: string[] = [];
const checks: string[] = [];

async function trainer(name = 'LEAF') {
  const accountId = `assets-qa-${randomUUID()}`; users.push(accountId);
  await database.pool.query('INSERT INTO auth_user (id,name,email,email_verified) VALUES ($1,$2,$3,true)', [accountId, 'Assets QA', `${accountId}@example.test`]);
  const character = await characters.create(accountId, { commandId: randomUUID(), name });
  return { accountId, character };
}
const seed = (characterId: string): SeedDevelopmentCommand => ({ characterId, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
const rejected = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => error instanceof CharacterServiceError && error.code === code);
async function count(characterId: string) {
  const result = await observer.pool.query<{ creatures: string; moves: string; inventory: string; outcomes: string; audits: string; receipts: string; revision: string }>(`SELECT
    (SELECT count(*) FROM creatures WHERE owner_id=$1) AS creatures,
    (SELECT count(*) FROM creature_moves WHERE creature_id IN (SELECT id FROM creatures WHERE owner_id=$1)) AS moves,
    (SELECT count(*) FROM character_inventory WHERE character_id=$1) AS inventory,
    (SELECT count(*) FROM domain_outcomes WHERE character_id=$1) AS outcomes,
    (SELECT count(*) FROM audit_events WHERE character_id=$1) AS audits,
    (SELECT count(*) FROM character_command_receipts WHERE character_id=$1) AS receipts,
    (SELECT revision FROM characters WHERE id=$1) AS revision`, [characterId]);
  return result.rows[0];
}
async function expectSqlFailure(sql: string, values: unknown[], sqlState: string) {
  await assert.rejects(database.pool.query(sql, values), (error: { code?: string }) => error.code === sqlState);
}
async function rolledBack(work: (client: PoolClient) => Promise<void>) {
  const client = await database.pool.connect();
  try { await client.query('BEGIN'); await work(client); }
  finally { await client.query('ROLLBACK'); client.release(); }
}
async function child(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const processToRun = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
  });
  let output = '';
  processToRun.stdout.setEncoding('utf8'); processToRun.stderr.setEncoding('utf8');
  processToRun.stdout.on('data', data => { output += data; }); processToRun.stderr.on('data', data => { output += data; });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => { processToRun.kill(); reject(new Error('Owned asset test child exceeded its 15-second deadline')); }, 15_000);
    processToRun.once('error', error => { clearTimeout(timeout); reject(error); });
    processToRun.once('exit', value => { clearTimeout(timeout); resolve(value); });
  });
  return { code, output, pid: processToRun.pid };
}
function assertFixture(value: TrainerAssets) {
  const parsed = trainerAssetsSchema.parse(value);
  assert.equal(parsed.profileId, 'r1-squirtle-v1'); assert.equal(parsed.party.length, 1);
  assert.equal(parsed.money, 3000); assert.equal(parsed.storage.capacity, 420); assert.equal(parsed.storage.used, 0);
  const squirtle = parsed.party[0];
  assert.equal(squirtle.speciesId, 7); assert.equal(squirtle.level, 5); assert.equal(squirtle.hp, 20); assert.equal(squirtle.maxHp, 20);
  assert.equal(squirtle.status, 'healthy'); assert.equal(squirtle.slot, 0);
  assert.deepEqual(squirtle.moves.map(move => [move.slot, move.moveId, move.pp, move.maxPp]), [[0, 33, 35, 35], [1, 39, 30, 30]]);
  assert.deepEqual(parsed.inventory.map(item => [item.itemId, item.quantity]).sort((a, b) => a[0] - b[0]), [[4, 5], [13, 5]]);
  assert.deepEqual(parsed.developmentFlags, ['development:r1-squirtle-v1:initialized']);
  assert.equal(parsed.location?.mapId, 'MAP_PALLET_TOWN');
  assert(!/personality|\bivs?\b|\bevs?\b|otId|otName|provenance|contentHash|sourceFingerprint|receipt|payloadHash|businessKey|accountId|sessionId|password|token|rng/i.test(JSON.stringify(parsed)));
}

try {
  const alice = await trainer(), bob = await trainer('RED');
  const empty = await assets.readOwnAssets(alice.accountId, alice.character.id);
  assert.deepEqual(empty, { version: 1, characterId: alice.character.id, revision: 0, profileId: null, party: [], storage: { used: 0, capacity: 420 }, inventory: [], money: 0, location: null, developmentFlags: [] });
  await rejected(assets.readOwnAssets(bob.accountId, alice.character.id), 'NOT_FOUND');
  checks.push('ordinary-trainer-has-no-granted-assets', 'owner-only-asset-selection');

  const command = seed(alice.character.id);
  const concurrent = await Promise.all([assets.seedDevelopmentFixture(command), new AssetService(database).seedDevelopmentFixture(command)]);
  assert.equal(concurrent.filter(result => !result.replayed).length, 1);
  assert.equal(concurrent.filter(result => result.replayed).length, 1);
  assert.equal(concurrent[0].revision, 1); assert.equal(concurrent[1].revision, 1);
  assert.deepEqual(await count(alice.character.id), { creatures: '1', moves: '2', inventory: '2', outcomes: '1', audits: '1', receipts: '1', revision: '1' });
  const projected = await assets.readOwnAssets(alice.accountId, alice.character.id); assertFixture(projected);
  assert.deepEqual((await assets.readOwnAssets(bob.accountId, bob.character.id)).party, []);
  checks.push('concurrent-seed-applies-once', 'source-profile-values-and-public-whitelist', 'seed-does-not-affect-second-character');
  const creature = await observer.pool.query('SELECT * FROM creatures WHERE owner_id=$1', [alice.character.id]);
  const creatureId = creature.rows[0].id as string, contentHash = creature.rows[0].content_hash as string;
  for (const [key, value] of Object.entries({ personality: '25', ot_id: '1', experience: '135', friendship: 70, ability_id: 67, held_item_id: 0,
    iv_hp: 15, iv_attack: 15, iv_defense: 15, iv_speed: 15, iv_sp_attack: 15, iv_sp_defense: 15,
    ev_hp: 0, ev_attack: 0, ev_defense: 0, ev_speed: 0, ev_sp_attack: 0, ev_sp_defense: 0,
    max_hp: 20, attack: 10, defense: 12, speed: 10, sp_attack: 10, sp_defense: 12 })) assert.equal(creature.rows[0][key], value, key);
  const state = await observer.pool.query('SELECT stage,activity,map_id,position_x,position_y FROM characters WHERE id=$1', [alice.character.id]);
  assert.equal(state.rows[0].stage, 'development-fixture'); assert.equal(state.rows[0].activity, 'recovering');
  assert.equal(state.rows[0].map_id, projected.location!.mapId); assert.equal(state.rows[0].position_x, projected.location!.x); assert.equal(state.rows[0].position_y, projected.location!.y);
  checks.push('persisted-identity-stats-and-source-legal-moves', 'fixture-remains-recovering-with-explicit-saved-location');

  await observer.pool.query('DELETE FROM character_command_receipts WHERE character_id=$1', [alice.character.id]);
  assert.equal((await assets.seedDevelopmentFixture(command)).replayed, true);
  assert.equal((await assets.seedDevelopmentFixture(seed(alice.character.id))).replayed, true);
  assert.deepEqual(await count(alice.character.id), { creatures: '1', moves: '2', inventory: '2', outcomes: '1', audits: '1', receipts: '2', revision: '1' });
  const lease = await characters.acquire(alice.accountId, alice.character.id);
  await rejected(assets.seedDevelopmentFixture(command), 'BUSY');
  const saved = await characters.save(lease.connection, { commandId: randomUUID(), type: 'save-profile', version: 1, activityId: lease.connection.activityId, expectedRevision: 1, payload: {} });
  assert.equal(saved.character.revision, 2); await characters.release(lease.connection);
  assert.equal((await assets.seedDevelopmentFixture(command)).revision, 1);
  assert.equal((await assets.readOwnAssets(alice.accountId, alice.character.id)).revision, 2);
  checks.push('permanent-business-key-survives-receipt-cleanup-and-new-command', 'active-lease-refuses-offline-seed', 'profile-save-preserves-assets-and-replay-does-not-rewind');

  const previousSaveId = randomUUID();
  const bobConnection = (await characters.acquire(bob.accountId, bob.character.id)).connection;
  await characters.save(bobConnection, { commandId: previousSaveId, type: 'save-profile', version: 1, activityId: bobConnection.activityId, expectedRevision: 0, payload: {} });
  await characters.release(bobConnection);
  await rejected(assets.seedDevelopmentFixture({ ...seed(bob.character.id), commandId: previousSaveId }), 'COMMAND_CONFLICT');
  await rejected(assets.seedDevelopmentFixture({ ...seed(bob.character.id), profileId: 'unsupported' } as unknown as SeedDevelopmentCommand), 'INVALID_MESSAGE');
  assert.deepEqual((await assets.readOwnAssets(bob.accountId, bob.character.id)).party, []);
  checks.push('same-command-different-mutation-payload-rejected', 'unsupported-profile-explicitly-rejected');

  let rollback = true;
  const rollbackTrainer = await trainer();
  const rollbackService = new AssetService(database, { testHooks: { beforeCommit: () => { if (rollback) { rollback = false; throw new Error('injected rollback'); } } } });
  const rollbackCommand = seed(rollbackTrainer.character.id);
  await rejected(rollbackService.seedDevelopmentFixture(rollbackCommand), 'DATABASE_UNAVAILABLE');
  assert.deepEqual(await count(rollbackTrainer.character.id), { creatures: '0', moves: '0', inventory: '0', outcomes: '0', audits: '0', receipts: '0', revision: '0' });
  assert.equal((await rollbackService.seedDevelopmentFixture(rollbackCommand)).replayed, false);
  checks.push('rollback-keeps-all-assets-outcome-audit-and-revision-atomic', 'rollback-retry-same-command');

  for (const committed of [false, true]) {
    let injected = false;
    const testHooks: AssetServiceTestHooks = { commit: async client => {
      if (injected) { await client.query('COMMIT'); return; }
      injected = true; await client.query(committed ? 'COMMIT' : 'ROLLBACK'); throw new Error('injected unknown COMMIT result');
    } };
    const uncertainTrainer = await trainer();
    const uncertain = await new AssetService(database, { testHooks }).seedDevelopmentFixture(seed(uncertainTrainer.character.id));
    assert.equal(uncertain.replayed, committed);
    assert.deepEqual(await count(uncertainTrainer.character.id), { creatures: '1', moves: '2', inventory: '2', outcomes: '1', audits: '1', receipts: '1', revision: '1' });
    checks.push(committed ? 'unknown-commit-queries-committed-outcome' : 'unknown-rollback-retries-without-duplicate-grant');
  }

  const duplicate = await trainer();
  await database.pool.query('INSERT INTO character_flags(character_id,flag_key) VALUES($1,$2)', [duplicate.character.id, 'fixture-existing-private-state']);
  await rejected(assets.seedDevelopmentFixture(seed(duplicate.character.id)), 'NOT_READY');
  assert.equal((await count(duplicate.character.id)).creatures, '0');
  checks.push('offline-seed-refuses-existing-progression');

  // Every negative starts from a valid source-backed row and overrides just the
  // integrity boundary under test. No broad reset or fixture-private source edits.
  const cloneSql = 'INSERT INTO creatures SELECT (jsonb_populate_record(NULL::creatures,to_jsonb(c)||$2::jsonb)).* FROM creatures c WHERE id=$1';
  const clone = (override: Record<string, unknown>) => JSON.stringify({ id: randomUUID(), provenance_key: `qa:${randomUUID()}`, slot_index: 2, ...override });
  for (const override of [
    { level: 0 }, { level: 101 }, { experience: -1 }, { experience: '4294967296' }, { personality: '-1' }, { ot_id: '4294967296' },
    { friendship: 256 }, { iv_hp: 32 }, { ev_attack: 256 }, { ev_hp: 255, ev_attack: 255, ev_defense: 1 },
    { hp: 21 }, { attack: 0 }, { status: 'sleep', status_turns: 0 }, { status: 'healthy', status_turns: 1 },
    { location_kind: 'party', slot_index: 7 }, { location_kind: 'party', box_index: 1 },
    { location_kind: 'storage', box_index: 0 }, { location_kind: 'storage', box_index: 15 },
    { location_kind: 'storage', box_index: 1, slot_index: 31 }, { location_kind: 'nowhere' },
  ]) await expectSqlFailure(cloneSql, [creatureId, clone(override)], '23514');
  await expectSqlFailure(cloneSql, [creatureId, clone({ owner_id: randomUUID() })], '23503');
  await expectSqlFailure(cloneSql, [creatureId, clone({ species_id: 999 })], '23503');
  await expectSqlFailure(cloneSql, [creatureId, clone({ slot_index: 1 })], '23505');
  await expectSqlFailure(cloneSql, [creatureId, clone({ id: creatureId, location_kind: 'storage', box_index: 1 })], '23505');
  await expectSqlFailure(cloneSql, [creatureId, clone({ provenance_key: creature.rows[0].provenance_key })], '23505');
  await rolledBack(async client => {
    for (let slot = 2; slot <= 6; slot++) await client.query(cloneSql, [creatureId, clone({ slot_index: slot })]);
    assert.equal((await client.query("SELECT count(*) FROM creatures WHERE owner_id=$1 AND location_kind='party'", [alice.character.id])).rows[0].count, '6');
    await client.query(`INSERT INTO creatures SELECT (jsonb_populate_record(NULL::creatures,to_jsonb(c)||jsonb_build_object(
      'id',gen_random_uuid(),'provenance_key','qa:box:'||box.n||':'||slot.n,'location_kind','storage','box_index',box.n,'slot_index',slot.n))).*
      FROM creatures c CROSS JOIN generate_series(1,14) AS box(n) CROSS JOIN generate_series(1,30) AS slot(n) WHERE c.id=$1`, [creatureId]);
    assert.equal((await client.query("SELECT count(*) FROM creatures WHERE owner_id=$1 AND location_kind='storage'", [alice.character.id])).rows[0].count, '420');
  });
  checks.push('creature-identity-iv-ev-hp-status-bounds', 'party-six-storage-fourteen-by-thirty-and-one-location', 'ownership-source-foreign-keys-and-permanent-provenance');

  for (const [sql, values, code] of [
    ['UPDATE creature_moves SET pp=36 WHERE creature_id=$1 AND move_id=33', [creatureId], '23514'],
    ['UPDATE creature_moves SET pp_ups=4 WHERE creature_id=$1', [creatureId], '23514'],
    ['UPDATE creature_moves SET slot_index=5 WHERE creature_id=$1 AND slot_index=2', [creatureId], '23514'],
    ['UPDATE creature_moves SET move_id=33 WHERE creature_id=$1 AND slot_index=2', [creatureId], '23505'],
    ['UPDATE creature_moves SET creature_id=$2 WHERE creature_id=$1', [creatureId, randomUUID()], '23503'],
    ['UPDATE character_inventory SET quantity=1000 WHERE character_id=$1', [alice.character.id], '23514'],
    ['UPDATE character_inventory SET quantity=0 WHERE character_id=$1', [alice.character.id], '23514'],
    ["UPDATE character_inventory SET slot_index=14 WHERE character_id=$1 AND pocket='POCKET_POKE_BALLS'", [alice.character.id], '23514'],
    ["UPDATE character_inventory SET pocket='POCKET_ITEMS' WHERE character_id=$1 AND item_id=4", [alice.character.id], '23505'],
    ["UPDATE character_inventory SET pocket='POCKET_KEY_ITEMS' WHERE character_id=$1 AND item_id=4", [alice.character.id], '23503'],
    ['UPDATE character_wallets SET money=-1 WHERE character_id=$1', [alice.character.id], '23514'],
    ['UPDATE character_wallets SET money=1000000 WHERE character_id=$1', [alice.character.id], '23514'],
    ['UPDATE character_variables SET value=65536 WHERE character_id=$1', [alice.character.id], '23514'],
    ['UPDATE domain_outcomes SET result=result WHERE character_id=$1', [alice.character.id], '23514'],
    ['UPDATE audit_events SET detail=detail WHERE character_id=$1', [alice.character.id], '23514'],
    ['UPDATE content_moves SET base_pp=base_pp WHERE content_hash=$1 AND source_id=33', [contentHash], '23514'],
    ['DELETE FROM characters WHERE id=$1', [alice.character.id], '23503'],
  ] as [string, unknown[], string][]) await expectSqlFailure(sql, values, code);
  await rolledBack(async client => {
    await client.query('UPDATE creature_moves SET pp_ups=3,pp=56 WHERE creature_id=$1 AND move_id=33', [creatureId]);
    assert.equal((await client.query('SELECT pp FROM creature_moves WHERE creature_id=$1 AND move_id=33', [creatureId])).rows[0].pp, 56);
    await client.query('UPDATE character_inventory SET quantity=999 WHERE character_id=$1', [alice.character.id]);
    await client.query('UPDATE character_wallets SET money=999999 WHERE character_id=$1', [alice.character.id]);
  });
  const outcome = await database.pool.query<{ id: string }>('SELECT id FROM domain_outcomes WHERE character_id=$1', [alice.character.id]);
  await expectSqlFailure('INSERT INTO character_claims(character_id,claim_key,domain_outcome_id) VALUES($1,$2,$3)', [bob.character.id, 'foreign-outcome', outcome.rows[0].id], '23503');
  await expectSqlFailure('INSERT INTO character_trainer_completions(character_id,trainer_key,content_hash,domain_outcome_id) VALUES($1,$2,$3,$4)', [bob.character.id, 'foreign-outcome', contentHash, outcome.rows[0].id], '23503');
  checks.push('source-pp-with-ppups-and-move-slot-bounds', 'inventory-quantity-pocket-capacity-and-wallet-bounds', 'private-story-values-and-cross-owner-outcomes', 'outcome-audit-content-immutability-and-deletion-restrict');

  const sessionId = randomUUID();
  await database.pool.query("INSERT INTO auth_session(id,user_id,token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [sessionId, alice.accountId, randomUUID()]);
  assertFixture(await assets.readOwnAssets(alice.accountId, alice.character.id, sessionId));
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [sessionId]);
  await rejected(assets.readOwnAssets(alice.accountId, alice.character.id, sessionId), 'AUTH_REQUIRED');
  await database.pool.query('INSERT INTO character_flags(character_id,flag_key) VALUES($1,$2)', [alice.character.id, 'PRIVATE_STORY_FLAG_DO_NOT_PROJECT']);
  await database.pool.query('INSERT INTO character_variables(character_id,variable_key,value) VALUES($1,$2,42)', [alice.character.id, 'PRIVATE_STORY_VARIABLE_DO_NOT_PROJECT']);
  const recoveryProjection = await assets.readOwnAssets(alice.accountId, alice.character.id);
  assertFixture(recoveryProjection); assert(!JSON.stringify(recoveryProjection).includes('PRIVATE_STORY'));
  checks.push('revoked-session-cannot-read-owned-assets', 'story-operational-data-never-enters-public-projection');

  const cliTrainer = await trainer();
  const cliCommand = seed(cliTrainer.character.id);
  const cliArgs = ['--character', cliCommand.characterId, '--profile', cliCommand.profileId, '--command', cliCommand.commandId];
  const cliScript = 'apps/server/src/seed-dev.ts';
  for (const [args, env, expected] of [
    [cliArgs, { NODE_ENV: 'production', DATABASE_URL: databaseUrl }, /only in local development/i],
    [cliArgs, { NODE_ENV: 'test', DATABASE_URL: databaseUrl }, /only in local development/i],
    [cliArgs, { NODE_ENV: 'development', APP_MODE: 'tester', DATABASE_URL: databaseUrl }, /only in local development/i],
    [cliArgs, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://unused:unused@192.0.2.1:1/never_contact_test' }, /local development database|loopback/i],
    [cliArgs, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://unused:unused@127.0.0.1/never_contact_test?host=example.test' }, /local development database|loopback/i],
    [['--character', cliCommand.characterId, '--profile', 'unknown'], { NODE_ENV: 'development', DATABASE_URL: databaseUrl }, /r1-squirtle-v1/i],
  ] as [string[], NodeJS.ProcessEnv, RegExp][]) {
    const blocked = await child(cliScript, args, env); assert.notEqual(blocked.code, 0); assert.match(blocked.output, expected);
  }
  assert.equal((await count(cliTrainer.character.id)).creatures, '0');
  const cliRuns = await Promise.all([child(cliScript, cliArgs, { NODE_ENV: 'development', DATABASE_URL: databaseUrl }), child(cliScript, cliArgs, { NODE_ENV: 'development', DATABASE_URL: databaseUrl })]);
  for (const result of cliRuns) assert.equal(result.code, 0, result.output);
  assert.notEqual(cliRuns[0].pid, cliRuns[1].pid);
  const cliExpected = await assets.readOwnAssets(cliTrainer.accountId, cliTrainer.character.id); assertFixture(cliExpected);
  assert.deepEqual(await count(cliTrainer.character.id), { creatures: '1', moves: '2', inventory: '2', outcomes: '1', audits: '1', receipts: '1', revision: '1' });
  const fresh = await child('tests/integration/assets-process-probe.ts', [alice.accountId, alice.character.id]);
  assert.equal(fresh.code, 0, fresh.output); assert.deepEqual(trainerAssetsSchema.parse(JSON.parse(fresh.output)), recoveryProjection);
  checks.push('seed-cli-production-tester-nonlocal-and-unknown-profile-guards', 'two-fresh-cli-processes-seed-once', 'fresh-process-recovers-private-owned-projection');

  const lostDatabase = createDatabase(databaseUrl);
  const offline = new AssetService(lostDatabase); await lostDatabase.close();
  await rejected(offline.readOwnAssets(alice.accountId, alice.character.id), 'DATABASE_UNAVAILABLE');
  await rejected(offline.seedDevelopmentFixture(seed(bob.character.id)), 'DATABASE_UNAVAILABLE');
  assert.equal((await count(bob.character.id)).creatures, '0');
  checks.push('database-outage-never-promises-assets');
  await writeFile('reports/assets-integration.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), status: 'passed', checks,
    scope: 'Separate real PostgreSQL test database. Explicit offline fixture only; no live economy or battle mechanics.',
    failureInjection: 'Real COMMIT/ROLLBACK followed by simulated lost acknowledgement; not a network partition or machine-crash test.',
    childPids: [...cliRuns.map(result => result.pid), fresh.pid] }, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'assets_integration_passed', checks }));
} finally {
  await characters.dispose();
  try { await removeAccountFixtures(observer, users); }
  finally { await database.close(); await observer.close(); }
}
