import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '@pokewaterblue/database';
import { practiceSnapshotSchema, type PracticeCommand, type PracticeSnapshot, type WildTestCommand, type WorldInput, type WorldLocation } from '@pokewaterblue/protocol';
import { CharacterService, CharacterServiceError, type CharacterConnection, type CharacterServiceTestHooks } from '../../apps/server/src/character-service.js';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { loadPracticeEngine, type PracticeStored } from '../../apps/server/src/practice-engine.js';
import { loadWildEncounterEngine } from '../../apps/server/src/wild-encounter-engine.js';
import { loadEncounterCore, type EncounterCheckpoint } from '../../tools/encounter-core/encounter.js';
import { accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixtures } from './account-fixtures.js';

process.env['NODE_ENV'] = 'test';
const url = accountTestDatabaseUrl(); await migrateAccountTestDatabase(url);
const database = createDatabase(url), content = await WorldContent.load(), practice = await loadPracticeEngine();
const wild = await loadWildEncounterEngine(), source = await loadEncounterCore();
const users: string[] = [], services: CharacterService[] = [], checks: string[] = [];
const route = { mapId: 'MAP_ROUTE1' as const, x: 12, y: 39, elevation: 3 };
function service(hooks?: CharacterServiceTestHooks) {
  const value = new CharacterService(database, { leaseMs: 120_000, testHooks: hooks });
  value.configureWorld(content); value.configurePractice(practice, true); value.configureWild(wild, true);
  services.push(value); return value;
}
function seed(steps = 8): EncounterCheckpoint {
  const state = source.create({ mainSeed: 0, wildSeed: 17185, trainerId: 1 });
  for (let index = 0; index < steps; index++) assert.equal(state.step({ behavior: 'grass', movement: 'walk' }).kind, 'none');
  return state.snapshot();
}
async function fixture(owner: CharacterService, options: { enabled?: boolean; seeded?: boolean; location?: WorldLocation } = {}) {
  const accountId = `wild-qa-${randomUUID()}`; users.push(accountId);
  await database.pool.query('INSERT INTO auth_user(id,name,email,email_verified) VALUES($1,$2,$3,true)', [accountId, 'Wild QA', `${accountId}@example.test`]);
  const character = await owner.create(accountId, { commandId: randomUUID(), name: 'WILDQA' });
  if (options.seeded !== false) await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  const location = options.location ?? route; content.validateLocation(location);
  if (options.seeded !== false) await database.pool.query('UPDATE characters SET map_id=$2,position_x=$3,position_y=$4,position_elevation=$5,position_facing=\'north\' WHERE id=$1', [character.id, location.mapId, location.x, location.y, location.elevation]);
  const sessionId = randomUUID();
  await database.pool.query("INSERT INTO auth_session(id,user_id,token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [sessionId, accountId, randomUUID()]);
  const joined = await owner.acquire(accountId, character.id, sessionId);
  if (options.enabled !== false && options.seeded !== false) {
    await owner.wildTestCommand(joined.connection, { commandId: randomUUID(), expectedRevision: 0, enabled: true });
    await database.pool.query('UPDATE character_wild_test_state SET checkpoint=$2 WHERE character_id=$1', [character.id, JSON.stringify(seed())]);
  }
  return { accountId, characterId: character.id, sessionId, connection: joined.connection };
}
function worldCommand(owner: CharacterService, connection: CharacterConnection) {
  const state = owner.snapshot(connection); assert(state);
  return { commandId: randomUUID(), activityId: state.character.activityId, expectedRevision: state.character.revision };
}
async function enter(owner: CharacterService, connection: CharacterConnection) { await owner.enterWorld(connection, worldCommand(owner, connection)); }
function packet(owner: CharacterService, connection: CharacterConnection, direction: WorldInput['direction'] = 'north'): WorldInput {
  const world = owner.worldProjection(connection); assert(world);
  return { sequence: world.lastInputSequence + 1, connectionGeneration: connection.connectionGeneration, zoneGeneration: world.zoneGeneration, direction, run: false };
}
async function step(owner: CharacterService, connection: CharacterConnection, direction: WorldInput['direction'] = 'north') {
  const input = packet(owner, connection, direction); await owner.worldInput(connection, input);
  assert.deepEqual(await owner.tickWorld(Date.now() + 1000), []); return input;
}
async function persisted(characterId: string) {
  return {
    character: (await database.pool.query('SELECT map_id,position_x,position_y,position_elevation,position_facing,activity,activity_id,revision,world_checkpoint_id FROM characters WHERE id=$1', [characterId])).rows[0],
    wild: (await database.pool.query('SELECT revision,enabled,checkpoint,last_step_id FROM character_wild_test_state WHERE character_id=$1', [characterId])).rows[0],
    practice: (await database.pool.query('SELECT revision,battle_id,checkpoint,origin FROM character_practice_state WHERE character_id=$1', [characterId])).rows[0],
  };
}
async function assets(characterId: string) {
  const result: Record<string, unknown> = {};
  for (const table of ['character_flags', 'character_variables', 'character_claims', 'character_map_patches', 'character_trainer_completions', 'character_wallets', 'character_inventory', 'domain_outcomes'])
    result[table] = (await database.pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE character_id=$1 ORDER BY to_jsonb(t)::text`, [characterId])).rows;
  result['creatures'] = (await database.pool.query('SELECT * FROM creatures WHERE owner_id=$1 ORDER BY id', [characterId])).rows;
  result['moves'] = (await database.pool.query('SELECT m.* FROM creature_moves m JOIN creatures c ON c.id=m.creature_id WHERE c.owner_id=$1 ORDER BY m.creature_id,m.slot_index', [characterId])).rows;
  return result;
}
const rejected = (work: Promise<unknown>, code: string) => assert.rejects(work, error => error instanceof CharacterServiceError && error.code === code);
function close(snapshot: PracticeSnapshot): Extract<PracticeCommand, { kind: 'close' }> {
  const battleId = snapshot.state.session?.battleId ?? snapshot.state.unavailable?.battleId; assert(battleId);
  return { commandId: randomUUID(), expectedRevision: snapshot.state.revision, kind: 'close', battleId };
}
async function recoveredProcess(accountId: string, characterId: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/integration/practice-process-probe.ts'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, PRACTICE_TEST_ACCOUNT: accountId, PRACTICE_TEST_CHARACTER: characterId } });
  let result: PracticeSnapshot | undefined, errors = '';
  child.stderr!.on('data', value => { errors = (errors + String(value)).slice(-4000); });
  child.on('message', value => { if (value && typeof value === 'object' && 'type' in value && value.type === 'practice-probe' && 'snapshot' in value) result = practiceSnapshotSchema.parse(value.snapshot); });
  const timer = setTimeout(() => child.kill(), 25000);
  try { const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }); assert.equal(code, 0, errors); assert(result); return result; }
  finally { clearTimeout(timer); }
}

try {
  const owner = service(), ordinary = await fixture(owner, { seeded: false });
  await rejected(owner.wildTestSnapshot(ordinary.connection), 'NOT_READY');
  await rejected(owner.wildTestCommand(ordinary.connection, { commandId: randomUUID(), expectedRevision: 0, enabled: true }), 'NOT_READY');
  const f = await fixture(owner, { enabled: false });
  assert.deepEqual((await owner.wildTestSnapshot(f.connection)).state, { enabled: false, revision: 0 });
  await enter(owner, f.connection); await step(owner, f.connection);
  assert.equal((await owner.practiceSnapshot(f.connection)).state.session, null);
  const enable: WildTestCommand = { commandId: randomUUID(), expectedRevision: 0, enabled: true };
  const enabled = await owner.wildTestCommand(f.connection, enable);
  assert.deepEqual(enabled.state, { enabled: true, revision: 1 });
  const initial = await persisted(f.characterId);
  assert.equal((await owner.wildTestCommand(f.connection, enable)).replayed, true);
  assert.deepEqual(await persisted(f.characterId), initial);
  await rejected(owner.wildTestCommand(f.connection, { ...enable, enabled: false }), 'COMMAND_CONFLICT');
  await rejected(owner.wildTestCommand(f.connection, { ...enable, commandId: randomUUID() }), 'STALE_REVISION');
  const disabled = await owner.wildTestCommand(f.connection, { commandId: randomUUID(), expectedRevision: 1, enabled: false });
  assert.deepEqual((await owner.wildTestCommand(f.connection, enable)).state, disabled.state, 'Old opt-in receipt returns latest config');
  assert.deepEqual((await persisted(f.characterId)).wild.checkpoint, initial.wild.checkpoint, 'Toggling never reseeds');
  checks.push('wild-testing-defaults-off-and-requires-local-development-fixture', 'toggle-receipts-are-fenced-monotonic-and-cannot-reseed');

  const blocked = await fixture(owner, { location: { ...route, y: 32 } }); await enter(owner, blocked.connection);
  const blockedBefore = await persisted(blocked.characterId); await step(owner, blocked.connection);
  assert.deepEqual((await persisted(blocked.characterId)).wild, blockedBefore.wild, 'Blocked direction is not a completed source step');
  assert.equal(owner.worldProjection(blocked.connection)!.avatar.y, 32);
  const plain = await fixture(owner, { location: { mapId: 'MAP_PALLET_TOWN', x: 10, y: 12, elevation: 3 } }); await enter(owner, plain.connection);
  const plainBefore = await persisted(plain.characterId), expectedPlain = wild.step(plainBefore.wild.checkpoint, { behavior: 'plain', movement: 'walk' });
  await step(owner, plain.connection, 'west');
  assert.deepEqual((await persisted(plain.characterId)).wild.checkpoint, expectedPlain.checkpoint);
  assert.equal((await owner.practiceSnapshot(plain.connection)).state.session, null);
  const transfer = await fixture(owner, { location: { mapId: 'MAP_PALLET_TOWN', x: 12, y: 0, elevation: 3 } }); await enter(owner, transfer.connection);
  const transferBefore = await persisted(transfer.characterId); await step(owner, transfer.connection);
  const transferAfter = await persisted(transfer.characterId);
  assert.equal(transferAfter.character.map_id, 'MAP_ROUTE1'); assert.equal(transferAfter.character.position_y, 39);
  assert.deepEqual(transferAfter.wild.checkpoint, wild.mapTransfer(transferBefore.wild.checkpoint));
  assert.equal((await owner.practiceSnapshot(transfer.connection)).state.session, null, 'Map arrival resets cooldown without inventing another grass step');
  checks.push('blocked-input-consumes-no-encounter-step', 'non-encounter-map-steps-use-source-plain-behavior', 'map-transfer-resets-source-cooldown-without-a-second-step-or-RNG-draw');

  const natural = await fixture(owner); await enter(owner, natural.connection);
  const unchanged = await assets(natural.characterId), before = await persisted(natural.characterId);
  const admittedInput = await step(owner, natural.connection);
  const begun = await owner.practiceSnapshot(natural.connection), committed = await persisted(natural.characterId);
  assert.equal(begun.state.session?.origin, 'route1-wild-test'); assert.equal(begun.state.session?.setup, undefined);
  assert.deepEqual(begun.state.session?.returnLocation, { ...route, y: 38, direction: 'north' });
  assert.equal(committed.character.activity, 'battle'); assert.equal(committed.character.position_y, 38);
  assert.equal(Number(committed.character.revision), Number(before.character.revision) + 1);
  assert.equal(committed.wild.checkpoint.phase, 'pending-encounter');
  assert.equal(committed.wild.revision, before.wild.revision, 'Walking does not stale the toggle revision');
  assert.equal(owner.worldProjection(natural.connection), null);
  assert(!owner.worldAvatars(route.mapId, randomUUID()).some(value => value.id === natural.characterId));
  assert.equal(begun.state.session!.presentation.opponent.speciesId, 19); assert.equal(begun.state.session!.presentation.opponent.level, 3);
  await owner.tickWorld(Date.now() + 1500); assert.deepEqual(await persisted(natural.characterId), committed);
  const lateInput = { ...admittedInput, sequence: admittedInput.sequence + 1 };
  await owner.worldInput(natural.connection, lateInput);
  assert.deepEqual(await persisted(natural.characterId), committed, 'A late held direction cannot advance or disconnect an admitted wild battle');
  assert.equal(owner.snapshot(natural.connection)!.character.activity, 'battle');
  await rejected(owner.worldInput(natural.connection, { ...lateInput, connectionGeneration: lateInput.connectionGeneration + 1 }), 'RECONNECT_REQUIRED');
  await rejected(owner.worldInput(natural.connection, { ...lateInput, zoneGeneration: lateInput.zoneGeneration + 1 }), 'RECONNECT_REQUIRED');
  await rejected(owner.enterWorld(natural.connection, worldCommand(owner, natural.connection)), 'RECONNECT_REQUIRED');
  await rejected(owner.practiceCommand(natural.connection, { commandId: randomUUID(), expectedRevision: begun.state.revision, kind: 'start', setup: practice.catalogue().presets[0]!.setup }), 'BUSY');
  for (const key of ['checkpoint', 'wildSlot', 'initialSeeds', 'rng', 'privateEngineState']) assert(!JSON.stringify(begun).includes(`"${key}":`));
  assert.deepEqual(await assets(natural.characterId), unchanged);
  checks.push('completed-source-grass-step-atomically-admits-exact-generated-opponent', 'battle-hides-avatar-freezes-exploration-and-rejects-second-battle', 'public-wild-session-omits-private-setup-RNG-and-checkpoint');
  checks.push('late-current-generation-held-input-keeps-wild-battle-connected-without-changing-state');

  const session = begun.state.session!;
  const attack: Extract<PracticeCommand, { kind: 'choose' }> = { commandId: randomUUID(), expectedRevision: begun.state.revision, kind: 'choose', battleId: session.battleId, choice: { kind: 'move', slot: 0 } };
  const fought = await owner.practiceCommand(natural.connection, attack);
  assert(fought.state.session!.presentation.self.moves[0]!.pp < session.presentation.self.moves[0]!.pp);
  assert.deepEqual((await owner.practiceCommand(natural.connection, attack)).state, fought.state);
  await owner.suspendTransport(natural.connection);
  await rejected(owner.practiceCommand(natural.connection, close(fought)), 'RECONNECT_REQUIRED');
  await rejected(owner.wildTestSnapshot(natural.connection), 'RECONNECT_REQUIRED');
  const resumed = await owner.resumeTransport(natural.connection, Date.now() + 30000); owner.activateTransport(resumed.connection);
  assert.deepEqual((await owner.practiceSnapshot(resumed.connection)).state, fought.state);
  await owner.release(resumed.connection);
  assert.deepEqual((await recoveredProcess(natural.accountId, natural.characterId)).state, fought.state);
  const recovered = await owner.acquire(natural.accountId, natural.characterId, natural.sessionId);
  const returnCommand = close(fought), pending = await persisted(natural.characterId);
  const expectedField = practice.finishWild(pending.practice.checkpoint as PracticeStored);
  const returned = await owner.practiceCommand(recovered.connection, returnCommand);
  assert.equal(returned.state.session, null); assert.equal(owner.snapshot(recovered.connection)!.character.activity, 'overworld');
  assert.equal(owner.worldProjection(recovered.connection)!.avatar.y, 38);
  assert.deepEqual((await persisted(natural.characterId)).wild.checkpoint, expectedField);
  assert.equal(source.restore(expectedField).view().phase, 'ready');
  const toggleState = await owner.wildTestSnapshot(recovered.connection);
  await owner.wildTestCommand(recovered.connection, { commandId: randomUUID(), expectedRevision: toggleState.state.revision, enabled: false });
  await step(owner, recovered.connection, 'south');
  assert.equal(owner.worldProjection(recovered.connection)!.avatar.y, 39);
  await owner.practiceCommand(recovered.connection, returnCommand);
  assert.equal(owner.worldProjection(recovered.connection)!.avatar.y, 39, 'Replaying old close cannot rewind later world motion');
  assert.deepEqual(await assets(natural.characterId), unchanged);
  checks.push('battle-choice-replay-spends-PP-once', 'transport-and-fresh-process-recover-same-wild-battle', 'close-carries-battle-RNG-to-field-and-returns-to-saved-tile', 'replayed-close-never-rewinds-later-exploration', 'owned-party-bag-money-story-and-rewards-remain-unchanged');

  for (const outcome of ['rollback', 'uncertain-rollback', 'uncertain-commit', 'publish'] as const) {
    let armed = false;
    const failing = service({
      beforeCommit: kind => { if (armed && outcome === 'rollback' && kind === 'wild-step') { armed = false; throw new Error('wild step precommit failure'); } },
      commit: async (client, kind) => { if (armed && kind === 'wild-step' && outcome.startsWith('uncertain')) { armed = false; await client.query(outcome === 'uncertain-commit' ? 'COMMIT' : 'ROLLBACK'); throw new Error('wild step unknown commit'); } await client.query('COMMIT'); },
      beforePublish: () => { if (armed && outcome === 'publish') { armed = false; throw new Error('wild step postcommit publication failure'); } },
    });
    const sample = await fixture(failing); await enter(failing, sample.connection); const baseline = await persisted(sample.characterId);
    await failing.worldInput(sample.connection, packet(failing, sample.connection)); armed = true;
    const errors = await failing.tickWorld(Date.now() + 1000);
    if (outcome === 'rollback') {
      assert.equal(errors.length, 1); assert.deepEqual(await persisted(sample.characterId), baseline);
      const rejoined = await failing.acquire(sample.accountId, sample.characterId, sample.sessionId);
      await enter(failing, rejoined.connection); await step(failing, rejoined.connection);
      assert.equal((await failing.practiceSnapshot(rejoined.connection)).state.session!.presentation.opponent.speciesId, 19);
    } else assert.deepEqual(errors, []);
    const current = await persisted(sample.characterId);
    assert.equal(current.character.activity, 'battle'); assert.equal(current.character.position_y, 38);
    assert.equal(Number(current.character.revision), Number(baseline.character.revision) + (outcome === 'rollback' ? 2 : 1));
    assert.equal(Number(current.practice.revision), 1); assert.equal(current.wild.checkpoint.words[11], 1);
    checks.push(`wild-step-${outcome}-preserves-one-source-encounter-and-one-battle`);
  }

  for (const outcome of ['uncertain-rollback', 'uncertain-commit', 'publish'] as const) {
    let armed = false;
    const failing = service({
      commit: async (client, kind) => { if (armed && kind === 'practice' && outcome.startsWith('uncertain')) { armed = false; await client.query(outcome === 'uncertain-commit' ? 'COMMIT' : 'ROLLBACK'); throw new Error('wild close unknown commit'); } await client.query('COMMIT'); },
      beforePublish: () => { if (armed && outcome === 'publish') { armed = false; throw new Error('wild close publication failure'); } },
    });
    const sample = await fixture(failing); await enter(failing, sample.connection); await step(failing, sample.connection);
    const beforeClose = await persisted(sample.characterId), command = close(await failing.practiceSnapshot(sample.connection));
    const expected = practice.finishWild(beforeClose.practice.checkpoint as PracticeStored);
    armed = true; const closed = await failing.practiceCommand(sample.connection, command);
    const afterClose = await persisted(sample.characterId);
    assert.equal(closed.state.session, null); assert.deepEqual(afterClose.wild.checkpoint, expected);
    assert.equal(Number(afterClose.character.revision), Number(beforeClose.character.revision) + 1);
    assert.equal(Number(afterClose.practice.revision), Number(beforeClose.practice.revision) + 1);
    assert.equal(failing.worldProjection(sample.connection)?.avatar.y, 38);
    assert.equal((await database.pool.query('SELECT 1 FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [sample.characterId, command.commandId])).rowCount, 1);
    checks.push(`wild-close-${outcome}-resumes-field-RNG-and-location-once`);
  }

  const corrupt = await fixture(owner); await enter(owner, corrupt.connection); await step(owner, corrupt.connection);
  const original = await persisted(corrupt.characterId);
  await database.pool.query("UPDATE character_practice_state SET checkpoint='{}'::jsonb WHERE character_id=$1", [corrupt.characterId]);
  const unavailable = await owner.practiceSnapshot(corrupt.connection);
  assert.equal(unavailable.state.unavailable?.origin, 'route1-wild-test');
  await rejected(owner.practiceCommand(corrupt.connection, close(unavailable)), 'NOT_READY');
  assert.deepEqual((await persisted(corrupt.characterId)).wild, original.wild);
  await database.pool.query('UPDATE character_practice_state SET checkpoint=$2 WHERE character_id=$1', [corrupt.characterId, JSON.stringify(original.practice.checkpoint)]);
  await database.pool.query('UPDATE character_practice_state SET origin=NULL WHERE character_id=$1', [corrupt.characterId]);
  const missingOrigin = await owner.practiceSnapshot(corrupt.connection);
  assert.equal(missingOrigin.state.unavailable?.origin, 'route1-wild-test');
  await rejected(owner.practiceCommand(corrupt.connection, close(missingOrigin)), 'NOT_READY');
  assert.deepEqual((await persisted(corrupt.characterId)).wild, original.wild);
  await database.pool.query('UPDATE character_practice_state SET origin=$2 WHERE character_id=$1', [corrupt.characterId, JSON.stringify(original.practice.origin)]);
  await owner.practiceCommand(corrupt.connection, close(await owner.practiceSnapshot(corrupt.connection)));
  checks.push('incompatible-wild-checkpoint-is-explicit-and-cannot-reroll-or-silently-reset-stream', 'missing-wild-origin-cannot-fall-through-ordinary-practice-close');

  const revoked = await fixture(owner); await enter(owner, revoked.connection);
  const valid = await persisted(revoked.characterId);
  await owner.worldInput(revoked.connection, packet(owner, revoked.connection));
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [revoked.sessionId]);
  const rejectedStep = await owner.tickWorld(Date.now() + 1000);
  assert(rejectedStep.some(value => value.connection.characterId === revoked.characterId));
  assert.deepEqual(await persisted(revoked.characterId), valid);
  checks.push('revocation-before-step-commit-cannot-persist-an-encounter');

  const revokedBattle = await fixture(owner); await enter(owner, revokedBattle.connection);
  const revokedBattleInput = await step(owner, revokedBattle.connection);
  const revokedBattleBefore = await persisted(revokedBattle.characterId);
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [revokedBattle.sessionId]);
  await rejected(owner.worldInput(revokedBattle.connection, { ...revokedBattleInput, sequence: revokedBattleInput.sequence + 1 }), 'AUTH_REQUIRED');
  assert.equal(owner.snapshot(revokedBattle.connection), null, 'Revoked late input freezes publication before transport rejection');
  assert.deepEqual(await persisted(revokedBattle.characterId), revokedBattleBefore);
  checks.push('late-input-in-battle-still-rejects-revoked-authentication');

  const takeover = await fixture(owner); await enter(owner, takeover.connection);
  await owner.worldInput(takeover.connection, packet(owner, takeover.connection));
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [takeover.sessionId]);
  const replacementSession = randomUUID();
  await database.pool.query("INSERT INTO auth_session(id,user_id,token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [replacementSession, takeover.accountId, randomUUID()]);
  await new Promise(resolve => setTimeout(resolve, 300));
  const newOwner = await owner.acquire(takeover.accountId, takeover.characterId, replacementSession);
  assert(newOwner.connection.connectionGeneration > takeover.connection.connectionGeneration);
  await rejected(owner.wildTestSnapshot(takeover.connection), 'SESSION_REPLACED');
  await owner.wildTestSnapshot(newOwner.connection); await enter(owner, newOwner.connection); await step(owner, newOwner.connection);
  assert.equal((await owner.practiceSnapshot(newOwner.connection)).state.session?.presentation.opponent.speciesId, 19);
  checks.push('revoked-old-session-cannot-block-new-authenticated-takeover-or-consume-encounter');

  await writeFile('reports/wild-test-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', checks,
    isolatedTestDatabase: true, userTestingAccountsTouched: false, scope: 'Opt-in Route 1 temporary wild battles; owned outcomes remain deferred.' }, null, 2) + '\n');
  console.log(`Wild encounter storage: ${checks.length} groups passed.`);
} finally {
  for (const value of services) await value.dispose();
  await removeAccountFixtures(database, users); await database.close();
}
