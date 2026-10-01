/** Test-only literals and observations; no mechanical expectations come from WASM. */
import assert from 'node:assert/strict';
import { Route1Driver, instantiateRoute1, ROUTE1_SOURCE, ROUTE1_PROFILE, type Route1Checkpoint, type Route1Choice, type Route1Event,
  type Route1Initial, type Route1Resources, type Route1Exports } from './driver';
import { assertOracleCreature, assertOracleWords, type ExpectedCreature, type ExpectedState } from '../encounter-core/verify-support';

export interface Draw { draw: number; role: string; before: number; value: number; after: number }
export interface State {
  sequence: number; turn: number; phase: string; outcome: string | null; runTries: number; wildSlot: number;
  rngState: number; rngDraws: number; actors: { hp: number; pp: number[]; stages: number[] }[];
}
interface LiteralMove {
  kind: 'move'; actor: 0 | 1; slot: number; moveId: number; flags: number; baseDamage: number;
  afterCritical: number; afterType: number; damage: number; hpDealt: number; targetHP: number; critical: 1 | 2;
  recoil: number; recoilDealt: number; ppAfter: number | null; commands: { type: number; battler: number; value: number }[];
}
type LiteralEvent = LiteralMove | Exclude<Route1Event, { kind: 'attack' | 'run' }>
  | { kind: 'run'; success: boolean; threshold: number | null; runTries: number };
export interface LiteralBoundary { state: State; events: LiteralEvent[]; trace: Draw[] }
export interface LiteralStep { choice: Route1Choice; expected: LiteralBoundary }
export interface Fixture {
  id: string; encounterSeeds: { mainSeed: number; wildSeed: number; trainerId: number };
  player: { hp: number; pp: [number, number] }; encounterExpected: ExpectedCreature; encounterState: ExpectedState;
  inventory?: { potion: number; pokeBall: number };
  initial: LiteralBoundary; steps: LiteralStep[];
  rawBoundaryOverrides?: { wildHp?: number; wildPp?: number[]; stages?: number[][]; runTries?: number };
}
export interface Fixtures {
  schemaVersion: number; sourceFingerprint: string; scope: string; independence: string;
  schedulingAdaptation: string; rawBoundaryPolicy: string; sourceRecords: unknown[]; cases: Fixture[];
}
export interface RecoveryJob { id: string; checkpoint: Route1Checkpoint; expected: State; remaining: LiteralStep[] }

export function summary(checkpoint: Route1Checkpoint): State {
  const w = checkpoint.core.words, h = checkpoint.host;
  return { sequence: h.sequence, turn: h.turn, phase: h.phase, outcome: h.outcome, runTries: w[148]!, wildSlot: h.wildSlot,
    rngState: checkpoint.rng.state, rngDraws: checkpoint.rng.draws,
    actors: [16, 64].map(offset => ({ hp: w[offset + 1]!, pp: w.slice(offset + 26, offset + 30), stages: w.slice(offset + 14, offset + 22) })) };
}
export function assertState(checkpoint: Route1Checkpoint, expected: State, label: string): void {
  assert.deepEqual(summary(checkpoint), expected, `${label}: literal HP, PP, stages, pending AI, outcome and RNG`);
}
export function eventsFromLiteral(events: LiteralEvent[]): Route1Event[] {
  return events.map(event => {
    if (event.kind === 'run') return { kind: 'run', escaped: event.success, attempts: event.runTries };
    if (event.kind !== 'move') return event;
    const { actor, slot, moveId, baseDamage, afterCritical, afterType, damage, flags, hpDealt, targetHP, critical, commands } = event;
    return { kind: 'attack', actor, slot, moveId, result: { baseDamage, afterCritical, afterType, damage, flags, hpDealt, targetHP, critical }, commands } as Route1Event;
  });
}
export function assertStep(events: Route1Event[], checkpoint: Route1Checkpoint, expected: LiteralBoundary, label: string): void {
  assert.deepEqual(events, eventsFromLiteral(expected.events), `${label}: source event ordering, attack arithmetic and controller updates`);
  assertState(checkpoint, expected.state, label);
}
export function checkTrace(trace: Draw[], state: number, draws: number): void {
  for (const row of trace) {
    assert.equal(row.before, state); assert.equal(row.draw, ++draws);
    state = Number((BigInt(state) * 1103515245n + 24691n) & 0xFFFFFFFFn);
    assert.equal(row.after, state); assert.equal(row.value, state >>> 16);
  }
}
export function exportRaw(api: Route1Exports, boundary: 0 | 3 = 0): number[] {
  assert.equal(api.spike3_checkpoint_export(boundary), 0);
  return Array.from({ length: 152 }, (_, index) => api.spike3_checkpoint_get(index) >>> 0);
}
export function importRaw(api: Route1Exports, words: number[], boundary: 0 | 3 = 0): number {
  assert.equal(api.spike3_import_begin(3, boundary, 152), 0);
  words.forEach((word, index) => assert.equal(api.spike3_import_set(index, word), 0));
  return api.spike3_import_commit();
}

/** Only the labeled raw cases configure depleted enemy mechanical state.
 * Every immutable real identity/stat and the RNG anchor remains source-derived.
 * This is a trusted private diagnostic boundary, not normal battle admission. */
export function initialize(module: WebAssembly.Module, resources: Route1Resources,
  fixture: Pick<Fixture, 'id' | 'encounterSeeds' | 'encounterExpected' | 'encounterState' | 'player' | 'inventory' | 'rawBoundaryOverrides'>): Route1Driver {
  const factory = resources.encounters.create(fixture.encounterSeeds), generated = factory.generate();
  assert.equal(generated.kind, 'encounter');
  if (generated.kind !== 'encounter') throw new Error('Missing fixture creature');
  assertOracleCreature(generated.creature, fixture.encounterExpected, fixture.id);
  assertOracleWords(factory.snapshot().words, fixture.encounterState, fixture.encounterSeeds.trainerId, fixture.encounterExpected, fixture.id);
  const initial: Route1Initial = { encounter: factory.snapshot(), player: fixture.player, inventory: fixture.inventory ?? { potion: 0, pokeBall: 0 } };
  if (!fixture.rawBoundaryOverrides) return new Route1Driver(module, resources, initial);
  const api = instantiateRoute1(module), overrides = fixture.rawBoundaryOverrides;
  assert.equal(api.spike_reset(initial.encounter.words[1]!), 0);
  for (const actor of [0, 1] as const) {
    const mon: typeof resources.profile.creature | typeof generated.creature = actor === 0 ? resources.profile.creature : generated.creature;
    const stats: { hp: number; attack: number; defense: number; speed: number; spAttack: number; spDefense: number } = mon.stats;
    const types: [number, number] = actor === 0 ? [11, 11] : mon.speciesId === 16 ? [0, 2] : [0, 0];
    const hp: number = actor === 0 ? initial.player.hp : overrides.wildHp ?? mon.hp;
    assert.equal(api.spike_set_battler(actor, mon.level, hp, stats.hp, stats.attack, stats.defense,
      stats.spAttack, stats.spDefense, types[0]!, types[1]!, 0, 0), 0);
    assert.equal(api.route1_set_identity(actor, mon.speciesId, mon.abilityId), 0);
    assert.equal(api.spike2_set_speed(actor, stats.speed), 0);
    for (let slot = 0; slot < 4; slot++) {
      const move: { moveId: number; pp: number } | undefined = mon.moves[slot];
      const pp: number = actor === 0 ? initial.player.pp[slot] ?? 0 : overrides.wildPp?.[slot] ?? move?.pp ?? 0;
      assert.equal(api.spike2_set_move(actor, slot, move?.moveId ?? 0, pp), 0);
    }
    for (let stat = 0; stat < 8; stat++) assert.equal(api.spike2_set_stage(actor, stat, overrides.stages?.[actor]?.[stat] ?? 6), 0);
    for (let slot = 0; slot < 6; slot++) assert.equal(api.spike2_set_party(actor, slot, slot === 0 ? mon.speciesId : 0, slot === 0 ? hp : 0, 0), 0);
  }
  assert.equal(api.route1_start(), 0);
  const wildSlot = api.route1_choose_wild(); assert(wildSlot >= 0 && wildSlot <= 4);
  const words = exportRaw(api);
  words[148] = overrides.runTries ?? 0;
  const checkpoint: Route1Checkpoint = { schemaVersion: 2, profile: ROUTE1_PROFILE,
    sourceFingerprint: ROUTE1_SOURCE, admission: initial,
    host: { sequence: 0, eventSequence: 0, turn: 1, phase: 'choice', outcome: null, wildSlot, inventory: initial.inventory },
    capture: null, core: { version: 3, boundary: 0, words }, rng: { state: words[4]!, draws: words[5]! } };
  return Route1Driver.restore(module, resources, checkpoint);
}
