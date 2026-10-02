import { readRetainedBytes } from '../fixtures/io';
/** Actual source encounter/combat -> private capture continuation. Coverage
 * seeds select natural outcomes; independent literals verify source mechanics.
 * No account login, durable grant, field acknowledgement or database mutation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config, route1CheckpointSchema,
  type Route1Choice } from '../battle-route1/engine';
import { loadProgressionCore } from '../battle-progression/progression';
import { loadCaptureCore, captureCheckpointDigest, type CaptureCheckpoint, type CaptureCreature, type CaptureView } from './capture';

const profile = await loadDevelopmentProfile(), originalProfile = structuredClone(profile);
const encounters = await loadEncounterCore(), battle = await loadRoute1Engine();
const progression = await loadProgressionCore(), capture = await loadCaptureCore();
const checks: string[] = [];
const view = (state: BattleSnapshot) => battle.project(state, 'player').presentation;
const raw = (state: BattleSnapshot) => route1CheckpointSchema.parse(
  JSON.parse(Buffer.from(state.privateEngineState.data, 'base64').toString('utf8')));
async function create(seed: number, label: string, options: Parameters<typeof createRoute1Initial>[1] = {}) {
  const field = encounters.create({ mainSeed: seed, wildSeed: 0, trainerId: 1 }), generated = field.generate();
  assert(generated.kind === 'encounter');
  const pending = field.snapshot(), initial = await createRoute1Initial(pending, options), id = `capture:bridge:${label}`;
  return { field, pending, creature: generated.creature,
    state: battle.createBattle(route1Config(battle, id), initial, makeRoute1Rng(id, initial)) };
}
function advance(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  const accepted = battle.validateChoice(state, 'player', choice); assert(accepted.accepted);
  const original = structuredClone(state), result = battle.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []); assert.deepEqual(state, original);
  return result.nextState;
}
function finish(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  for (let turn = 0; view(state).phase !== 'ended'; turn++) {
    assert(turn < 120, 'Bounded source battle did not terminate'); state = advance(state, choice);
  }
  return state;
}
function caughtCreature(terminal: BattleSnapshot): CaptureCreature {
  const descriptor = raw(terminal).capture; assert(descriptor);
  const { slot: _slot, ...creature } = descriptor.creature; return creature;
}
const context = (trainerGender: 0 | 1 = 0) => capture.developmentContext({ trainerName: trainerGender ? 'LEAF' : 'RED', trainerGender });
const comparable = (result: CaptureView) => ({ ...result,
  pendingNickname: result.pendingNickname ? { ...result.pendingNickname, decisionId: '<bound-to-own-admission>' } : null });
let terminalHandoffs = 0, stageRestores = 0;
function verifyTerminal(terminal: BattleSnapshot, name: string | null, supplied = context()): CaptureCheckpoint {
  const before = structuredClone(terminal), c = caughtCreature(terminal), speciesName = c.speciesId === 16 ? 'PIDGEY' : 'RATTATA';
  const originalContext = structuredClone(supplied), pending = progression.fromBattle(terminal), pendingBefore = pending.snapshot();
  const session = capture.fromBattle(terminal, supplied), indirect = capture.fromProgression(pendingBefore, supplied);
  const start = session.snapshot();
  assert.deepEqual(capture.fromBattle(terminal, supplied).snapshot(), start);
  const finalName = name === null || [...name].every(character => character === ' ') ? speciesName : name;
  for (const sequence of [0, 1, 2, 3] as const) {
    const result = session.view(), snapshot = session.snapshot();
    assert.equal(result.sequence, sequence);
    assert.equal(result.phase, ['ready', 'pending-nickname', 'nickname-applied', 'pending-ownership-application'][sequence]);
    assert.deepEqual(result.creature, c, 'Party capture preserves exact identity, HP, PP, XP, EVs and cached stats');
    assert.deepEqual(result.metadata, { nickname: sequence >= 2 ? finalName : speciesName, otName: supplied.trainerName,
      otGender: supplied.trainerGender, language: 2, metGame: 4, metLevel: c.level, metLocation: 101, ballItemId: 4 });
    assert.deepEqual(result.dex, { before: supplied.dex, after: sequence ? { seen: true, caught: true } : supplied.dex,
      newEntry: sequence > 0 && !supplied.dex.caught });
    assert.deepEqual(result.captureStat, { before: supplied.captureStat,
      after: sequence ? Math.min(supplied.captureStat + 1, 0xFFFFFF) : supplied.captureStat });
    assert.deepEqual(result.inventory, view(terminal).inventory);
    assert.equal(result.ownershipApplication, 'pending'); assert.equal(result.combatReadmission, 'unsupported');
    assert.deepEqual(result.storage, { partyMask: sequence === 3 ? 3 : 1, partyCount: sequence === 3 ? 2 : 1,
      boxMasks: Array<number>(14).fill(0), currentBox: supplied.currentBox, lastSentBox: supplied.lastSentBox,
      shownBoxWasFullMessage: supplied.shownBoxWasFullMessage, knowsBill: supplied.knowsBill, message: null });
    if (sequence === 3) assert.deepEqual(result.placement, { kind: 'party', slot: 1, creature: c, metadata: result.metadata });
    else assert.equal(result.placement, null);
    if (sequence === 1) { assert(result.pendingNickname); assert.match(result.pendingNickname.decisionId, /^[a-f0-9]{64}$/); }
    else assert.equal(result.pendingNickname, null);
    assert(result.origin.kind === 'battle-terminal');
    assert.equal(result.origin.battleId, terminal.config.battleId); assert.equal(result.origin.terminalSequence, terminal.transitionSequence);
    assert.equal(result.origin.outcome, 'captured'); assert.match(result.origin.terminalDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(capture.restore(snapshot).snapshot(), snapshot); assert.deepEqual(capture.restore(snapshot).view(), result); stageRestores++;
    assert.deepEqual(comparable(indirect.view()), comparable(result));
    const detached = session.snapshot(); detached.words[0] ^= 1;
    const detachedView = session.view(); detachedView.metadata.nickname = 'ALTERED';
    assert.deepEqual(session.snapshot(), snapshot); assert.deepEqual(session.view(), result);
    assert.throws(() => session.advance({ expectedSequence: sequence === 0 ? 2 : 0 }));
    assert.throws(() => session.advance({ expectedSequence: sequence, unknown: true }));
    assert.deepEqual(session.snapshot(), snapshot, 'Rejected stage cannot publish partial effects');
    const projected = session.project(); assert.throws(() => session.project('wild')); assert.throws(() => session.project('other-account'));
    for (const key of ['ivs', 'evs', 'personality', 'otId', 'otName', 'rng', 'words', 'admission', 'origin', 'storage', 'context'])
      assert(!JSON.stringify(projected).includes(`"${key}"`), `Private ${key} escaped owner projection`);
    if (sequence === 0 || sequence === 2) {
      session.advance({ expectedSequence: sequence }); indirect.advance({ expectedSequence: sequence });
      assert.throws(() => session.advance({ expectedSequence: sequence }));
    } else if (sequence === 1) {
      const decision = { expectedSequence: 1, decisionId: result.pendingNickname!.decisionId,
        ...(name === null ? { kind: 'keep-species-name' } : { kind: 'nickname', name }) };
      for (const invalid of [{ ...decision, decisionId: '0'.repeat(64) }, { ...decision, expectedSequence: 0 },
        { ...decision, unknown: true }, { ...decision, kind: 'nickname', name: 'ABCDEFGHIJK' },
        { ...decision, kind: 'nickname', name: '👾' }, { ...decision, kind: 'nickname', name: 'bad\nname' }]) {
        assert.throws(() => session.decideNickname(invalid)); assert.deepEqual(session.snapshot(), snapshot);
      }
      assert.throws(() => indirect.decideNickname(decision), 'Decision identity binds its original admission');
      session.decideNickname(decision);
      indirect.decideNickname({ ...decision, decisionId: indirect.view().pendingNickname!.decisionId });
      assert.throws(() => session.decideNickname(decision));
    } else {
      assert.throws(() => session.advance({ expectedSequence: 2 }));
      assert.throws(() => session.decideNickname({ expectedSequence: 1, decisionId: '0'.repeat(64), kind: 'keep-species-name' }));
      assert.deepEqual(session.snapshot(), snapshot, 'Completed capture cannot allocate a second candidate');
    }
  }
  assert.deepEqual(terminal, before); assert.deepEqual(pending.snapshot(), pendingBefore); assert.deepEqual(supplied, originalContext);
  terminalHandoffs++; return start;
}

const seeds = [3, 14, 11, 29, 47, 33, 26, 75, 130, 92, 450, 116];
const naturalCaptures: { slot: number; seed: number; speciesId: number; level: number }[] = [];
let captured: BattleSnapshot | undefined;
for (const [slot, seed] of seeds.entries()) {
  const trial = await create(seed, `slot-${slot}`, { inventory: { potion: 0, pokeBall: 1 } });
  assert.equal(trial.creature.slot, slot, 'Coverage seed must still select this real source slot');
  assert.throws(() => capture.fromBattle(trial.state, context()));
  const terminal = advance(trial.state, { kind: 'item', itemId: 4 }); assert.equal(view(terminal).outcome, 'captured');
  verifyTerminal(terminal, slot % 2 ? null : `BIRD${slot}`, context(slot % 2 ? 1 : 0));
  assert.deepEqual(trial.field.snapshot(), trial.pending, 'Capture cannot release the pending field encounter');
  naturalCaptures.push({ slot, seed, speciesId: trial.creature.speciesId, level: trial.creature.level }); captured = terminal;
}
assert(captured);
checks.push('all-twelve-natural-source-slot-captures-receive-bound-metadata-and-party-placement',
  'direct-and-progression-handoff-equivalence-with-distinct-bound-decision-identities',
  'every-stage-recovery-detached-projections-and-stale-decision-atomicity');
for (const name of ['', '   ', '  Sky  ', 'ABCDEFGHIJ']) verifyTerminal(captured, name);
for (const dex of [{ seen: true, caught: false }, { seen: true, caught: true }])
  for (const captureStat of [7, 0xFFFFFE, 0xFFFFFF]) verifyTerminal(captured, null,
    capture.developmentContext({ trainerName: 'LEAF', trainerGender: 1, dex, captureStat, currentBox: 13, lastSentBox: 7,
      shownBoxWasFullMessage: true, knowsBill: true }));
checks.push('source-blank-and-padded-nicknames-and-maximum-length', 'already-seen-caught-and-saturated-stat-contexts');

let spentCapture: BattleSnapshot | undefined, spentSeed: number | null = null;
for (let seed = 0; seed < 192; seed++) {
  const trial = await create(seed, `spent-${seed}`, { hp: 1, inventory: { potion: 1, pokeBall: 3 } });
  let state = advance(trial.state, { kind: 'item', itemId: 13 });
  if (view(state).phase === 'ended') continue;
  state = advance(state, { kind: 'move', slot: 0 });
  while (view(state).phase !== 'ended' && view(state).inventory.pokeBall > 0)
    state = advance(state, { kind: 'item', itemId: 4 });
  if (view(state).outcome !== 'captured') continue;
  const caught = caughtCreature(state);
  if (caught.hp >= caught.stats.hp || !caught.moves.some(move => move.moveId && move.pp < profile.definitions.moves.find(row => row.id === move.moveId)!.pp)) continue;
  assert.equal(view(state).inventory.potion, 0); assert(view(state).inventory.pokeBall < 3);
  verifyTerminal(state, 'TIRED'); assert.deepEqual(trial.field.snapshot(), trial.pending);
  spentCapture = state; spentSeed = seed; break;
}
assert(spentCapture); assert.notEqual(spentSeed, null);
checks.push('damaged-wild-with-spent-pp-and-potion-ball-costs-crosses-party-boundary-unchanged');

// Storage is deliberately a diagnostic branch: the actual battle has no bench.
const { policy: _policy, ...diagnosticContext } = context();
const boxMasks = Array<number>(14).fill(0x3FFFFFFF); boxMasks[0] = 0x1FFFFFFF;
const boxed = capture.createDiagnostic({ creature: caughtCreature(spentCapture), context: { ...diagnosticContext,
  partyMask: 63, boxMasks, currentBox: 13, lastSentBox: 13 } });
boxed.advance({ expectedSequence: 0 });
boxed.decideNickname({ expectedSequence: 1, decisionId: boxed.view().pendingNickname!.decisionId, kind: 'keep-species-name' });
boxed.advance({ expectedSequence: 2 });
const boxedView = boxed.view(); assert.equal(boxedView.creature, null); assert(boxedView.placement?.kind === 'box');
assert.equal(boxedView.placement.box, 0); assert.equal(boxedView.placement.slot, 29);
for (const key of ['hp', 'status', 'stats', 'level']) assert(!(key in boxedView.placement.boxedCreature));
for (const move of boxedView.placement.boxedCreature.moves)
  assert.equal(move.pp, move.moveId ? profile.definitions.moves.find(row => row.id === move.moveId)!.pp : 0);
assert.deepEqual(capture.restore(boxed.snapshot()).view(), boxedView);
assert.throws(() => capture.createDiagnostic({ creature: caughtCreature(spentCapture), context: { ...diagnosticContext,
  partyMask: 63, boxMasks: Array<number>(14).fill(0x3FFFFFFF) } }));
assert.throws(() => capture.fromBattle(spentCapture, { ...context(), partyMask: 63, boxMasks }));
checks.push('actual-capture-data-exercises-explicit-diagnostic-pc-wrap-pp-restoration-and-full-capacity-guard');

const rejectedOutcomes: string[] = [];
for (const [label, options, choice] of [
  ['won', {}, { kind: 'move', slot: 0 }], ['ran', {}, { kind: 'run' }],
  ['lost', { hp: 1 }, { kind: 'move', slot: 1 }],
  ['draw', { hp: 9, pp: [0, 0], inventory: { potion: 0, pokeBall: 0 } }, { kind: 'struggle' }],
] as const) {
  const trial = await create(0, label, structuredClone(options) as Parameters<typeof createRoute1Initial>[1]);
  const terminal = finish(trial.state, choice); assert.equal(view(terminal).outcome, label);
  assert.throws(() => capture.fromBattle(terminal, context()));
  assert.throws(() => capture.fromProgression(progression.fromBattle(terminal).snapshot(), context()));
  rejectedOutcomes.push(label);
}
assert.throws(() => capture.fromBattle(captured, undefined));
assert.throws(() => capture.fromBattle(raw(captured).capture, context()));
for (const supplied of [{ trainerName: 'RED' }, { trainerName: '', trainerGender: 0 }, { trainerName: 'TOOLONG8', trainerGender: 0 },
  { trainerName: 'RED', trainerGender: 2 }, { trainerName: 'RED', trainerGender: 0, metLocation: 101 }])
  assert.throws(() => capture.developmentContext(supplied));
for (const override of [{ trainerId: 2 }, { partyMask: 3 }, { metLocation: 101 }, { unknown: true }])
  assert.throws(() => capture.fromBattle(captured, { ...context(), ...override }));
checks.push('active-and-all-noncapture-outcomes-and-unbound-descriptors-rejected', 'explicit-source-context-and-text-guards');

const pendingName = capture.fromBattle(captured, context()); pendingName.advance({ expectedSequence: 0 });
const bound = pendingName.snapshot();
function rehash(checkpoint: CaptureCheckpoint) {
  const { digest: _digest, ...body } = checkpoint; checkpoint.digest = captureCheckpointDigest(body); return checkpoint;
}
for (const change of [
  (checkpoint: CaptureCheckpoint) => { checkpoint.compatibility.codecSha256 = '0'.repeat(64); },
  (checkpoint: CaptureCheckpoint) => { checkpoint.words[0] ^= 1; },
  (checkpoint: CaptureCheckpoint) => { checkpoint.words[159] ^= 1; },
  (checkpoint: CaptureCheckpoint) => { checkpoint.sequence = 3; },
  (checkpoint: CaptureCheckpoint) => {
    assert(checkpoint.admission.kind === 'battle-terminal'); checkpoint.admission.context.trainerName = 'ALTER';
  },
  (checkpoint: CaptureCheckpoint) => {
    assert(checkpoint.admission.kind === 'battle-terminal'); checkpoint.admission.battle.rng.draws++;
  },
]) { const invalid = structuredClone(bound); change(invalid); assert.throws(() => capture.restore(rehash(invalid))); }
const corrupted = progression.fromBattle(captured).snapshot(); corrupted.digest = '0'.repeat(64);
assert.throws(() => capture.fromProgression(corrupted, context()));
assert.deepEqual(profile, originalProfile);
checks.push('semantic-replay-rejects-rehashed-context-state-and-terminal-corruption', 'canonical-fixture-and-player-terminal-preserved');
const retained = {
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json': '23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  'tools/battle-loss/fixtures/source-cases.json': 'dbfe309e1a8ce56fdf691710858785756f910c3502c926935112632c5d93cd1b',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-spike/primary/probe.wasm': '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  '.local/battle-loss/primary/loss.wasm': 'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
};
for (const [path, expected] of Object.entries(retained))
  assert.equal(createHash('sha256').update(await readRetainedBytes(path)).digest('hex'), expected, path);
checks.push('all-five-prior-wasm-modules-and757-retained-literal-fixtures-byte-identical');
await writeFile('reports/battle-capture-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Private source encounter/combat/capture proposals; no account ownership, world activity or database mutation',
  checks, naturalCaptures, terminalHandoffs, stageRestores, spentSeed, rejectedOutcomes,
  diagnosticPcDestination: { box: boxedView.placement.box, slot: boxedView.placement.slot },
  captureCompatibility: capture.compatibility, battleCompatibility: battle.compatibility,
  remaining: ['durable capture metadata/dex/storage activity and atomic ownership grant', 'evolution completion',
    'resulting-team combat coverage', 'durable blackout and arrival scripts', 'durable battle outcomes and live UI'] }, null, 2)+'\n');
console.log(`Capture integration passed: ${checks.length} groups, ${naturalCaptures.length} natural slot captures, ${terminalHandoffs} handoffs, ${stageRestores} stage restores.`);
