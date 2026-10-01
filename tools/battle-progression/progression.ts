/** Private postbattle continuation over source C; no owned or durable effects.
 * The unchanged combat-v2 adapter remains the sole combat implementation. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { battleSnapshotSchema, type BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile, type DevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadRoute1Engine, route1CheckpointSchema, route1CaptureSchema, route1InventorySchema, type Route1Engine } from '../battle-route1/engine';

export const PROGRESSION_PROFILE = 'firered-route1-progression-v1' as const;
export const PROGRESSION_POLICY = 'single-untraded-no-modifiers-v1' as const;
export const PROGRESSION_STATE_WORDS = 64;
const statNames = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
const uint32 = z.number().int().min(0).max(0xFFFFFFFF);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const statsSchema = z.strictObject({ hp: uint32.max(65535), attack: uint32.max(65535), defense: uint32.max(65535),
  speed: uint32.max(65535), spAttack: uint32.max(65535), spDefense: uint32.max(65535) });
const evsSchema = z.strictObject({ hp: uint32.max(255), attack: uint32.max(255), defense: uint32.max(255),
  speed: uint32.max(255), spAttack: uint32.max(255), spDefense: uint32.max(255) })
  .refine(evs => Object.values(evs).reduce((sum, value) => sum + value, 0) <= 510, 'Source total EV limit exceeded');
const ivsSchema = z.strictObject({ hp: z.literal(15), attack: z.literal(15), defense: z.literal(15),
  speed: z.literal(15), spAttack: z.literal(15), spDefense: z.literal(15) });
const moveSchema = z.strictObject({ moveId: uint32.max(354), pp: uint32.max(255), ppUps: z.literal(0) });
export const progressionCreatureSchema = z.strictObject({ speciesId: z.literal(7), abilityId: z.literal(67),
  personality: z.literal(25), otId: z.literal(1), level: uint32.min(1).max(100), experience: uint32,
  friendship: uint32.max(255), hp: uint32.max(65535), stats: statsSchema, ivs: ivsSchema, evs: evsSchema,
  calculatedEvs: evsSchema, moves: z.array(moveSchema).length(4), status: z.literal(0), heldItemId: z.literal(0) });
export type ProgressionCreature = z.infer<typeof progressionCreatureSchema>;
const defeatedSchema = z.strictObject({ speciesId: z.union([z.literal(16), z.literal(19)]), level: uint32.min(2).max(5) })
  .refine(value => value.speciesId !== 19 || value.level <= 4, 'Unsupported Route 1 Rattata level');
const friendshipContextSchema = z.strictObject({ ballItemId: z.union([z.literal(4), z.literal(11)]),
  metLocation: uint32.max(255), currentRegion: uint32.max(255) });
export const progressionDiagnosticSchema = z.strictObject({ creature: progressionCreatureSchema,
  defeated: defeatedSchema, friendshipContext: friendshipContextSchema, experienceOverride: uint32.min(1).max(32767).optional() });
export type ProgressionDiagnostic = z.infer<typeof progressionDiagnosticSchema>;
export const progressionDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('replace-move'), decisionId: sha256, slot: uint32.max(3) }),
  z.strictObject({ kind: z.literal('decline-move'), decisionId: sha256 }),
]);
export type ProgressionDecision = z.infer<typeof progressionDecisionSchema>;
const admissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('battle-terminal'), battle: battleSnapshotSchema }),
  z.strictObject({ kind: z.literal('diagnostic'), initial: progressionDiagnosticSchema }),
]);
const compatibilitySchema = z.strictObject({ profile: z.literal(PROGRESSION_PROFILE), abiVersion: z.literal(1),
  policy: z.literal(PROGRESSION_POLICY),
  sourceFingerprint: sha256, wasmSha256: sha256, hostSha256: sha256, battleCompatibilitySha256: sha256 });
const checkpointBodySchema = z.strictObject({ schemaVersion: z.literal(1), compatibility: compatibilitySchema,
  admission: admissionSchema, decisions: z.array(progressionDecisionSchema).max(128),
  words: z.array(uint32).length(PROGRESSION_STATE_WORDS).nullable() });
export const progressionCheckpointSchema = checkpointBodySchema.extend({ digest: sha256 }).strict();
export type ProgressionCheckpoint = z.infer<typeof progressionCheckpointSchema>;
export interface RawProgressionExports {
  memory: WebAssembly.Memory;
  progression_abi_version(): number;
  progression_input_word_count(): number;
  progression_input_begin(): number;
  progression_input_set(index: number, value: number): number;
  progression_start(species: number, level: number, currentRegion: number, mode: number, overrideXP: number): number;
  progression_next(): number;
  progression_decide(slot: number): number;
  progression_get(field: number): number;
  progression_mon_get(index: number): number;
  progression_state_word_count(): number;
  progression_state_get(index: number): number;
  progression_event_get(field: number): number;
  progression_import_begin(): number;
  progression_import_set(index: number, value: number): number;
  progression_import_commit(): number;
}
export type ProgressionPhase = 'pending-move' | 'pending-evolution' | 'complete' | 'pending-loss' | 'pending-capture';
export interface ProgressionEvent { kind: 'experience' | 'level-up' | 'learned-move' | 'replaced-move' | 'declined-move' | 'evolution' | 'complete'; value: number; slot: number }
export interface ProgressionView {
  phase: ProgressionPhase; sequence: number; creature: ProgressionCreature;
  award: { sourceExperience: number; experience: number; remainingExperience: number };
  pendingMove: { decisionId: string; moveId: number } | null;
  pendingEvolution: { speciesId: number } | null;
  inventory: z.infer<typeof route1InventorySchema> | null;
  capture: z.infer<typeof route1CaptureSchema> | null;
  origin: { kind: 'battle-terminal'; battleId: string; terminalSequence: number; terminalDigest: string; outcome: string }
    | { kind: 'diagnostic' };
  events: ProgressionEvent[];
  combatReadmission: 'unsupported';
}
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
/** Corruption digest, not an authentication mechanism or a durable deduplicator. */
export function progressionCheckpointDigest(body: Omit<ProgressionCheckpoint, 'digest'>): string { return hash(canonical(body)); }
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(status: number, action: string): void { require(status === 0, `Progression C rejected ${action}: ${status}`); }
const expectedExports = ['memory', 'progression_abi_version', 'progression_input_word_count', 'progression_input_begin', 'progression_input_set', 'progression_start',
  'progression_next', 'progression_decide', 'progression_get', 'progression_mon_get', 'progression_state_word_count',
  'progression_state_get', 'progression_event_get', 'progression_import_begin', 'progression_import_set', 'progression_import_commit'].sort();
export function instantiateRawProgression(module: WebAssembly.Module): RawProgressionExports {
  require(WebAssembly.Module.imports(module).length === 0
    && canonical(WebAssembly.Module.exports(module).map(row => row.name).sort()) === canonical(expectedExports), 'Unsupported progression WASM surface');
  const api = new WebAssembly.Instance(module).exports as unknown as RawProgressionExports;
  require(api.progression_abi_version() === 1 && api.progression_input_word_count() === 46 && api.progression_state_word_count() === PROGRESSION_STATE_WORDS
    && api.memory.buffer.byteLength === 262144 && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported progression ABI/memory');
  return api;
}
const zeroEvs = () => ({ hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });
type Admission = z.infer<typeof admissionSchema>;
interface Prepared {
  creature: ProgressionCreature; defeated: z.infer<typeof defeatedSchema>;
  context: z.infer<typeof friendshipContextSchema> | null; overrideXP?: number;
  origin: ProgressionView['origin']; inventory: ProgressionView['inventory']; capture: ProgressionView['capture'];
  phase: 'pending-loss' | 'pending-capture' | 'complete' | null;
}
interface Run { api: RawProgressionExports | null; prepared: Prepared; events: ProgressionEvent[]; words: number[] | null }

export class ProgressionCore {
  readonly module: WebAssembly.Module;
  readonly compatibility: z.infer<typeof compatibilitySchema>;
  constructor(module: WebAssembly.Module, compatibility: z.infer<typeof compatibilitySchema>,
    private readonly battle: Route1Engine, private readonly profile: DevelopmentProfile) {
    instantiateRawProgression(module); this.module = module;
    this.compatibility = Object.freeze(compatibilitySchema.parse(compatibility));
    require(this.compatibility.battleCompatibilitySha256 === hash(canonical(battle.compatibility)), 'Progression battle compatibility differs');
    require(profile.id === 'r1-squirtle-v1' && profile.sourceFingerprint === this.compatibility.sourceFingerprint,
      'Progression requires the pinned development fixture');
    this.profile = structuredClone(profile);
  }
  fromBattle(input: unknown): ProgressionSession { return this.create(admissionSchema.parse({ kind: 'battle-terminal', battle: input })); }
  /** Explicit private diagnostic surface. It does not authorize another battle,
   * establish owned provenance, or represent reachable combat-v2 state. */
  createDiagnostic(input: unknown): ProgressionSession { return this.create(admissionSchema.parse({ kind: 'diagnostic', initial: input })); }
  private create(admission: Admission): ProgressionSession {
    const run = this.replay(admission, []);
    readCreature(run);
    return new ProgressionSession(this, admission, [], run);
  }
  restore(input: unknown): ProgressionSession {
    const checkpoint = progressionCheckpointSchema.parse(input), { digest, ...body } = checkpoint;
    require(digest === progressionCheckpointDigest(body), 'Progression checkpoint integrity differs');
    require(canonical(checkpoint.compatibility) === canonical(this.compatibility), 'Incompatible progression checkpoint');
    const run = this.replay(checkpoint.admission, checkpoint.decisions);
    require(canonical(run.words) === canonical(checkpoint.words), 'Progression checkpoint differs from its source replay');
    return new ProgressionSession(this, checkpoint.admission, checkpoint.decisions, run);
  }
  private prepare(admission: Admission): Prepared {
    if (admission.kind === 'diagnostic') {
      const initial = admission.initial;
      return { creature: initial.creature, defeated: initial.defeated, context: initial.friendshipContext,
        ...(initial.experienceOverride === undefined ? {} : { overrideXP: initial.experienceOverride }),
        origin: { kind: 'diagnostic' }, inventory: null, capture: null, phase: null };
    }
    const snapshot: BattleSnapshot = this.battle.restore(admission.battle);
    const checkpoint = route1CheckpointSchema.parse(JSON.parse(Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8')));
    require(checkpoint.host.phase === 'ended' && checkpoint.host.outcome !== null, 'Progression requires an actual terminal battle');
    const baseline = this.profile.creature, words = checkpoint.core.words;
    // The fixture has no OT-name provenance. Untraded, one-recipient ordinary
    // wild rewards are an explicit versioned policy, not proved by OTID alone.
    const creature = progressionCreatureSchema.parse({ speciesId: baseline.speciesId, abilityId: baseline.abilityId,
      personality: baseline.personality, otId: baseline.otId, level: baseline.level, experience: baseline.experience,
      friendship: baseline.friendship, hp: words[17], stats: baseline.stats, ivs: baseline.ivs,
      evs: baseline.evs, calculatedEvs: zeroEvs(), status: 0, heldItemId: 0,
      moves: Array.from({ length: 4 }, (_, slot) => ({ moveId: words[38 + slot], pp: words[42 + slot], ppUps: 0 })) });
    const outcome = checkpoint.host.outcome;
    return { creature, defeated: defeatedSchema.parse({ speciesId: words[94], level: words[64] }), context: null,
      origin: { kind: 'battle-terminal', battleId: snapshot.config.battleId, terminalSequence: snapshot.transitionSequence,
        terminalDigest: hash(canonical(snapshot)), outcome }, inventory: checkpoint.host.inventory, capture: checkpoint.capture,
      phase: outcome === 'won' ? null : outcome === 'lost' || outcome === 'draw' ? 'pending-loss' : outcome === 'captured' ? 'pending-capture' : 'complete' };
  }
  /** Internal deterministic replay; no input or existing session is mutated. */
  replay(admission: Admission, decisions: ProgressionDecision[]): Run {
    const prepared = this.prepare(admission), events: ProgressionEvent[] = [];
    if (prepared.phase !== null) {
      require(decisions.length === 0, 'Terminal handoff has no move decision');
      return { api: null, prepared, events, words: null };
    }
    const api = instantiateRawProgression(this.module), c = prepared.creature, context = prepared.context;
    const words = [c.speciesId, c.personality, c.otId, c.experience, c.level, c.friendship, c.hp,
      ...statNames.map(key => c.stats[key]), ...statNames.map(key => c.ivs[key]), ...statNames.map(key => c.evs[key]),
      ...c.moves.map(move => move.moveId), ...c.moves.map(move => move.pp), 0,
      context?.ballItemId ?? 0xFFFFFFFF, context?.metLocation ?? 0xFFFFFFFF, 0, 0, 0, 0,
      ...statNames.map(key => c.calculatedEvs[key])];
    ok(api.progression_input_begin(), 'input begin'); words.forEach((value, index) => ok(api.progression_input_set(index, value), 'input'));
    ok(api.progression_start(prepared.defeated.speciesId, prepared.defeated.level, context?.currentRegion ?? 0xFFFFFFFF,
      prepared.overrideXP === undefined ? 0 : 1, prepared.overrideXP ?? 0), 'start');
    settle(api, events);
    for (let index = 0; index < decisions.length; index++) {
      const decision = decisions[index]!;
      require(api.progression_get(0) === 3 && decision.decisionId === decisionId(admission, index, api), 'Stale or unavailable progression decision');
      ok(api.progression_decide(decision.kind === 'replace-move' ? decision.slot : 4), 'move decision');
      recordEvent(api, events); settle(api, events);
    }
    return { api, prepared, events, words: exportWords(api) };
  }
}
function exportWords(api: RawProgressionExports): number[] { return Array.from({ length: PROGRESSION_STATE_WORDS }, (_, index) => api.progression_state_get(index) >>> 0); }
function recordEvent(api: RawProgressionExports, events: ProgressionEvent[]): void {
  const type = api.progression_event_get(0);
  if (type === 0) return;
  const kinds = ['experience', 'level-up', 'learned-move', 'replaced-move', 'declined-move', 'evolution', 'complete'] as const;
  require(type >= 1 && type <= kinds.length, 'Unknown source progression event');
  events.push({ kind: kinds[type - 1]!, value: api.progression_event_get(1) >>> 0, slot: api.progression_event_get(2) >>> 0 });
  require(events.length <= 4096, 'Progression event bound exceeded');
}
function settle(api: RawProgressionExports, events: ProgressionEvent[]): void {
  for (let steps = 0; steps < 4096; steps++) {
    const phase = api.progression_get(0);
    if (phase === 3 || phase === 4 || phase === 5) return;
    require(phase === 1 || phase === 2, 'Unknown source progression phase');
    ok(api.progression_next(), 'source continuation'); recordEvent(api, events);
  }
  throw new Error('Progression source continuation bound exceeded');
}
function decisionId(admission: Admission, sequence: number, api: RawProgressionExports): string {
  return hash(canonical({ admission, sequence, words: exportWords(api), moveId: api.progression_get(1) }));
}
function readCreature(run: Run): ProgressionCreature {
  if (!run.api) return structuredClone(run.prepared.creature);
  const api = run.api, w = Array.from({ length: 40 }, (_, i) => api.progression_mon_get(i) >>> 0);
  const stats = (offset: number) => Object.fromEntries(statNames.map((key, index) => [key, w[offset + index]]));
  return progressionCreatureSchema.parse({ speciesId: w[0], abilityId: 67, personality: w[1], otId: w[2], experience: w[3], level: w[4],
    friendship: w[5], hp: w[6], stats: stats(7), ivs: stats(13), evs: stats(19), calculatedEvs: calculatedEvs(run),
    moves: w.slice(25, 29).map((moveId, slot) => ({ moveId, pp: w[29 + slot], ppUps: 0 })), status: w[36], heldItemId: w[37] });
}
function calculatedEvs(run: Run): ProgressionCreature['calculatedEvs'] {
  // The C checkpoint owns the last-recalculation basis. The exact header offsets
  // are supplied by the source adapter and validated through full replay.
  const words = run.words;
  require(words !== null, 'Missing source cached-stat basis');
  return Object.fromEntries(statNames.map((key, index) => [key, words[16 + index]!])) as ProgressionCreature['calculatedEvs'];
}

export class ProgressionSession {
  constructor(private readonly core: ProgressionCore, private readonly admission: Admission,
    private decisions: ProgressionDecision[], private run: Run) {
    this.admission = structuredClone(admission); this.decisions = structuredClone(decisions);
  }
  snapshot(): ProgressionCheckpoint {
    const body = checkpointBodySchema.parse({ schemaVersion: 1, compatibility: this.core.compatibility,
      admission: this.admission, decisions: this.decisions, words: this.run.words });
    return { ...body, digest: progressionCheckpointDigest(body) };
  }
  view(): ProgressionView {
    const { api, prepared } = this.run;
    const phase = prepared.phase ?? ({ 3: 'pending-move', 4: 'pending-evolution', 5: 'complete' } as const)[api!.progression_get(0) as 3 | 4 | 5];
    require(phase, 'Source continuation did not settle');
    return structuredClone({ phase, sequence: this.decisions.length, creature: readCreature(this.run),
      award: { sourceExperience: api?.progression_get(6) ?? 0, experience: api?.progression_get(3) ?? 0, remainingExperience: api?.progression_get(2) ?? 0 },
      pendingMove: phase === 'pending-move' ? { decisionId: decisionId(this.admission, this.decisions.length, api!), moveId: api!.progression_get(1) } : null,
      pendingEvolution: phase === 'pending-evolution' ? { speciesId: api!.progression_get(4) } : null,
      inventory: prepared.inventory, capture: prepared.capture, origin: prepared.origin, events: this.run.events, combatReadmission: 'unsupported' });
  }
  decide(input: unknown): ProgressionView {
    const decision = progressionDecisionSchema.parse(input), before = this.view();
    require(before.pendingMove && before.pendingMove.decisionId === decision.decisionId, 'Stale or unavailable progression decision');
    const decisions = z.array(progressionDecisionSchema).max(128).parse([...this.decisions, decision]);
    const candidate = this.core.replay(this.admission, decisions);
    readCreature(candidate); // Reject invalid output before replacing the session.
    this.decisions = decisions; this.run = candidate;
    return this.view();
  }
  /** A single owner view; exact enemy identity, RNG, source words and provenance
   * remain private. This does not authorize an HTTP or room entry point. */
  project(viewer = 'player') {
    require(viewer === 'player', 'Only the owner may view this progression');
    const view = this.view(), c = view.creature;
    return { phase: view.phase, sequence: view.sequence, self: { speciesId: c.speciesId, level: c.level, experience: c.experience,
      friendship: c.friendship, hp: c.hp, stats: c.stats, moves: c.moves }, pendingMove: view.pendingMove,
    pendingEvolution: view.pendingEvolution, inventory: view.inventory,
    capture: view.capture ? { speciesId: view.capture.creature.speciesId, level: view.capture.creature.level, pendingDisposition: true as const } : null,
    combatReadmission: view.combatReadmission };
  }
}

export async function loadProgressionCore(): Promise<ProgressionCore> {
  const report = z.object({ status: z.literal('passed'), profile: z.literal(PROGRESSION_PROFILE), wasm: z.string(),
    wasmSha256: sha256, extraction: z.object({ sourceFingerprint: sha256 }) })
    .parse(JSON.parse(await readFile('reports/battle-progression-build.json', 'utf8')));
  const [buffer, battle, profile] = await Promise.all([readFile(report.wasm), loadRoute1Engine(), loadDevelopmentProfile()]);
  require(hash(buffer) === report.wasmSha256 && report.extraction.sourceFingerprint === profile.sourceFingerprint, 'Progression build/source hash differs');
  const hostHash = createHash('sha256');
  for (const path of ['tools/battle-progression/progression.ts', 'apps/server/src/development-profile.ts']) hostHash.update(await readFile(path));
  const compatibility = { profile: PROGRESSION_PROFILE, policy: PROGRESSION_POLICY, abiVersion: 1 as const, sourceFingerprint: report.extraction.sourceFingerprint,
    wasmSha256: report.wasmSha256, hostSha256: hostHash.digest('hex'), battleCompatibilitySha256: hash(canonical(battle.compatibility)) };
  return new ProgressionCore(new WebAssembly.Module(buffer), compatibility, battle, profile);
}
