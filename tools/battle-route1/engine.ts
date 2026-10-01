/** Private real Route 1 profile through the existing six-method WASM adapter. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState, BattleSnapshot, DeepReadonly } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { Route1Driver, ROUTE1_PROFILE, ROUTE1_SOURCE, route1InitialSchema, route1ChoiceSchema,
  route1EventSchema, route1PresentationSchema, route1CheckpointSchema,
  type Route1Initial, type Route1Resources } from './driver';
export { route1InitialSchema, route1ChoiceSchema, route1EventSchema, route1PresentationSchema,
  route1CheckpointSchema, route1InventorySchema, route1CaptureSchema, Route1Driver, instantiateRoute1 } from './driver';
export type { Route1Initial, Route1Choice, Route1Event, Route1Presentation, Route1Checkpoint, Route1Exports, Route1Inventory, Route1Capture } from './driver';

function bytes(value: number): Uint8Array {
  const data = new Uint8Array(4); new DataView(data.buffer).setUint32(0, value, true); return data;
}
function pve(config: DeepReadonly<BattleConfig>): void {
  if (config.policy.mode !== 'pve' || config.participantIds.length !== 2 || config.participantIds[0] !== 'player'
    || config.participantIds[1] !== 'wild') throw new Error('Route 1 admits only the private player-versus-wild profile.');
}
function pveState(state: DeepReadonly<BattleSnapshot>): void { pve(state.config); }

export function createRoute1Engine(module: WebAssembly.Module, resources: Route1Resources, engineVersion: string) {
  const kernel = createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands',
    engineVersion, rulesVersion: ROUTE1_PROFILE, contentFingerprint: ROUTE1_SOURCE, engineStateVersion: 3,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: route1InitialSchema, choiceSchema: route1ChoiceSchema, eventSchema: route1EventSchema,
    presentationSchema: route1PresentationSchema, checkpointSchema: route1CheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0 || new DataView(rng.buffer, rng.byteOffset, 4).getUint32(0, true) !== initial.encounter.words[1])
        throw new Error('Battle RNG must start at the admitted encounter post-held-item boundary.');
      return new Route1Driver(module, resources, initial);
    },
    restore: checkpoint => Route1Driver.restore(module, resources, checkpoint),
    metadata: checkpoint => ({ transitionSequence: checkpoint.host.sequence, eventSequence: checkpoint.host.eventSequence,
      rng: bytes(checkpoint.rng.state), draws: checkpoint.rng.draws }),
  });
  // The shared adapter also supports other profiles' PvP copies. This specific
  // profile keeps its controller identity and human view deliberately one-sided.
  return {
    compatibility: kernel.compatibility,
    createBattle(...args: Parameters<typeof kernel.createBattle>) { pve(args[0]); return kernel.createBattle(...args); },
    validateChoice(...args: Parameters<typeof kernel.validateChoice>) { pveState(args[0]); return kernel.validateChoice(...args); },
    advance(...args: Parameters<typeof kernel.advance>) { pveState(args[0]); return kernel.advance(...args); },
    snapshot(...args: Parameters<typeof kernel.snapshot>) { pveState(args[0]); return kernel.snapshot(...args); },
    restore(...args: Parameters<typeof kernel.restore>) { pveState(args[0]); return kernel.restore(...args); },
    project(...args: Parameters<typeof kernel.project>) { pveState(args[0]); return kernel.project(...args); },
  };
}
export type Route1Engine = ReturnType<typeof createRoute1Engine>;
export function route1Config(engine: Route1Engine, battleId: string): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'wild'], policy: { mode: 'pve', allowedDomainEffects: [] } };
}
/** The battle-local count starts at zero, while the full preceding factory
 * stream/count remains in admission. Mechanical intro/tie and selection draws
 * then execute in C. Frame-dependent VBlank RNG is explicitly not simulated. */
export function makeRoute1Rng(battleId: string, input: Route1Initial): BattleRngState {
  const initial = route1InitialSchema.parse(input);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(initial.encounter.words[1]!)).toString('base64') } };
}
export async function createRoute1Initial(encounter: unknown, depleted: { hp?: number; pp?: [number, number]; inventory?: { potion: number; pokeBall: number } } = {}): Promise<Route1Initial> {
  const options = z.strictObject({ hp: z.number().int().positive().optional(), pp: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
    inventory: z.strictObject({ potion: z.number().int().min(0).max(5), pokeBall: z.number().int().min(0).max(5) }).optional() }).parse(depleted);
  const profile = await loadDevelopmentProfile();
  const initial = route1InitialSchema.parse({ encounter, inventory: options.inventory ?? {
    potion: profile.inventory.find(item => item.itemId === 13)?.quantity, pokeBall: profile.inventory.find(item => item.itemId === 4)?.quantity },
  player: { hp: options.hp ?? profile.creature.hp,
    pp: options.pp ?? profile.creature.moves.map(move => move.pp) } });
  // Engine admission independently repeats source factory semantic validation;
  // building an initial envelope grants no authority by itself.
  if (initial.player.hp > profile.creature.hp || initial.player.pp.some((pp, index) => pp > profile.creature.moves[index]!.pp))
    throw new Error('Depleted player values exceed the canonical fixture.');
  const factory = (await loadEncounterCore()).restore(initial.encounter);
  const pending = factory.view();
  if (pending.phase !== 'pending-encounter') throw new Error('An actual pending encounter is required.');
  if (pending.trainerId !== profile.creature.otId || pending.creature?.otId !== profile.creature.otId)
    throw new Error('Encounter trainer differs from the selected fixture trainer.');
  return initial;
}
export async function loadRoute1Module(): Promise<WebAssembly.Module> {
  const report = z.object({ status: z.literal('passed'), wasm: z.string(), wasmSha256: z.string().regex(/^[a-f0-9]{64}$/), exports: z.array(z.string()) })
    .parse(JSON.parse(await readFile('reports/battle-route1-build.json', 'utf8')));
  const buffer = await readFile(report.wasm);
  if (createHash('sha256').update(buffer).digest('hex') !== report.wasmSha256) throw new Error('Route 1 artifact hash differs from its build report.');
  const module = new WebAssembly.Module(buffer);
  if (WebAssembly.Module.imports(module).length !== 0 || JSON.stringify(WebAssembly.Module.exports(module).map(row => row.name).sort())
    !== JSON.stringify(['memory', ...report.exports].sort())) throw new Error('Unsupported Route 1 WASM surface.');
  return module;
}
export async function loadRoute1Engine(): Promise<Route1Engine> {
  const [module, profile, encounters] = await Promise.all([loadRoute1Module(), loadDevelopmentProfile(), loadEncounterCore()]);
  const report = JSON.parse(await readFile('reports/battle-route1-build.json', 'utf8')) as { wasmSha256: string };
  const hash = createHash('sha256').update(report.wasmSha256);
  for (const path of ['tools/battle-route1/engine.ts', 'tools/battle-route1/driver.ts', 'apps/server/src/development-profile.ts',
    'tools/encounter-core/encounter.ts', 'packages/battle-core/src/contracts.ts', 'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  hash.update(JSON.stringify(encounters.compatibility));
  return createRoute1Engine(module, { profile, encounters }, `build-${hash.digest('hex')}`);
}
