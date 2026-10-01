/** Test-only observations against independently committed source literals. */
import assert from 'node:assert/strict';
import type { ProgressionCheckpoint, ProgressionCreature, ProgressionDiagnostic, ProgressionEvent,
  ProgressionSession, ProgressionView, RawProgressionExports } from './progression';

export interface Expected {
  phase: 'move-choice' | 'pending-evolution' | 'complete'; creature: ProgressionCreature;
  remainingExperience: number; sourceAward: number; awardExperience: number; appliedExperience: number;
  pendingMove: number; evolutionSpecies: number; statBasisEvs: ProgressionCreature['evs']; decisions: number;
  events: unknown[]; apiEvents: ProgressionEvent[];
}
export type Decision = { kind: 'replace-move'; slot: number } | { kind: 'decline-move' };
export interface Fixture { id: string; initial: ProgressionDiagnostic; checkpoints: Expected[]; decisions: Decision[] }
export interface Fixtures { schemaVersion: number; sourceFingerprint: string; scope: string; independence: string;
  sourceRecords: unknown[]; growthTable: number[]; learnset: { level: number; moveId: number; pp: number }[]; cases: Fixture[] }
export interface RecoveryJob { id: string; checkpoint: ProgressionCheckpoint; initialExperience: number;
  expected: Expected[]; remaining: Decision[] }
export interface RawJob { id: string; words: number[]; action: 'next' | number; after: number[]; event: number[] }
const keys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;

export function assertView(view: ProgressionView, expected: Expected, initialExperience: number, label: string): void {
  assert.equal(view.phase, expected.phase === 'move-choice' ? 'pending-move' : expected.phase, `${label}: continuation phase`);
  assert.equal(view.sequence, expected.decisions, `${label}: decision sequence`);
  assert.deepEqual(view.creature, expected.creature, `${label}: exact XP/EV/cached stats/HP/friendship/moves/PP`);
  assert.deepEqual(view.award, { sourceExperience: expected.sourceAward, experience: expected.awardExperience,
    remainingExperience: expected.remainingExperience }, `${label}: source division and unapplied remainder`);
  assert.equal(view.creature.experience - initialExperience, expected.appliedExperience, `${label}: applied XP and max-level clipping`);
  assert.equal(view.pendingMove?.moveId ?? 0, expected.pendingMove, `${label}: next move`);
  assert.equal(view.pendingEvolution?.speciesId ?? 0, expected.evolutionSpecies, `${label}: evolution handoff`);
  assert.deepEqual(view.events, expected.apiEvents, `${label}: source continuation event order`);
  assert.deepEqual(view.origin, { kind: 'diagnostic' }); assert.equal(view.inventory, null); assert.equal(view.capture, null);
  assert.equal(view.combatReadmission, 'unsupported');
  if (view.pendingMove) assert.match(view.pendingMove.decisionId, /^[a-f0-9]{64}$/);
}
export function decide(session: ProgressionSession, choice: Decision): ProgressionView {
  const pending = session.view().pendingMove; assert(pending);
  return session.decide({ ...choice, decisionId: pending.decisionId });
}
export function rawWords(raw: RawProgressionExports): number[] {
  return Array.from({ length: 64 }, (_, index) => raw.progression_state_get(index) >>> 0);
}
export function rawEvent(raw: RawProgressionExports): number[] {
  return Array.from({ length: 3 }, (_, index) => raw.progression_event_get(index) >>> 0);
}
export function inputWords(input: ProgressionDiagnostic): number[] {
  const c = input.creature, context = input.friendshipContext;
  return [7, 25, 1, c.experience, c.level, c.friendship, c.hp, ...keys.map(key => c.stats[key]),
    ...keys.map(key => c.ivs[key]), ...keys.map(key => c.evs[key]), ...c.moves.map(move => move.moveId),
    ...c.moves.map(move => move.pp), 0, context.ballItemId, context.metLocation, 0, 0, 0, 0,
    ...keys.map(key => c.calculatedEvs[key])];
}
export function startRaw(raw: RawProgressionExports, input: ProgressionDiagnostic): void {
  raw.progression_input_begin(); inputWords(input).forEach((word, index) => assert.equal(raw.progression_input_set(index, word), 0));
  assert.equal(raw.progression_start(input.defeated.speciesId, input.defeated.level, input.friendshipContext.currentRegion,
    input.experienceOverride === undefined ? 0 : 1, input.experienceOverride ?? 0), 0);
}
export function importRaw(raw: RawProgressionExports, words: number[]): number {
  raw.progression_import_begin(); words.forEach((word, index) => assert.equal(raw.progression_import_set(index, word), 0));
  return raw.progression_import_commit();
}
export function assertRaw(raw: RawProgressionExports, expected: Expected, context: ProgressionDiagnostic['friendshipContext'], label: string): void {
  const c = expected.creature;
  const words = [7, 25, 1, c.experience, c.level, c.friendship, c.hp, ...keys.map(key => c.stats[key]),
    ...keys.map(key => c.ivs[key]), ...keys.map(key => c.evs[key]), ...c.moves.map(move => move.moveId),
    ...c.moves.map(move => move.pp), 0, context.ballItemId, context.metLocation, 0, 0, 0, 0];
  assert.deepEqual(Array.from({ length: 40 }, (_, index) => raw.progression_mon_get(index) >>> 0), words, `${label}: raw source mon`);
  assert.deepEqual(rawWords(raw).slice(16, 22), keys.map(key => expected.statBasisEvs[key]), `${label}: cached-stat basis`);
  assert.equal(raw.progression_get(0), expected.phase === 'move-choice' ? 3 : expected.phase === 'pending-evolution' ? 4 : 5);
  assert.equal(raw.progression_get(1), expected.pendingMove); assert.equal(raw.progression_get(2), expected.remainingExperience);
  assert.equal(raw.progression_get(3), expected.awardExperience); assert.equal(raw.progression_get(4), expected.evolutionSpecies);
  assert.equal(raw.progression_get(6), expected.sourceAward);
}
