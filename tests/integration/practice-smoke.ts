import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '@pokewaterblue/database';
import { practiceSnapshotSchema, type PracticeCommand, type PracticeSnapshot, type WorldCommand } from '@pokewaterblue/protocol';
import { CharacterService, CharacterServiceError, type CharacterConnection, type CharacterServiceTestHooks } from '../../apps/server/src/character-service.js';
import { AssetService } from '../../apps/server/src/asset-service.js';
import { WorldContent } from '../../apps/server/src/world-content.js';
import { loadPracticeEngine } from '../../apps/server/src/practice-engine.js';
import { createPursuitDiagnostic, loadPursuitEngine, makePursuitRng, pursuitConfig } from '../../tools/battle-pursuit/engine.js';
import { accountTestDatabaseUrl, migrateAccountTestDatabase, removeAccountFixtures } from './account-fixtures.js';

process.env['NODE_ENV'] = 'test';
const url = accountTestDatabaseUrl(); await migrateAccountTestDatabase(url);
const database = createDatabase(url), engine = await loadPracticeEngine(), content = await WorldContent.load();
const users: string[] = [], services: CharacterService[] = [], checks: string[] = [], probePids: number[] = [];
const setup = engine.catalogue().presets[0]!.setup;
function service(hooks?: CharacterServiceTestHooks) {
  const value = new CharacterService(database, { testHooks: hooks, leaseMs: 120_000 });
  value.configureWorld(content); value.configurePractice(engine, true); services.push(value); return value;
}
async function fixture(owner: CharacterService, seeded = true) {
  const accountId = `practice-qa-${randomUUID()}`; users.push(accountId);
  await database.pool.query('INSERT INTO auth_user(id,name,email,email_verified) VALUES($1,$2,$3,true)', [accountId, 'Practice QA', `${accountId}@example.test`]);
  const character = await owner.create(accountId, { commandId: randomUUID(), name: 'PRACTIC' });
  if (seeded) await new AssetService(database).seedDevelopmentFixture({ characterId: character.id, commandId: randomUUID(), profileId: 'r1-squirtle-v1' });
  const sessionId = randomUUID();
  await database.pool.query("INSERT INTO auth_session(id,user_id,token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [sessionId, accountId, randomUUID()]);
  const joined = await owner.acquire(accountId, character.id, sessionId);
  return { accountId, characterId: character.id, sessionId, connection: joined.connection };
}
const start = (revision = 0): PracticeCommand => ({ commandId: randomUUID(), expectedRevision: revision, kind: 'start', setup: structuredClone(setup) });
function choose(view: PracticeSnapshot): Extract<PracticeCommand, { kind: 'choose' }> {
  const session = view.state.session; assert(session);
  const choice = session.presentation.availableChoices.find(value => value.kind === 'move') ?? session.presentation.availableChoices[0]; assert(choice);
  return { commandId: randomUUID(), expectedRevision: view.state.revision, kind: 'choose', battleId: session.battleId, choice };
}
function close(view: PracticeSnapshot): Extract<PracticeCommand, { kind: 'close' }> {
  const battleId = view.state.session?.battleId ?? view.state.unavailable?.battleId; assert(battleId);
  return { commandId: randomUUID(), expectedRevision: view.state.revision, kind: 'close', battleId };
}
const reject = (work: Promise<unknown>, code: string) => assert.rejects(work, error => error instanceof CharacterServiceError && error.code === code);
const stored = async (characterId: string) => (await database.pool.query('SELECT revision,battle_id,checkpoint FROM character_practice_state WHERE character_id=$1', [characterId])).rows;
async function assets(characterId: string) {
  const story: Record<string, unknown> = {};
  for (const table of ['character_flags', 'character_variables', 'character_claims', 'character_map_patches', 'character_trainer_completions'])
    story[table] = (await database.pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE character_id=$1 ORDER BY to_jsonb(t)::text`, [characterId])).rows;
  return {
    story,
    creatures: (await database.pool.query('SELECT * FROM creatures WHERE owner_id=$1 ORDER BY id', [characterId])).rows,
    moves: (await database.pool.query('SELECT m.* FROM creature_moves m JOIN creatures c ON c.id=m.creature_id WHERE c.owner_id=$1 ORDER BY m.creature_id,m.slot_index', [characterId])).rows,
    inventory: (await database.pool.query('SELECT * FROM character_inventory WHERE character_id=$1 ORDER BY item_id', [characterId])).rows,
    wallet: (await database.pool.query('SELECT * FROM character_wallets WHERE character_id=$1', [characterId])).rows,
    outcomes: (await database.pool.query('SELECT * FROM domain_outcomes WHERE character_id=$1 ORDER BY id', [characterId])).rows,
    location: (await database.pool.query('SELECT map_id,position_x,position_y,position_elevation,position_facing FROM characters WHERE id=$1', [characterId])).rows,
  };
}
function worldCommand(owner: CharacterService, connection: CharacterConnection): WorldCommand {
  const snapshot = owner.snapshot(connection); assert(snapshot);
  return { commandId: randomUUID(), activityId: snapshot.character.activityId, expectedRevision: snapshot.character.revision };
}
async function probe(accountId: string, characterId: string): Promise<PracticeSnapshot> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/integration/practice-process-probe.ts'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, PRACTICE_TEST_ACCOUNT: accountId, PRACTICE_TEST_CHARACTER: characterId },
  });
  assert(child.pid); probePids.push(child.pid);
  let snapshot: PracticeSnapshot | undefined, errors = '';
  child.stderr!.on('data', value => { errors = (errors + String(value)).slice(-4000); });
  child.on('message', value => {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'practice-probe' && 'snapshot' in value) snapshot = practiceSnapshotSchema.parse(value.snapshot);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
      timer = setTimeout(() => { child.kill(); reject(new Error('Owned practice recovery process timed out.')); }, 25_000);
    });
    assert.equal(code, 0, errors); assert(snapshot); return snapshot;
  } finally { clearTimeout(timer); }
}

try {
  const owner = service(), f = await fixture(owner), ordinary = await fixture(owner, false), other = await fixture(owner);
  const baseline = await assets(f.characterId);
  assert.deepEqual((await owner.practiceSnapshot(f.connection)).state, { revision: 0, session: null });
  await reject(owner.practiceSnapshot(ordinary.connection), 'NOT_READY');
  const disabled = service(); disabled.configurePractice(engine, false);
  await reject(disabled.practiceSnapshot(f.connection), 'NOT_READY');
  checks.push('practice-requires-explicit-development-fixture-and-enabled-local-mode');

  await owner.enterWorld(f.connection, worldCommand(owner, f.connection));
  await reject(owner.practiceCommand(f.connection, start()), 'BUSY');
  await owner.leaveWorld(f.connection, worldCommand(owner, f.connection));
  const first = start(), begun = await owner.practiceCommand(f.connection, first);
  assert.equal(begun.state.revision, 1); assert.equal(owner.snapshot(f.connection)!.character.activity, 'battle');
  assert.equal(owner.worldProjection(f.connection), null);
  const exact = await stored(f.characterId);
  const replay = await owner.practiceCommand(f.connection, first);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.state, begun.state); assert.deepEqual(await stored(f.characterId), exact);
  const changed = structuredClone(first); if (changed.kind === 'start') changed.setup.opponent.hpPercent = 1;
  await reject(owner.practiceCommand(f.connection, changed), 'COMMAND_CONFLICT');
  await reject(owner.practiceCommand(f.connection, start(0)), 'STALE_REVISION');
  await reject(owner.practiceCommand(f.connection, start(1)), 'BUSY');
  await reject(owner.enterWorld(f.connection, worldCommand(owner, f.connection)), 'RECONNECT_REQUIRED');
  const character = owner.snapshot(f.connection)!.character;
  await reject(owner.save(f.connection, { commandId: randomUUID(), type: 'save-profile', version: 1, activityId: character.activityId, expectedRevision: character.revision, payload: {} }), 'STALE_REVISION');
  checks.push('practice-start-is-idempotent-and-mutually-exclusive-with-world-and-profile-save', 'changed-and-stale-starts-cannot-reseed');

  const accepted = choose(begun), after = await owner.practiceCommand(f.connection, accepted);
  assert.equal(after.state.revision, 2); assert(after.state.session!.presentation.turn >= begun.state.session!.presentation.turn);
  const settled = await stored(f.characterId);
  assert.deepEqual((await owner.practiceCommand(f.connection, accepted)).state, after.state);
  assert.deepEqual(await stored(f.characterId), settled);
  assert.deepEqual((await owner.practiceCommand(f.connection, first)).state, after.state, 'An old start receipt returns current state');
  const wrong = { ...choose(begun), expectedRevision: 2, battleId: randomUUID() };
  await reject(owner.practiceCommand(f.connection, wrong), 'STALE_REVISION');
  await reject(owner.practiceCommand(other.connection, { ...wrong, battleId: after.state.session!.battleId, expectedRevision: 0 }), 'STALE_REVISION');
  assert.deepEqual((await owner.practiceSnapshot(other.connection)).state, { revision: 0, session: null });
  const otherBattle = await owner.practiceCommand(other.connection, start()), otherStored = await stored(other.characterId);
  await reject(owner.practiceCommand(other.connection, { ...wrong, battleId: after.state.session!.battleId, expectedRevision: otherBattle.state.revision }), 'STALE_REVISION');
  assert.deepEqual(await stored(other.characterId), otherStored); assert.deepEqual(await stored(f.characterId), settled);
  assert.deepEqual(await assets(f.characterId), baseline);
  for (const word of ['privateEngineState', 'rng', 'wildSlot', 'protectPolicy', 'checkpoint', 'afterCritical']) assert(!JSON.stringify(after).includes(`"${word}"`));
  checks.push('accepted-choice-and-hidden-RNG-commit-once', 'old-receipts-never-rewind-newer-turns', 'owner-isolation-and-no-owned-party-bag-wallet-reward-or-location-mutation', 'public-projection-excludes-private-engine-data');

  await owner.suspendTransport(f.connection);
  await reject(owner.practiceCommand(f.connection, close(after)), 'RECONNECT_REQUIRED');
  const resumed = await owner.resumeTransport(f.connection, Date.now() + 30_000);
  owner.activateTransport(resumed.connection);
  assert.deepEqual((await owner.practiceSnapshot(resumed.connection)).state, after.state);
  await reject(owner.practiceCommand(f.connection, close(after)), 'SESSION_REPLACED');
  const taken = await owner.acquire(f.accountId, f.characterId, f.sessionId);
  await reject(owner.practiceCommand(resumed.connection, close(after)), 'SESSION_REPLACED');
  await owner.release(taken.connection);
  assert.deepEqual((await probe(f.accountId, f.characterId)).state, after.state);
  assert.deepEqual(await stored(f.characterId), settled, 'Fresh process cannot reseed or rewrite the checkpoint');
  const fresh = await owner.acquire(f.accountId, f.characterId, f.sessionId);
  assert.deepEqual((await owner.practiceSnapshot(fresh.connection)).state, after.state);
  const finished = await owner.practiceCommand(fresh.connection, close(after));
  assert.equal(finished.state.revision, 3); assert.equal(finished.state.session, null);
  assert.equal(owner.snapshot(fresh.connection)!.character.activity, 'recovering');
  const second = await owner.practiceCommand(fresh.connection, start(3));
  assert.notEqual(second.state.session!.battleId, after.state.session!.battleId);
  await reject(owner.practiceCommand(fresh.connection, { ...close(after), expectedRevision: 4 }), 'STALE_REVISION');
  checks.push('suspended-and-replaced-transports-cannot-advance', 'authenticated-resume-and-fresh-process-recover-exact-state', 'close-retains-global-revision-and-old-battle-commands-stay-fenced');

  await database.pool.query("UPDATE character_practice_state SET checkpoint='{}'::jsonb WHERE character_id=$1", [f.characterId]);
  const unavailable = await owner.practiceSnapshot(fresh.connection); assert(unavailable.state.unavailable); assert.equal(unavailable.state.session, null);
  const recovered = await owner.practiceCommand(fresh.connection, close(unavailable));
  assert.equal(recovered.state.session, null); assert.equal(recovered.state.revision, 5);
  assert.deepEqual(await assets(f.characterId), baseline);
  checks.push('obsolete-or-corrupt-practice-can-be-closed-without-applying-engine-or-asset-effects');

  // Model a real pre-upgrade save with the retained engine, in a dedicated
  // isolated fixture. New runtime must resume its bytes without migrating it.
  const legacyFixture = await fixture(owner), legacyAssets = await assets(legacyFixture.characterId);
  await owner.practiceCommand(legacyFixture.connection, start());
  const current = engine.restore((await stored(legacyFixture.characterId))[0].checkpoint);
  const admission = JSON.parse(Buffer.from(current.snapshot.privateEngineState.data, 'base64').toString('utf8')).admission;
  const legacyEngine = await loadPursuitEngine();
  const legacyInitial = createPursuitDiagnostic({ seed: admission.seed, player: admission.player, opponent: admission.opponent });
  const legacyId = current.snapshot.config.battleId;
  const legacy = { ...current, snapshot: legacyEngine.createBattle(pursuitConfig(legacyEngine, legacyId), legacyInitial, makePursuitRng(legacyId, legacyInitial)) };
  await database.pool.query('UPDATE character_practice_state SET checkpoint=$2 WHERE character_id=$1', [legacyFixture.characterId, JSON.stringify(legacy)]);
  const legacyView = await owner.practiceSnapshot(legacyFixture.connection), legacyStored = await stored(legacyFixture.characterId);
  assert(legacyView.state.session); assert(!legacyView.state.unavailable);
  await owner.release(legacyFixture.connection);
  assert.deepEqual((await probe(legacyFixture.accountId, legacyFixture.characterId)).state, legacyView.state);
  assert.deepEqual(await stored(legacyFixture.characterId), legacyStored, 'Old save bytes are unchanged by fresh-process recovery');
  const legacyJoined = await owner.acquire(legacyFixture.accountId, legacyFixture.characterId, legacyFixture.sessionId);
  const legacyAdvanced = await owner.practiceCommand(legacyJoined.connection, choose(legacyView));
  const legacyNext = (await stored(legacyFixture.characterId))[0].checkpoint;
  assert.deepEqual(legacyNext.snapshot.config.compatibility, legacy.snapshot.config.compatibility);
  assert.equal(legacyNext.snapshot.transitionSequence, 1);
  await owner.practiceCommand(legacyJoined.connection, close(legacyAdvanced));
  assert.deepEqual(await assets(legacyFixture.characterId), legacyAssets);
  checks.push('pre-mirror-pursuit-save-recovers-in-fresh-process-and-advances-with-unchanged-compatibility');

  const savedWorld = await fixture(owner);
  await owner.enterWorld(savedWorld.connection, worldCommand(owner, savedWorld.connection));
  await owner.release(savedWorld.connection);
  const dormant = await owner.acquire(savedWorld.accountId, savedWorld.characterId, savedWorld.sessionId);
  assert.equal(dormant.snapshot.worldActive, false); assert.equal(dormant.snapshot.character.activity, 'overworld');
  const savedLocation = await assets(savedWorld.characterId);
  const fromSaved = await owner.practiceCommand(dormant.connection, start());
  assert(fromSaved.state.session); assert.equal(owner.worldProjection(dormant.connection), null);
  assert.deepEqual(await assets(savedWorld.characterId), savedLocation);
  await owner.practiceCommand(dormant.connection, close(fromSaved));
  checks.push('fresh-login-from-saved-overworld-enters-practice-without-moving-or-joining-world');

  for (const failure of ['rollback', 'unknown-rollback', 'unknown-commit', 'publish'] as const) {
    let armed = false;
    const injected = service({
      beforeCommit: kind => { if (armed && failure === 'rollback' && kind === 'practice') { armed = false; throw new Error('Injected practice rollback'); } },
      commit: async (client, kind) => {
        if (armed && kind === 'practice' && failure.startsWith('unknown')) {
          armed = false; await client.query(failure === 'unknown-commit' ? 'COMMIT' : 'ROLLBACK'); throw new Error('Injected practice commit uncertainty');
        }
        await client.query('COMMIT');
      },
      beforePublish: () => { if (armed && failure === 'publish') { armed = false; throw new Error('Injected practice publication loss'); } },
    });
    const sample = await fixture(injected), original = await assets(sample.characterId);
    let joined = sample.connection;
    const initial = await injected.practiceCommand(joined, start()), action = choose(initial), before = await stored(sample.characterId);
    armed = true;
    let result: PracticeSnapshot;
    if (failure === 'rollback') {
      await reject(injected.practiceCommand(joined, action), 'DATABASE_UNAVAILABLE');
      assert.deepEqual(await stored(sample.characterId), before);
      joined = (await injected.acquire(sample.accountId, sample.characterId, sample.sessionId)).connection;
      result = await injected.practiceCommand(joined, action);
    } else result = await injected.practiceCommand(joined, action);
    assert.equal(result.state.revision, 2);
    assert.equal((await database.pool.query('SELECT count(*) AS n FROM practice_command_receipts WHERE character_id=$1 AND command_id=$2', [sample.characterId, action.commandId])).rows[0].n, '1');
    const once = await stored(sample.characterId);
    assert.deepEqual((await injected.practiceCommand(joined, action)).state, result.state);
    assert.deepEqual(await stored(sample.characterId), once); assert.deepEqual(await assets(sample.characterId), original);
    checks.push(`practice-${failure}-retains-exactly-one-accepted-choice-and-no-asset-effects`);
  }
  const revoked = await fixture(owner), revokedView = await owner.practiceCommand(revoked.connection, start());
  const revokedBefore = await stored(revoked.characterId);
  await database.pool.query('DELETE FROM auth_session WHERE id=$1', [revoked.sessionId]);
  await reject(owner.practiceCommand(revoked.connection, choose(revokedView)), 'AUTH_REQUIRED');
  await reject(owner.practiceSnapshot(revoked.connection), 'AUTH_REQUIRED');
  assert.deepEqual(await stored(revoked.characterId), revokedBefore);
  checks.push('revoked-session-cannot-read-or-advance-practice');
  await writeFile('reports/practice-storage-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed', checks, probePids,
    scope: 'Isolated real PostgreSQL fixtures, source engine, exactly-once commands, failure injection and fresh-process practice recovery. User testing accounts are not accessed.' }, null, 2) + '\n');
  console.log(`Practice storage passed: ${checks.length} groups and ${probePids.length} fresh process.`);
} finally {
  for (const owner of services) await owner.dispose();
  await removeAccountFixtures(database, users); await database.close();
}
