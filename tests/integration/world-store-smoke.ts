import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createDatabase } from '@pokewaterblue/database';
import type { WorldCommand, WorldInput } from '@pokewaterblue/protocol';
import { CharacterService, CharacterServiceError, type CharacterConnection, type CharacterServiceTestHooks } from '../../apps/server/src/character-service.js';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixtures } from './account-fixtures.js';

const url = accountTestDatabaseUrl(); process.env['NODE_ENV'] = 'test'; await migrateAccountTestDatabase(url);
const database = createDatabase(url), observer = createDatabase(url), content = await WorldContent.load();
const users: string[] = [], services: CharacterService[] = [], checks: string[] = [];
const PALLET = 'MAP_PALLET_TOWN', HOUSE = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F';
function service(hooks?: CharacterServiceTestHooks) { const value = new CharacterService(database, { testHooks: hooks }); value.configureWorld(content); services.push(value); return value; }
async function fixture(owner: CharacterService, withSession = false, enter = true) {
  const accountId = `world-qa-${randomUUID()}`; users.push(accountId);
  await database.pool.query('INSERT INTO auth_user(id,name,email,email_verified) VALUES($1,$2,$3,true)', [accountId, 'World QA', `${accountId}@example.test`]);
  const character = await owner.create(accountId, { commandId: randomUUID(), name: 'LEAF' });
  await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  content.validateLocation({ mapId: PALLET, x: 6, y: 8, elevation: 3 });
  await database.pool.query("UPDATE characters SET position_x=6,position_y=8,position_facing='north' WHERE id=$1", [character.id]);
  let sessionId: string | undefined;
  if (withSession) {
    sessionId = randomUUID();
    await database.pool.query("INSERT INTO auth_session(id,user_id,token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [sessionId, accountId, randomUUID()]);
  }
  const joined = await owner.acquire(accountId, character.id, sessionId);
  if (enter) await owner.enterWorld(joined.connection, command(owner, joined.connection));
  return { accountId, character, connection: joined.connection, sessionId };
}
function command(owner: CharacterService, connection: CharacterConnection): WorldCommand {
  const state = owner.snapshot(connection); assert(state);
  return { commandId: randomUUID(), activityId: state.character.activityId, expectedRevision: state.character.revision };
}
function input(owner: CharacterService, connection: CharacterConnection, direction: WorldInput['direction'] = 'north'): WorldInput {
  const world = owner.worldProjection(connection); assert(world);
  return { direction, run: false, sequence: world.lastInputSequence + 1, connectionGeneration: connection.connectionGeneration, zoneGeneration: world.zoneGeneration };
}
const persisted = async (id: string) => (await observer.pool.query('SELECT map_id,position_x,position_y,revision,transition_generation,world_checkpoint_id,activity FROM characters WHERE id=$1', [id])).rows[0];
const rejected = async (work: Promise<unknown>, code: string) => assert.rejects(work, error => error instanceof CharacterServiceError && error.code === code);
function onlyDestination(owner: CharacterService, connection: CharacterConnection) {
  const projection = owner.worldProjection(connection); assert(projection);
  assert.equal(projection.avatar.mapId, HOUSE); assert.equal(projection.avatar.x, 4); assert.equal(projection.avatar.y, 8);
  assert.equal(owner.worldAvatars(PALLET, randomUUID()).filter(avatar => avatar.id === connection.characterId).length, 0);
  assert.equal(owner.worldAvatars(HOUSE, randomUUID()).filter(avatar => avatar.id === connection.characterId).length, 1);
}

try {
  let armed = false;
  const rollback = service({ beforeCommit: kind => { if (armed && kind === 'world') { armed = false; throw new Error('injected world rollback'); } } });
  const f = await fixture(rollback); const before = await persisted(f.character.id);
  armed = true; await rollback.worldInput(f.connection, input(rollback, f.connection));
  const failed = await rollback.tickWorld(Date.now() + 1000);
  assert.equal(failed.length, 1); assert.deepEqual(await persisted(f.character.id), before);
  assert.equal(rollback.worldProjection(f.connection), null);
  const recovered = await rollback.acquire(f.accountId, f.character.id);
  await rollback.enterWorld(recovered.connection, command(rollback, recovered.connection));
  assert.equal(rollback.worldProjection(recovered.connection)?.avatar.mapId, PALLET);
  assert.equal(rollback.worldProjection(recovered.connection)?.avatar.x, 6);
  checks.push('failed-before-transfer-commit-keeps-source-checkpoint', 'failed-transfer-hides-runtime-until-reauthenticated-recovery');

  for (const commitHappened of [false, true]) {
    let inject = false;
    const uncertain = service({ commit: async (client, kind) => {
      if (!inject || kind !== 'world') { await client.query('COMMIT'); return; }
      inject = false; await client.query(commitHappened ? 'COMMIT' : 'ROLLBACK'); throw new Error('injected uncertain world COMMIT acknowledgement');
    } });
    const sample = await fixture(uncertain), initial = await persisted(sample.character.id);
    inject = true; await uncertain.worldInput(sample.connection, input(uncertain, sample.connection));
    assert.deepEqual(await uncertain.tickWorld(Date.now() + 1000), []);
    const row = await persisted(sample.character.id);
    assert.equal(Number(row.revision), Number(initial.revision) + 1); assert.equal(Number(row.transition_generation), Number(initial.transition_generation) + 1);
    assert.notEqual(row.world_checkpoint_id, initial.world_checkpoint_id); onlyDestination(uncertain, sample.connection);
    checks.push(commitHappened ? 'unknown-transfer-commit-recovers-one-committed-destination' : 'unknown-transfer-rollback-retries-once');
  }

  let publishFailure = false;
  const publisher = service({ beforePublish: () => { if (publishFailure) { publishFailure = false; throw new Error('injected committed membership publication failure'); } } });
  const published = await fixture(publisher), original = await persisted(published.character.id);
  publishFailure = true; await publisher.worldInput(published.connection, input(publisher, published.connection));
  assert.deepEqual(await publisher.tickWorld(Date.now() + 1000), []);
  onlyDestination(publisher, published.connection);
  assert.equal(Number((await persisted(published.character.id)).revision), Number(original.revision) + 1);
  checks.push('commit-before-membership-publication-failure-reloads-single-destination');

  for (const disposition of ['rollback', 'uncertain-rollback', 'uncertain-commit', 'publish'] as const) {
    let checkpointArmed = false;
    const ordinary = service({
      beforeCommit: kind => { if (checkpointArmed && disposition === 'rollback' && kind === 'world') { checkpointArmed = false; throw new Error('injected ordinary checkpoint rollback'); } },
      commit: async (client, kind) => {
        if (checkpointArmed && kind === 'world' && disposition.startsWith('uncertain')) {
          checkpointArmed = false; await client.query(disposition === 'uncertain-commit' ? 'COMMIT' : 'ROLLBACK'); throw new Error('injected ordinary checkpoint lost acknowledgement');
        }
        await client.query('COMMIT');
      },
      beforePublish: () => { if (checkpointArmed && disposition === 'publish') { checkpointArmed = false; throw new Error('injected ordinary checkpoint publication failure'); } },
    });
    const walker = await fixture(ordinary), oldCheckpoint = await persisted(walker.character.id);
    await ordinary.worldInput(walker.connection, input(ordinary, walker.connection, 'east')); await ordinary.tickWorld(Date.now() + 500);
    checkpointArmed = true; const failures = await ordinary.tickWorld(Date.now() + 5100);
    if (disposition === 'rollback') {
      assert.equal(failures.length, 1); assert.deepEqual(await persisted(walker.character.id), oldCheckpoint); assert.equal(ordinary.worldProjection(walker.connection), null);
    } else {
      assert.deepEqual(failures, []); const row = await persisted(walker.character.id);
      assert.equal(row.position_x, 7); assert.equal(Number(row.revision), Number(oldCheckpoint.revision) + 1);
      assert.equal(Number(row.transition_generation), Number(oldCheckpoint.transition_generation));
      assert.equal(ordinary.worldAvatars(PALLET, randomUUID()).filter(avatar => avatar.id === walker.character.id).length, 1);
    }
    checks.push(`ordinary-checkpoint-${disposition}-keeps-one-durable-location`);
  }

  const invalid = service(), negative = await fixture(invalid);
  const validPacket = input(invalid, negative.connection, 'east');
  await rejected(invalid.worldInput(negative.connection, { ...validPacket, x: 1000 } as unknown as WorldInput), 'INVALID_MESSAGE');
  await rejected(invalid.worldInput(negative.connection, { ...validPacket, connectionGeneration: validPacket.connectionGeneration + 1 }), 'RECONNECT_REQUIRED');
  await rejected(invalid.worldInput(negative.connection, { ...validPacket, zoneGeneration: validPacket.zoneGeneration + 1 }), 'RECONNECT_REQUIRED');
  assert.equal(invalid.worldProjection(negative.connection)?.avatar.x, 6);
  await invalid.worldInput(negative.connection, validPacket);
  await rejected(invalid.worldInput(negative.connection, { ...validPacket, sequence: validPacket.sequence + 1 }), 'BUSY');
  await invalid.tickWorld(Date.now() + 500);
  assert.equal(invalid.worldProjection(negative.connection)?.avatar.x, 7);
  await invalid.worldInput(negative.connection, input(invalid, negative.connection, 'east'));
  await invalid.tickWorld(Date.now() + 500); assert.equal(invalid.worldProjection(negative.connection)?.avatar.x, 8);
  checks.push('forged-position-connection-and-zone-generations-rejected', 'early-input-rejected-without-poisoning-next-sequence');

  const disconnected = service(), live = await fixture(disconnected, true);
  await disconnected.worldInput(live.connection, input(disconnected, live.connection, 'east'));
  await disconnected.tickWorld(Date.now() + 500);
  await disconnected.checkpointWorldOnDisconnect(live.connection);
  assert.equal((await persisted(live.character.id)).position_x, 7);
  assert.equal(disconnected.worldProjection(live.connection), null);
  const expired = service(), revoked = await fixture(expired, true), old = await persisted(revoked.character.id);
  await expired.worldInput(revoked.connection, input(expired, revoked.connection, 'east'));
  await expired.tickWorld(Date.now() + 500);
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [revoked.sessionId]);
  await rejected(expired.checkpointWorldOnDisconnect(revoked.connection), 'AUTH_REQUIRED');
  assert.deepEqual(await persisted(revoked.character.id), old);
  assert.equal(expired.worldProjection(revoked.connection), null);
  checks.push('authorized-graceful-close-checkpoints-finished-tile', 'revoked-session-close-hides-avatar-without-writing');

  const periodic = service(), periodicFixture = await fixture(periodic);
  await periodic.worldInput(periodicFixture.connection, input(periodic, periodicFixture.connection, 'east'));
  await periodic.tickWorld(Date.now() + 500);
  assert.equal((await persisted(periodicFixture.character.id)).position_x, 6);
  await periodic.tickWorld(Date.now() + 5100);
  assert.equal((await persisted(periodicFixture.character.id)).position_x, 7);
  checks.push('ordinary-walking-checkpoints-after-five-second-interval');

  const midstep = service(), moving = await fixture(midstep);
  await midstep.worldInput(moving.connection, input(midstep, moving.connection, 'east'));
  const motion = midstep.worldProjection(moving.connection)!.avatar.motion; assert(motion);
  await midstep.save(moving.connection, { ...command(midstep, moving.connection), type: 'save-profile', version: 1, payload: {} });
  assert.equal((await persisted(moving.character.id)).position_x, 6);
  assert.deepEqual(midstep.worldProjection(moving.connection)!.avatar.motion, motion);
  await midstep.tickWorld(Date.now() + 500); assert.equal(midstep.worldProjection(moving.connection)!.avatar.x, 7);
  await new Promise(resolve => setTimeout(resolve, 5050));
  await midstep.worldInput(moving.connection, input(midstep, moving.connection, 'east'));
  const liveMotion = midstep.worldProjection(moving.connection)!.avatar.motion; assert(liveMotion);
  await midstep.tickWorld();
  assert.equal((await persisted(moving.character.id)).position_x, 7);
  assert.deepEqual(midstep.worldProjection(moving.connection)!.avatar.motion, liveMotion);
  await midstep.tickWorld(Date.now() + 500); assert.equal(midstep.worldProjection(moving.connection)!.avatar.x, 8);
  checks.push('mid-step-save-persists-finished-tile-and-preserves-motion', 'five-second-checkpoint-does-not-starve-during-motion');

  const retries = service(), retryFixture = await fixture(retries, false, false);
  const entryCommand = command(retries, retryFixture.connection);
  await retries.enterWorld(retryFixture.connection, entryCommand);
  const entered = await persisted(retryFixture.character.id), generation = retries.worldProjection(retryFixture.connection)!.zoneGeneration;
  await retries.enterWorld(retryFixture.connection, entryCommand);
  assert.deepEqual(await persisted(retryFixture.character.id), entered);
  await retries.worldInput(retryFixture.connection, { ...input(retries, retryFixture.connection, 'east'), sequence: 20 });
  await retries.tickWorld(Date.now() + 500);
  await retries.enterWorld(retryFixture.connection, entryCommand);
  assert.equal(retries.worldProjection(retryFixture.connection)!.avatar.x, 7);
  assert.equal(retries.worldProjection(retryFixture.connection)!.zoneGeneration, generation);
  await rejected(retries.enterWorld(retryFixture.connection, { ...entryCommand, expectedRevision: entryCommand.expectedRevision + 1 }), 'COMMAND_CONFLICT');
  const exitCommand = command(retries, retryFixture.connection);
  await retries.leaveWorld(retryFixture.connection, exitCommand);
  const exited = await persisted(retryFixture.character.id);
  await retries.leaveWorld(retryFixture.connection, exitCommand);
  assert.deepEqual(await persisted(retryFixture.character.id), exited); assert.equal(retries.worldProjection(retryFixture.connection), null);
  await retries.enterWorld(retryFixture.connection, command(retries, retryFixture.connection));
  const currentWorld = retries.worldProjection(retryFixture.connection);
  await rejected(retries.leaveWorld(retryFixture.connection, exitCommand), 'RECONNECT_REQUIRED');
  assert.deepEqual(retries.worldProjection(retryFixture.connection), currentWorld);
  const transferring = service(), transferRetry = await fixture(transferring, false, false);
  const transferEntry = command(transferring, transferRetry.connection); await transferring.enterWorld(transferRetry.connection, transferEntry);
  await transferring.worldInput(transferRetry.connection, input(transferring, transferRetry.connection));
  assert.equal(transferring.snapshot(transferRetry.connection)!.character.activity, 'transferring');
  await transferring.enterWorld(transferRetry.connection, transferEntry);
  assert.equal(transferring.snapshot(transferRetry.connection)!.character.activity, 'transferring');
  await transferring.tickWorld(Date.now() + 1000); onlyDestination(transferring, transferRetry.connection);
  checks.push('entry-and-leave-receipts-replay-without-rewind-or-new-zone', 'changed-entry-payload-conflicts', 'monotonic-sequence-gaps-are-safe');
  checks.push('old-leave-receipt-cannot-exit-new-world-activity', 'entry-replay-preserves-pending-transfer');

  const takeover = service(), firstTab = await fixture(takeover);
  await takeover.worldInput(firstTab.connection, input(takeover, firstTab.connection, 'east')); await takeover.tickWorld(Date.now() + 500);
  assert.equal((await persisted(firstTab.character.id)).position_x, 6);
  const secondTab = await takeover.acquire(firstTab.accountId, firstTab.character.id);
  assert.equal((await persisted(firstTab.character.id)).position_x, 7);
  assert.equal(takeover.worldProjection(firstTab.connection), null);
  await takeover.enterWorld(secondTab.connection, command(takeover, secondTab.connection));
  assert.equal(takeover.worldProjection(secondTab.connection)!.avatar.x, 7);
  checks.push('new-tab-checkpoints-finished-unsaved-tile-before-replacement');

  const guards = service(), unmarked = await fixture(guards, false, false);
  await database.pool.query('DELETE FROM character_flags WHERE character_id=$1', [unmarked.character.id]);
  await rejected(guards.enterWorld(unmarked.connection, command(guards, unmarked.connection)), 'NOT_READY');
  const invalidLocation = await fixture(guards, false, false);
  await database.pool.query('UPDATE characters SET position_x=999 WHERE id=$1', [invalidLocation.character.id]);
  await rejected(guards.enterWorld(invalidLocation.connection, command(guards, invalidLocation.connection)), 'NOT_READY');
  checks.push('missing-development-marker-and-invalid-source-location-refuse-entry');

  const modifiedRoot = await mkdtemp(join(tmpdir(), 'pokewaterblue-world-source-'));
  try {
    const directory = join(modifiedRoot, 'content/generated/client/maps'); await mkdir(directory, { recursive: true });
    for (const name of ['PalletTown', 'Route1', 'PalletTown_PlayersHouse_1F']) {
      const bytes = await readFile(`content/generated/client/maps/${name}.json`, 'utf8');
      await writeFile(join(directory, `${name}.json`), name === 'PalletTown' ? `${bytes}\n ` : bytes);
    }
    await assert.rejects(WorldContent.load(modifiedRoot), /Shared world content differs/);
  } finally {
    const ownedPath = await realpath(modifiedRoot), temporaryParent = await realpath(tmpdir());
    assert.equal(dirname(ownedPath).toLowerCase(), temporaryParent.toLowerCase());
    assert(basename(ownedPath).startsWith('pokewaterblue-world-source-'));
    await rm(ownedPath, { recursive: true, force: true });
  }
  checks.push('modified-source-bytes-refuse-server-world-content');

  const expiring = service(), expiredLease = await fixture(expiring);
  assert.equal(expiring.worldProjection(expiredLease.connection, Date.now() + 16_000), null);
  assert.equal(expiring.worldAvatars(PALLET, randomUUID(), Date.now() + 16_000).length, 0);
  const leaseFailure = await expiring.tickWorld(Date.now() + 16_000);
  assert.equal((leaseFailure[0]?.error as CharacterServiceError).code, 'LEASE_EXPIRED');
  checks.push('expired-heartbeat-lease-removes-public-avatar-and-freezes-input');
  const expiredDatabaseLease = service(), ended = await fixture(expiredDatabaseLease);
  const endedInput = input(expiredDatabaseLease, ended.connection, 'east');
  await database.pool.query("UPDATE character_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE character_id=$1", [ended.character.id]);
  await rejected(expiredDatabaseLease.worldInput(ended.connection, endedInput), 'LEASE_EXPIRED');
  assert.equal(expiredDatabaseLease.worldProjection(ended.connection), null);
  checks.push('expired-database-lease-fences-next-input-immediately');

  const outagePool = createDatabase(url), outage = new CharacterService(outagePool); outage.configureWorld(content); services.push(outage);
  const lost = await fixture(outage), lastGood = await persisted(lost.character.id);
  await outage.worldInput(lost.connection, input(outage, lost.connection, 'east')); await outage.tickWorld(Date.now() + 500);
  await outagePool.close();
  await rejected(outage.heartbeat(lost.connection), 'DATABASE_UNAVAILABLE');
  assert.equal(outage.worldProjection(lost.connection), null); assert.equal(outage.worldAvatars(PALLET, randomUUID()).length, 0);
  assert.deepEqual(await persisted(lost.character.id), lastGood);
  checks.push('real-driver-outage-hides-ghost-avatar-without-checkpoint-acknowledgement');
  await writeFile('reports/world-store.json', `${JSON.stringify({ status: 'passed', verifiedAt: new Date().toISOString(), checks,
    scope: 'Real PostgreSQL. Clock arguments drive internal service ticks only; source-valid offline fixtures and actual COMMIT/ROLLBACK inject storage failures.',
    limits: 'Graceful close saves the last finished tile while authorized. Revocation cannot write. Unacknowledged ordinary walking can roll back to the prior checkpoint after process loss; no machine-crash or network-partition claim.' }, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'world_store_passed', checks }));
} finally {
  await Promise.allSettled(services.map(owner => owner.dispose()));
  try { await removeAccountFixtures(observer, users); } finally { await database.close(); await observer.close(); }
}
