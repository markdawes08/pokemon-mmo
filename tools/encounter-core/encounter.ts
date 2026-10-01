/** Private source-C encounter foundation. This is neither a battle engine nor
 * a captured/owned creature record. Never expose seeds/checkpoints to clients. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ENCOUNTER_PROFILE = 'firered-route1-encounter-v1' as const;
export const ENCOUNTER_STATE_WORDS = 44;
const uint32 = z.number().int().min(0).max(0xFFFFFFFF);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const statNames = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
const statsSchema = z.strictObject({ hp: uint32, attack: uint32, defense: uint32, speed: uint32, spAttack: uint32, spDefense: uint32 });
export const encounterCreatureSchema = z.strictObject({
  slot: z.number().int().min(0).max(11), speciesId: z.union([z.literal(16), z.literal(19)]),
  level: z.number().int().min(2).max(5), personality: uint32, nature: z.number().int().min(0).max(24),
  abilityId: z.union([z.literal(50), z.literal(51), z.literal(62)]), abilityNum: z.union([z.literal(0), z.literal(1)]),
  gender: z.union([z.literal(0), z.literal(254)]), otId: uint32,
  ivs: statsSchema, stats: statsSchema, hp: uint32, experience: uint32,
  friendship: z.literal(70), status: z.literal(0), heldItemId: z.literal(0),
  moves: z.array(z.strictObject({ moveId: uint32, pp: uint32, ppUps: z.literal(0) })).length(4),
});
export type EncounterCreature = z.infer<typeof encounterCreatureSchema>;
export const encounterSeedSchema = z.strictObject({ mainSeed: uint32, wildSeed: z.number().int().min(0).max(65535), trainerId: uint32 });
export type EncounterSeeds = z.infer<typeof encounterSeedSchema>;
export const encounterStepSchema = z.strictObject({ behavior: z.enum(['plain', 'grass']), movement: z.enum(['walk', 'run']) });
export type EncounterStep = z.infer<typeof encounterStepSchema>;
const compatibilitySchema = z.strictObject({
  profile: z.literal(ENCOUNTER_PROFILE), abiVersion: z.literal(1), sourceFingerprint: sha256,
  wasmSha256: sha256, hostSha256: sha256,
});
const checkpointBodySchema = z.strictObject({
  schemaVersion: z.literal(1), compatibility: compatibilitySchema, initialSeeds: encounterSeedSchema,
  phase: z.enum(['ready', 'pending-encounter']), words: z.array(uint32).length(ENCOUNTER_STATE_WORDS),
});
export const encounterCheckpointSchema = checkpointBodySchema.extend({ digest: sha256 }).strict();
export type EncounterCheckpoint = z.infer<typeof encounterCheckpointSchema>;
export interface EncounterView {
  phase: 'ready' | 'pending-encounter'; trainerId: number; encounterSerial: number;
  generalRng: { state: number; draws: number }; encounterRng: { state: number; draws: number };
  cooldown: { steps: number; buff: number; previousBehavior: number };
  creature: EncounterCreature | null;
}
export type EncounterResult = { kind: 'none' } | { kind: 'encounter'; creature: EncounterCreature };

export interface RawEncounterExports {
  memory: WebAssembly.Memory;
  encounter_abi_version(): number;
  encounter_reset(mainSeed: number, wildSeed: number, trainerId: number): number;
  encounter_step(attributes: number): number;
  encounter_generate(): number;
  encounter_state_word_count(): number;
  encounter_state_get(index: number): number;
  encounter_import_begin(): void;
  encounter_import_set(index: number, value: number): number;
  encounter_import_commit(): number;
  encounter_creature_get(index: number): number;
}
const expectedExports = ['memory', 'encounter_abi_version', 'encounter_reset', 'encounter_step', 'encounter_generate',
  'encounter_state_word_count', 'encounter_state_get', 'encounter_import_begin', 'encounter_import_set',
  'encounter_import_commit', 'encounter_creature_get'].sort();
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
/** Integrity check detects corruption, not authentication. Persist only in
 * server-owned authenticated storage. Plausible forged identities are not proof
 * of an actual historical encounter. Compatibility and semantics are separate. */
export function checkpointDigest(body: Omit<EncounterCheckpoint, 'digest'>): string { return hash(canonical(body)); }
function ok(status: number, operation: string): void {
  if (status !== 0) throw new Error(`Encounter module rejected ${operation} (${status}).`);
}
export function instantiateRawEncounter(module: WebAssembly.Module): RawEncounterExports {
  if (WebAssembly.Module.imports(module).length !== 0
    || canonical(WebAssembly.Module.exports(module).map(row => row.name).sort()) !== canonical(expectedExports))
    throw new Error('Unsupported private encounter module surface.');
  const api = new WebAssembly.Instance(module).exports as unknown as RawEncounterExports;
  if (api.encounter_abi_version() !== 1 || api.encounter_state_word_count() !== ENCOUNTER_STATE_WORDS
    || api.memory.buffer.byteLength !== 262144 || api.memory.buffer instanceof SharedArrayBuffer)
    throw new Error('Unsupported private encounter module ABI or memory.');
  return api;
}
function exportWords(api: RawEncounterExports): number[] {
  return Array.from({ length: ENCOUNTER_STATE_WORDS }, (_, index) => api.encounter_state_get(index) >>> 0);
}
function importWords(api: RawEncounterExports, words: number[]): void {
  api.encounter_import_begin();
  words.forEach((value, index) => ok(api.encounter_import_set(index, value), 'import word'));
  ok(api.encounter_import_commit(), 'checkpoint semantics');
}
/** Affine exponentiation verifies counted RNG state in O(log draws), without
 * consuming source Random calls or replaying a potentially enormous history. */
export function advanceEncounterRng(seed: number, draws: number, addend: 24691 | 12345): number {
  uint32.parse(seed); uint32.parse(draws);
  let multiplier = 1103515245n, increment = BigInt(addend), remaining = BigInt(draws);
  let accumulatedMultiplier = 1n, accumulatedIncrement = 0n;
  const mask = 0xFFFFFFFFn;
  while (remaining > 0n) {
    if ((remaining & 1n) !== 0n) {
      accumulatedMultiplier = accumulatedMultiplier * multiplier & mask;
      accumulatedIncrement = (accumulatedIncrement * multiplier + increment) & mask;
    }
    increment = increment * (multiplier + 1n) & mask;
    multiplier = multiplier * multiplier & mask;
    remaining >>= 1n;
  }
  return Number((accumulatedMultiplier * BigInt(seed) + accumulatedIncrement) & mask);
}
function validateRng(words: number[], seeds: EncounterSeeds): void {
  if (words[1] !== advanceEncounterRng(seeds.mainSeed, words[3], 24691)
    || words[2] !== advanceEncounterRng(seeds.wildSeed, words[4], 12345)
    || words[10] !== seeds.trainerId) throw new Error('Encounter checkpoint RNG provenance or trainer identity differs.');
}
function readCreature(words: number[]): EncounterCreature | null {
  const c = words.slice(12);
  if (!c[0]) return null;
  const stats = (offset: number) => Object.fromEntries(statNames.map((name, index) => [name, c[offset + index]]));
  return encounterCreatureSchema.parse({
    slot: c[1], speciesId: c[2], level: c[3], personality: c[4], nature: c[5], abilityId: c[6], abilityNum: c[7],
    gender: c[8], otId: c[9], ivs: stats(10), stats: stats(16), hp: c[22], experience: c[23], friendship: c[24],
    status: c[25], heldItemId: c[26], moves: c.slice(27, 31).map(word => ({ moveId: word & 65535, pp: word >>> 16 & 255, ppUps: word >>> 24 })),
  });
}

export class EncounterCore {
  readonly module: WebAssembly.Module;
  readonly compatibility: z.infer<typeof compatibilitySchema>;
  constructor(module: WebAssembly.Module, compatibility: z.infer<typeof compatibilitySchema>) {
    instantiateRawEncounter(module);
    this.module = module;
    this.compatibility = Object.freeze(compatibilitySchema.parse(compatibility));
  }
  create(input: unknown): EncounterFactory {
    const seeds = encounterSeedSchema.parse(input);
    const api = instantiateRawEncounter(this.module);
    ok(api.encounter_reset(seeds.mainSeed, seeds.wildSeed, seeds.trainerId), 'reset');
    return new EncounterFactory(this, api, seeds, 'ready');
  }
  restore(input: unknown): EncounterFactory {
    const checkpoint = encounterCheckpointSchema.parse(input);
    const { digest, ...body } = checkpoint;
    if (checkpointDigest(body) !== digest) throw new Error('Encounter checkpoint integrity differs.');
    if (canonical(checkpoint.compatibility) !== canonical(this.compatibility)) throw new Error('Encounter checkpoint compatibility differs; migration is required.');
    validateRng(checkpoint.words, checkpoint.initialSeeds);
    if (checkpoint.words[5] !== 0 && checkpoint.words[5] !== 2)
      throw new Error('Encounter checkpoint behavior is outside the host profile.');
    if (checkpoint.phase === 'pending-encounter'
      && (checkpoint.words[11] === 0 || checkpoint.words[12] !== 1 || checkpoint.words[6] !== 0 || checkpoint.words[7] !== 0))
      throw new Error('Encounter checkpoint has no valid pending creature boundary.');
    const api = instantiateRawEncounter(this.module);
    importWords(api, checkpoint.words);
    readCreature(checkpoint.words);
    return new EncounterFactory(this, api, checkpoint.initialSeeds, checkpoint.phase);
  }
}

export class EncounterFactory {
  #api: RawEncounterExports;
  #phase: EncounterCheckpoint['phase'];
  readonly #core: EncounterCore;
  readonly #seeds: EncounterSeeds;
  constructor(core: EncounterCore, api: RawEncounterExports, seeds: EncounterSeeds, phase: EncounterCheckpoint['phase']) {
    this.#core = core; this.#api = api; this.#seeds = { ...seeds }; this.#phase = phase;
  }
  view(): EncounterView {
    const words = exportWords(this.#api);
    return { phase: this.#phase, trainerId: words[10], encounterSerial: words[11],
      generalRng: { state: words[1], draws: words[3] }, encounterRng: { state: words[2], draws: words[4] },
      cooldown: { previousBehavior: words[5], buff: words[6], steps: words[7] }, creature: readCreature(words) };
  }
  snapshot(): EncounterCheckpoint {
    const body = checkpointBodySchema.parse({ schemaVersion: 1, compatibility: this.#core.compatibility,
      initialSeeds: this.#seeds, phase: this.#phase, words: exportWords(this.#api) });
    return { ...body, digest: checkpointDigest(body) };
  }
  step(input: unknown): EncounterResult {
    const parsed = encounterStepSchema.parse(input);
    // Walking and running share source encounter eligibility; the authoritative
    // movement owner must supply one call per completed eligible step.
    return this.#mutate(api => api.encounter_step(parsed.behavior === 'grass' ? 0x01000002 : 0));
  }
  /** Diagnostic/internal generation boundary; bypasses step eligibility openly.
   * It still uses source slot/level RNG; no caller-selected species/IVs/slot. */
  generate(): EncounterResult { return this.#mutate(api => api.encounter_generate()); }
  /** Explicit handoff boundary after the owner has handled the pending encounter.
   * This factory has no battle/outcome authority and does not award anything. */
  continueAfterEncounter(): void {
    if (this.#phase !== 'pending-encounter') throw new Error('No pending encounter to continue.');
    this.#phase = 'ready';
  }
  #mutate(action: (api: RawEncounterExports) => number): EncounterResult {
    if (this.#phase !== 'ready') throw new Error('Pending encounter must be handled before another step or generation.');
    // A C trap/exhaustion cannot publish partial RNG or identity state.
    const candidate = instantiateRawEncounter(this.#core.module);
    importWords(candidate, exportWords(this.#api));
    const result = action(candidate);
    if (result !== 0 && result !== 1) throw new Error(`Unsupported encounter operation (${result}).`);
    const words = exportWords(candidate);
    validateRng(words, this.#seeds);
    const creature = readCreature(words);
    if (result === 1 && !creature) throw new Error('Source encounter omitted its creature.');
    this.#api = candidate;
    if (result === 1 && creature) { this.#phase = 'pending-encounter'; return { kind: 'encounter', creature }; }
    return { kind: 'none' };
  }
}

/** Loads only the verified private artifact. No browser imports, imports into
 * WASM, nondeterministic host callbacks, or fallback/reroll recovery exist. */
export async function loadEncounterCore(options: { wasmPath?: string; manifestPath?: string } = {}): Promise<EncounterCore> {
  const manifestPath = options.manifestPath ?? 'reports/encounter-core-build.json';
  const report = z.object({ status: z.literal('passed'), wasm: z.string(), wasmSha256: sha256,
    abiVersion: z.literal(1), checkpointWords: z.literal(44), extraction: z.object({ sourceFingerprint: sha256 }) })
    .parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const wasmPath = options.wasmPath ?? report.wasm;
  const [bytes, host] = await Promise.all([readFile(wasmPath), readFile('tools/encounter-core/encounter.ts')]);
  if (hash(bytes) !== report.wasmSha256) throw new Error('Encounter artifact hash differs from the successful build.');
  return new EncounterCore(new WebAssembly.Module(bytes), { profile: ENCOUNTER_PROFILE, abiVersion: 1,
    sourceFingerprint: report.extraction.sourceFingerprint, wasmSha256: report.wasmSha256, hostSha256: hash(host) });
}
