/** ABI/view mapping only; expectations are independently authored source literals. */
import assert from 'node:assert/strict';
import type { EvolutionCheckpoint, EvolutionCreature, EvolutionDiagnostic, EvolutionSession, EvolutionView, RawEvolutionExports } from './evolution';
export type FixtureCreature = EvolutionCreature & { nature: number; gender: number };
export interface FixtureInput { creature: FixtureCreature; context: { nickname: string; language: 2; targetSeen: boolean;
  targetCaught: boolean; evolutionStat: number; canCancel: boolean } }
export interface SourceEvent { kind: number; value: number; slot: number }
export interface Expected { phase: number; preSpecies: number; target: number; choice: number; stopped: boolean; learnFirst: boolean;
  cursor: number; moveToLearn: number; seen: boolean; caught: boolean; count: number; renamed: boolean; lastReturn: number;
  event: SourceEvent; lastDecisionSlot: number; nickname: string; nicknameBytes: number[]; creature: FixtureCreature }
export type Operation = { kind: 'choose'; accept: boolean } | { kind: 'next' } | { kind: 'decide'; slot: number };
export interface RawExpected { operation: Operation | null; expected: Expected }
export interface Settled { sequence: number; expected: Expected; events: SourceEvent[] }
export interface Fixture { id: string; input: FixtureInput; accept: boolean; decisions: number[]; raw: RawExpected[]; settled: Settled[] }
export interface Fixtures { sourceFingerprint: string; independence: string; cases: Fixture[];
  eligibility: { id: string; input: FixtureInput; target: number }[] }
export interface HostJob { caseIndex: number; settledIndex: number; checkpoint: EvolutionCheckpoint }
export interface RawJob { caseIndex: number; rawIndex: number; words: number[] }
const keys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
export function diagnosticCreature(input: FixtureCreature): EvolutionCreature {
  const { nature: _nature, gender: _gender, ...creature } = structuredClone(input); return creature;
}
export function diagnostic(input: FixtureInput): EvolutionDiagnostic {
  const c = input.context;
  return { creature: diagnosticCreature(input.creature), context: { nickname: c.nickname, language: c.language,
    targetDex: { seen: c.targetSeen, caught: c.targetCaught }, evolutionStat: c.evolutionStat, canCancel: c.canCancel } };
}
const glyphs: Record<string, number> = { ' ': 0,
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65+i), 0xBB+i])),
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String.fromCharCode(97+i), 0xD5+i])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), 0xA1+i])),
  '!': 0xAB, '?': 0xAC, '.': 0xAD, '-': 0xAE, '…': 0xB0, '“': 0xB1, '”': 0xB2, '‘': 0xB3,
  "'": 0xB4, '♂': 0xB5, '♀': 0xB6, ',': 0xB8, '/': 0xBA };
export function encodedName(text: string): number[] {
  assert([...text].length <= 10);
  return [...[...text].map(char => { assert(char in glyphs); return glyphs[char]!; }), ...Array<number>(11-[...text].length).fill(255)];
}
export function monWords(c: FixtureCreature): number[] {
  return [c.speciesId, c.personality, c.otId, c.experience, c.level, c.friendship, c.hp,
    ...keys.map(key => c.stats[key]), ...keys.map(key => c.ivs[key]), ...keys.map(key => c.evs[key]),
    ...c.moves.map(move => move.moveId), ...c.moves.map(move => move.pp),
    c.moves.reduce((bits, move, index) => bits | move.ppUps << (2*index), 0), c.ballItemId ?? 0xFFFFFFFF,
    c.metLocation ?? 0xFFFFFFFF, c.status, c.heldItemId, 0, c.abilityNum];
}
export function inputWords(input: FixtureInput): number[] {
  const c = input.context;
  return [...monWords(input.creature), ...keys.map(key => input.creature.calculatedEvs[key]), ...encodedName(c.nickname),
    c.language, Number(c.targetSeen), Number(c.targetCaught), c.evolutionStat, Number(c.canCancel), ...Array<number>(10).fill(0)];
}
export function expectedWords(input: FixtureInput, expected: Expected): number[] {
  const e = expected, c = input.context;
  return [1, e.phase, 1, e.preSpecies, e.target, e.choice, Number(e.stopped), Number(e.learnFirst), e.cursor,
    e.moveToLearn, Number(c.targetSeen), Number(c.targetCaught), Number(e.seen), Number(e.caught), c.evolutionStat,
    e.count, Number(e.renamed), e.lastReturn, Number(c.canCancel), e.event.kind, e.event.value, e.event.slot,
    c.language, e.lastDecisionSlot, Number(e.seen), Number(e.seen), ...keys.map(key => e.creature.calculatedEvs[key]),
    ...e.nicknameBytes, ...Array<number>(5).fill(0), ...monWords(e.creature), ...Array<number>(40).fill(0)];
}
export function rawWords(raw: RawEvolutionExports): number[] {
  return Array.from({ length: 128 }, (_, i) => raw.evolution_state_get(i) >>> 0);
}
export function startRaw(raw: RawEvolutionExports, input: FixtureInput): number {
  assert.equal(raw.evolution_input_begin(), 0);
  inputWords(input).forEach((value, index) => assert.equal(raw.evolution_input_set(index, value), 0));
  return raw.evolution_start();
}
export function importRaw(raw: RawEvolutionExports, words: number[]): number {
  assert.equal(raw.evolution_import_begin(), 0);
  words.forEach((value, index) => assert.equal(raw.evolution_import_set(index, value), 0));
  return raw.evolution_import_commit();
}
export function operateRaw(raw: RawEvolutionExports, operation: Operation): void {
  const result = operation.kind === 'choose' ? raw.evolution_choose(Number(operation.accept))
    : operation.kind === 'next' ? raw.evolution_next() : raw.evolution_decide(operation.slot);
  assert.equal(result, 0, `source operation ${JSON.stringify(operation)}`);
}
export function hostDecision(session: EvolutionSession, fixture: Fixture, nextSequence: number): void {
  const view = session.view(), pending = view.pendingEvolution ?? view.pendingMove; assert(pending);
  const slot = fixture.decisions[nextSequence-2];
  session.decide({ expectedSequence: view.sequence, decisionId: pending.decisionId,
    ...(nextSequence === 1 ? { kind: fixture.accept ? 'accept-evolution' : 'cancel-evolution' }
      : slot === 4 ? { kind: 'decline-move' } : { kind: 'replace-move', slot }) });
}
export function assertRaw(raw: RawEvolutionExports, input: FixtureInput, expected: Expected, label: string): void {
  assert.deepEqual(rawWords(raw), expectedWords(input, expected), `${label}: complete independent 128-word source state`);
  assert.equal(raw.evolution_get(3), expected.creature.nature);
  assert.equal(raw.evolution_get(4), expected.creature.abilityId);
  assert.equal(raw.evolution_get(5), expected.creature.gender);
}
export function assertView(view: EvolutionView, input: FixtureInput, settled: Settled, label: string): void {
  const e = settled.expected, c = input.context;
  assert.equal(view.sequence, settled.sequence, label);
  assert.equal(view.phase, ({ 1: 'pending-evolution', 3: 'pending-move', 4: 'pending-ownership-application' } as Record<number, string>)[e.phase]);
  assert.deepEqual(view.creature, diagnosticCreature(e.creature)); assert.equal(view.nickname, e.nickname);
  assert.equal(view.language, 2); assert.equal(view.targetSpecies, e.target);
  assert.equal(view.result, e.choice === 0 ? null : e.choice === 1 ? 'evolved' : 'cancelled');
  assert.deepEqual(view.dex, { before: { seen: c.targetSeen, caught: c.targetCaught }, after: { seen: e.seen, caught: e.caught } });
  assert.deepEqual(view.evolutionStat, { before: c.evolutionStat, after: e.count }); assert.equal(view.renamed, e.renamed);
  const kinds = ['', 'evolved', 'cancelled', 'learned-move', 'replaced-move', 'declined-move', 'complete'];
  assert.deepEqual(view.events, settled.events.map(event => ({ ...event, kind: kinds[event.kind] })));
  if (e.phase === 1) {
    assert(view.pendingEvolution); assert.match(view.pendingEvolution.decisionId, /^[a-f0-9]{64}$/);
    assert.equal(view.pendingEvolution.speciesId, e.target); assert.equal(view.pendingEvolution.canCancel, c.canCancel);
  } else assert.equal(view.pendingEvolution, null);
  if (e.phase === 3) { assert(view.pendingMove); assert.match(view.pendingMove.decisionId, /^[a-f0-9]{64}$/); assert.equal(view.pendingMove.moveId, e.moveToLearn); }
  else assert.equal(view.pendingMove, null);
  assert.deepEqual(view.origin, { kind: 'diagnostic' }); assert.equal(view.inventory, null);
  assert.equal(view.ownershipApplication, 'pending'); assert.equal(view.combatReadmission, 'unsupported');
}
