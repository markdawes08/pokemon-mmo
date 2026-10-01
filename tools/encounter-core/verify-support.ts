/** Test-only comparison against independently committed source literals. */
import assert from 'node:assert/strict';
import type { EncounterCheckpoint, EncounterCreature } from './encounter';

export const statKeys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
type Stats = Record<typeof statKeys[number], number>;
export interface Initial { mainSeed: number; wildSeed: number; trainerId: number }
export interface ExpectedCreature {
  slot: number; slotRoll: number; speciesId: number; level: number; personality: number;
  personalityAttempts: number; nature: number; abilityId: number; abilityNum: number; gender: number;
  otId: number; ivs: Stats; evs: Stats; stats: Stats; hp: number; experience: number;
  friendship: number; status: number; heldItemId: number;
  moves: { moveId: number; pp: number; ppUps: number }[];
}
export interface ExpectedState {
  main: { initialSeed: number; state: number; draws: number };
  wild: { initialSeed: number; state: number; draws: number };
  previousBehavior: number; encounterRateBuff: number; stepsSinceLastEncounter: number; serial: number;
}
export interface Draw { stream: 'main' | 'wild'; draw: number; role: string; before: number; value: number; after: number }
export interface FactoryCase {
  id: string; purposes: string[]; initial: Initial; expected: ExpectedCreature; state: ExpectedState; trace: Draw[];
}
export interface ExpectedStep {
  input: { terrain: 'land' | 'none'; behavior: number }; reason: string;
  creature: ExpectedCreature | null; state: ExpectedState; mainTrace: Draw[]; wildTrace: Draw[];
}
export interface StepCase { id: string; initial: Initial; steps: ExpectedStep[] }
export interface Fixtures {
  schemaVersion: number; sourceFingerprint: string; scope: string; independence: string; adaptation: string;
  sourceRecords: { path: string; sha256: string; evidence: string }[];
  factoryCases: FactoryCase[]; stepCases: StepCase[];
}
export interface RecoveryJob {
  id: string; snapshot: EncounterCheckpoint; expected: ExpectedState; trainerId: number;
  creature: ExpectedCreature | null; remaining: ExpectedStep[];
}

export function assertOracleCreature(actual: EncounterCreature, expected: ExpectedCreature, label: string): void {
  const { slotRoll: _slotRoll, personalityAttempts: _attempts, evs: _evs, ...comparison } = expected;
  const moves = [...comparison.moves];
  while (moves.length < 4) moves.push({ moveId: 0, pp: 0, ppUps: 0 });
  assert.deepEqual(actual, { ...comparison, moves }, `${label}: strict private creature projection`);
}

export function expectedCreatureWords(creature: ExpectedCreature): number[] {
  return [1, creature.slot, creature.speciesId, creature.level, creature.personality, creature.nature,
    creature.abilityId, creature.abilityNum, creature.gender, creature.otId,
    ...statKeys.map(key => creature.ivs[key]), ...statKeys.map(key => creature.stats[key]),
    creature.hp, creature.experience, creature.friendship, creature.status, creature.heldItemId,
    ...Array.from({ length: 4 }, (_, slot) => {
      const move = creature.moves[slot];
      return move ? (move.moveId | move.pp << 16 | move.ppUps << 24) >>> 0 : 0;
    }), 0];
}

export function assertOracleWords(words: readonly number[], expected: ExpectedState, trainerId: number,
  creature: ExpectedCreature | null, label: string): void {
  assert.equal(words.length, 44, `${label}: logical word count`);
  assert.deepEqual(words.slice(0, 12), [1, expected.main.state, expected.wild.state,
    expected.main.draws, expected.wild.draws, expected.previousBehavior, expected.encounterRateBuff,
    expected.stepsSinceLastEncounter, 0, 0, trainerId, expected.serial], `${label}: both RNGs, counters, cooldown and identity`);
  if (creature) assert.deepEqual(words.slice(12), expectedCreatureWords(creature), `${label}: exact real creature`);
}

/** Independent O(log n) affine composition, used only for counter-boundary tests.
 * It does not advance the production instance or infer expected values from it.
 */
export function jump(seed: number, count: number, addend: number): number {
  let remaining = BigInt(count), multiplier = 1103515245n, increment = BigInt(addend);
  let accumulatedMultiplier = 1n, accumulatedIncrement = 0n;
  const mask = 0xFFFFFFFFn;
  while (remaining > 0n) {
    if (remaining & 1n) {
      accumulatedIncrement = (accumulatedIncrement * multiplier + increment) & mask;
      accumulatedMultiplier = accumulatedMultiplier * multiplier & mask;
    }
    increment = increment * (multiplier + 1n) & mask;
    multiplier = multiplier * multiplier & mask;
    remaining >>= 1n;
  }
  return Number((accumulatedMultiplier * BigInt(seed) + accumulatedIncrement) & mask);
}

export function checkTrace(trace: readonly Draw[], initialState: number, initialCount: number): void {
  let state = initialState, count = initialCount;
  for (const draw of trace) {
    assert.equal(draw.before, state, `${draw.role}: trace continuity`);
    assert.equal(draw.draw, ++count, `${draw.role}: trace count`);
    state = Number((BigInt(state) * 1103515245n + (draw.stream === 'main' ? 24691n : 12345n)) & 0xFFFFFFFFn);
    assert.equal(draw.after, state, `${draw.role}: source LCG arithmetic`);
    assert.equal(draw.value, state >>> 16, `${draw.role}: source high half`);
  }
}

export function stepInput(step: ExpectedStep) {
  assert(step.input.behavior === (step.input.terrain === 'land' ? 2 : 0), 'Fixture stays within wrapper terrain profile');
  return { behavior: step.input.terrain === 'land' ? 'grass' as const : 'plain' as const, movement: 'walk' as const };
}
