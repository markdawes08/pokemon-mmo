import { readFixtureText, readRetainedBytes } from '../fixtures/io';
/** Private source-result -> family combat diagnostics. No field acknowledgement,
 * account access, ownership grant, live entry or database mutation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config, type Route1Choice } from '../battle-route1/engine';
import { loadProgressionCore, type ProgressionDiagnostic } from '../battle-progression/progression';
import { loadCaptureCore, type CaptureSession } from '../battle-capture/capture';
import { loadEvolutionCore } from '../battle-evolution/evolution';
import { diagnostic, type Fixtures as EvolutionFixtures } from '../battle-evolution/verify-support';
import { createFamilyDiagnostic, createFamilyDiagnosticFromResult, loadFamilyResources, prepareFamily,
  type FamilyCreature, type FamilyResult } from './admission';
import { familyConfig, loadFamilyEngine, makeFamilyRng, type FamilyChoice } from './engine';

const profile = await loadDevelopmentProfile(), retainedProfile = structuredClone(profile);
const encounters = await loadEncounterCore(), battle = await loadRoute1Engine(), family = await loadFamilyEngine();
const progression = await loadProgressionCore(), capture = await loadCaptureCore(), evolution = await loadEvolutionCore();
const resources = await loadFamilyResources(), checks: string[] = [];
let handoffs = 0, restoredBoundaries = 0, diagnosticTurns = 0;
const resultingSpecies = new Set<number>();
const oldView = (state: BattleSnapshot) => battle.project(state, 'player').presentation;
function oldAdvance(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  const accepted = battle.validateChoice(state, 'player', choice); assert(accepted.accepted);
  const before = structuredClone(state), result = battle.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []); assert.deepEqual(state, before); return result.nextState;
}
function finish(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  for (let turn = 0; oldView(state).phase !== 'ended'; turn++) {
    assert(turn < 120); state = oldAdvance(state, choice);
  }
  return state;
}
async function trial(seed: number, name: string, options: Parameters<typeof createRoute1Initial>[1] = {}) {
  const field = encounters.create({ mainSeed: seed, wildSeed: 0, trainerId: 1 });
  const generated = field.generate(); assert(generated.kind === 'encounter');
  const pending = field.snapshot(), initial = await createRoute1Initial(pending, options), id = `family:parent:${name}`;
  return { field, pending, creature: generated.creature,
    state: battle.createBattle(route1Config(battle, id), initial, makeRoute1Rng(id, initial)) };
}
const next = encounters.create({ mainSeed: 0, wildSeed: 0, trainerId: 1 });
assert.equal(next.generate().kind, 'encounter'); const nextPending = next.snapshot();
async function bridge(result: FamilyResult, expected: { creature: Pick<FamilyCreature, 'speciesId' | 'hp' | 'moves' | 'stats' | 'experience' | 'evs'>;
  inventory: { potion: number; pokeBall: number } | null; diagnosticSource: boolean }) {
  const retainedResult = structuredClone(result), retainedEncounter = structuredClone(nextPending);
  const initial = await createFamilyDiagnosticFromResult(result, nextPending), prepared = prepareFamily(resources, initial);
  const mon = prepared.mons[0]; resultingSpecies.add(mon.speciesId);
  for (const key of ['speciesId', 'hp', 'moves', 'stats', 'experience', 'evs'] as const)
    assert.deepEqual(mon[key], expected.creature[key], `Result ${key} must survive admission without healing or recalculation`);
  assert.deepEqual(prepared.context.inventory, expected.inventory);
  assert.equal(prepared.context.liveAdmission, false);
  assert.deepEqual(prepared.context.origin, { kind: 'private-result-proof', resultKind: result.kind,
    resultDigest: result.checkpoint.digest, diagnosticSource: expected.diagnosticSource, ownershipApplication: 'pending' });
  assert.deepEqual(await createFamilyDiagnosticFromResult(result, nextPending), initial);
  const id = `family:bridge:${handoffs++}`;
  let state = family.createBattle(familyConfig(family, id), initial, makeFamilyRng(id, initial));
  const first = family.project(state, 'player').presentation;
  assert.equal(first.self.speciesId, mon.speciesId); assert.equal(first.self.hp, mon.hp);
  assert.deepEqual(first.inventory, expected.inventory);
  assert.equal(family.validateChoice(state, 'player', { kind: 'item', itemId: 13 } as unknown as FamilyChoice).accepted, false);
  assert.equal(family.validateChoice(state, 'player', { kind: 'switch', slot: 1 } as unknown as FamilyChoice).accepted, false);
  assert.throws(() => family.project(state, 'wild'));
  for (let turn = 0; turn < 2; turn++) {
    assert.deepEqual(family.restore(state), state); restoredBoundaries++;
    const view = family.project(state, 'player').presentation;
    for (const key of ['ivs', 'evs', 'calculatedEvs', 'personality', 'otId', 'words', 'admission', 'origin', 'resultDigest'])
      assert(!JSON.stringify(view).includes(`"${key}"`), `Private field ${key} escaped family projection`);
    if (view.phase === 'ended') break;
    const choice = view.availableChoices.find(choice => choice.kind === 'move' || choice.kind === 'struggle'); assert(choice);
    const accepted = family.validateChoice(state, 'player', choice); assert(accepted.accepted);
    const before = structuredClone(state), advanced = family.advance(state, [accepted.value]);
    assert.deepEqual(advanced.domainEffects, []); assert.deepEqual(state, before);
    state = advanced.nextState; diagnosticTurns++;
    assert.deepEqual(family.project(state, 'player').presentation.inventory, expected.inventory, 'The bag is immutable context here');
  }
  assert.deepEqual(family.restore(state), state); restoredBoundaries++;
  assert.deepEqual(result, retainedResult); assert.deepEqual(nextPending, retainedEncounter);
  assert.deepEqual(next.snapshot(), nextPending, 'Diagnostic combat cannot release a source field encounter');
  return prepared;
}

const sourceCases = JSON.parse(await readFixtureText('tools/encounter-core/fixtures/source-cases.json')) as {
  factoryCases: { initial: { mainSeed: number }; expected: { slot: number } }[] };
const seeds = new Map(sourceCases.factoryCases.map(row => [row.expected.slot, row.initial.mainSeed]));
assert.equal(seeds.size, 12);
let wonResult: FamilyResult | undefined;
for (const [slot, seed] of seeds) {
  const parent = await trial(seed, `win-${slot}`), terminal = finish(parent.state, { kind: 'move', slot: 0 });
  assert.equal(oldView(terminal).outcome, 'won');
  const session = progression.fromBattle(terminal), before = session.snapshot(), view = session.view();
  assert.equal(view.phase, 'complete'); assert(view.creature.experience > 135); assert.equal(view.creature.evs.speed, 1);
  assert.equal(view.creature.calculatedEvs.speed, 0, 'Post-win cached statistics predate the new EV');
  wonResult = { kind: 'progression', checkpoint: before };
  await bridge(wonResult, { creature: view.creature, inventory: view.inventory, diagnosticSource: false });
  assert.deepEqual(session.snapshot(), before); assert.deepEqual(parent.field.snapshot(), parent.pending);
}
checks.push('all-twelve-actual-victory-results-admitted-only-as-private-diagnostics',
  'earned-xp-current-evs-cached-stat-basis-and-depleted-hp-pp-preserved');
assert(wonResult);
const healed = await trial(0, 'spent-potion', { hp: 1, inventory: { potion: 1, pokeBall: 0 } });
const healedTerminal = finish(oldAdvance(healed.state, { kind: 'item', itemId: 13 }), { kind: 'move', slot: 0 });
assert.equal(oldView(healedTerminal).outcome, 'won');
const healedResult = progression.fromBattle(healedTerminal), healedView = healedResult.view();
assert.deepEqual(healedView.inventory, { potion: 0, pokeBall: 0 });
await bridge({ kind: 'progression', checkpoint: healedResult.snapshot() }, { creature: healedView.creature,
  inventory: healedView.inventory, diagnosticSource: false });
checks.push('spent-source-bag-is-retained-context-with-no-family-item-spending');

function settleCapture(session: CaptureSession): void {
  session.advance({ expectedSequence: 0 }); const pending = session.view().pendingNickname; assert(pending);
  session.decideNickname({ expectedSequence: 1, decisionId: pending.decisionId, kind: 'keep-species-name' });
  session.advance({ expectedSequence: 2 });
}
const captureContext = capture.developmentContext({ trainerName: 'RED', trainerGender: 0 });
let captureResult: ReturnType<typeof capture.fromBattle> | undefined;
for (const [slot, seed] of [3, 14, 11, 29, 47, 33, 26, 75, 130, 92, 450, 116].entries()) {
  const parent = await trial(seed, `catch-${slot}`, { inventory: { potion: 0, pokeBall: 1 } });
  assert.equal(parent.creature.slot, slot);
  const terminal = oldAdvance(parent.state, { kind: 'item', itemId: 4 }); assert.equal(oldView(terminal).outcome, 'captured');
  const session = capture.fromBattle(terminal, captureContext);
  await assert.rejects(() => createFamilyDiagnosticFromResult({ kind: 'capture-party', checkpoint: session.snapshot() }, nextPending));
  settleCapture(session); const view = session.view(), checkpoint = session.snapshot();
  assert(view.placement?.kind === 'party');
  await bridge({ kind: 'capture-party', checkpoint }, { creature: view.placement.creature,
    inventory: view.inventory, diagnosticSource: false });
  assert.deepEqual(session.snapshot(), checkpoint); assert.deepEqual(parent.field.snapshot(), parent.pending); captureResult = session;
}
checks.push('all-twelve-natural-capture-party-results-preserve-identity-and-pending-ownership', 'unfinished-capture-rejected');
assert(captureResult);
const spentSeed = (JSON.parse(await readFile('reports/battle-capture-integration.json', 'utf8')) as { spentSeed: number }).spentSeed;
const tired = await trial(spentSeed, 'tired-capture', { hp: 1, inventory: { potion: 1, pokeBall: 3 } });
let tiredState = oldAdvance(oldAdvance(tired.state, { kind: 'item', itemId: 13 }), { kind: 'move', slot: 0 });
while (oldView(tiredState).phase !== 'ended' && oldView(tiredState).inventory.pokeBall > 0)
  tiredState = oldAdvance(tiredState, { kind: 'item', itemId: 4 });
assert.equal(oldView(tiredState).outcome, 'captured');
const tiredCapture = capture.fromBattle(tiredState, captureContext); settleCapture(tiredCapture);
const tiredView = tiredCapture.view(); assert(tiredView.placement?.kind === 'party'); assert(tiredView.creature);
assert(tiredView.creature.hp < tiredView.creature.stats.hp);
await bridge({ kind: 'capture-party', checkpoint: tiredCapture.snapshot() }, { creature: tiredView.placement.creature,
  inventory: tiredView.inventory, diagnosticSource: false });
const { policy: _policy, ...plainContext } = captureContext;
const boxed = capture.createDiagnostic({ creature: tiredView.creature, context: { ...plainContext, partyMask: 63 } });
settleCapture(boxed); assert.equal(boxed.view().placement?.kind, 'box');
await assert.rejects(() => createFamilyDiagnosticFromResult({ kind: 'capture-party', checkpoint: boxed.snapshot() }, nextPending));
checks.push('depleted-natural-capture-keeps-hp-pp-and-spent-bag', 'boxed-data-requires-source-party-reconstruction');

const evolutionFixtures = JSON.parse(await readFixtureText('tools/battle-evolution/fixtures/source-cases.json')) as EvolutionFixtures;
let lastPlayer: FamilyCreature | undefined;
for (const id of ['level-7-16', 'level-8-36', 'level-16-18', 'level-17-36', 'level-19-20']) {
  const row = evolutionFixtures.cases.find(row => row.id === id); assert(row, id);
  const session = evolution.createDiagnostic(diagnostic(row.input)), initial = session.view();
  await assert.rejects(() => createFamilyDiagnosticFromResult({ kind: 'evolution', checkpoint: session.snapshot() }, nextPending));
  session.decide({ expectedSequence: initial.sequence, decisionId: initial.pendingEvolution!.decisionId, kind: 'accept-evolution' });
  while (session.view().phase === 'pending-move') {
    const view = session.view(); session.decide({ expectedSequence: view.sequence, decisionId: view.pendingMove!.decisionId, kind: 'decline-move' });
  }
  const view = session.view(), checkpoint = session.snapshot(); assert.equal(view.phase, 'pending-ownership-application');
  const prepared = await bridge({ kind: 'evolution', checkpoint }, { creature: view.creature, inventory: view.inventory, diagnosticSource: true });
  lastPlayer = prepared.mons[0]; assert.deepEqual(session.snapshot(), checkpoint);
}
assert.deepEqual([...resultingSpecies].sort((a, b) => a - b), [7, 8, 9, 16, 17, 18, 19, 20]); assert(lastPlayer);
checks.push('all-five-evolution-edges-retain-diagnostic-provenance-and-pending-ownership', 'all-eight-result-species-execute-and-restore-family-combat');

const progressionFixtures = JSON.parse(await readFixtureText('tools/battle-progression/fixtures/source-cases.json')) as {
  cases: { id: string; initial: ProgressionDiagnostic }[] };
const pendingRow = progressionFixtures.cases.find(row => row.id === 'level-15-to-16-exact-threshold'); assert(pendingRow);
const pendingProgression = progression.createDiagnostic(pendingRow.initial);
assert.notEqual(pendingProgression.view().phase, 'complete');
await assert.rejects(() => createFamilyDiagnosticFromResult({ kind: 'progression', checkpoint: pendingProgression.snapshot() }, nextPending));
await assert.rejects(() => createFamilyDiagnosticFromResult({ kind: 'evolution', checkpoint: { creature: lastPlayer } } as never, nextPending));
const forged = structuredClone(wonResult); forged.checkpoint.digest = '0'.repeat(64);
await assert.rejects(() => createFamilyDiagnosticFromResult(forged, nextPending));
for (const moveId of [18, 119, 130, 162, 182, 228, 229, 240, 283]) {
  const invalid = structuredClone(lastPlayer); invalid.moves[0] = { moveId, pp: 0, ppUps: 0 };
  assert.throws(() => createFamilyDiagnostic({ seed: 1, player: invalid, opponent: lastPlayer! }));
}
const otherTrainer = encounters.create({ mainSeed: 0, wildSeed: 0, trainerId: 2 }); assert.equal(otherTrainer.generate().kind, 'encounter');
await assert.rejects(() => createFamilyDiagnosticFromResult(wonResult!, otherTrainer.snapshot()));
assert.deepEqual(profile, retainedProfile);
checks.push('pending-decisions-unbound-views-corrupted-proofs-and-wrong-trainer-rejected',
  'all-nine-deferred-moves-reject-the-whole-moveset-even-at-zero-pp',
  'source-parents-field-pending-state-and-development-fixture-preserved');

const prior = JSON.parse(await readFile('reports/nineteenth-battle-evolution-integration.json', 'utf8')) as { retainedPins: Record<string, string> };
const retainedPins = { ...prior.retainedPins,
  '.local/battle-evolution/primary/evolution.wasm': '1585f15e7aef6a5ed952cbf3f17041d5382163e39f51c3b1ed3ac65f41495c5c',
  'tools/battle-evolution/fixtures/source-cases.json': '9e629febd8845dc6e281164f6ee93ff964dab6d11f186754832ac19002307c8f' };
for (const [path, expected] of Object.entries(retainedPins))
  assert.equal(createHash('sha256').update(await readRetainedBytes(path)).digest('hex'), expected, `Retained bytes changed: ${path}`);
checks.push('seven-prior-WASM-artifacts-and-2274-retained-literal-cases-byte-identical');
await writeFile('reports/battle-family-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Proof-bound private family combat diagnostics only. No ownership, durable mutation, field acknowledgement or live admission.',
  checks, handoffs, restoredBoundaries, diagnosticTurns, resultingSpecies: [...resultingSpecies].sort((a, b) => a - b),
  retainedPins, compatibility: family.compatibility,
  remaining: ['nine family moves', 'party switching', 'complete resulting-team admission', 'durable ownership and outcomes', 'live battle UI'] }, null, 2) + '\n');
console.log(`Family integration passed: ${checks.length} groups, ${handoffs} result handoffs, ${restoredBoundaries} restores, ${diagnosticTurns} diagnostic turns.`);
