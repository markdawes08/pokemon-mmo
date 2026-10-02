import { readFixtureText, readRetainedBytes } from '../fixtures/io';
/** Actual private encounter -> combat -> victory continuation integration.
 * Numeric fidelity is checked separately against independent source literals.
 * This verifier never logs into an account, acknowledges a field encounter,
 * changes the fixture, or writes character assets. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config,
  route1CheckpointSchema, type Route1Choice } from '../battle-route1/engine';
import { loadProgressionCore, progressionCheckpointDigest, type ProgressionCheckpoint } from './progression';

const profile = await loadDevelopmentProfile(), originalProfile = structuredClone(profile);
const encounters = await loadEncounterCore(), battle = await loadRoute1Engine(), progression = await loadProgressionCore();
const checks: string[] = [];
const fixtureSeeds = JSON.parse(await readFixtureText('tools/encounter-core/fixtures/source-cases.json')) as {
  factoryCases: { initial: { mainSeed: number; wildSeed: number; trainerId: number }; expected: { slot: number } }[];
};
const selected = new Map(fixtureSeeds.factoryCases.map(row => [row.expected.slot, row.initial]));
assert.equal(selected.size, 12);
const privateState = (snapshot: BattleSnapshot) => route1CheckpointSchema.parse(
  JSON.parse(Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8')));
const view = (snapshot: BattleSnapshot) => battle.project(snapshot, 'player').presentation;
async function create(seeds: { mainSeed: number; wildSeed: number; trainerId: number }, label: string,
  options: Parameters<typeof createRoute1Initial>[1] = {}) {
  const field = encounters.create(seeds), generated = field.generate();
  assert.equal(generated.kind, 'encounter');
  if (generated.kind !== 'encounter') throw new Error('Expected actual source encounter');
  const pending = field.snapshot(), initial = await createRoute1Initial(pending, options);
  const id = `progression:bridge:${label}`;
  return { field, pending, creature: generated.creature,
    state: battle.createBattle(route1Config(battle, id), initial, makeRoute1Rng(id, initial)) };
}
function advance(state: BattleSnapshot, choice: Route1Choice) {
  const accepted = battle.validateChoice(state, 'player', choice); assert(accepted.accepted);
  const before = structuredClone(state), result = battle.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []);
  assert.deepEqual(state, before);
  return result.nextState;
}
function finish(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  for (let turn = 0; view(state).phase !== 'ended'; turn++) {
    assert(turn < 120, 'Bounded diagnostic battle failed to terminate');
    state = advance(state, choice);
  }
  return state;
}

let terminalHandoffs = 0;
function verifyTerminal(terminal: BattleSnapshot, award: number): void {
  const original = structuredClone(terminal), combat = view(terminal), raw = privateState(terminal);
  const session = progression.fromBattle(terminal), result = session.view(), checkpoint = session.snapshot();
  assert.deepEqual(terminal, original, 'Creating a continuation leaves the terminal battle unchanged');
  assert.deepEqual(progression.fromBattle(terminal).snapshot(), checkpoint, 'Same terminal creates the same private continuation');
  assert.deepEqual(progression.restore(checkpoint).view(), result, 'Logical restore reproduces the exact source continuation');
  assert.deepEqual(result.origin, { kind: 'battle-terminal', battleId: terminal.config.battleId,
    terminalSequence: terminal.transitionSequence, terminalDigest: result.origin.kind === 'battle-terminal' ? result.origin.terminalDigest : '',
    outcome: combat.outcome });
  assert(result.origin.kind === 'battle-terminal' && /^[a-f0-9]{64}$/.test(result.origin.terminalDigest));
  assert.equal(result.phase, combat.outcome === 'lost' || combat.outcome === 'draw' ? 'pending-loss'
    : combat.outcome === 'captured' ? 'pending-capture' : 'complete');
  assert.equal(result.award.experience, award);
  assert.equal(result.award.sourceExperience, award);
  assert.equal(result.award.remainingExperience, 0);
  assert.equal(result.creature.experience, 135 + award);
  assert.equal(result.creature.level, 5, 'Even the largest admitted first win remains below source level six');
  assert.deepEqual(result.creature.stats, profile.creature.stats, 'EV gain without leveling preserves cached stats');
  assert.deepEqual(result.creature.calculatedEvs, profile.creature.evs);
  assert.deepEqual(result.creature.evs, { ...profile.creature.evs, speed: award ? 1 : 0 });
  assert.equal(result.creature.hp, combat.self.hp, 'Reward handoff never heals current HP');
  assert.equal(result.creature.friendship, 70, 'Unprocessed loss friendship remains pending; no fabricated metadata used');
  assert.deepEqual(result.creature.moves, Array.from({ length: 4 }, (_, slot) => ({ moveId: raw.core.words[38 + slot],
    pp: raw.core.words[42 + slot], ppUps: 0 })));
  assert.deepEqual(result.inventory, combat.inventory);
  assert.deepEqual(result.capture, raw.capture);
  assert.equal(result.pendingMove, null); assert.equal(result.pendingEvolution, null);
  assert.equal(result.combatReadmission, 'unsupported');
  if (!award) assert.deepEqual(result.events, []);
  assert.throws(() => session.decide({ kind: 'decline-move', decisionId: '0'.repeat(64) }));
  assert.deepEqual(session.snapshot(), checkpoint, 'An unavailable decision cannot alter the accepted continuation');
  const projected = session.project('player');
  assert.throws(() => session.project('wild')); assert.throws(() => session.project('other-account'));
  for (const field of ['ivs', 'evs', 'calculatedEvs', 'personality', 'otId', 'rng', 'words', 'admission', 'origin', 'terminalDigest'])
    assert(!JSON.stringify(projected).includes(`"${field}"`), `Private ${field} escaped owner projection`);
  const detached = session.snapshot();
  if (detached.admission.kind === 'battle-terminal') detached.admission.battle.rng.draws++;
  assert.deepEqual(session.snapshot(), checkpoint, 'Returned checkpoints cannot mutate the session');
  result.creature.hp = 65535;
  assert.equal(session.view().creature.hp, combat.self.hp, 'Returned private views are detached');
  assert.deepEqual(privateState(terminal).rng, raw.rng, 'Progression consumes no combat RNG');
  terminalHandoffs++;
}

const victories: { slot: number; speciesId: number; level: number; experience: number; turns: number }[] = [];
const terminals = new Map<string, BattleSnapshot>();
for (const [slot, seeds] of [...selected].sort((a, b) => a[0] - b[0])) {
  const trial = await create({ ...seeds, trainerId: 1 }, `slot-${slot}`);
  assert.throws(() => progression.fromBattle(trial.state), 'Active battle cannot become a reward continuation');
  const terminal = finish(trial.state, { kind: 'move', slot: 0 });
  assert.equal(view(terminal).outcome, 'won');
  const sourceAward = trial.creature.speciesId === 16
    ? ({ 2: 15, 3: 23, 4: 31, 5: 39 } as Record<number, number>)[trial.creature.level]!
    : ({ 2: 16, 3: 24, 4: 32 } as Record<number, number>)[trial.creature.level]!;
  verifyTerminal(terminal, sourceAward);
  assert.deepEqual(trial.field.snapshot(), trial.pending, 'Progression cannot acknowledge field activity');
  victories.push({ slot, speciesId: trial.creature.speciesId, level: trial.creature.level,
    experience: sourceAward, turns: terminal.transitionSequence });
  terminals.set('won', terminal);
}
checks.push('all-twelve-real-encounter-slots-award-source-experience-and-speed-ev',
  'strict-active-battle-rejection-and-unchanged-pending-field');

const baseSeeds = { mainSeed: 0, wildSeed: 0, trainerId: 1 };
for (const [label, options, choice, expected] of [
  ['run', {}, { kind: 'run' }, 'ran'],
  ['loss', { hp: 1 }, { kind: 'move', slot: 1 }, 'lost'],
  ['draw', { hp: 9, pp: [0, 0], inventory: { potion: 0, pokeBall: 0 } }, { kind: 'struggle' }, 'draw'],
] as const) {
  const trial = await create(baseSeeds, label, structuredClone(options) as Parameters<typeof createRoute1Initial>[1]);
  const terminal = finish(trial.state, choice);
  assert.equal(view(terminal).outcome, expected);
  verifyTerminal(terminal, 0);
  terminals.set(expected, terminal);
  assert.deepEqual(trial.field.snapshot(), trial.pending);
}
let captureSeed: number | null = null;
for (let seed = 0; seed < 192; seed++) {
  const trial = await create({ ...baseSeeds, mainSeed: seed }, `capture-${seed}`, { inventory: { potion: 0, pokeBall: 1 } });
  const candidate = advance(trial.state, { kind: 'item', itemId: 4 });
  if (view(candidate).outcome !== 'captured') continue;
  verifyTerminal(candidate, 0);
  terminals.set('captured', candidate);
  assert.deepEqual(trial.field.snapshot(), trial.pending);
  captureSeed = seed; break;
}
assert.notEqual(captureSeed, null);
assert.deepEqual([...terminals.keys()].sort(), ['captured', 'draw', 'lost', 'ran', 'won']);
checks.push('natural-run-capture-loss-and-struggle-draw-never-award-victory-xp-or-evs');

// A spent Potion must survive the terminal bridge alongside the exact PP/HP.
const healing = await create(baseSeeds, 'spent-potion', { hp: 1, inventory: { potion: 1, pokeBall: 0 } });
const healed = advance(healing.state, { kind: 'item', itemId: 13 });
const healedTerminal = finish(healed, { kind: 'move', slot: 0 });
assert.equal(view(healedTerminal).outcome, 'won');
const healedAward = healing.creature.speciesId === 16 ? [0, 0, 15, 23, 31, 39][healing.creature.level]!
  : [0, 0, 16, 24, 32][healing.creature.level]!;
verifyTerminal(healedTerminal, healedAward);
assert.deepEqual(view(healedTerminal).inventory, { potion: 0, pokeBall: 0 });
checks.push('used-items-depleted-hp-and-pp-cross-terminal-boundary-without-refill');

// The retained engine must remain unable to admit a progressed creature.
const unchanged = structuredClone(healing.state), raw = privateState(unchanged);
(raw.admission.player as Record<string, unknown>).experience = 174;
unchanged.privateEngineState.data = Buffer.from(JSON.stringify(raw)).toString('base64');
assert.throws(() => battle.restore(unchanged));
assert.deepEqual(profile, originalProfile);
checks.push('progressed-team-readmission-remains-explicitly-unsupported', 'canonical-fixture-remains-unchanged');

const bound = progression.fromBattle(terminals.get('won')!).snapshot();
const recalculate = (checkpoint: ProgressionCheckpoint) => {
  const { digest: _digest, ...body } = checkpoint;
  checkpoint.digest = progressionCheckpointDigest(body); return checkpoint;
};
for (const change of [
  (checkpoint: ProgressionCheckpoint) => { checkpoint.compatibility.wasmSha256 = '0'.repeat(64); },
  (checkpoint: ProgressionCheckpoint) => { checkpoint.words![0] ^= 1; },
  (checkpoint: ProgressionCheckpoint) => { checkpoint.words![63] ^= 1; },
  (checkpoint: ProgressionCheckpoint) => { checkpoint.words = null; },
  (checkpoint: ProgressionCheckpoint) => { checkpoint.decisions.push({ kind: 'decline-move', decisionId: '0'.repeat(64) }); },
  (checkpoint: ProgressionCheckpoint) => {
    assert.equal(checkpoint.admission.kind, 'battle-terminal');
    if (checkpoint.admission.kind === 'battle-terminal') checkpoint.admission.battle.rng.draws++;
  },
]) {
  const malformed = structuredClone(bound); change(malformed);
  assert.throws(() => progression.restore(recalculate(malformed)), 'Semantic replay rejects corruption even with a fresh digest');
}
const lostCheckpoint = progression.fromBattle(terminals.get('lost')!).snapshot();
lostCheckpoint.words = bound.words;
assert.throws(() => progression.restore(recalculate(lostCheckpoint)), 'Nonvictory cannot be given a reward checkpoint');
checks.push('compatible-replay-terminal-binding-and-semantic-corruption-rejection',
  'owner-only-projection-detached-state-and-unavailable-decision-atomicity');

async function fileHash(path: string) { return createHash('sha256').update(await readRetainedBytes(path)).digest('hex'); }
assert.equal(await fileHash('tools/battle-route1/fixtures/source-cases.json'), '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac');
assert.equal(await fileHash('tools/battle-route1/fixtures/items-cases.json'), '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1');
assert.equal(await fileHash('.local/battle-route1/primary/route1.wasm'), '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02');
assert.equal(await fileHash('.local/battle-spike/primary/probe.wasm'), '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724');
checks.push('retained-combat-artifacts-and-original-literal-fixtures-byte-identical');

await writeFile('reports/battle-progression-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Private source encounter/combat/progression handoff; no account, database, owned outcome, field acknowledgement or live battle admission',
  checks, victories, terminalHandoffs, naturalOutcomes: [...terminals.keys()], captureSeed, battleCompatibility: battle.compatibility,
  progressionCompatibility: progression.compatibility,
  remaining: ['blackout/faint friendship continuation', 'owned capture metadata and placement', 'evolution completion',
    'broader combat team/move/ability closure', 'durable battle activity and outcomes', 'live battle UI'] }, null, 2) + '\n');
console.log(`Progression integration passed: ${checks.length} groups, ${victories.length} real slot victories and ${terminals.size} natural outcomes.`);
