/** Private source capture continuation. These are candidate metadata and
 * placement results, never a grant of owned assets or a live battle admission. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { battleSnapshotSchema } from '@pokewaterblue/battle-core';
import { worldMapSchema } from '@pokewaterblue/content-schema';
import { WORLD_MAP_HASHES } from '@pokewaterblue/protocol';
import { route1InventorySchema } from '../battle-route1/engine';
import { loadProgressionCore, progressionCheckpointSchema, type ProgressionCore } from '../battle-progression/progression';

export const CAPTURE_PROFILE = 'firered-route1-capture-v1' as const;
export const CAPTURE_DEVELOPMENT_POLICY = 'r1-route1-capture-metadata-v1' as const;
export const CAPTURE_STATE_WORDS = 160;
export const CAPTURE_INPUT_WORDS = 80;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sequenceSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const statNames = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
const stats = z.strictObject({ hp: word.min(1).max(65535), attack: word.min(1).max(65535), defense: word.min(1).max(65535),
  speed: word.min(1).max(65535), spAttack: word.min(1).max(65535), spDefense: word.min(1).max(65535) });
const ivs = z.strictObject({ hp: word.max(31), attack: word.max(31), defense: word.max(31),
  speed: word.max(31), spAttack: word.max(31), spDefense: word.max(31) });
const zeroEvs = z.strictObject({ hp: z.literal(0), attack: z.literal(0), defense: z.literal(0),
  speed: z.literal(0), spAttack: z.literal(0), spDefense: z.literal(0) });
export const captureCreatureSchema = z.strictObject({ speciesId: z.union([z.literal(16), z.literal(19)]),
  level: word.min(2).max(5), personality: word, nature: word.max(24), abilityId: z.union([z.literal(50), z.literal(51), z.literal(62)]),
  abilityNum: z.union([z.literal(0), z.literal(1)]), gender: z.union([z.literal(0), z.literal(254)]), otId: word,
  ivs, evs: zeroEvs, stats, hp: word.min(1).max(65535), experience: word, friendship: z.literal(70), status: z.literal(0),
  heldItemId: z.literal(0), moves: z.array(z.strictObject({ moveId: word.max(354), pp: word.max(255), ppUps: z.literal(0) })).length(4),
}).refine(c => c.hp <= c.stats.hp && (c.speciesId !== 19 || c.level <= 4), 'Unsupported captured creature');
export type CaptureCreature = z.infer<typeof captureCreatureSchema>;
export type CaptureBoxCreature = Omit<CaptureCreature, 'level' | 'hp' | 'status' | 'stats'>;
const dexSchema = z.strictObject({ seen: z.boolean(), caught: z.boolean() })
  .refine(dex => !dex.caught || dex.seen, 'Caught dex history requires coherent seen history');
export const captureContextSchema = z.strictObject({ trainerName: z.string(), trainerGender: z.union([z.literal(0), z.literal(1)]), trainerId: word,
  dex: dexSchema, captureStat: word.max(0xFFFFFF), partyMask: word.max(63), boxMasks: z.array(word.max(0x3FFFFFFF)).length(14),
  currentBox: word.max(13), lastSentBox: word.max(13), shownBoxWasFullMessage: z.boolean(), knowsBill: z.boolean() });
export type CaptureContext = z.infer<typeof captureContextSchema>;
export const developmentCaptureContextSchema = captureContextSchema.extend({ policy: z.literal(CAPTURE_DEVELOPMENT_POLICY),
  trainerId: z.literal(1), partyMask: z.literal(1), boxMasks: z.array(z.literal(0)).length(14) }).strict();
export type DevelopmentCaptureContext = z.infer<typeof developmentCaptureContextSchema>;
export const captureDiagnosticSchema = z.strictObject({ creature: captureCreatureSchema, context: captureContextSchema });
export type CaptureDiagnostic = z.infer<typeof captureDiagnosticSchema>;
export const captureNicknameDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ expectedSequence: z.literal(1), decisionId: sha256, kind: z.literal('keep-species-name') }),
  z.strictObject({ expectedSequence: z.literal(1), decisionId: sha256, kind: z.literal('nickname'), name: z.string() }),
]);
export type CaptureNicknameDecision = z.infer<typeof captureNicknameDecisionSchema>;
const admissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('battle-terminal'), battle: battleSnapshotSchema, context: developmentCaptureContextSchema }),
  z.strictObject({ kind: z.literal('progression-capture'), progression: progressionCheckpointSchema, context: developmentCaptureContextSchema }),
  z.strictObject({ kind: z.literal('diagnostic'), initial: captureDiagnosticSchema }),
]);
type Admission = z.infer<typeof admissionSchema>;
const compatibilitySchema = z.strictObject({ profile: z.literal(CAPTURE_PROFILE), abiVersion: z.literal(1),
  developmentPolicy: z.literal(CAPTURE_DEVELOPMENT_POLICY), sourceFingerprint: sha256, wasmSha256: sha256, hostSha256: sha256,
  codecSha256: sha256, progressionCompatibilitySha256: sha256, battleCompatibilitySha256: sha256, routeMapSha256: sha256 });
const checkpointBodySchema = z.strictObject({ schemaVersion: z.literal(1), compatibility: compatibilitySchema, admission: admissionSchema,
  sequence: sequenceSchema, nicknameDecision: captureNicknameDecisionSchema.nullable(), words: z.array(word).length(CAPTURE_STATE_WORDS) });
export const captureCheckpointSchema = checkpointBodySchema.extend({ digest: sha256 }).strict();
export type CaptureCheckpoint = z.infer<typeof captureCheckpointSchema>;
const codecSchema = z.strictObject({ characters: z.array(z.strictObject({ text: z.string(), byte: word.max(254) })).min(1).max(255),
  speciesNames: z.strictObject({ '16': z.literal('PIDGEY'), '19': z.literal('RATTATA') }), eos: z.literal(255),
  nicknameLength: z.literal(10), trainerNameLength: z.literal(7) });
export type CaptureCodec = z.infer<typeof codecSchema>;
export interface RawCaptureExports {
  memory: WebAssembly.Memory;
  capture_abi_version(): number; capture_input_word_count(): number; capture_state_word_count(): number;
  capture_input_begin(): number; capture_input_set(index: number, value: number): number; capture_start(): number;
  capture_advance(): number; capture_name_begin(): number; capture_name_set(index: number, value: number): number; capture_decide(kind: number): number;
  capture_get(index: number): number; capture_mon_get(index: number): number; capture_state_get(index: number): number;
  capture_import_begin(): number; capture_import_set(index: number, value: number): number; capture_import_commit(): number;
  capture_constant(index: number): number; capture_capacity(): number;
}
export interface CaptureMetadata {
  nickname: string; otName: string; otGender: 0 | 1; language: 2; metGame: 4; metLevel: number; metLocation: number; ballItemId: 4;
}
export type CapturePlacement = { kind: 'party'; slot: number; creature: CaptureCreature; metadata: CaptureMetadata }
  | { kind: 'box'; box: number; slot: number; boxedCreature: CaptureBoxCreature; metadata: CaptureMetadata };
export interface CaptureView {
  phase: 'ready' | 'pending-nickname' | 'nickname-applied' | 'pending-ownership-application'; sequence: 0 | 1 | 2 | 3;
  creature: CaptureCreature | null; metadata: CaptureMetadata;
  dex: { before: { seen: boolean; caught: boolean }; after: { seen: boolean; caught: boolean }; newEntry: boolean };
  captureStat: { before: number; after: number };
  pendingNickname: { decisionId: string; speciesName: string; maxLength: 10 } | null;
  placement: CapturePlacement | null;
  storage: { partyMask: number; partyCount: number; boxMasks: number[]; currentBox: number; lastSentBox: number;
    shownBoxWasFullMessage: boolean; knowsBill: boolean; message: 'someones-pc' | 'bills-pc' | 'someones-box-full' | 'bills-box-full' | null };
  inventory: z.infer<typeof route1InventorySchema> | null;
  origin: { kind: 'battle-terminal'; battleId: string; terminalSequence: number; terminalDigest: string; outcome: 'captured' } | { kind: 'diagnostic' };
  ownershipApplication: 'pending'; combatReadmission: 'unsupported';
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
/** Integrity and source replay are not authentication or durable deduplication. */
export function captureCheckpointDigest(body: Omit<CaptureCheckpoint, 'digest'>): string { return hash(canonical(body)); }
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(status: number, operation: string): void { require(status === 0, `Capture C rejected ${operation}: ${status}`); }
const expectedExports = ['memory', ...['abi_version', 'input_word_count', 'state_word_count', 'input_begin', 'input_set', 'start', 'advance',
  'name_begin', 'name_set', 'decide', 'get', 'mon_get', 'state_get', 'import_begin', 'import_set', 'import_commit', 'constant', 'capacity']
  .map(name => `capture_${name}`)].sort();
export function instantiateRawCapture(module: WebAssembly.Module): RawCaptureExports {
  require(WebAssembly.Module.imports(module).length === 0
    && canonical(WebAssembly.Module.exports(module).map(row => row.name).sort()) === canonical(expectedExports), 'Unsupported capture WASM surface');
  const api = new WebAssembly.Instance(module).exports as unknown as RawCaptureExports;
  require(api.capture_abi_version() === 1 && api.capture_input_word_count() === CAPTURE_INPUT_WORDS && api.capture_state_word_count() === CAPTURE_STATE_WORDS
    && api.memory.buffer.byteLength === 262144 && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported capture ABI or memory');
  return api;
}
interface Prepared { creature: CaptureCreature; context: CaptureContext; inventory: CaptureView['inventory']; origin: CaptureView['origin'] }
interface Run { api: RawCaptureExports; prepared: Prepared; words: number[] }
function exportWords(api: RawCaptureExports): number[] { return Array.from({ length: CAPTURE_STATE_WORDS }, (_, index) => api.capture_state_get(index) >>> 0); }
function pendingId(admission: Admission, words: number[]): string { return hash(canonical({ admission, stage: 'pending-nickname', words })); }

export class CaptureCore {
  readonly module: WebAssembly.Module; readonly compatibility: z.infer<typeof compatibilitySchema>;
  private readonly codec: CaptureCodec;
  private readonly encoded = new Map<string, number>(); private readonly decoded = new Map<number, string>();
  constructor(module: WebAssembly.Module, compatibility: z.infer<typeof compatibilitySchema>, private readonly progression: ProgressionCore, codec: unknown) {
    const api = instantiateRawCapture(module); this.module = module;
    this.compatibility = Object.freeze(compatibilitySchema.parse(compatibility)); this.codec = codecSchema.parse(codec);
    require(this.compatibility.progressionCompatibilitySha256 === hash(canonical(progression.compatibility))
      && this.compatibility.battleCompatibilitySha256 === progression.compatibility.battleCompatibilitySha256, 'Capture prerequisite compatibility differs');
    require(api.capture_constant(0) <= 255 && canonical(Array.from({ length: 5 }, (_, index) => api.capture_constant(index + 1)))
      === canonical([2, 4, 4, 14, 30]), 'Capture source metadata/capacity constants differ');
    for (const { text, byte } of this.codec.characters) {
      require([...text].length === 1 && !this.encoded.has(text) && !this.decoded.has(byte), 'Capture character codec is not one-to-one');
      this.encoded.set(text, byte); this.decoded.set(byte, text);
    }
    require(this.encoded.get(' ') === 0, 'Capture source space encoding differs');
    this.encodeText('PIDGEY', 10); this.encodeText('RATTATA', 10);
  }
  /** Source keyboard glyphs only; no Unicode normalization or silent truncation. */
  encodeText(input: unknown, maxLength: 7 | 10): number[] {
    require(maxLength === 7 || maxLength === 10, 'Unsupported source name field');
    const value = z.string().parse(input), glyphs = [...value];
    require(glyphs.length <= maxLength && (maxLength !== 7 || glyphs.some(glyph => glyph !== ' ')), 'Unsupported source name length or blank trainer name');
    const bytes = glyphs.map(glyph => { const byte = this.encoded.get(glyph); require(byte !== undefined, 'Unsupported source name character'); return byte; });
    return [...bytes, ...Array.from({ length: maxLength + 1 - bytes.length }, () => 255)];
  }
  decodeText(bytes: number[]): string {
    const end = bytes.indexOf(255);
    require(end >= 0 && bytes.slice(end).every(byte => byte === 255), 'Malformed source text terminator');
    return bytes.slice(0, end).map(byte => { const glyph = this.decoded.get(byte); require(glyph !== undefined, 'Unsupported source text byte'); return glyph; }).join('');
  }
  /** Explicit fixture metadata/empty storage, not a lookup of account history. */
  developmentContext(input: unknown): DevelopmentCaptureContext {
    const options = z.strictObject({ trainerName: z.string(), trainerGender: z.union([z.literal(0), z.literal(1)]), dex: dexSchema.optional(),
      captureStat: word.max(0xFFFFFF).optional(), currentBox: word.max(13).optional(), lastSentBox: word.max(13).optional(),
      shownBoxWasFullMessage: z.boolean().optional(), knowsBill: z.boolean().optional() }).parse(input);
    this.encodeText(options.trainerName, 7);
    return developmentCaptureContextSchema.parse({ policy: CAPTURE_DEVELOPMENT_POLICY, trainerName: options.trainerName,
      trainerGender: options.trainerGender, trainerId: 1, dex: options.dex ?? { seen: false, caught: false }, captureStat: options.captureStat ?? 0,
      partyMask: 1, boxMasks: Array.from({ length: 14 }, () => 0), currentBox: options.currentBox ?? 0, lastSentBox: options.lastSentBox ?? 0,
      shownBoxWasFullMessage: options.shownBoxWasFullMessage ?? false, knowsBill: options.knowsBill ?? false });
  }
  fromBattle(battle: unknown, context: unknown): CaptureSession { return this.create(admissionSchema.parse({ kind: 'battle-terminal', battle, context })); }
  fromProgression(progression: unknown, context: unknown): CaptureSession { return this.create(admissionSchema.parse({ kind: 'progression-capture', progression, context })); }
  /** Diagnostic occupancy/identity data never imply an actual combat party. */
  createDiagnostic(initial: unknown): CaptureSession { return this.create(admissionSchema.parse({ kind: 'diagnostic', initial })); }
  private create(admission: Admission): CaptureSession {
    const run = this.replay(admission, 0, null), session = new CaptureSession(this, admission, 0, null, run);
    session.view(); session.snapshot(); return session;
  }
  restore(input: unknown): CaptureSession {
    const checkpoint = captureCheckpointSchema.parse(input), { digest, ...body } = checkpoint;
    require(digest === captureCheckpointDigest(body), 'Capture checkpoint integrity differs');
    require(canonical(checkpoint.compatibility) === canonical(this.compatibility), 'Incompatible capture checkpoint');
    const run = this.replay(checkpoint.admission, checkpoint.sequence, checkpoint.nicknameDecision);
    require(canonical(run.words) === canonical(checkpoint.words), 'Capture checkpoint differs from its source replay');
    const session = new CaptureSession(this, checkpoint.admission, checkpoint.sequence, checkpoint.nicknameDecision, run); session.view(); return session;
  }
  private prepare(admission: Admission): Prepared {
    if (admission.kind === 'diagnostic') return { ...admission.initial, inventory: null, origin: { kind: 'diagnostic' } };
    const pending = admission.kind === 'battle-terminal' ? this.progression.fromBattle(admission.battle) : this.progression.restore(admission.progression);
    const view = pending.view(), checkpoint = pending.snapshot();
    require(view.phase === 'pending-capture' && view.origin.kind === 'battle-terminal' && view.origin.outcome === 'captured'
      && checkpoint.admission.kind === 'battle-terminal' && view.capture?.kind === 'pending-disposition' && view.capture.ballItemId === 4,
    'Capture requires an actual compatible pending captured terminal');
    const { slot: _slot, ...creature } = view.capture.creature;
    const { policy: _policy, ...context } = admission.context;
    return { creature: captureCreatureSchema.parse(creature), context: captureContextSchema.parse(context), inventory: view.inventory,
      origin: { ...view.origin, outcome: 'captured' } };
  }
  /** Rebuild each candidate from immutable admission plus the single accepted
   * name decision. No prior result, original battle or ownership is changed. */
  replay(admission: Admission, sequence: 0 | 1 | 2 | 3, decision: CaptureNicknameDecision | null): Run {
    require((sequence < 2) === (decision === null), 'Capture nickname decision differs from stage');
    const prepared = this.prepare(admission), c = prepared.creature, f = prepared.context;
    require(c.otId === f.trainerId, 'Capture original trainer differs from explicit context');
    const api = instantiateRawCapture(this.module);
    const input = [c.speciesId, c.personality, c.otId, c.experience, c.level, c.friendship, c.hp,
      ...statNames.map(key => c.stats[key]), ...statNames.map(key => c.ivs[key]), ...statNames.map(key => c.evs[key]),
      ...c.moves.map(move => move.moveId), ...c.moves.map(move => move.pp), 0, 4, api.capture_constant(0), 0, 0, 0, c.abilityNum,
      f.trainerGender, ...this.encodeText(f.trainerName, 7), Number(f.dex.seen), Number(f.dex.caught), f.captureStat,
      f.partyMask, f.currentBox, f.lastSentBox, Number(f.shownBoxWasFullMessage), Number(f.knowsBill), ...f.boxMasks,
      ...Array.from({ length: 9 }, () => 0)];
    require(input.length === CAPTURE_INPUT_WORDS, 'Capture input layout differs');
    ok(api.capture_input_begin(), 'input begin'); input.forEach((value, index) => ok(api.capture_input_set(index, value), 'input'));
    require(api.capture_capacity() === 0, 'Capture requires capacity before any source effect');
    ok(api.capture_start(), 'initial capture');
    // Derived creature identity is source-validated as well as its scalar body.
    require(api.capture_get(2) === c.abilityId && api.capture_get(1) === c.nature && api.capture_get(3) === c.gender,
      'Capture derived species identity differs');
    if (sequence >= 1) ok(api.capture_advance(), 'dex and nickname stage');
    if (decision !== null) {
      require(decision.decisionId === pendingId(admission, exportWords(api)), 'Stale capture nickname decision');
      if (decision.kind === 'nickname') {
        const name = this.encodeText(decision.name, 10); ok(api.capture_name_begin(), 'nickname begin');
        name.forEach((byte, index) => ok(api.capture_name_set(index, byte), 'nickname byte'));
      }
      ok(api.capture_decide(decision.kind === 'nickname' ? 1 : 0), 'nickname decision');
    }
    if (sequence === 3) ok(api.capture_advance(), 'automatic source placement');
    const state = exportWords(api);
    require(state[1] === sequence, 'Capture source stage differs');
    return { api, prepared, words: state };
  }
}
function readCreature(run: Run): CaptureCreature {
  const m = run.words.slice(80, 120), before = run.prepared.creature;
  const group = (offset: number) => Object.fromEntries(statNames.map((key, index) => [key, m[offset + index]]));
  return captureCreatureSchema.parse({ speciesId: m[0], personality: m[1], otId: m[2], experience: m[3], level: m[4],
    friendship: m[5], hp: m[6], stats: group(7), ivs: group(13), evs: group(19),
    moves: m.slice(25, 29).map((moveId, slot) => ({ moveId, pp: m[29 + slot], ppUps: m[33]! >>> (slot * 2) & 3 })),
    heldItemId: m[37], status: m[36], abilityNum: m[39], abilityId: before.abilityId, nature: before.nature, gender: before.gender });
}
function boxCreature(creature: CaptureCreature): CaptureBoxCreature {
  const { hp: _hp, status: _status, stats: _stats, level: _level, ...boxed } = creature; return boxed;
}
export class CaptureSession {
  constructor(private readonly core: CaptureCore, private readonly admission: Admission, private sequence: 0 | 1 | 2 | 3,
    private decision: CaptureNicknameDecision | null, private run: Run) {
    this.admission = structuredClone(admission); this.decision = structuredClone(decision);
  }
  snapshot(): CaptureCheckpoint {
    const body = checkpointBodySchema.parse({ schemaVersion: 1, compatibility: this.core.compatibility, admission: this.admission,
      sequence: this.sequence, nicknameDecision: this.decision, words: this.run.words });
    return { ...body, digest: captureCheckpointDigest(body) };
  }
  view(): CaptureView {
    const w = this.run.words, c = readCreature(this.run), seq = this.sequence;
    require(w[66] === 4 && w[67] === 2 && (w[68] === 0 || w[68] === 1) && w[114] === 4, 'Capture source metadata differs');
    const metadata: CaptureMetadata = { nickname: this.core.decodeText(w.slice(54, 65)), otName: this.core.decodeText(w.slice(46, 54)),
      otGender: w[68], language: 2, metGame: 4, metLevel: w[65]!, metLocation: w[115]!, ballItemId: 4 };
    let placement: CapturePlacement | null = null;
    if (seq === 3) {
      require(w[30] === 1 && (w[19] === 1 || w[19] === 2), 'Capture source placement is incomplete');
      placement = w[19] === 1 ? { kind: 'party', slot: w[20]!, creature: c, metadata }
        : { kind: 'box', box: w[21]!, slot: w[22]!, boxedCreature: boxCreature(c), metadata };
    } else require(w[30] === 0 && w[19] === 0, 'Capture placement exists before source allocation');
    const messages = [null, 'someones-pc', 'bills-pc', 'someones-box-full', 'bills-box-full'] as const;
    require(w[25]! < messages.length, 'Capture box message differs');
    return structuredClone({ phase: (['ready', 'pending-nickname', 'nickname-applied', 'pending-ownership-application'] as const)[seq], sequence: seq,
      creature: placement?.kind === 'box' ? null : c, metadata,
      dex: { before: { seen: w[4] === 1, caught: w[5] === 1 }, after: { seen: w[6] === 1, caught: w[7] === 1 }, newEntry: w[10] === 1 },
      captureStat: { before: w[8]!, after: w[9]! }, pendingNickname: seq === 1 ? { decisionId: pendingId(this.admission, w),
        speciesName: c.speciesId === 16 ? 'PIDGEY' : 'RATTATA', maxLength: 10 as const } : null, placement,
      storage: { partyMask: w[12]!, partyCount: w[13]!, boxMasks: w.slice(32, 46), currentBox: w[14]!, lastSentBox: w[15]!,
        shownBoxWasFullMessage: w[16] === 1, knowsBill: w[17] === 1, message: messages[w[25]!]! },
      inventory: this.run.prepared.inventory, origin: this.run.prepared.origin, ownershipApplication: 'pending', combatReadmission: 'unsupported' });
  }
  advance(input: unknown): CaptureView {
    const command = z.strictObject({ expectedSequence: z.union([z.literal(0), z.literal(2)]) }).parse(input);
    require(command.expectedSequence === this.sequence, 'Stale or unavailable capture stage');
    return this.publish(sequenceSchema.parse(this.sequence + 1), this.decision);
  }
  decideNickname(input: unknown): CaptureView {
    const decision = captureNicknameDecisionSchema.parse(input);
    require(this.sequence === 1 && decision.expectedSequence === this.sequence, 'Stale or unavailable nickname stage');
    return this.publish(2, decision);
  }
  private publish(sequence: 0 | 1 | 2 | 3, decision: CaptureNicknameDecision | null): CaptureView {
    const run = this.core.replay(this.admission, sequence, decision), candidate = new CaptureSession(this.core, this.admission, sequence, decision, run);
    const view = candidate.view(); candidate.snapshot(); // Validate the entire candidate before publishing any state.
    this.sequence = sequence; this.decision = structuredClone(decision); this.run = run; return view;
  }
  project(viewer = 'player') {
    require(viewer === 'player', 'Only the owner may view this capture continuation');
    const view = this.view(), c = view.creature;
    return { phase: view.phase, sequence: view.sequence, speciesId: this.run.prepared.creature.speciesId, nickname: view.metadata.nickname,
      creature: c ? { speciesId: c.speciesId, level: c.level, hp: c.hp, maxHP: c.stats.hp, status: c.status, moves: c.moves } : null,
      pendingNickname: view.pendingNickname, dex: view.dex, captureStat: view.captureStat, inventory: view.inventory,
      placement: view.placement ? (view.placement.kind === 'party' ? { kind: 'party' as const, slot: view.placement.slot }
        : { kind: 'box' as const, box: view.placement.box, slot: view.placement.slot }) : null,
      ownershipApplication: view.ownershipApplication, combatReadmission: view.combatReadmission };
  }
}

export async function loadCaptureCore(): Promise<CaptureCore> {
  const report = z.object({ status: z.literal('passed'), profile: z.literal(CAPTURE_PROFILE), wasm: z.string(), wasmSha256: sha256, codecSha256: sha256,
    extraction: z.object({ sourceFingerprint: sha256 }) }).parse(JSON.parse(await readFile('reports/battle-capture-build.json', 'utf8')));
  const [buffer, progression, codecBytes, routeBytes] = await Promise.all([readFile(report.wasm), loadProgressionCore(),
    readFile('.local/battle-capture/primary/extracted/codec.json'), readFile('content/generated/client/maps/Route1.json')]);
  require(hash(buffer) === report.wasmSha256 && report.extraction.sourceFingerprint === progression.compatibility.sourceFingerprint, 'Capture build/source hash differs');
  require(hash(codecBytes) === report.codecSha256, 'Capture source text codec differs from the build');
  require(hash(routeBytes) === WORLD_MAP_HASHES.MAP_ROUTE1, 'Capture Route 1 content differs');
  const route = worldMapSchema.parse(JSON.parse(routeBytes.toString('utf8')));
  require(route.id === 'MAP_ROUTE1' && route.source.fingerprint === report.extraction.sourceFingerprint, 'Capture source map differs');
  const compatibility = { profile: CAPTURE_PROFILE, abiVersion: 1 as const, developmentPolicy: CAPTURE_DEVELOPMENT_POLICY,
    sourceFingerprint: report.extraction.sourceFingerprint, wasmSha256: report.wasmSha256, hostSha256: hash(await readFile('tools/battle-capture/capture.ts')),
    codecSha256: hash(codecBytes), progressionCompatibilitySha256: hash(canonical(progression.compatibility)),
    battleCompatibilitySha256: progression.compatibility.battleCompatibilitySha256, routeMapSha256: hash(routeBytes) };
  return new CaptureCore(new WebAssembly.Module(buffer), compatibility, progression, JSON.parse(codecBytes.toString('utf8')));
}
