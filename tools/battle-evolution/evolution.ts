/** Private ordinary level-evolution continuation. Source C owns species,
 * statistics, name, dex and learning changes; ownership remains unapplied. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { route1InventorySchema } from '../battle-route1/engine';
import { loadProgressionCore, progressionCheckpointSchema, type ProgressionCore } from '../battle-progression/progression';

export const EVOLUTION_PROFILE = 'firered-route1-evolution-v1' as const;
export const EVOLUTION_INPUT_WORDS = 72;
export const EVOLUTION_STATE_WORDS = 128;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const counter = word.max(128);
const statNames = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
const speciesSchema = z.union([z.literal(7), z.literal(8), z.literal(9), z.literal(16), z.literal(17), z.literal(18), z.literal(19), z.literal(20)]);
const statsSchema = z.strictObject({ hp: word.min(1).max(65535), attack: word.min(1).max(65535), defense: word.min(1).max(65535),
  speed: word.min(1).max(65535), spAttack: word.min(1).max(65535), spDefense: word.min(1).max(65535) });
const ivsSchema = z.strictObject({ hp: word.max(31), attack: word.max(31), defense: word.max(31),
  speed: word.max(31), spAttack: word.max(31), spDefense: word.max(31) });
const evsSchema = z.strictObject({ hp: word.max(255), attack: word.max(255), defense: word.max(255),
  speed: word.max(255), spAttack: word.max(255), spDefense: word.max(255) })
  .refine(evs => Object.values(evs).reduce((sum, value) => sum + value, 0) <= 510, 'Source total EV limit exceeded');
export const evolutionCreatureSchema = z.strictObject({ speciesId: speciesSchema,
  abilityId: z.union([z.literal(50), z.literal(51), z.literal(62), z.literal(67)]), abilityNum: z.union([z.literal(0), z.literal(1)]),
  personality: word, otId: word, level: word.min(1).max(100), experience: word, friendship: word.max(255), hp: word.max(65535),
  stats: statsSchema, ivs: ivsSchema, evs: evsSchema, calculatedEvs: evsSchema,
  moves: z.array(z.strictObject({ moveId: word.max(354), pp: word.max(255), ppUps: word.max(3) })).length(4),
  status: word, heldItemId: z.union([z.literal(0), z.literal(195)]), ballItemId: z.union([z.literal(4), z.literal(11)]).nullable(),
  metLocation: word.max(255).nullable(),
}).refine(c => c.hp <= c.stats.hp && statNames.every(key => c.calculatedEvs[key] <= c.evs[key]), 'Invalid cached creature statistics');
export type EvolutionCreature = z.infer<typeof evolutionCreatureSchema>;
const dexSchema = z.strictObject({ seen: z.boolean(), caught: z.boolean() })
  .refine(dex => !dex.caught || dex.seen, 'Caught target dex history requires seen history');
export const evolutionContextSchema = z.strictObject({ nickname: z.string(), language: z.literal(2), targetDex: dexSchema,
  evolutionStat: word.max(0xFFFFFF), canCancel: z.boolean() });
export type EvolutionContext = z.infer<typeof evolutionContextSchema>;
const progressionContextSchema = evolutionContextSchema.extend({ canCancel: z.literal(true) }).strict();
export const evolutionDiagnosticSchema = z.strictObject({ creature: evolutionCreatureSchema, context: evolutionContextSchema });
export type EvolutionDiagnostic = z.infer<typeof evolutionDiagnosticSchema>;
const decisionBase = { expectedSequence: counter, decisionId: sha256 };
export const evolutionDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...decisionBase, kind: z.literal('accept-evolution') }),
  z.strictObject({ ...decisionBase, kind: z.literal('cancel-evolution') }),
  z.strictObject({ ...decisionBase, kind: z.literal('replace-move'), slot: word.max(3) }),
  z.strictObject({ ...decisionBase, kind: z.literal('decline-move') }),
]);
export type EvolutionDecision = z.infer<typeof evolutionDecisionSchema>;
const admissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('progression-pending'), progression: progressionCheckpointSchema, context: progressionContextSchema }),
  z.strictObject({ kind: z.literal('diagnostic'), initial: evolutionDiagnosticSchema }),
]);
type Admission = z.infer<typeof admissionSchema>;
const compatibilitySchema = z.strictObject({ profile: z.literal(EVOLUTION_PROFILE), abiVersion: z.literal(1),
  sourceFingerprint: sha256, wasmSha256: sha256, hostSha256: sha256, codecSha256: sha256,
  progressionCompatibilitySha256: sha256, battleCompatibilitySha256: sha256 });
const checkpointBodySchema = z.strictObject({ schemaVersion: z.literal(1), compatibility: compatibilitySchema,
  admission: admissionSchema, decisions: z.array(evolutionDecisionSchema).max(128), words: z.array(word).length(EVOLUTION_STATE_WORDS) });
export const evolutionCheckpointSchema = checkpointBodySchema.extend({ digest: sha256 }).strict();
export type EvolutionCheckpoint = z.infer<typeof evolutionCheckpointSchema>;
const codecSchema = z.strictObject({ characters: z.array(z.strictObject({ text: z.string(), byte: word.max(254) })).min(1).max(255),
  speciesNames: z.strictObject({ '7': z.literal('SQUIRTLE'), '8': z.literal('WARTORTLE'), '9': z.literal('BLASTOISE'),
    '16': z.literal('PIDGEY'), '17': z.literal('PIDGEOTTO'), '18': z.literal('PIDGEOT'), '19': z.literal('RATTATA'), '20': z.literal('RATICATE') }),
  eos: z.literal(255), nicknameLength: z.literal(10), trainerNameLength: z.literal(7) });
export type EvolutionCodec = z.infer<typeof codecSchema>;
export interface RawEvolutionExports {
  memory: WebAssembly.Memory;
  evolution_abi_version(): number; evolution_input_word_count(): number; evolution_state_word_count(): number;
  evolution_input_begin(): number; evolution_input_set(index: number, value: number): number; evolution_start(): number;
  evolution_choose(kind: number): number; evolution_next(): number; evolution_decide(slot: number): number;
  evolution_get(index: number): number; evolution_mon_get(index: number): number; evolution_state_get(index: number): number;
  evolution_import_begin(): number; evolution_import_set(index: number, value: number): number; evolution_import_commit(): number;
}
export interface EvolutionEvent { kind: 'evolved' | 'cancelled' | 'learned-move' | 'replaced-move' | 'declined-move' | 'complete'; value: number; slot: number }
export interface EvolutionView {
  phase: 'pending-evolution' | 'pending-move' | 'pending-ownership-application'; sequence: number;
  creature: EvolutionCreature; nickname: string; language: 2; targetSpecies: number;
  pendingEvolution: { decisionId: string; speciesId: number; canCancel: boolean } | null;
  pendingMove: { decisionId: string; moveId: number } | null;
  result: 'evolved' | 'cancelled' | null;
  dex: { before: { seen: boolean; caught: boolean }; after: { seen: boolean; caught: boolean } };
  evolutionStat: { before: number; after: number }; renamed: boolean; events: EvolutionEvent[];
  inventory: z.infer<typeof route1InventorySchema> | null;
  origin: { kind: 'progression-diagnostic'; progressionDigest: string } | { kind: 'diagnostic' };
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
/** Hashes/replay check compatibility and corruption, not ownership or permission. */
export function evolutionCheckpointDigest(body: Omit<EvolutionCheckpoint, 'digest'>): string { return hash(canonical(body)); }
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(status: number, operation: string): void { require(status === 0, `Evolution C rejected ${operation}: ${status}`); }
const expectedExports = ['memory', ...['abi_version', 'input_word_count', 'state_word_count', 'input_begin', 'input_set', 'start',
  'choose', 'next', 'decide', 'get', 'mon_get', 'state_get', 'import_begin', 'import_set', 'import_commit'].map(name => `evolution_${name}`)].sort();
export function instantiateRawEvolution(module: WebAssembly.Module): RawEvolutionExports {
  require(WebAssembly.Module.imports(module).length === 0
    && canonical(WebAssembly.Module.exports(module).map(row => row.name).sort()) === canonical(expectedExports), 'Unsupported evolution WASM surface');
  const api = new WebAssembly.Instance(module).exports as unknown as RawEvolutionExports;
  require(api.evolution_abi_version() === 1 && api.evolution_input_word_count() === EVOLUTION_INPUT_WORDS
    && api.evolution_state_word_count() === EVOLUTION_STATE_WORDS && api.memory.buffer.byteLength === 262144
    && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported evolution ABI or memory');
  return api;
}
interface Prepared { creature: EvolutionCreature; context: EvolutionContext; expectedTarget: number | null;
  origin: EvolutionView['origin']; inventory: EvolutionView['inventory'] }
interface Run { api: RawEvolutionExports; prepared: Prepared; words: number[]; events: EvolutionEvent[] }
function exportWords(api: RawEvolutionExports): number[] { return Array.from({ length: EVOLUTION_STATE_WORDS }, (_, index) => api.evolution_state_get(index) >>> 0); }
function decisionId(admission: Admission, sequence: number, words: number[]): string { return hash(canonical({ admission, sequence, words })); }
function recordEvent(api: RawEvolutionExports, events: EvolutionEvent[]): void {
  const type = api.evolution_state_get(19);
  if (type === 0) return;
  const kind = (['', 'evolved', 'cancelled', 'learned-move', 'replaced-move', 'declined-move', 'complete'] as const)[type];
  require(kind, 'Unsupported source evolution event');
  events.push({ kind, value: api.evolution_state_get(20) >>> 0, slot: api.evolution_state_get(21) >>> 0 });
}
function settle(api: RawEvolutionExports, events: EvolutionEvent[]): void {
  for (let step = 0; api.evolution_get(0) === 2; step++) {
    require(step < 4096, 'Evolution source continuation did not settle');
    ok(api.evolution_next(), 'source learning continuation'); recordEvent(api, events);
  }
  require([1, 3, 4].includes(api.evolution_get(0)), 'Unsupported evolution decision boundary');
}

export class EvolutionCore {
  readonly module: WebAssembly.Module; readonly compatibility: z.infer<typeof compatibilitySchema>;
  private readonly encoded = new Map<string, number>(); private readonly decoded = new Map<number, string>();
  constructor(module: WebAssembly.Module, compatibility: z.infer<typeof compatibilitySchema>, private readonly progression: ProgressionCore, codec: unknown) {
    instantiateRawEvolution(module); this.module = module; this.compatibility = Object.freeze(compatibilitySchema.parse(compatibility));
    require(this.compatibility.progressionCompatibilitySha256 === hash(canonical(progression.compatibility))
      && this.compatibility.battleCompatibilitySha256 === progression.compatibility.battleCompatibilitySha256, 'Evolution prerequisite compatibility differs');
    const parsed = codecSchema.parse(codec);
    for (const { text, byte } of parsed.characters) {
      require([...text].length === 1 && !this.encoded.has(text) && !this.decoded.has(byte), 'Evolution source codec is not one-to-one');
      this.encoded.set(text, byte); this.decoded.set(byte, text);
    }
    require(this.encoded.get(' ') === 0, 'Evolution source space encoding differs');
    for (const name of Object.values(parsed.speciesNames)) this.encodeNickname(name);
  }
  encodeNickname(input: unknown): number[] {
    const glyphs = [...z.string().parse(input)];
    require(glyphs.length <= 10 && glyphs.some(glyph => glyph !== ' '), 'Unsupported source nickname length or blank name');
    const bytes = glyphs.map(glyph => { const value = this.encoded.get(glyph); require(value !== undefined, 'Unsupported source nickname character'); return value; });
    return [...bytes, ...Array.from({ length: 11 - bytes.length }, () => 255)];
  }
  decodeNickname(bytes: number[]): string {
    const end = bytes.indexOf(255); require(end >= 0 && bytes.slice(end).every(value => value === 255), 'Malformed source nickname suffix');
    return bytes.slice(0, end).map(value => { const glyph = this.decoded.get(value); require(glyph !== undefined, 'Unsupported source nickname byte'); return glyph; }).join('');
  }
  /** The retained progression profile reaches this state only through its
   * explicitly diagnostic higher-level input, never through combat-v2. */
  fromProgression(progression: unknown, context: unknown): EvolutionSession {
    return this.create(admissionSchema.parse({ kind: 'progression-pending', progression, context }));
  }
  createDiagnostic(initial: unknown): EvolutionSession { return this.create(admissionSchema.parse({ kind: 'diagnostic', initial })); }
  private create(admission: Admission): EvolutionSession {
    const run = this.replay(admission, []), session = new EvolutionSession(this, admission, [], run);
    session.view(); session.snapshot(); return session;
  }
  restore(input: unknown): EvolutionSession {
    const checkpoint = evolutionCheckpointSchema.parse(input), { digest, ...body } = checkpoint;
    require(digest === evolutionCheckpointDigest(body), 'Evolution checkpoint integrity differs');
    require(canonical(checkpoint.compatibility) === canonical(this.compatibility), 'Incompatible evolution checkpoint');
    const run = this.replay(checkpoint.admission, checkpoint.decisions);
    require(canonical(run.words) === canonical(checkpoint.words), 'Evolution checkpoint differs from its source replay');
    const session = new EvolutionSession(this, checkpoint.admission, checkpoint.decisions, run); session.view(); return session;
  }
  private prepare(admission: Admission): Prepared {
    if (admission.kind === 'diagnostic') return { ...admission.initial, expectedTarget: null, origin: { kind: 'diagnostic' }, inventory: null };
    const previous = this.progression.restore(admission.progression), view = previous.view(), checkpoint = previous.snapshot();
    require(view.phase === 'pending-evolution' && view.pendingEvolution !== null && view.origin.kind === 'diagnostic'
      && checkpoint.admission.kind === 'diagnostic' && checkpoint.words !== null, 'Evolution requires a compatible pending diagnostic progression');
    const words = checkpoint.words;
    const creature = evolutionCreatureSchema.parse({ ...view.creature, abilityNum: words[63],
      ballItemId: words[58] === 0xFFFFFFFF ? null : words[58], metLocation: words[59] === 0xFFFFFFFF ? null : words[59] });
    return { creature, context: admission.context, expectedTarget: view.pendingEvolution.speciesId,
      inventory: view.inventory, origin: { kind: 'progression-diagnostic', progressionDigest: checkpoint.digest } };
  }
  /** Fresh candidate memory and complete immutable-admission replay. No source
   * input, prior session, original progression or owned record is mutated. */
  replay(admission: Admission, decisions: EvolutionDecision[]): Run {
    const prepared = this.prepare(admission), c = prepared.creature, context = prepared.context;
    const api = instantiateRawEvolution(this.module), events: EvolutionEvent[] = [];
    const input = [c.speciesId, c.personality, c.otId, c.experience, c.level, c.friendship, c.hp,
      ...statNames.map(key => c.stats[key]), ...statNames.map(key => c.ivs[key]), ...statNames.map(key => c.evs[key]),
      ...c.moves.map(move => move.moveId), ...c.moves.map(move => move.pp),
      c.moves.reduce((bits, move, index) => bits | move.ppUps << (index * 2), 0), c.ballItemId ?? 0xFFFFFFFF,
      c.metLocation ?? 0xFFFFFFFF, c.status, c.heldItemId, 0, c.abilityNum, ...statNames.map(key => c.calculatedEvs[key]),
      ...this.encodeNickname(context.nickname), context.language, Number(context.targetDex.seen), Number(context.targetDex.caught),
      context.evolutionStat, Number(context.canCancel), ...Array.from({ length: 10 }, () => 0)];
    require(input.length === EVOLUTION_INPUT_WORDS, 'Evolution input layout differs');
    ok(api.evolution_input_begin(), 'input begin'); input.forEach((value, index) => ok(api.evolution_input_set(index, value), 'input'));
    ok(api.evolution_start(), 'source evolution eligibility');
    require(api.evolution_get(4) === c.abilityId, 'Evolution species ability differs');
    require(prepared.expectedTarget === null || prepared.expectedTarget === api.evolution_get(1), 'Progression evolution target differs from source');
    for (const [index, decision] of decisions.entries()) {
      const phase = api.evolution_get(0);
      require(decision.expectedSequence === index && decision.decisionId === decisionId(admission, index, exportWords(api)), 'Stale evolution decision');
      if (decision.kind === 'accept-evolution' || decision.kind === 'cancel-evolution') {
        require(phase === 1 && index === 0 && (decision.kind !== 'cancel-evolution' || context.canCancel), 'Unavailable evolution choice');
        ok(api.evolution_choose(decision.kind === 'accept-evolution' ? 1 : 0), 'evolution choice');
      } else {
        require(phase === 3, 'No pending evolution move decision');
        ok(api.evolution_decide(decision.kind === 'replace-move' ? decision.slot : 4), 'evolution move decision');
      }
      recordEvent(api, events); settle(api, events);
    }
    return { api, prepared, words: exportWords(api), events };
  }
}
function readCreature(run: Run): EvolutionCreature {
  const w = run.words, m = w.slice(48, 88);
  const group = (words: number[], offset: number) => Object.fromEntries(statNames.map((key, index) => [key, words[offset + index]]));
  return evolutionCreatureSchema.parse({ speciesId: m[0], personality: m[1], otId: m[2], experience: m[3], level: m[4],
    friendship: m[5], hp: m[6], stats: group(m, 7), ivs: group(m, 13), evs: group(m, 19), calculatedEvs: group(w, 26),
    moves: m.slice(25, 29).map((moveId, slot) => ({ moveId, pp: m[29 + slot], ppUps: m[33]! >>> (2 * slot) & 3 })),
    ballItemId: m[34] === 0xFFFFFFFF ? null : m[34], metLocation: m[35] === 0xFFFFFFFF ? null : m[35],
    status: m[36], heldItemId: m[37], abilityNum: m[39], abilityId: run.api.evolution_get(4) });
}
export class EvolutionSession {
  constructor(private readonly core: EvolutionCore, private readonly admission: Admission, private decisions: EvolutionDecision[], private run: Run) {
    this.admission = structuredClone(admission); this.decisions = structuredClone(decisions);
  }
  snapshot(): EvolutionCheckpoint {
    const body = checkpointBodySchema.parse({ schemaVersion: 1, compatibility: this.core.compatibility,
      admission: this.admission, decisions: this.decisions, words: this.run.words });
    return { ...body, digest: evolutionCheckpointDigest(body) };
  }
  view(): EvolutionView {
    const w = this.run.words, sequence = this.decisions.length, sourcePhase = w[1];
    const phase = ({ 1: 'pending-evolution', 3: 'pending-move', 4: 'pending-ownership-application' } as const)[sourcePhase as 1 | 3 | 4];
    require(phase && w[22] === 2 && w[5]! <= 2, 'Evolution source boundary differs');
    const pending = decisionId(this.admission, sequence, w), creature = readCreature(this.run);
    return structuredClone({ phase, sequence, creature, nickname: this.core.decodeNickname(w.slice(32, 43)), language: 2,
      targetSpecies: w[4]!, pendingEvolution: phase === 'pending-evolution' ? { decisionId: pending, speciesId: w[4]!, canCancel: w[18] === 1 } : null,
      pendingMove: phase === 'pending-move' ? { decisionId: pending, moveId: w[9]! } : null,
      result: w[5] === 0 ? null : w[5] === 1 ? 'evolved' : 'cancelled',
      dex: { before: { seen: w[10] === 1, caught: w[11] === 1 }, after: { seen: w[12] === 1, caught: w[13] === 1 } },
      evolutionStat: { before: w[14]!, after: w[15]! }, renamed: w[16] === 1, events: this.run.events,
      inventory: this.run.prepared.inventory, origin: this.run.prepared.origin, ownershipApplication: 'pending', combatReadmission: 'unsupported' });
  }
  decide(input: unknown): EvolutionView {
    const decision = evolutionDecisionSchema.parse(input), view = this.view(), pending = view.pendingEvolution ?? view.pendingMove;
    require(pending && decision.expectedSequence === this.decisions.length && decision.decisionId === pending.decisionId, 'Stale or completed evolution decision');
    const decisions = z.array(evolutionDecisionSchema).max(128).parse([...this.decisions, decision]);
    const run = this.core.replay(this.admission, decisions), candidate = new EvolutionSession(this.core, this.admission, decisions, run);
    const result = candidate.view(); candidate.snapshot(); // Entire candidate validates before any accepted state changes.
    this.decisions = decisions; this.run = run; return result;
  }
  project(viewer = 'player') {
    require(viewer === 'player', 'Only the owner may view this evolution continuation');
    const view = this.view(), c = view.creature;
    return { phase: view.phase, sequence: view.sequence, result: view.result, nickname: view.nickname,
      creature: { speciesId: c.speciesId, abilityId: c.abilityId, level: c.level, experience: c.experience, friendship: c.friendship,
        hp: c.hp, stats: c.stats, status: c.status, moves: c.moves }, pendingEvolution: view.pendingEvolution, pendingMove: view.pendingMove,
      dex: view.dex, evolutionStat: view.evolutionStat, inventory: view.inventory,
      ownershipApplication: view.ownershipApplication, combatReadmission: view.combatReadmission };
  }
}

export async function loadEvolutionCore(): Promise<EvolutionCore> {
  const report = z.object({ status: z.literal('passed'), profile: z.literal(EVOLUTION_PROFILE), wasm: z.string(), wasmSha256: sha256,
    codecSha256: sha256, extraction: z.object({ sourceFingerprint: sha256 }) }).parse(JSON.parse(await readFile('reports/battle-evolution-build.json', 'utf8')));
  const [buffer, progression, codecBytes] = await Promise.all([readFile(report.wasm), loadProgressionCore(),
    readFile('.local/battle-evolution/primary/extracted/codec.json')]);
  require(hash(buffer) === report.wasmSha256 && hash(codecBytes) === report.codecSha256
    && report.extraction.sourceFingerprint === progression.compatibility.sourceFingerprint, 'Evolution build/source/codec hash differs');
  const compatibility = { profile: EVOLUTION_PROFILE, abiVersion: 1 as const, sourceFingerprint: report.extraction.sourceFingerprint,
    wasmSha256: report.wasmSha256, codecSha256: report.codecSha256, hostSha256: hash(await readFile('tools/battle-evolution/evolution.ts')),
    progressionCompatibilitySha256: hash(canonical(progression.compatibility)), battleCompatibilitySha256: progression.compatibility.battleCompatibilitySha256 };
  return new EvolutionCore(new WebAssembly.Module(buffer), compatibility, progression, JSON.parse(codecBytes.toString('utf8')));
}
