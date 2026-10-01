/** Test-only field mappings; all expected mechanics come from source literals. */
import assert from 'node:assert/strict';
import type { ProgressionCreature } from '../battle-progression/progression';
import type { LossCheckpoint, LossView } from './loss';

export type FixtureCreature = Omit<ProgressionCreature, 'status' | 'moves'> & {
  status: number; moves: { moveId: number; pp: number; ppUps: number }[];
};
export interface FieldState { flags: number; route16: number; safariEntrance: number; questLogEntrance: number;
  eliteFourFlags: number; championFlags: number; league: number; avatarFlags: number; direction: number; hasDirection: boolean }
export interface Warp { mapGroup: number; mapNum: number; warpId: number; x: number; y: number }
export interface FixtureInput { creature: FixtureCreature; opponentLevel: number; outcome: 'lost' | 'draw';
  context: { money: number; badgeMask: number; healLocationId: number; brockDefeated: boolean; field: FieldState } }
export interface Expected { sequence: number; creature: FixtureCreature; moneyBefore: number; money: number; moneyLoss: number;
  badgeCount: number; friendshipBefore: number; friendshipLoss: number; field: FieldState; lastHeal: Warp;
  respawn: { destination: Warp; healerLocalId: number; arrivalScript: string; message: 'mom' | 'nurse' | 'nurse-pre-brock' } | null }
export interface Fixture { id: string; input: FixtureInput; stages: Expected[] }
export interface Fixtures { sourceFingerprint: string; independence: string; cases: Fixture[];
  badgeMultipliers: number[]; healLocations: { id: number; lastHeal: Warp; destination: Warp; healerLocalId: number }[] }
export interface RecoveryJob { id: string; input: FixtureInput; checkpoint: LossCheckpoint; expected: Expected[] }
export interface RawLoss {
  loss_input_begin(): number; loss_input_set(index: number, word: number): number; loss_start(): number;
  loss_advance(): number; loss_state_get(index: number): number;
  loss_import_begin(): number; loss_import_set(index: number, word: number): number; loss_import_commit(): number;
}
const keys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
export function diagnostic(input: FixtureInput) {
  const c = input.context, f = c.field;
  return { creature: structuredClone(input.creature), opponentLevel: input.opponentLevel, outcome: input.outcome,
    context: { money: c.money, badgeMask: c.badgeMask, lastHealId: c.healLocationId, fieldFlagMask: f.flags,
      route16Scene: f.route16, safariEntranceScene: f.safariEntrance, questLogEntrance: f.questLogEntrance,
      eliteFourFlagMask: f.eliteFourFlags, championTrainerMask: f.championFlags, leagueScene: f.league,
      avatarFlags: f.avatarFlags, direction: f.direction, hasDirection: f.hasDirection,
      brockDefeated: c.brockDefeated, trainerTowerScene: 0 as const } };
}
export function monWords(c: FixtureCreature): number[] {
  const bonuses = c.moves.reduce((sum, move, index) => sum | (move.ppUps << (2 * index)), 0);
  return [7, 25, 1, c.experience, c.level, c.friendship, c.hp, ...keys.map(key => c.stats[key]),
    ...keys.map(key => c.ivs[key]), ...keys.map(key => c.evs[key]), ...c.moves.map(move => move.moveId),
    ...c.moves.map(move => move.pp), bonuses, 0xFFFFFFFF, 0xFFFFFFFF, c.status, 0, 0, 0];
}
export function inputWords(input: FixtureInput): number[] {
  const c = input.context, f = c.field;
  return [...monWords(input.creature), ...keys.map(key => input.creature.calculatedEvs[key]),
    c.money, c.badgeMask, c.healLocationId, input.opponentLevel, input.outcome === 'lost' ? 2 : 3,
    f.flags, f.route16, f.safariEntrance, f.questLogEntrance, f.eliteFourFlags, f.championFlags, f.league,
    f.avatarFlags, f.direction, Number(f.hasDirection), Number(c.brockDefeated), 0, 0];
}
export function expectedWords(input: FixtureInput, expected: Expected): number[] {
  const e = expected, f = e.field, warp = (value: Warp) => [value.mapGroup, value.mapNum, value.warpId >>> 0, value.x, value.y];
  const script = e.respawn?.message === 'mom' ? 1 : e.respawn?.message === 'nurse-pre-brock' ? 2 : e.respawn?.message === 'nurse' ? 3 : 0;
  return [1, e.sequence, e.moneyBefore, e.money, e.moneyLoss, input.context.badgeMask, input.context.healLocationId,
    input.opponentLevel, input.outcome === 'lost' ? 2 : 3, f.flags, f.route16, f.safariEntrance, f.questLogEntrance,
    f.eliteFourFlags, f.championFlags, f.league, f.avatarFlags, f.direction, Number(f.hasDirection), Number(input.context.brockDefeated), 0,
    e.respawn?.healerLocalId ?? 0, script, ...(e.respawn ? warp(e.respawn.destination) : [0, 0, 0, 0, 0]),
    ...warp(e.lastHeal), e.friendshipBefore, e.friendshipLoss, 1,
    ...keys.map(key => e.creature.calculatedEvs[key]), ...Array<number>(6).fill(0), ...monWords(e.creature), ...Array<number>(8).fill(0)];
}
export function rawWords(raw: RawLoss): number[] { return Array.from({ length: 96 }, (_, i) => raw.loss_state_get(i) >>> 0); }
export function startRaw(raw: RawLoss, input: FixtureInput): void {
  raw.loss_input_begin(); inputWords(input).forEach((word, index) => assert.equal(raw.loss_input_set(index, word), 0));
  assert.equal(raw.loss_start(), 0);
}
export function importRaw(raw: RawLoss, words: number[]): number {
  raw.loss_import_begin(); words.forEach((word, index) => assert.equal(raw.loss_import_set(index, word), 0));
  return raw.loss_import_commit();
}
export function assertRaw(raw: RawLoss, input: FixtureInput, expected: Expected, label: string): void {
  assert.deepEqual(rawWords(raw), expectedWords(input, expected), `${label}: complete independent 96-word source state`);
}

// These are the exact named effects of the source reset sequence, rather than
// a blanket story reset. Comparing the complete sets protects unrelated data.
export const CLEAR_FLAGS = [0x4B8, 0x4B9, 0x4BA, 0x4BB, 0x4BC, 0x830, 0x802, 0x800, 0x805, 0x806, 0x808];
export const CLEAR_TRAINERS = [438, 439, 440, 739, 740, 741];
export const RESET_VARIABLES = [0x4068, 0x405E, 0x406E, 0x404D];

export function assertView(view: LossView, input: FixtureInput, expected: Expected, label: string): void {
  const e = expected, f = e.field;
  assert.equal(view.sequence, e.sequence, `${label}: stage sequence`);
  assert.equal(view.phase, ['ready', 'faint-applied', 'pending-world-application'][e.sequence]);
  assert.deepEqual(view.creature, e.creature, `${label}: exact friendship/HP/status/PP with retained XP/EV/stat cache`);
  assert.deepEqual(view.money, { before: e.moneyBefore, previewLoss: e.moneyLoss,
    loss: e.moneyBefore - e.money, after: e.money }, `${label}: preview is not a second debit`);
  assert.deepEqual(view.friendship, { before: e.friendshipBefore, loss: e.friendshipLoss, after: e.creature.friendship });
  assert.deepEqual(view.context, { ...diagnostic(input).context, money: e.money, fieldFlagMask: f.flags,
    route16Scene: f.route16, safariEntranceScene: f.safariEntrance, questLogEntrance: f.questLogEntrance,
    eliteFourFlagMask: f.eliteFourFlags, championTrainerMask: f.championFlags, leagueScene: f.league,
    avatarFlags: f.avatarFlags, direction: f.direction, hasDirection: f.hasDirection });
  if (e.respawn) {
    assert(view.respawn); const { script, messageVariant, ...location } = view.respawn;
    assert.deepEqual(location, { ...e.respawn.destination, healerLocalId: e.respawn.healerLocalId });
    assert.equal(script, e.respawn.arrivalScript);
    assert.equal(messageVariant, e.respawn.message === 'mom' ? null : e.respawn.message);
    assert(view.fieldChanges);
    const ordered = (rows: number[]) => rows.slice().sort((a, b) => a-b);
    assert.deepEqual(ordered(view.fieldChanges.clearFlags), ordered(CLEAR_FLAGS), `${label}: only named reset flags`);
    assert.deepEqual(ordered(view.fieldChanges.clearTrainerFlags), ordered(CLEAR_TRAINERS));
    assert.deepEqual(view.fieldChanges.setVariables.slice().sort((a, b) => a.id-b.id),
      RESET_VARIABLES.map(id => ({ id, value: 0 })).sort((a, b) => a.id-b.id));
    assert.deepEqual(view.fieldChanges.avatar, { flags: 1, direction: 2, hasDirection: true });
  } else { assert.equal(view.respawn, null); assert.equal(view.fieldChanges, null); }
  assert.deepEqual(view.origin, { kind: 'diagnostic' }); assert.equal(view.inventory, null);
  assert.equal(view.worldApplication, 'pending'); assert.equal(view.combatReadmission, 'unsupported');
}
