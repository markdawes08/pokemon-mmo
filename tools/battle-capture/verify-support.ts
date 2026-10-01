/** Test-only ABI mappings. All expected mechanics are independent JSON literals. */
import assert from 'node:assert/strict';
import type { CaptureCheckpoint, CaptureCreature, CaptureDiagnostic, CaptureSession, CaptureView, RawCaptureExports } from './capture';

export interface FixtureContext { trainerName: string; trainerGender: 0 | 1; seen: boolean; caught: boolean; captureCount: number;
  partyMask: number; currentBox: number; sendBox: number; shownFullMessage: boolean; billPC: boolean; boxMasks: number[] }
export interface FixtureInput { creature: CaptureCreature; context: FixtureContext }
export type FixtureDecision = { kind: 'keep' } | { kind: 'rename'; name: string };
export interface Expected { sequence: 0 | 1 | 2 | 3; creature: CaptureCreature; context: FixtureContext;
  nickname: string; nicknameBytes: number[]; trainerNameBytes: number[]; metLevel: number; metLocation: number; metGame: 4;
  language: 2; ballItemId: 4; otGender: 0 | 1; mail: number; newDex: boolean; scratchBox: number; decision: number;
  partyCount: number; pcMessage: number; placement: { kind: 'party'; slot: number } | { kind: 'box'; box: number; slot: number } | null }
export interface Fixture { id: string; input: FixtureInput; decision: FixtureDecision; stages: Expected[] }
export interface Fixtures { sourceFingerprint: string; independence: string; cases: Fixture[]; keyboard: Record<string, number> }
export interface RecoveryJob { id: string; input: FixtureInput; decision: FixtureDecision; checkpoint: CaptureCheckpoint; expected: Expected[] }
const keys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
const glyphs: Record<string, number> = { ' ': 0,
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65+i), 0xBB+i])),
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [String.fromCharCode(97+i), 0xD5+i])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), 0xA1+i])),
  '!': 0xAB, '?': 0xAC, '.': 0xAD, '-': 0xAE, '…': 0xB0, '“': 0xB1, '”': 0xB2, '‘': 0xB3,
  "'": 0xB4, '♂': 0xB5, '♀': 0xB6, ',': 0xB8, '/': 0xBA };
export function encodedName(text: string, capacity: number): number[] {
  const chars = [...text]; assert(chars.length <= capacity);
  return [...chars.map(char => { assert(char in glyphs); return glyphs[char]!; }), ...Array<number>(capacity+1-chars.length).fill(255)];
}
export function diagnostic(input: FixtureInput): CaptureDiagnostic {
  const c = input.context;
  return { creature: structuredClone(input.creature), context: { trainerName: c.trainerName, trainerGender: c.trainerGender,
    trainerId: input.creature.otId, dex: { seen: c.seen, caught: c.caught }, captureStat: c.captureCount,
    partyMask: c.partyMask, boxMasks: c.boxMasks.slice(), currentBox: c.currentBox, lastSentBox: c.sendBox,
    shownBoxWasFullMessage: c.shownFullMessage, knowsBill: c.billPC } };
}
export function monWords(c: CaptureCreature): number[] {
  return [c.speciesId, c.personality, c.otId, c.experience, c.level, c.friendship, c.hp,
    ...keys.map(key => c.stats[key]), ...keys.map(key => c.ivs[key]), ...keys.map(key => c.evs[key]),
    ...c.moves.map(move => move.moveId), ...c.moves.map(move => move.pp), 0, 4, 101, 0, 0, 0, c.abilityNum];
}
export function inputWords(input: FixtureInput): number[] {
  const c = input.context;
  return [...monWords(input.creature), c.trainerGender, ...encodedName(c.trainerName, 7), Number(c.seen), Number(c.caught), c.captureCount,
    c.partyMask, c.currentBox, c.sendBox, Number(c.shownFullMessage), Number(c.billPC), ...c.boxMasks, ...Array<number>(9).fill(0)];
}
export function expectedWords(input: FixtureInput, expected: Expected): number[] {
  const e = expected, c = e.context, initial = input.context, p = e.placement;
  return [1, e.sequence, 1, c.trainerGender, Number(initial.seen), Number(initial.caught), Number(c.seen), Number(c.caught),
    initial.captureCount, c.captureCount, Number(e.newDex), initial.partyMask, c.partyMask, e.partyCount,
    c.currentBox, c.sendBox, Number(c.shownFullMessage), Number(c.billPC), e.scratchBox,
    p ? p.kind === 'party' ? 1 : 2 : 0, p?.kind === 'party' ? p.slot : 0xFFFFFFFF,
    p?.kind === 'box' ? p.box : 0xFFFFFFFF, p?.kind === 'box' ? p.slot : 0xFFFFFFFF,
    p ? p.kind === 'party' ? 0 : 1 : 0xFFFFFFFF, e.decision, e.pcMessage, 0, Number(c.seen), Number(c.seen), 0,
    Number(e.sequence === 3), 0, ...c.boxMasks, ...e.trainerNameBytes, ...e.nicknameBytes,
    e.metLevel, e.metGame, e.language, e.otGender, e.mail, ...Array<number>(10).fill(0), ...monWords(e.creature), ...Array<number>(40).fill(0)];
}
export function rawWords(raw: RawCaptureExports): number[] {
  return Array.from({ length: 160 }, (_, index) => raw.capture_state_get(index) >>> 0);
}
export function startRaw(raw: RawCaptureExports, input: FixtureInput): void {
  assert.equal(raw.capture_input_begin(), 0);
  inputWords(input).forEach((value, index) => assert.equal(raw.capture_input_set(index, value), 0));
  assert.equal(raw.capture_capacity(), 0); assert.equal(raw.capture_start(), 0);
}
export function importRaw(raw: RawCaptureExports, words: number[]): number {
  assert.equal(raw.capture_import_begin(), 0);
  words.forEach((value, index) => assert.equal(raw.capture_import_set(index, value), 0));
  return raw.capture_import_commit();
}
export function rawDecision(raw: RawCaptureExports, decision: FixtureDecision): void {
  if (decision.kind === 'rename') {
    assert.equal(raw.capture_name_begin(), 0);
    encodedName(decision.name, 10).forEach((value, index) => assert.equal(raw.capture_name_set(index, value), 0));
  }
  assert.equal(raw.capture_decide(decision.kind === 'keep' ? 0 : 1), 0);
}
export function hostDecision(session: CaptureSession, decision: FixtureDecision): void {
  const pending = session.view().pendingNickname; assert(pending);
  session.decideNickname({ expectedSequence: 1, decisionId: pending.decisionId,
    ...(decision.kind === 'keep' ? { kind: 'keep-species-name' } : { kind: 'nickname', name: decision.name }) });
}
export function advanceBoth(session: CaptureSession, raw: RawCaptureExports, sequence: number, decision: FixtureDecision): void {
  if (sequence === 2) { hostDecision(session, decision); rawDecision(raw, decision); }
  else { assert(sequence === 1 || sequence === 3); session.advance({ expectedSequence: sequence-1 }); assert.equal(raw.capture_advance(), 0); }
}
export function assertRaw(raw: RawCaptureExports, input: FixtureInput, expected: Expected, label: string): void {
  assert.deepEqual(rawWords(raw), expectedWords(input, expected), `${label}: complete independent 160-word source state`);
}
export function assertView(view: CaptureView, input: FixtureInput, expected: Expected, label: string): void {
  const e = expected, c = e.context;
  assert.equal(view.sequence, e.sequence, label);
  assert.equal(view.phase, ['ready', 'pending-nickname', 'nickname-applied', 'pending-ownership-application'][e.sequence]);
  const metadata = { nickname: e.nickname, otName: c.trainerName, otGender: e.otGender, language: e.language,
    metGame: e.metGame, metLevel: e.metLevel, metLocation: e.metLocation, ballItemId: e.ballItemId };
  assert.deepEqual(view.metadata, metadata);
  assert.deepEqual(view.dex, { before: { seen: input.context.seen, caught: input.context.caught },
    after: { seen: c.seen, caught: c.caught }, newEntry: e.newDex });
  assert.deepEqual(view.captureStat, { before: input.context.captureCount, after: c.captureCount });
  assert.deepEqual(view.storage, { partyMask: c.partyMask, partyCount: e.partyCount, boxMasks: c.boxMasks, currentBox: c.currentBox,
    lastSentBox: c.sendBox, shownBoxWasFullMessage: c.shownFullMessage, knowsBill: c.billPC,
    message: [null, 'someones-pc', 'bills-pc', 'someones-box-full', 'bills-box-full'][e.pcMessage] });
  if (e.sequence === 1) {
    assert(view.pendingNickname); assert.match(view.pendingNickname.decisionId, /^[a-f0-9]{64}$/);
    assert.equal(view.pendingNickname.speciesName, e.creature.speciesId === 16 ? 'PIDGEY' : 'RATTATA');
    assert.equal(view.pendingNickname.maxLength, 10);
  } else assert.equal(view.pendingNickname, null);
  if (e.placement?.kind === 'box') {
    const { hp: _hp, stats: _stats, status: _status, level: _level, ...boxed } = e.creature;
    assert.equal(view.creature, null);
    assert.deepEqual(view.placement, { ...e.placement, boxedCreature: boxed, metadata });
    assert(view.placement.kind === 'box');
    for (const privatePartyField of ['hp', 'status', 'stats', 'level']) assert(!(privatePartyField in view.placement.boxedCreature));
  } else {
    assert.deepEqual(view.creature, e.creature);
    assert.deepEqual(view.placement, e.placement ? { ...e.placement, creature: e.creature, metadata } : null);
  }
  assert.deepEqual(view.origin, { kind: 'diagnostic' }); assert.equal(view.inventory, null);
  assert.equal(view.ownershipApplication, 'pending'); assert.equal(view.combatReadmission, 'unsupported');
}
