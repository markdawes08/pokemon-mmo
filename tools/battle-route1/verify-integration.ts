/** Private integration: real fixture + encounter checkpoint + six-method engine.
 * Source fidelity is checked by the separate literal verifier. No database,
 * room, user account or browser mutation occurs here. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore, checkpointDigest, type EncounterCheckpoint } from '../encounter-core/encounter';
import { loadRoute1Engine, createRoute1Initial, makeRoute1Rng, route1Config } from './engine';

const profile = await loadDevelopmentProfile();
const encounterCore = await loadEncounterCore();
const engine = await loadRoute1Engine();
const fixtures = JSON.parse(await readFile('tools/encounter-core/fixtures/source-cases.json', 'utf8')) as {
  factoryCases: { initial: { mainSeed: number; wildSeed: number; trainerId: number }; expected: { slot: number } }[];
};
const selected = new Map(fixtures.factoryCases.map(row => [row.expected.slot, row.initial]));
assert.equal(selected.size, 12);
const checks: string[] = [];
const scenarios: { slot: number; species: number; level: number; turns: number; outcome: string; transitions: number }[] = [];
let transitions = 0;

function inspect(snapshot: BattleSnapshot) {
  const projection = engine.project(snapshot, 'player');
  assert.equal(projection.viewerId, 'player');
  assert.equal(projection.transitionSequence, snapshot.transitionSequence);
  assert.throws(() => engine.project(snapshot, 'wild'), 'Wild controller is not a human viewer');
  assert.throws(() => engine.project(snapshot, 'other-account'), 'Foreign viewer has no projection');
  const text = JSON.stringify(projection);
  for (const field of ['privateEngineState', 'personality', 'ivs', 'rng', 'initialSeed', 'wildChoice', 'coreWords']) {
    assert(!text.includes(`"${field}"`), `Private ${field} escaped projection`);
  }
  assert.deepEqual(Object.keys(projection.presentation.opponent).sort(), ['hpPercent', 'level', 'speciesId', 'status']);
  assert.equal(engine.validateChoice(snapshot, 'wild', { kind: 'move', slot: 0 }).accepted, false);
  assert.deepEqual(engine.restore(engine.snapshot(snapshot)), snapshot);
  return projection.presentation;
}

for (const [slot, seeds] of [...selected].sort((a, b) => a[0] - b[0])) {
  const factory = encounterCore.create({ ...seeds, trainerId: profile.creature.otId });
  const generated = factory.generate();
  assert.equal(generated.kind, 'encounter');
  if (generated.kind !== 'encounter') throw new Error('Expected wild creature');
  assert.equal(generated.creature.slot, slot);
  const encounter = factory.snapshot(), encounterBefore = structuredClone(encounter);
  const initial = await createRoute1Initial(encounter);
  const initialBefore = structuredClone(initial), id = `route1:bridge:${slot}`;
  const config = route1Config(engine, id), rng = makeRoute1Rng(id, initial);
  let snapshot = engine.createBattle(config, initial, rng);
  assert.deepEqual(initial, initialBefore, 'Battle admission leaves source inputs unchanged');
  assert.deepEqual(encounter, encounterBefore, 'Battle admission cannot consume or alter field checkpoint');
  assert.deepEqual(factory.snapshot(), encounterBefore, 'Field factory still owns its pending encounter');
  const first = inspect(snapshot);
  assert.equal(first.self.speciesId, 7); assert.equal(first.self.level, 5);
  assert.equal(first.self.hp, profile.creature.hp); assert.equal(first.self.maxHP, profile.creature.stats.hp);
  assert.equal(first.opponent.speciesId, generated.creature.speciesId);
  assert.equal(first.opponent.level, generated.creature.level);
  assert.equal(first.opponent.hpPercent, 100);
  assert.deepEqual(first.self.moves.map(move => [move.moveId, move.pp]), profile.creature.moves.map(move => [move.moveId, move.pp]));
  let turnCount = 0;
  while (inspect(snapshot).phase !== 'ended') {
    assert(turnCount++ < 120, `Tackle/Struggle battle failed to terminate: slot ${slot}`);
    const view = inspect(snapshot);
    const choice = view.availableChoices.find(row => row.kind === 'move' && row.slot === 0)
      ?? view.availableChoices.find(row => row.kind === 'struggle')
      ?? view.availableChoices.find(row => row.kind === 'move');
    assert(choice, 'A living legal team needs Fight or automatic Struggle');
    const accepted = engine.validateChoice(snapshot, 'player', choice);
    assert(accepted.accepted);
    const before = structuredClone(snapshot);
    const result = engine.advance(snapshot, [accepted.value]);
    assert.deepEqual(snapshot, before, 'Advance is candidate-only');
    const restoredResult = engine.advance(engine.restore(before), [accepted.value]);
    assert.deepEqual(restoredResult, result, 'Restore preserves the exact hidden opponent choice and RNG');
    assert.deepEqual(result.domainEffects, [], 'Private profile cannot award or persist assets');
    assert.equal(result.nextState.transitionSequence, snapshot.transitionSequence + 1);
    result.orderedEvents.forEach((event, index) => {
      assert.equal(event.battleId, id);
      assert.equal(event.transitionSequence, result.nextState.transitionSequence);
      assert.equal(event.sequence, snapshot.eventSequence + index + 1);
    });
    assert(result.orderedEvents.length > 0);
    snapshot = result.nextState;
    transitions++;
  }
  const terminal = inspect(snapshot);
  assert(terminal.outcome && ['won', 'lost', 'draw'].includes(terminal.outcome));
  assert.equal(terminal.availableChoices.length, 0);
  assert.equal(terminal.needsChoice, false);
  assert.equal(engine.validateChoice(snapshot, 'player', { kind: 'run' }).accepted, false);
  assert.throws(() => engine.advance(snapshot, []));
  assert.deepEqual(factory.snapshot(), encounterBefore, 'Private battle does not acknowledge field encounter or write assets');
  scenarios.push({ slot, species: generated.creature.speciesId, level: generated.creature.level,
    turns: turnCount, outcome: terminal.outcome, transitions: snapshot.transitionSequence });
}
checks.push('all-twelve-source-slots-real-fixture-admission-and-natural-terminal-play',
  'owner-only-projection-hides-enemy-details-and-rng', 'detached-inputs-and-deterministic-restore',
  'ordered-events-and-zero-persistent-effects', 'field-pending-encounter-remains-unchanged');

const factory = encounterCore.create({ mainSeed: 0, wildSeed: 0, trainerId: profile.creature.otId });
factory.generate();
const pending = factory.snapshot();
async function create(label: string, depletion: { hp?: number; pp?: [number, number] } = {}) {
  const initial = await createRoute1Initial(pending, depletion);
  const config = route1Config(engine, `route1:bridge:${label}`);
  return engine.createBattle(config, initial, makeRoute1Rng(config.battleId, initial));
}
const emptyPp = await create('exhausted', { hp: 1, pp: [0, 0] });
const exhausted = inspect(emptyPp);
assert.equal(exhausted.self.hp, 1, 'Admission preserves depleted HP');
assert.deepEqual(exhausted.self.moves.map(move => move.pp), [0, 0]);
assert(exhausted.availableChoices.some(choice => choice.kind === 'struggle'));
assert(!exhausted.availableChoices.some(choice => choice.kind === 'move'));
const struggle = engine.validateChoice(emptyPp, 'player', { kind: 'struggle' }); assert(struggle.accepted);
const exhaustedResult = engine.advance(emptyPp, [struggle.value]);
assert.deepEqual(exhaustedResult.domainEffects, []);
inspect(exhaustedResult.nextState);
const onePp = await create('one-usable-slot', { pp: [0, 1] });
assert.equal(engine.validateChoice(onePp, 'player', { kind: 'move', slot: 0 }).accepted, false);
assert.equal(engine.validateChoice(onePp, 'player', { kind: 'move', slot: 1 }).accepted, true);
assert.equal(engine.validateChoice(onePp, 'player', { kind: 'struggle' }).accepted, false);
checks.push('depleted-real-player-hp-and-pp-remain-depleted', 'struggle-only-when-all-player-pp-exhausted');

let escaping = await create('escape');
let attempts = 0;
while (inspect(escaping).phase !== 'ended') {
  assert(attempts++ < 20);
  const accepted = engine.validateChoice(escaping, 'player', { kind: 'run' }); assert(accepted.accepted);
  const result = engine.advance(escaping, [accepted.value]);
  assert.deepEqual(result.domainEffects, []);
  escaping = result.nextState;
}
assert(['ran', 'lost'].includes(inspect(escaping).outcome!));
checks.push('escape-uses-real-opponent-and-terminal-contract');

for (const depletion of [{ hp: 0 }, { hp: profile.creature.stats.hp + 1 }, { pp: [36, 30] }, { pp: [35, 31] }, { pp: [-1, 0] }]) {
  await assert.rejects(() => createRoute1Initial(pending, depletion as { hp?: number; pp?: [number, number] }));
}
const absentPending = structuredClone(pending);
absentPending.phase = 'ready';
const { digest: _digest, ...body } = absentPending;
absentPending.digest = checkpointDigest(body);
await assert.rejects(() => createRoute1Initial(absentPending));
const foreignFactory = encounterCore.create({ mainSeed: 0, wildSeed: 0, trainerId: profile.creature.otId + 1 });
foreignFactory.generate();
await assert.rejects(() => createRoute1Initial(foreignFactory.snapshot()));
const poisoned = structuredClone(pending) as EncounterCheckpoint;
poisoned.words[1] ^= 1;
await assert.rejects(() => createRoute1Initial(poisoned));
const legal = await create('reject-forged-commands');
const accepted = engine.validateChoice(legal, 'player', { kind: 'move', slot: 0 }); assert(accepted.accepted);
for (const input of [[], [accepted.value, accepted.value], [{ ...accepted.value, actorId: 'wild' }],
  [{ ...accepted.value, transitionSequence: 1 }], [{ ...accepted.value, battleId: 'other' }],
  [{ ...accepted.value, choice: { kind: 'move' as const, slot: 3 } }]]) {
  assert.throws(() => engine.advance(legal, input));
}
const unchanged = structuredClone(legal);
for (const unsupported of [{ kind: 'item', itemId: 14 }, { kind: 'switch', partyIndex: 1 }, { kind: 'move', slot: 0, seed: 999 }]) {
  assert.equal(engine.validateChoice(legal, 'player', unsupported as { kind: 'move'; slot: number }).accepted, false);
  assert.deepEqual(legal, unchanged);
}
checks.push('invalid-hp-pp-nonpending-foreign-and-corrupt-encounters-rejected',
  'forged-stale-duplicate-and-unsupported-command-rejection');
await writeFile('reports/battle-route1-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Private source fixture/encounter/six-method battle integration; no database, live room, public UI or asset writes',
  profileId: profile.id, contentHash: profile.contentHash, compatibility: engine.compatibility,
  checks, scenarios, transitions, escapeAttempts: attempts,
  remaining: ['additional items', 'party switching', 'experience/EV/level progression', 'owned capture/loss effects', 'durable battle activity and live admission'] }, null, 2) + '\n');
console.log(`Route 1 integration passed: ${scenarios.length} real encounter slots, ${transitions} natural turns, ${checks.length} assertion groups.`);
