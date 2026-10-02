import { readFixtureText, readRetainedBytes } from '../fixtures/io';
/** Actual encounter -> battle -> source loss continuation, with a pending world
 * handoff only. Never logs into an account or writes field/character state. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { WorldContent } from '../../apps/server/src/world-content';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config,
  route1CheckpointSchema, type Route1Choice } from '../battle-route1/engine';
import { loadProgressionCore } from '../battle-progression/progression';
import { loadLossCore, lossCheckpointDigest, type LossCheckpoint } from './loss';

const profile = await loadDevelopmentProfile(), originalProfile = structuredClone(profile);
const encounters = await loadEncounterCore(), battle = await loadRoute1Engine();
const progression = await loadProgressionCore(), loss = await loadLossCore();
const checks: string[] = [];
const fixtures = JSON.parse(await readFixtureText('tools/encounter-core/fixtures/source-cases.json')) as {
  factoryCases: { initial: { mainSeed: number; wildSeed: number; trainerId: number }; expected: { slot: number } }[];
};
const selected = new Map(fixtures.factoryCases.map(row => [row.expected.slot, row.initial]));
assert.equal(selected.size, 12);
const view = (state: BattleSnapshot) => battle.project(state, 'player').presentation;
const raw = (state: BattleSnapshot) => route1CheckpointSchema.parse(
  JSON.parse(Buffer.from(state.privateEngineState.data, 'base64').toString('utf8')));
async function create(seeds: { mainSeed: number; wildSeed: number; trainerId: number }, label: string,
  options: Parameters<typeof createRoute1Initial>[1] = {}) {
  const field = encounters.create(seeds), generated = field.generate();
  assert.equal(generated.kind, 'encounter');
  if (generated.kind !== 'encounter') throw new Error('Expected source encounter');
  const pending = field.snapshot(), initial = await createRoute1Initial(pending, options), id = `loss:bridge:${label}`;
  return { field, pending, creature: generated.creature,
    state: battle.createBattle(route1Config(battle, id), initial, makeRoute1Rng(id, initial)) };
}
function advance(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  const accepted = battle.validateChoice(state, 'player', choice); assert(accepted.accepted);
  const before = structuredClone(state), result = battle.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []); assert.deepEqual(state, before);
  return result.nextState;
}
function finish(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  for (let turn = 0; view(state).phase !== 'ended'; turn++) {
    assert(turn < 120, 'Bounded battle did not terminate');
    state = advance(state, choice);
  }
  return state;
}

let terminalHandoffs = 0, stageRestores = 0;
function verifyTerminal(terminal: BattleSnapshot, money = 3000): LossCheckpoint {
  const before = structuredClone(terminal), context = loss.developmentContext({ money });
  const pending = progression.fromBattle(terminal), pendingBefore = pending.snapshot();
  const session = loss.fromBattle(terminal, context), indirect = loss.fromProgression(pendingBefore, context);
  assert.deepEqual(session.view(), indirect.view());
  const start = session.snapshot();
  assert.deepEqual(loss.fromBattle(terminal, context).snapshot(), start);
  const beforeCreature = pending.view().creature, combat = view(terminal), combatWords = raw(terminal).core.words;
  assert.equal(beforeCreature.hp, 0);
  assert.equal(beforeCreature.friendship, 70);
  for (const sequence of [0, 1, 2] as const) {
    const result = session.view(), snapshot = session.snapshot(), applied = sequence === 2;
    assert.equal(result.sequence, sequence);
    assert.equal(result.phase, ['ready', 'faint-applied', 'pending-world-application'][sequence]);
    assert.deepEqual(result.money, { before: money, previewLoss: Math.min(money, 40),
      loss: applied ? Math.min(money, 40) : 0, after: applied ? Math.max(money - 40, 0) : money });
    assert.deepEqual(result.friendship, { before: 70, loss: sequence ? 1 : 0, after: sequence ? 69 : 70 });
    assert.deepEqual(result.creature, { ...beforeCreature, hp: applied ? 20 : 0, friendship: sequence ? 69 : 70,
      moves: beforeCreature.moves.map((move, slot) => ({ ...move, pp: applied ? [35, 30, 0, 0][slot] : combatWords[42 + slot] })) });
    assert.equal(result.creature.experience, 135);
    assert.deepEqual(result.creature.stats, profile.creature.stats);
    assert.deepEqual(result.creature.evs, profile.creature.evs);
    assert.deepEqual(result.inventory, combat.inventory);
    assert.equal(result.context.money, result.money.after);
    assert.equal(result.worldApplication, 'pending'); assert.equal(result.combatReadmission, 'unsupported');
    assert(result.origin.kind === 'battle-terminal');
    assert.equal(result.origin.battleId, terminal.config.battleId);
    assert.equal(result.origin.terminalSequence, terminal.transitionSequence);
    assert.equal(result.origin.outcome, combat.outcome);
    assert.match(result.origin.terminalDigest, /^[a-f0-9]{64}$/);
    if (applied) {
      assert.deepEqual(result.respawn, { mapGroup: 4, mapNum: 0, warpId: -1, x: 8, y: 5,
        healerLocalId: 1, script: 'EventScript_AfterWhiteOutMomHeal', messageVariant: null });
      assert(result.fieldChanges);
      assert.equal(result.fieldChanges.clearFlags.length, 11);
      assert.equal(result.fieldChanges.clearTrainerFlags.length, 6);
      assert.equal(result.fieldChanges.setVariables.length, 4);
      assert(result.fieldChanges.setVariables.every(entry => entry.value === 0));
      assert.deepEqual(result.fieldChanges.avatar, { flags: 1, direction: 2, hasDirection: true });
    } else { assert.equal(result.respawn, null); assert.equal(result.fieldChanges, null); }
    assert.deepEqual(loss.restore(snapshot).snapshot(), snapshot);
    assert.deepEqual(loss.restore(snapshot).view(), result); stageRestores++;
    assert.deepEqual(indirect.view(), result, 'Both bridge entries execute identical mechanics');
    const detached = session.snapshot(); detached.words[0] ^= 1;
    const detachedView = session.view(); detachedView.creature.hp = 65535;
    assert.deepEqual(session.snapshot(), snapshot); assert.deepEqual(session.view(), result);
    assert.throws(() => session.advance({ expectedSequence: sequence === 0 ? 1 : 0 }));
    assert.throws(() => session.advance({ expectedSequence: sequence, ignored: true }));
    assert.deepEqual(session.snapshot(), snapshot, 'Rejected stage is atomic');
    const projected = session.project();
    assert.throws(() => session.project('wild')); assert.throws(() => session.project('other-account'));
    for (const key of ['ivs', 'evs', 'calculatedEvs', 'personality', 'otId', 'rng', 'words', 'admission', 'origin', 'context'])
      assert(!JSON.stringify(projected).includes(`"${key}"`), `Private ${key} escaped projection`);
    if (sequence < 2) {
      session.advance({ expectedSequence: sequence }); indirect.advance({ expectedSequence: sequence });
      assert.throws(() => session.advance({ expectedSequence: sequence }));
    } else {
      for (const expectedSequence of [0, 1, 2]) assert.throws(() => session.advance({ expectedSequence }));
      assert.deepEqual(session.snapshot(), snapshot, 'Completed loss cannot double debit');
    }
  }
  assert.deepEqual(terminal, before); assert.deepEqual(pending.snapshot(), pendingBefore);
  terminalHandoffs++;
  return start;
}

const naturalLosses: { slot: number; speciesId: number; level: number; turns: number }[] = [];
let lost: BattleSnapshot | undefined;
for (const [slot, seeds] of [...selected].sort((a, b) => a[0] - b[0])) {
  const trial = await create({ ...seeds, trainerId: 1 }, `slot-${slot}`, { hp: 1 });
  assert.throws(() => loss.fromBattle(trial.state, loss.developmentContext()));
  const terminal = finish(trial.state, { kind: 'move', slot: 1 });
  assert.equal(view(terminal).outcome, 'lost'); verifyTerminal(terminal);
  assert.deepEqual(trial.field.snapshot(), trial.pending, 'Loss cannot acknowledge original field encounter');
  naturalLosses.push({ slot, speciesId: trial.creature.speciesId, level: trial.creature.level, turns: terminal.transitionSequence });
  lost = terminal;
}
assert(lost);
checks.push('all-twelve-natural-slot-losses-faint-heal-debit-and-home-handoff', 'direct-and-pending-progression-bridge-equivalence',
  'stage-replay-owner-projection-detached-state-and-duplicate-stage-atomicity');
const seeds = { mainSeed: 0, wildSeed: 0, trainerId: 1 };
const drawTrial = await create(seeds, 'draw', { hp: 9, pp: [0, 0], inventory: { potion: 0, pokeBall: 0 } });
const draw = finish(drawTrial.state, { kind: 'struggle' });
assert.equal(view(draw).outcome, 'draw'); assert.equal(draw.transitionSequence, 3);
verifyTerminal(draw); assert.deepEqual(drawTrial.field.snapshot(), drawTrial.pending);
checks.push('natural-three-turn-struggle-draw-follows-source-defeat-routing');
for (const money of [0, 1, 39, 40, 41, 3000]) verifyTerminal(lost, money);
checks.push('depleted-wallet-is-retained-and-debited-only-once-with-source-clamp');
const itemTrial = await create(seeds, 'spent-potion', { hp: 1, inventory: { potion: 1, pokeBall: 0 } });
const itemTerminal = finish(advance(itemTrial.state, { kind: 'item', itemId: 13 }), { kind: 'move', slot: 1 });
assert.equal(view(itemTerminal).outcome, 'lost'); assert.deepEqual(view(itemTerminal).inventory, { potion: 0, pokeBall: 0 });
verifyTerminal(itemTerminal); assert.deepEqual(itemTrial.field.snapshot(), itemTrial.pending);
checks.push('source-healing-restores-pp-and-hp-without-refilling-bag-or-changing-xp-evs');

const rejectedOutcomes: string[] = [];
for (const [label, choice] of [['won', { kind: 'move', slot: 0 }], ['ran', { kind: 'run' }]] as const) {
  const trial = await create(seeds, label), terminal = finish(trial.state, choice);
  assert.equal(view(terminal).outcome, label);
  assert.throws(() => loss.fromBattle(terminal, loss.developmentContext()));
  assert.throws(() => loss.fromProgression(progression.fromBattle(terminal).snapshot(), loss.developmentContext()));
  rejectedOutcomes.push(label);
}
let captureSeed: number | null = null;
for (let seed = 0; seed < 192; seed++) {
  const trial = await create({ ...seeds, mainSeed: seed }, `capture-${seed}`, { inventory: { potion: 0, pokeBall: 1 } });
  const terminal = advance(trial.state, { kind: 'item', itemId: 4 });
  if (view(terminal).outcome !== 'captured') continue;
  assert.throws(() => loss.fromBattle(terminal, loss.developmentContext()));
  assert.throws(() => loss.fromProgression(progression.fromBattle(terminal).snapshot(), loss.developmentContext()));
  rejectedOutcomes.push('captured'); captureSeed = seed; break;
}
assert.notEqual(captureSeed, null);
checks.push('actual-active-won-ran-and-captured-battles-rejected');

for (const money of [-1, 3001, 1.5]) assert.throws(() => loss.developmentContext({ money }));
assert.throws(() => loss.developmentContext({ money: 40, badgeMask: 0 }));
assert.throws(() => loss.fromBattle(lost, undefined));
for (const override of [{ lastHealId: 2 }, { badgeMask: 1 }, { trainerTowerScene: 1 }, { fieldFlagMask: 4 }, { unknown: true }])
  assert.throws(() => loss.fromBattle(lost, { ...loss.developmentContext(), ...override }));
const bound = loss.fromBattle(lost, loss.developmentContext()).snapshot();
function rehash(checkpoint: LossCheckpoint): LossCheckpoint {
  const { digest: _digest, ...body } = checkpoint; checkpoint.digest = lossCheckpointDigest(body); return checkpoint;
}
for (const change of [
  (checkpoint: LossCheckpoint) => { checkpoint.compatibility.wasmSha256 = '0'.repeat(64); },
  (checkpoint: LossCheckpoint) => { checkpoint.words[0] ^= 1; },
  (checkpoint: LossCheckpoint) => { checkpoint.words[95] ^= 1; },
  (checkpoint: LossCheckpoint) => { checkpoint.sequence = 2; },
  (checkpoint: LossCheckpoint) => {
    assert(checkpoint.admission.kind === 'battle-terminal'); checkpoint.admission.context.money = 0;
  },
  (checkpoint: LossCheckpoint) => {
    assert(checkpoint.admission.kind === 'battle-terminal'); checkpoint.admission.battle.rng.draws++;
  },
]) {
  const invalid = structuredClone(bound); change(invalid);
  assert.throws(() => loss.restore(rehash(invalid)), 'Replay rejects semantic corruption with a recomputed digest');
}
const invalidProgression = progression.fromBattle(lost).snapshot(); invalidProgression.digest = '0'.repeat(64);
assert.throws(() => loss.fromProgression(invalidProgression, loss.developmentContext()));
checks.push('explicit-development-context-and-semantic-checkpoint-guards');

const world = await WorldContent.load();
const location = world.validateLocation({ mapId: 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', x: 8, y: 5, elevation: 3 });
const house = world.maps[location.mapId]!;
assert(house.events.objects.some(object => object.visible && object.localId === 1 && object.x === 8 && object.y === 4));
assert(!house.events.triggers.some(trigger => trigger.x === 8 && trigger.y === 5));
assert.deepEqual(profile, originalProfile);
checks.push('pinned-home-target-is-safe-and-faces-source-mom-without-applying-world-state', 'canonical-fixture-preserved');
const retained = {
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json': '23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-spike/primary/probe.wasm': '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
};
for (const [path, expected] of Object.entries(retained))
  assert.equal(createHash('sha256').update(await readRetainedBytes(path)).digest('hex'), expected, path);
checks.push('all-four-previous-wasm-modules-and-retained-combat-progression-fixtures-byte-identical');
await writeFile('reports/battle-loss-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Private source encounter/battle/loss continuation only; field activity, accounts and world remain untouched',
  checks, naturalLosses, naturalDrawTurns: draw.transitionSequence, terminalHandoffs, stageRestores, captureSeed, rejectedOutcomes,
  safeSourceHome: location, lossCompatibility: loss.compatibility, battleCompatibility: battle.compatibility,
  remaining: ['durable blackout application and arrival scripts', 'owned capture', 'evolution completion',
    'broader combat closure', 'durable battle activity and outcomes', 'live battle UI'] }, null, 2) + '\n');
console.log(`Loss integration passed: ${checks.length} groups, ${naturalLosses.length} natural slot losses, ${terminalHandoffs} handoffs, ${stageRestores} stage restores.`);
