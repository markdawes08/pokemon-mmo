/** Private source loss continuation. Candidate resource/field changes have no
 * durable or world authority and never acknowledge the original field activity. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { battleSnapshotSchema } from '@pokewaterblue/battle-core';
import { worldMapSchema } from '@pokewaterblue/content-schema';
import { WORLD_MAP_HASHES } from '@pokewaterblue/protocol';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { route1CheckpointSchema, route1InventorySchema } from '../battle-route1/engine';
import { loadProgressionCore, progressionCheckpointSchema, progressionCreatureSchema, type ProgressionCore } from '../battle-progression/progression';

export const LOSS_PROFILE = 'firered-route1-loss-v1' as const;
export const LOSS_DEVELOPMENT_POLICY = 'r1-pallet-mom-blackout-v1' as const;
export const LOSS_STATE_WORDS = 96;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sequenceSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const statNames = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
export const lossCreatureSchema = progressionCreatureSchema.extend({ status: word,
  moves: z.array(z.strictObject({ moveId: word.max(354), pp: word.max(255), ppUps: word.max(3) })).length(4) }).strict();
export type LossCreature = z.infer<typeof lossCreatureSchema>;
export const lossContextSchema = z.strictObject({ money: word.max(999999), badgeMask: word.max(255), lastHealId: word.min(1).max(20),
  fieldFlagMask: word.max(63), route16Scene: word.max(65535), safariEntranceScene: word.max(65535), questLogEntrance: word.max(65535),
  eliteFourFlagMask: word.max(31), championTrainerMask: word.max(63), leagueScene: word.max(65535), avatarFlags: word.max(255),
  direction: word.min(1).max(4), hasDirection: z.boolean(), brockDefeated: z.boolean(), trainerTowerScene: z.literal(0) });
export type LossContext = z.infer<typeof lossContextSchema>;
export const developmentLossContextSchema = lossContextSchema.extend({ policy: z.literal(LOSS_DEVELOPMENT_POLICY), money: word.max(3000),
  badgeMask: z.literal(0), lastHealId: z.literal(1), fieldFlagMask: z.literal(0), route16Scene: z.literal(0),
  safariEntranceScene: z.literal(0), questLogEntrance: z.literal(0), eliteFourFlagMask: z.literal(0), championTrainerMask: z.literal(0),
  leagueScene: z.literal(0), avatarFlags: z.literal(1), direction: z.literal(1), hasDirection: z.literal(false), brockDefeated: z.literal(false) }).strict();
export type DevelopmentLossContext = z.infer<typeof developmentLossContextSchema>;
export const lossDiagnosticSchema = z.strictObject({ creature: lossCreatureSchema, opponentLevel: word.min(1).max(100),
  outcome: z.enum(['lost', 'draw']), context: lossContextSchema });
export type LossDiagnostic = z.infer<typeof lossDiagnosticSchema>;
const admissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('battle-terminal'), battle: battleSnapshotSchema, context: developmentLossContextSchema }),
  z.strictObject({ kind: z.literal('progression-loss'), progression: progressionCheckpointSchema, context: developmentLossContextSchema }),
  z.strictObject({ kind: z.literal('diagnostic'), initial: lossDiagnosticSchema }),
]);
type Admission = z.infer<typeof admissionSchema>;
const compatibilitySchema = z.strictObject({ profile: z.literal(LOSS_PROFILE), abiVersion: z.literal(1),
  developmentPolicy: z.literal(LOSS_DEVELOPMENT_POLICY), sourceFingerprint: sha256, wasmSha256: sha256, hostSha256: sha256,
  progressionCompatibilitySha256: sha256, battleCompatibilitySha256: sha256, houseMapSha256: sha256 });
const checkpointBodySchema = z.strictObject({ schemaVersion: z.literal(1), compatibility: compatibilitySchema, admission: admissionSchema,
  sequence: sequenceSchema, words: z.array(word).length(LOSS_STATE_WORDS) });
export const lossCheckpointSchema = checkpointBodySchema.extend({ digest: sha256 }).strict();
export type LossCheckpoint = z.infer<typeof lossCheckpointSchema>;
export interface RawLossExports {
  memory: WebAssembly.Memory;
  loss_abi_version(): number; loss_input_word_count(): number; loss_state_word_count(): number;
  loss_input_begin(): number; loss_input_set(index: number, value: number): number; loss_start(): number;
  loss_advance(): number; loss_get(index: number): number; loss_mon_get(index: number): number; loss_state_get(index: number): number;
  loss_import_begin(): number; loss_import_set(index: number, value: number): number; loss_import_commit(): number;
  loss_context_count(kind: number): number; loss_context_id(kind: number, index: number): number; loss_heal_get(id: number, field: number): number;
}
export interface LossView {
  phase: 'ready' | 'faint-applied' | 'pending-world-application'; sequence: 0 | 1 | 2; creature: LossCreature;
  money: { before: number; previewLoss: number; loss: number; after: number };
  friendship: { before: number; loss: number; after: number };
  inventory: z.infer<typeof route1InventorySchema> | null; context: LossContext;
  respawn: { mapGroup: number; mapNum: number; warpId: number; x: number; y: number; healerLocalId: number;
    script: 'EventScript_AfterWhiteOutMomHeal' | 'EventScript_AfterWhiteOutHeal'; messageVariant: 'nurse-pre-brock' | 'nurse' | null } | null;
  fieldChanges: { clearFlags: number[]; clearTrainerFlags: number[]; setVariables: { id: number; value: number }[];
    avatar: { flags: number; direction: number; hasDirection: boolean } } | null;
  origin: { kind: 'battle-terminal'; battleId: string; terminalSequence: number; terminalDigest: string; outcome: 'lost' | 'draw' }
    | { kind: 'diagnostic' };
  worldApplication: 'pending'; combatReadmission: 'unsupported';
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
/** Integrity and replay detect corruption; neither authenticates supplied state
 * nor deduplicates future durable effects. Storage must be server-owned. */
export function lossCheckpointDigest(body: Omit<LossCheckpoint, 'digest'>): string { return hash(canonical(body)); }
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(status: number, operation: string): void { require(status === 0, `Loss C rejected ${operation}: ${status}`); }
const expectedExports = ['memory', ...['abi_version', 'input_word_count', 'state_word_count', 'input_begin', 'input_set', 'start',
  'advance', 'get', 'mon_get', 'state_get', 'import_begin', 'import_set', 'import_commit', 'context_count', 'context_id', 'heal_get']
  .map(name => `loss_${name}`)].sort();
export function instantiateRawLoss(module: WebAssembly.Module): RawLossExports {
  require(WebAssembly.Module.imports(module).length === 0
    && canonical(WebAssembly.Module.exports(module).map(row => row.name).sort()) === canonical(expectedExports), 'Unsupported loss WASM surface');
  const api = new WebAssembly.Instance(module).exports as unknown as RawLossExports;
  require(api.loss_abi_version() === 1 && api.loss_input_word_count() === 64 && api.loss_state_word_count() === LOSS_STATE_WORDS
    && api.memory.buffer.byteLength === 262144 && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported loss ABI or memory');
  return api;
}
interface Prepared { creature: LossCreature; context: LossContext; opponentLevel: number; outcome: 'lost' | 'draw';
  inventory: LossView['inventory']; origin: LossView['origin'] }
interface Run { api: RawLossExports; prepared: Prepared; words: number[] }

export class LossCore {
  readonly module: WebAssembly.Module; readonly compatibility: z.infer<typeof compatibilitySchema>;
  constructor(module: WebAssembly.Module, compatibility: z.infer<typeof compatibilitySchema>,
    private readonly progression: ProgressionCore, private readonly baselineMoney: number) {
    const api = instantiateRawLoss(module); this.module = module;
    this.compatibility = Object.freeze(compatibilitySchema.parse(compatibility));
    require(this.compatibility.progressionCompatibilitySha256 === hash(canonical(progression.compatibility))
      && this.compatibility.battleCompatibilitySha256 === progression.compatibility.battleCompatibilitySha256,
    'Loss prerequisite compatibility differs');
    require(baselineMoney === 3000, 'Loss development fixture wallet changed');
    require(canonical(Array.from({ length: 5 }, (_, index) => api.loss_heal_get(1, index) >>> 0))
      === canonical([3, 0, 0xFFFFFFFF, 6, 8]), 'Source Pallet heal record changed');
  }
  /** Explicit opt-in baseline, not a lookup or reset of any account. Omitted
   * money selects the named fixture amount; supplied depleted money is retained. */
  developmentContext(input: unknown = {}): DevelopmentLossContext {
    const options = z.strictObject({ money: word.max(3000).optional() }).parse(input);
    return developmentLossContextSchema.parse({ policy: LOSS_DEVELOPMENT_POLICY, money: options.money ?? this.baselineMoney,
      badgeMask: 0, lastHealId: 1, fieldFlagMask: 0, route16Scene: 0, safariEntranceScene: 0, questLogEntrance: 0,
      eliteFourFlagMask: 0, championTrainerMask: 0, leagueScene: 0, avatarFlags: 1, direction: 1,
      hasDirection: false, brockDefeated: false, trainerTowerScene: 0 });
  }
  fromBattle(battle: unknown, context: unknown): LossSession { return this.create(admissionSchema.parse({ kind: 'battle-terminal', battle, context })); }
  fromProgression(progression: unknown, context: unknown): LossSession { return this.create(admissionSchema.parse({ kind: 'progression-loss', progression, context })); }
  /** Explicit diagnostic source-state surface, never a combat or account API. */
  createDiagnostic(initial: unknown): LossSession { return this.create(admissionSchema.parse({ kind: 'diagnostic', initial })); }
  private create(admission: Admission): LossSession {
    const run = this.replay(admission, 0); readCreature(run);
    return new LossSession(this, admission, 0, run);
  }
  restore(input: unknown): LossSession {
    const checkpoint = lossCheckpointSchema.parse(input), { digest, ...body } = checkpoint;
    require(digest === lossCheckpointDigest(body), 'Loss checkpoint integrity differs');
    require(canonical(checkpoint.compatibility) === canonical(this.compatibility), 'Incompatible loss checkpoint');
    const run = this.replay(checkpoint.admission, checkpoint.sequence);
    require(canonical(run.words) === canonical(checkpoint.words), 'Loss checkpoint differs from its source replay');
    readCreature(run);
    return new LossSession(this, checkpoint.admission, checkpoint.sequence, run);
  }
  private prepare(admission: Admission): Prepared {
    if (admission.kind === 'diagnostic') return { ...admission.initial, origin: { kind: 'diagnostic' }, inventory: null };
    const pending = admission.kind === 'battle-terminal' ? this.progression.fromBattle(admission.battle) : this.progression.restore(admission.progression);
    const view = pending.view(), checkpoint = pending.snapshot();
    require(view.phase === 'pending-loss' && view.origin.kind === 'battle-terminal'
      && (view.origin.outcome === 'lost' || view.origin.outcome === 'draw') && checkpoint.admission.kind === 'battle-terminal',
    'Loss requires a compatible actual pending loss or draw');
    const terminal = route1CheckpointSchema.parse(JSON.parse(Buffer.from(checkpoint.admission.battle.privateEngineState.data, 'base64').toString('utf8')));
    return { creature: lossCreatureSchema.parse(view.creature), context: lossContextSchema.parse(stripPolicy(admission.context)),
      opponentLevel: terminal.core.words[64]!, outcome: view.origin.outcome, inventory: view.inventory,
      origin: { ...view.origin, outcome: view.origin.outcome } };
  }
  /** Replay stages on a fresh memory. Calls never mutate a supplied checkpoint,
   * previous session, or the original battle/progression/field activity. */
  replay(admission: Admission, sequence: 0 | 1 | 2): Run {
    const prepared = this.prepare(admission), c = prepared.creature, f = prepared.context;
    require(c.hp === 0, 'Loss continuation requires the sole participant to be fainted');
    const api = instantiateRawLoss(this.module);
    const words = [c.speciesId, c.personality, c.otId, c.experience, c.level, c.friendship, c.hp,
      ...statNames.map(key => c.stats[key]), ...statNames.map(key => c.ivs[key]), ...statNames.map(key => c.evs[key]),
      ...c.moves.map(move => move.moveId), ...c.moves.map(move => move.pp),
      c.moves.reduce((packed, move, index) => packed | move.ppUps << (index * 2), 0), 0xFFFFFFFF, 0xFFFFFFFF, c.status, 0, 0, 0,
      ...statNames.map(key => c.calculatedEvs[key]), f.money, f.badgeMask, f.lastHealId, prepared.opponentLevel,
      prepared.outcome === 'lost' ? 2 : 3, f.fieldFlagMask, f.route16Scene, f.safariEntranceScene, f.questLogEntrance,
      f.eliteFourFlagMask, f.championTrainerMask, f.leagueScene, f.avatarFlags, f.direction, Number(f.hasDirection),
      Number(f.brockDefeated), f.trainerTowerScene, 0];
    require(words.length === 64, 'Loss input layout differs');
    ok(api.loss_input_begin(), 'input begin'); words.forEach((value, index) => ok(api.loss_input_set(index, value), 'input'));
    ok(api.loss_start(), 'initial loss');
    for (let step = 0; step < sequence; step++) ok(api.loss_advance(), 'source stage');
    const state = Array.from({ length: LOSS_STATE_WORDS }, (_, index) => api.loss_state_get(index) >>> 0);
    require(state[1] === sequence && api.loss_get(0) === sequence, 'Loss source stage differs');
    return { api, prepared, words: state };
  }
}
function stripPolicy(context: DevelopmentLossContext): LossContext {
  const { policy: _policy, ...rest } = context;
  return rest;
}
function readCreature(run: Run): LossCreature {
  const w = run.words, m = w.slice(48, 88);
  const stats = (source: number[], offset: number) => Object.fromEntries(statNames.map((key, index) => [key, source[offset + index]]));
  return lossCreatureSchema.parse({ speciesId: m[0], abilityId: 67, personality: m[1], otId: m[2], experience: m[3], level: m[4],
    friendship: m[5], hp: m[6], stats: stats(m, 7), ivs: stats(m, 13), evs: stats(m, 19), calculatedEvs: stats(w, 36),
    moves: m.slice(25, 29).map((moveId, slot) => ({ moveId, pp: m[29 + slot], ppUps: m[33]! >>> (2 * slot) & 3 })),
    status: m[36], heldItemId: m[37] });
}
function readContext(words: number[]): LossContext {
  return lossContextSchema.parse({ money: words[3], badgeMask: words[5], lastHealId: words[6], fieldFlagMask: words[9],
    route16Scene: words[10], safariEntranceScene: words[11], questLogEntrance: words[12], eliteFourFlagMask: words[13],
    championTrainerMask: words[14], leagueScene: words[15], avatarFlags: words[16], direction: words[17], hasDirection: words[18] === 1,
    brockDefeated: words[19] === 1, trainerTowerScene: words[20] });
}
function sourceIds(api: RawLossExports, kind: number, expected: number): number[] {
  require(api.loss_context_count(kind) === expected, 'Loss source context count differs');
  return Array.from({ length: expected }, (_, index) => api.loss_context_id(kind, index) >>> 0);
}
export class LossSession {
  constructor(private readonly core: LossCore, private readonly admission: Admission,
    private sequence: 0 | 1 | 2, private run: Run) { this.admission = structuredClone(admission); }
  snapshot(): LossCheckpoint {
    const body = checkpointBodySchema.parse({ schemaVersion: 1, compatibility: this.core.compatibility,
      admission: this.admission, sequence: this.sequence, words: this.run.words });
    return { ...body, digest: lossCheckpointDigest(body) };
  }
  view(): LossView {
    const w = this.run.words, api = this.run.api, applied = this.sequence === 2;
    const scripts = { 1: 'EventScript_AfterWhiteOutMomHeal', 2: 'EventScript_AfterWhiteOutHeal', 3: 'EventScript_AfterWhiteOutHeal' } as const;
    const script = scripts[w[22] as keyof typeof scripts];
    require(!applied || script, 'Loss arrival script differs');
    const creature = readCreature(this.run), context = readContext(w);
    return structuredClone({ phase: (['ready', 'faint-applied', 'pending-world-application'] as const)[this.sequence], sequence: this.sequence,
      creature, money: { before: w[2]!, previewLoss: w[4]!, loss: w[2]! - w[3]!, after: w[3]! },
      friendship: { before: w[33]!, loss: w[34]!, after: creature.friendship }, inventory: this.run.prepared.inventory, context,
      respawn: applied ? { mapGroup: w[23]!, mapNum: w[24]!, warpId: w[25]! | 0, x: w[26]!, y: w[27]!, healerLocalId: w[21]!, script,
        messageVariant: w[22] === 1 ? null : w[22] === 2 ? 'nurse-pre-brock' : 'nurse' } : null,
      fieldChanges: applied ? { clearFlags: [...sourceIds(api, 3, 5), ...sourceIds(api, 1, 6)],
        clearTrainerFlags: sourceIds(api, 4, 6), setVariables: [...sourceIds(api, 5, 1), ...sourceIds(api, 2, 3)].map(id => ({ id, value: 0 })),
        avatar: { flags: context.avatarFlags, direction: context.direction, hasDirection: context.hasDirection } } : null,
      origin: this.run.prepared.origin, worldApplication: 'pending', combatReadmission: 'unsupported' });
  }
  advance(input: unknown): LossView {
    const command = z.strictObject({ expectedSequence: z.union([z.literal(0), z.literal(1)]) }).parse(input);
    require(command.expectedSequence === this.sequence && this.sequence < 2, 'Stale or completed loss stage');
    const sequence = sequenceSchema.parse(this.sequence + 1), candidate = this.core.replay(this.admission, sequence);
    const session = new LossSession(this.core, this.admission, sequence, candidate);
    const result = session.view(); session.snapshot(); // Entire result validated before publication.
    this.sequence = sequence; this.run = candidate;
    return result;
  }
  project(viewer = 'player') {
    require(viewer === 'player', 'Only the owner may view this loss continuation');
    const view = this.view(), c = view.creature;
    return { phase: view.phase, sequence: view.sequence, self: { speciesId: c.speciesId, level: c.level, friendship: c.friendship,
      hp: c.hp, maxHP: c.stats.hp, status: c.status, moves: c.moves }, money: view.money, inventory: view.inventory,
    respawn: view.respawn ? { mapGroup: view.respawn.mapGroup, mapNum: view.respawn.mapNum,
      x: view.respawn.x, y: view.respawn.y, pendingApplication: true as const } : null,
    worldApplication: view.worldApplication, combatReadmission: view.combatReadmission };
  }
}

export async function loadLossCore(): Promise<LossCore> {
  const report = z.object({ status: z.literal('passed'), profile: z.literal(LOSS_PROFILE), wasm: z.string(), wasmSha256: sha256,
    extraction: z.object({ sourceFingerprint: sha256 }) }).parse(JSON.parse(await readFile('reports/battle-loss-build.json', 'utf8')));
  const [buffer, progression, profile, houseBytes] = await Promise.all([readFile(report.wasm), loadProgressionCore(), loadDevelopmentProfile(),
    readFile('content/generated/client/maps/PalletTown_PlayersHouse_1F.json')]);
  require(hash(buffer) === report.wasmSha256 && report.extraction.sourceFingerprint === profile.sourceFingerprint, 'Loss build/source hash differs');
  require(hash(houseBytes) === WORLD_MAP_HASHES.MAP_PALLET_TOWN_PLAYERS_HOUSE_1F, 'Loss house content differs');
  const house = worldMapSchema.parse(JSON.parse(houseBytes.toString('utf8'))), anchor = house.blocks[house.width * 5 + 8];
  require(house.source.fingerprint === profile.sourceFingerprint && house.id === 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F'
    && anchor?.collision === 0 && anchor.elevation === 3 && house.events.objects.some(object => object.localId === 1
      && object.x === 8 && object.y === 4 && object.visible) && !house.events.objects.some(object => object.visible && object.x === 8 && object.y === 5)
    && !house.events.triggers.some(trigger => trigger.x === 8 && trigger.y === 5), 'Source home arrival is unavailable');
  const hostHash = createHash('sha256').update(await readFile('tools/battle-loss/loss.ts'));
  const compatibility = { profile: LOSS_PROFILE, abiVersion: 1 as const, developmentPolicy: LOSS_DEVELOPMENT_POLICY,
    sourceFingerprint: report.extraction.sourceFingerprint, wasmSha256: report.wasmSha256, hostSha256: hostHash.digest('hex'),
    progressionCompatibilitySha256: hash(canonical(progression.compatibility)),
    battleCompatibilitySha256: progression.compatibility.battleCompatibilitySha256, houseMapSha256: hash(houseBytes) };
  return new LossCore(new WebAssembly.Module(buffer), compatibility, progression, profile.money);
}
