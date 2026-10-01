/** Private item/capture integration through the unchanged six-method adapter.
 * Fidelity comes from separate literal source fixtures; these checks cover
 * admission, command identity, projections, restore and candidate publication. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config, route1CheckpointSchema,
  type Route1Choice, type Route1Checkpoint } from './engine';

const profile = await loadDevelopmentProfile(), factoryCore = await loadEncounterCore(), engine = await loadRoute1Engine();
const originalProfile = structuredClone(profile);
const checks: string[] = [];
function privateState(snapshot: BattleSnapshot): Route1Checkpoint {
  return route1CheckpointSchema.parse(JSON.parse(Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8')));
}
function mutate(snapshot: BattleSnapshot, change: (checkpoint: Route1Checkpoint) => void): BattleSnapshot {
  const candidate = structuredClone(snapshot), checkpoint = privateState(candidate);
  change(checkpoint);
  candidate.privateEngineState.data = Buffer.from(JSON.stringify(checkpoint)).toString('base64');
  return candidate;
}
async function create(seed: number, label: string, options: Parameters<typeof createRoute1Initial>[1] = {}) {
  const field = factoryCore.create({ mainSeed: seed, wildSeed: 0x4321, trainerId: profile.creature.otId });
  const generated = field.generate(); assert.equal(generated.kind, 'encounter');
  if (generated.kind !== 'encounter') throw new Error('Expected actual source encounter');
  const pending = field.snapshot(), initial = await createRoute1Initial(pending, options), id = `route1:items:${label}`;
  return { snapshot: engine.createBattle(route1Config(engine, id), initial, makeRoute1Rng(id, initial)), field, pending, creature: generated.creature };
}
function view(snapshot: BattleSnapshot) {
  const result = engine.project(snapshot, 'player').presentation;
  assert.throws(() => engine.project(snapshot, 'wild'));
  assert.throws(() => engine.project(snapshot, 'other-account'));
  for (const forbidden of ['personality', 'ivs', 'evs', 'otId', 'wildSlot', 'rng', 'privateEngineState']) {
    assert(!JSON.stringify(result).includes(`"${forbidden}"`), `Projection leaked ${forbidden}`);
  }
  assert.deepEqual(engine.restore(engine.snapshot(snapshot)), snapshot);
  return result;
}
function advance(snapshot: BattleSnapshot, choice: Route1Choice) {
  const before = structuredClone(snapshot), accepted = engine.validateChoice(snapshot, 'player', choice);
  assert(accepted.accepted);
  const result = engine.advance(snapshot, [accepted.value]);
  assert.deepEqual(snapshot, before, 'An item candidate cannot mutate published state');
  assert.deepEqual(engine.advance(engine.restore(before), [accepted.value]), result, 'Restored item action is identical');
  assert.deepEqual(result.domainEffects, [], 'This private profile never grants or spends durable assets');
  assert.equal(result.nextState.transitionSequence, before.transitionSequence + 1);
  result.orderedEvents.forEach((event, index) => {
    assert.equal(event.battleId, snapshot.config.battleId);
    assert.equal(event.transitionSequence, result.nextState.transitionSequence);
    assert.equal(event.sequence, before.eventSequence + index + 1);
  });
  assert.throws(() => engine.advance(result.nextState, [accepted.value]), 'Old accepted command cannot spend the next state again');
  view(result.nextState);
  return result;
}

const pristine = await create(0, 'pristine');
assert.deepEqual(view(pristine.snapshot).inventory, { potion: 5, pokeBall: 5 });
const noEffectBefore = structuredClone(pristine.snapshot);
for (let repeat = 0; repeat < 3; repeat++) assert.equal(engine.validateChoice(pristine.snapshot, 'player', { kind: 'item', itemId: 13 }).accepted, false);
assert.deepEqual(pristine.snapshot, noEffectBefore, 'Full-HP Potion consumes no item, turn or RNG');
assert(!view(pristine.snapshot).availableChoices.some(choice => choice.kind === 'item' && choice.itemId === 13));
const noItems = await create(0, 'no-items', { hp: 1, inventory: { potion: 0, pokeBall: 0 } });
for (const itemId of [4, 13] as const) assert.equal(engine.validateChoice(noItems.snapshot, 'player', { kind: 'item', itemId }).accepted, false);
assert(!view(noItems.snapshot).availableChoices.some(choice => choice.kind === 'item'));
checks.push('canonical-inventory-and-depleted-admission', 'no-effect-and-empty-item-rejection-without-state-change');

const healing = await create(0, 'potion', { hp: 1, pp: [0, 0], inventory: { potion: 1, pokeBall: 0 } });
const healed = advance(healing.snapshot, { kind: 'item', itemId: 13 });
const healedView = view(healed.nextState), potion = healed.orderedEvents.find(event => event.payload.kind === 'potion');
assert(potion && potion.payload.kind === 'potion');
assert.equal(potion.payload.restoredHp, 19); assert.equal(potion.payload.remaining, 0);
assert.deepEqual(healedView.inventory, { potion: 0, pokeBall: 0 });
assert.deepEqual(healedView.self.moves.map(move => move.pp), [0, 0], 'Item use does not spend player move PP');
assert(healedView.self.hp > 1 && healedView.self.hp <= 20);
const wildAttack = healed.orderedEvents.findIndex(event => event.payload.kind === 'attack' && event.payload.actor === 1);
assert(wildAttack > healed.orderedEvents.indexOf(potion), 'Healing precedes the retained wild action');
assert.deepEqual(healing.field.snapshot(), healing.pending);
assert.equal(engine.validateChoice(healed.nextState, 'player', { kind: 'item', itemId: 13 }).accepted, false);
checks.push('potion-heals-before-wild-action-and-consumes-one', 'restored-item-action-is-deterministic-and-stale-command-rejected');

const captures = [], identities = new Set<string>();
let failedThrows = 0;
for (let seed = 0; seed < 192 && (identities.size < 3 || failedThrows === 0); seed++) {
  const trial = await create(seed, `throw-${seed}`, { inventory: { potion: 0, pokeBall: 1 } });
  const result = advance(trial.snapshot, { kind: 'item', itemId: 4 });
  const ball = result.orderedEvents.find(event => event.payload.kind === 'capture');
  assert(ball && ball.payload.kind === 'capture');
  assert.equal(ball.payload.remaining, 0);
  assert.deepEqual(view(result.nextState).inventory, { potion: 0, pokeBall: 0 });
  const checkpoint = privateState(result.nextState);
  assert.deepEqual(trial.field.snapshot(), trial.pending, 'Capture leaves the separate pending field checkpoint unchanged');
  if (!ball.payload.caught) {
    failedThrows++;
    assert.equal(checkpoint.capture, null);
    assert(result.orderedEvents.some(event => event.payload.kind === 'attack' && event.payload.actor === 1));
    assert.equal(engine.validateChoice(result.nextState, 'player', { kind: 'item', itemId: 4 }).accepted, false);
    continue;
  }
  assert.equal(ball.payload.shakes, 4);
  assert.equal(checkpoint.host.outcome, 'captured');
  assert(checkpoint.capture && checkpoint.capture.kind === 'pending-disposition');
  assert.equal(checkpoint.capture.ballItemId, 4);
  const { evs, ...creature } = checkpoint.capture.creature;
  assert.deepEqual(creature, trial.creature, 'First-throw capture retains the exact actual encounter creature');
  assert(Object.values(evs).every(value => value === 0));
  const terminal = view(result.nextState);
  assert.deepEqual(terminal.capture, { speciesId: trial.creature.speciesId, level: trial.creature.level, pendingDisposition: true });
  assert.equal(terminal.availableChoices.length, 0);
  assert(!result.orderedEvents.some(event => event.payload.kind === 'attack'), 'Successful capture stops combat immediately');
  assert.throws(() => engine.advance(result.nextState, []));
  for (const change of [
    (state: Route1Checkpoint) => { state.capture = null; },
    (state: Route1Checkpoint) => { state.capture!.creature.personality ^= 1; },
    (state: Route1Checkpoint) => { state.capture!.creature.hp = 0; },
    (state: Route1Checkpoint) => { state.capture!.creature.moves[0]!.pp++; },
  ]) assert.throws(() => engine.restore(mutate(result.nextState, change)), 'Forged capture descriptor rejected');
  identities.add(`${trial.creature.speciesId}:${trial.creature.abilityId}`);
  captures.push({ seed, speciesId: trial.creature.speciesId, abilityId: trial.creature.abilityId, level: trial.creature.level });
}
assert.equal(identities.size, 3, 'Natural captures cover Pidgey and both Rattata ability identities');
assert(failedThrows > 0);
checks.push('failed-ball-consumes-once-and-wild-acts', 'successful-ball-handoff-preserves-real-identity-and-stops-combat',
  'capture-projection-excludes-private-creature-fields', 'capture-checkpoint-forgery-rejected');

for (const inventory of [{ potion: -1, pokeBall: 1 }, { potion: 6, pokeBall: 1 }, { potion: 1, pokeBall: 6 }, { potion: 1.5, pokeBall: 1 }]) {
  await assert.rejects(() => createRoute1Initial(pristine.pending, { inventory }));
}
for (const change of [
  (state: Route1Checkpoint) => { state.host.inventory.pokeBall = 6; },
  (state: Route1Checkpoint) => { state.host.inventory.potion = -1; },
  (state: Route1Checkpoint) => { state.host.inventory.potion = 1; },
]) assert.throws(() => engine.restore(mutate(healed.nextState, change)));
const oldRules = structuredClone(pristine.snapshot); oldRules.config.compatibility.rulesVersion = 'firered-route1-singles-v1';
assert.throws(() => engine.restore(oldRules), 'No silent migration of old mechanics checkpoints');
for (const unsupported of [{ kind: 'item', itemId: 14 }, { kind: 'item', itemId: 4, target: 'self' }, { kind: 'item', itemId: 13, partyIndex: 1 }]) {
  assert.equal(engine.validateChoice(pristine.snapshot, 'player', unsupported as Route1Choice).accepted, false);
}
assert.deepEqual(profile, originalProfile);
checks.push('inventory-bounds-and-false-healing-restore-rejected', 'unsupported-item-target-and-old-profile-rejected', 'fixture-and-field-state-unchanged');
await writeFile('reports/battle-route1-items-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Private six-method Potion/Poke Ball integration; no database, account, room, owned capture grant or field acknowledgement',
  compatibility: engine.compatibility, checks, captures, failedThrows,
  pending: ['capture owner/met/nickname metadata', 'party/storage placement', 'durable item/capture effects', 'experience/progression/loss', 'live battle admission'] }, null, 2) + '\n');
console.log(`Route 1 item integration passed: ${checks.length} groups, ${captures.length} captures and ${failedThrows} failed throws.`);
