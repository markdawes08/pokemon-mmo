/** Private P03 experiment driver. This is deliberately not a BattleEngine. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const uint32 = z.number().int().min(0).max(0xFFFFFFFF);
const hp = z.number().int().min(1).max(65535);
const stat = z.number().int().min(1).max(999);
const type = z.number().int().min(0).max(17).refine(value => value !== 9, 'Mystery type is outside the probe');
const battlerSchema = z.strictObject({
  level: z.number().int().min(1).max(100), hp, maxHP: hp,
  attack: stat, defense: stat, spAttack: stat, spDefense: stat,
  type1: type, type2: type,
  status1: z.union([z.literal(0), z.literal(16)]),
  status2: z.union([z.literal(0), z.literal(0x20000000)]),
  stages: z.array(z.number().int().min(0).max(12)).length(8)
    .refine(values => [0, 3, 6, 7].every(index => values[index] === 6), 'Non-damage stages must stay neutral in this probe'),
}).refine(row => row.hp <= row.maxHP, 'HP exceeds maximum');
export const probeInputSchema = z.strictObject({
  seed: uint32, move: z.union([z.literal(33), z.literal(55)]), crit: z.union([z.literal(1), z.literal(2)]),
  battlers: z.tuple([battlerSchema, battlerSchema]),
});
export type ProbeInput = z.infer<typeof probeInputSchema>;
export const resultSchema = z.strictObject({
  baseDamage: z.number().int().nonnegative(), afterCritical: z.number().int().nonnegative(),
  afterType: z.number().int().nonnegative(), damage: z.number().int().nonnegative(),
  flags: z.number().int().nonnegative(), hpDealt: z.number().int().nonnegative(),
  targetHP: z.number().int().nonnegative(), physicalDmg: z.number().int().nonnegative(), specialDmg: z.number().int().nonnegative(),
  rngState: uint32, events: z.array(z.strictObject({ type: z.union([z.literal(1), z.literal(2)]), battler: z.literal(1), value: z.number().int().nonnegative() })).max(2),
});
export type ProbeResult = z.infer<typeof resultSchema>;

export interface ProbeExports {
  memory: WebAssembly.Memory;
  spike_abi_version(): number;
  spike_reset(seed: number): number;
  spike_set_battler(index: number, level: number, hp: number, maxHP: number, attack: number, defense: number, spAttack: number,
    spDefense: number, type1: number, type2: number, status1: number, status2: number): number;
  spike_set_stage(index: number, stat: number, value: number): number;
  spike_set_capabilities(ability0: number, ability1: number, item0: number, item1: number, weather: number, battleFlags: number, side0: number, side1: number): number;
  spike_damage(move: number, crit: number): number;
  spike_get_result(field: number): number;
  spike_get_rng(): number;
  spike_rng_next(): number;
  spike_get_event(index: number, field: number): number;
  spike_get_battler(index: number, field: number): number;
  spike_battle_mon_size(): number;
}

export function statusOk(status: number, action: string): void {
  if (status !== 0) throw new Error(`Source probe rejected ${action} (status ${status}); no gameplay result is committed.`);
}

export async function loadProbeModule(): Promise<WebAssembly.Module> {
  const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8')) as { status: string; wasm: string; wasmSha256: string; exports: string[] };
  if (build.status !== 'passed' || build.wasm !== '.local/battle-spike/primary/probe.wasm') throw new Error('Missing successful battle probe build. Run npm.cmd run battle:spike.');
  const bytes = await readFile(build.wasm);
  if (createHash('sha256').update(bytes).digest('hex') !== build.wasmSha256) throw new Error('Battle probe bytes differ from the build report.');
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error('Unexpected WASM host dependencies.');
  const actual = WebAssembly.Module.exports(module).map(row => row.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(['memory', ...build.exports].sort())) throw new Error('Unexpected probe export surface.');
  return module;
}

/** Each instance has private fixed linear memory; callers never supply a shared import. */
export function instantiateProbe(module: WebAssembly.Module): ProbeExports {
  const api = new WebAssembly.Instance(module).exports as unknown as ProbeExports;
  if (api.spike_abi_version() !== 1 || api.memory.buffer.byteLength !== 262144 || api.memory.buffer instanceof SharedArrayBuffer) throw new Error('Unsupported source probe ABI/memory.');
  return api;
}

/** Internal fixture/state input only. Live seeds and untrusted player choices have no entry point here. */
export function initializeProbe(api: ProbeExports, input: unknown): ProbeInput {
  const parsed = probeInputSchema.parse(input);
  statusOk(api.spike_reset(parsed.seed), 'reset');
  statusOk(api.spike_set_capabilities(0, 0, 0, 0, 0, 0, 0, 0), 'empty supported environment');
  parsed.battlers.forEach((battler, index) => {
    statusOk(api.spike_set_battler(index, battler.level, battler.hp, battler.maxHP, battler.attack, battler.defense,
      battler.spAttack, battler.spDefense, battler.type1, battler.type2, battler.status1, battler.status2), 'battler');
    battler.stages.forEach((stage, stat) => statusOk(api.spike_set_stage(index, stat, stage), 'stat stage'));
  });
  return parsed;
}

export function readProbeResult(api: ProbeExports): ProbeResult {
  statusOk(api.spike_get_result(0), 'source command path');
  const eventCount = api.spike_get_result(11);
  if (eventCount < 0 || eventCount > 2) throw new Error('Invalid source controller event count');
  const values = Array.from({ length: 9 }, (_, index) => api.spike_get_result(index + 1));
  return resultSchema.parse({ baseDamage: values[0], afterCritical: values[1], afterType: values[2], damage: values[3], flags: values[4],
    hpDealt: values[5], targetHP: values[6], physicalDmg: values[7], specialDmg: values[8], rngState: api.spike_get_rng() >>> 0,
    events: Array.from({ length: eventCount }, (_, index) => ({ type: api.spike_get_event(index, 0), battler: api.spike_get_event(index, 1), value: api.spike_get_event(index, 2) })) });
}

export function runProbe(api: ProbeExports, input: unknown): ProbeResult {
  const parsed = initializeProbe(api, input);
  statusOk(api.spike_damage(parsed.move, parsed.crit), 'damage and HP update');
  return readProbeResult(api);
}
