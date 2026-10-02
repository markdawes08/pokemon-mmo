import { readFixtureText, readRetainedBytes } from '../fixtures/io';
/** Verified progression -> private evolution continuation, plus truthful rejection
 * of every currently reachable combat outcome. No account or durable mutation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config, type Route1Choice } from '../battle-route1/engine';
import { loadProgressionCore, type ProgressionDiagnostic } from '../battle-progression/progression';
import { loadEvolutionCore, type EvolutionSession } from './evolution';

const profile = await loadDevelopmentProfile(), retainedProfile = structuredClone(profile);
const progression = await loadProgressionCore(), evolution = await loadEvolutionCore();
const encounters = await loadEncounterCore(), battle = await loadRoute1Engine();
const fixtures = JSON.parse(await readFixtureText('tools/battle-progression/fixtures/source-cases.json')) as {
  cases: { id: string; initial: ProgressionDiagnostic; decisions: { kind: 'replace-move' | 'decline-move'; slot?: number }[];
    checkpoints: { phase: string }[] }[];
};
const checks: string[] = [];
let handoffs = 0, restoredBoundaries = 0, evolutionChoices = 0, moveChoices = 0;
const sourceLevels = new Set<number>();
const context = (nickname = 'SQUIRTLE', evolutionStat = 0) => ({ nickname, language: 2 as const,
  targetDex: { seen: false, caught: false }, evolutionStat, canCancel: true });
function restoreBoundary(session: EvolutionSession): EvolutionSession {
  const checkpoint = session.snapshot(), view = session.view();
  const restored = evolution.restore(checkpoint);
  assert.deepEqual(restored.view(), view);
  assert.deepEqual(restored.snapshot(), checkpoint);
  restoredBoundaries++;
  return restored;
}
function finishMoves(session: EvolutionSession, replace: boolean): EvolutionSession {
  for (let steps = 0; session.view().phase === 'pending-move'; steps++) {
    assert(steps < 32);
    session = restoreBoundary(session);
    const view = session.view(), pending = view.pendingMove;
    assert(pending);
    const before = structuredClone(view.creature.moves);
    session.decide({ expectedSequence: view.sequence, decisionId: pending.decisionId,
      kind: replace ? 'replace-move' : 'decline-move', ...(replace ? { slot: 0 } : {}) });
    const after = session.view().creature.moves;
    if (replace) {
      assert.equal(after[0]!.moveId, pending.moveId);
      assert.equal(after[0]!.ppUps, 0);
      assert(after[0]!.pp > 0);
      assert.deepEqual(after.slice(1), before.slice(1), 'Unselected slots retain depleted PP and PP bonuses');
    } else assert.deepEqual(after, before, 'Declining preserves every old move and PP');
    moveChoices++;
  }
  assert.equal(session.view().phase, 'pending-ownership-application');
  return restoreBoundary(session);
}
function preparedProgression(row: typeof fixtures.cases[number]) {
  const session = progression.createDiagnostic(row.initial);
  for (const decision of row.decisions) {
    const pending = session.view().pendingMove;
    assert(pending);
    session.decide({ ...decision, decisionId: pending.decisionId });
  }
  return session;
}
const pendingRows = fixtures.cases.filter(row => row.checkpoints.at(-1)!.phase === 'pending-evolution');
assert.equal(pendingRows.length, 88, 'Retained progression fixture coverage changed; review the bridge');
for (const [index, row] of pendingRows.entries()) {
  const parent = preparedProgression(row), parentCheckpoint = parent.snapshot(), before = parent.view();
  assert.equal(before.phase, 'pending-evolution');
  sourceLevels.add(before.creature.level);
  for (const accept of [false, true]) {
    const metadata = context(index % 2 ? 'Shell' : 'SQUIRTLE', index % 3 ? 7 : 0xFFFFFF);
    metadata.targetDex = index % 3 ? { seen: true, caught: true } : { seen: false, caught: false };
    let session = evolution.fromProgression(parentCheckpoint, metadata);
    handoffs++;
    const initial = session.view();
    assert.equal(initial.origin.kind, 'progression-diagnostic');
    assert.equal(initial.targetSpecies, 8);
    assert.equal(initial.ownershipApplication, 'pending');
    assert.equal(initial.combatReadmission, 'unsupported');
    assert.deepEqual(initial.inventory, null);
    assert.deepEqual(parent.snapshot(), parentCheckpoint);
    assert.deepEqual(evolution.fromProgression(parentCheckpoint, metadata).snapshot(), session.snapshot());
    session = restoreBoundary(session);
    const choice = { expectedSequence: initial.sequence, decisionId: initial.pendingEvolution!.decisionId,
      kind: accept ? 'accept-evolution' : 'cancel-evolution' };
    session.decide(choice); evolutionChoices++;
    const accepted = session.snapshot();
    assert.throws(() => session.decide(choice));
    assert.deepEqual(session.snapshot(), accepted, 'A repeated evolution decision cannot publish changes');
    session = finishMoves(session, index % 2 === 0);
    const final = session.view(), c = final.creature;
    assert.equal(final.result, accept ? 'evolved' : 'cancelled');
    assert.equal(c.speciesId, accept ? 8 : 7, 'One cleared level-up bit permits only one species transition, even at level 100');
    assert.equal(c.level, before.creature.level);
    assert.equal(c.experience, before.creature.experience);
    assert.equal(c.friendship, before.creature.friendship);
    assert.equal(c.personality, before.creature.personality);
    assert.equal(c.otId, before.creature.otId);
    assert.equal(c.abilityId, 67);
    assert.equal(c.status, before.creature.status);
    assert.equal(c.heldItemId, before.creature.heldItemId);
    assert.deepEqual(c.ivs, before.creature.ivs);
    assert.deepEqual(c.evs, before.creature.evs);
    assert.equal(c.hp, before.creature.hp === 0 ? 0 : before.creature.hp + c.stats.hp - before.creature.stats.hp);
    assert.equal(final.nickname, accept && metadata.nickname === 'SQUIRTLE' ? 'WARTORTLE' : metadata.nickname);
    assert.deepEqual(final.dex.after, accept ? { seen: true, caught: true } : metadata.targetDex);
    assert.equal(final.evolutionStat.after, accept ? Math.min(0xFFFFFF, metadata.evolutionStat + 1) : metadata.evolutionStat);
    assert.deepEqual(parent.snapshot(), parentCheckpoint, 'Evolution never mutates the saved progression checkpoint');
    const output = JSON.stringify(session.project('player'));
    for (const key of ['ivs', 'evs', 'calculatedEvs', 'personality', 'otId', 'words', 'admission', 'origin', 'progressionDigest'])
      assert(!output.includes(`"${key}"`), `Private field ${key} escaped the owner view`);
    assert.throws(() => session.project('other-account'));
    const detached = session.view(); detached.creature.hp = 0;
    assert.deepEqual(session.view(), final);
  }
}
checks.push('all-88-retained-pending-progression-diagnostics-cross-accept-and-cancel-bridges',
  'one-species-step-preserves-identity-xp-ev-friendship-and-missing-hp',
  'explicit-nickname-dex-count-context-and-source-saturation',
  'every-accepted-boundary-restores-without-mutating-parent',
  'stale-decisions-owner-projection-and-detached-views');

// Squirtle learns Bite at 18, Wartortle at 19. An explicit diagnostic that
// previously declined Bite must encounter it again after evolving at level 19.
const targeted = structuredClone(fixtures.cases.find(row => row.id === 'level-18-to-19-exact-threshold')!);
assert(targeted);
const biteSlot = targeted.initial.creature.moves.findIndex(move => move.moveId === 44);
assert(biteSlot >= 0);
targeted.initial.creature.moves[biteSlot] = { moveId: 33, pp: 0, ppUps: 0 };
targeted.initial.creature.moves.forEach(move => { move.pp = 0; });
const targetParent = preparedProgression(targeted), targetCheckpoint = targetParent.snapshot();
assert.equal(targetParent.view().creature.level, 19);
for (const replace of [false, true]) {
  let session = evolution.fromProgression(targetCheckpoint, context()); handoffs++;
  session = restoreBoundary(session);
  const initial = session.view();
  session.decide({ expectedSequence: initial.sequence, decisionId: initial.pendingEvolution!.decisionId, kind: 'accept-evolution' });
  evolutionChoices++;
  assert.equal(session.view().phase, 'pending-move');
  assert.equal(session.view().pendingMove!.moveId, 44);
  session = finishMoves(session, replace);
  assert.equal(session.view().creature.moves.some(move => move.moveId === 44), replace);
  assert.deepEqual(targetParent.snapshot(), targetCheckpoint);
}
checks.push('new-species-current-level-move-replace-and-decline-after-restored-evolution');

const battleView = (state: BattleSnapshot) => battle.project(state, 'player').presentation;
function advance(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  const accepted = battle.validateChoice(state, 'player', choice); assert(accepted.accepted);
  const before = structuredClone(state), result = battle.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []); assert.deepEqual(state, before);
  return result.nextState;
}
const naturalOutcomes: string[] = [];
for (const [label, seed, options, choice] of [
  ['won', 0, {}, { kind: 'move', slot: 0 }],
  ['ran', 0, {}, { kind: 'run' }],
  ['lost', 0, { hp: 1 }, { kind: 'move', slot: 1 }],
  ['draw', 0, { hp: 9, pp: [0, 0], inventory: { potion: 0, pokeBall: 0 } }, { kind: 'struggle' }],
  ['captured', 3, { inventory: { potion: 0, pokeBall: 1 } }, { kind: 'item', itemId: 4 }],
] as const) {
  const field = encounters.create({ mainSeed: seed, wildSeed: 0, trainerId: 1 });
  assert.equal(field.generate().kind, 'encounter');
  const pending = field.snapshot(), initial = await createRoute1Initial(pending, structuredClone(options) as Parameters<typeof createRoute1Initial>[1]);
  const id = `evolution:nonpending:${label}`;
  let state = battle.createBattle(route1Config(battle, id), initial, makeRoute1Rng(id, initial));
  assert.throws(() => progression.fromBattle(state), 'Active combat does not yield an evolution handoff');
  for (let turn = 0; battleView(state).phase !== 'ended'; turn++) {
    assert(turn < 120); state = advance(state, choice);
  }
  assert.equal(battleView(state).outcome, label);
  const terminal = structuredClone(state), parent = progression.fromBattle(state), checkpoint = parent.snapshot();
  assert.notEqual(parent.view().phase, 'pending-evolution');
  assert.throws(() => evolution.fromProgression(checkpoint, context()), 'Actual current combat cannot reach evolution');
  assert.deepEqual(parent.snapshot(), checkpoint); assert.deepEqual(state, terminal); assert.deepEqual(field.snapshot(), pending);
  naturalOutcomes.push(label);
}
assert.deepEqual(naturalOutcomes.sort(), ['captured', 'draw', 'lost', 'ran', 'won']);
checks.push('all-five-natural-combat-outcomes-reject-evolution-without-fabricating-a-levelup',
  'field-battle-rng-inventory-and-terminal-state-remain-unchanged');
for (const badContext of [undefined, { ...context(), canCancel: false }, { ...context(), language: 3 },
  { ...context(), nickname: 'Bad\nName' }, { ...context(), targetDex: { seen: false, caught: true } }]) {
  assert.throws(() => evolution.fromProgression(targetCheckpoint, badContext));
}
assert.throws(() => evolution.fromProgression({ creature: targetParent.view().creature, pendingEvolution: { speciesId: 8 } }, context()));
assert.deepEqual(profile, retainedProfile);
checks.push('missing-unbound-or-unsupported-context-rejected-and-development-fixture-preserved');

const retainedPins = {
  '.local/battle-spike/primary/probe.wasm': '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  '.local/battle-loss/primary/loss.wasm': 'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
  '.local/battle-capture/primary/capture.wasm': '1e6b16390cdaa4906c01b391c30984735a22e998f548e9ff7de44d890865a60b',
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json': '23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  'tools/battle-loss/fixtures/source-cases.json': 'dbfe309e1a8ce56fdf691710858785756f910c3502c926935112632c5d93cd1b',
  'tools/battle-capture/fixtures/source-cases.json': '47a4b1ebf06bfc055a25fd119834f76c4f4243afe6ceddb5ac49c968e37c8c3c',
};
for (const [path, expected] of Object.entries(retainedPins))
  assert.equal(createHash('sha256').update(await readRetainedBytes(path)).digest('hex'), expected, `Retained bytes changed: ${path}`);
checks.push('six-prior-WASM-artifacts-and-1403-retained-literal-cases-byte-identical');
await writeFile('reports/battle-evolution-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Private diagnostic progression/evolution bridge; current real combat explicitly cannot reach evolution. No accounts, database, field acknowledgement or durable grants.',
  checks, retainedProgressionCases: pendingRows.length, handoffs, restoredBoundaries, evolutionChoices, moveChoices,
  resultingLevels: [...sourceLevels].sort((a, b) => a - b), naturalOutcomes, retainedPins,
  compatibility: evolution.compatibility,
  remaining: ['resulting-team/move/ability/switching combat coverage', 'durable battle and evolution outcomes', 'live battle and evolution presentation'],
}, null, 2) + '\n');
console.log(`Evolution integration passed: ${checks.length} groups, ${handoffs} diagnostic handoffs, ${restoredBoundaries} restored boundaries and five rejected natural outcomes.`);
