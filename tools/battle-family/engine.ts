/** A private family profile of the selected source-C engine architecture. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState, BattleSnapshot, DeepReadonly } from '@pokewaterblue/battle-core';
import { FamilyDriver, FAMILY_PROFILE, FAMILY_SOURCE, familyInitialSchema, familyChoiceSchema, familyEventSchema,
  familyPresentationSchema, familyCheckpointSchema, type FamilyInitial, type FamilyResources } from './driver';
import { familySeed, loadFamilyResources } from './admission';
export { FamilyDriver, instantiateFamily, FAMILY_PROFILE, FAMILY_SOURCE, FAMILY_MOVES, FAMILY_CHECKPOINT_WORDS,
  familyInitialSchema, familyCreatureSchema, familyDiagnosticSchema, familyResultSchema, familyChoiceSchema, familyEventSchema,
  familyPresentationSchema, familyCheckpointSchema, createFamilyDiagnostic, createFamilyDiagnosticFromResult, loadFamilyResources } from './driver';
export type { FamilyInitial, FamilyCreature, FamilyDiagnostic, FamilyResult, FamilyResources,
  FamilyChoice, FamilyEvent, FamilyPresentation, FamilyCheckpoint, FamilyExports } from './driver';

function bytes(value: number): Uint8Array {
  const buffer = new Uint8Array(4); new DataView(buffer.buffer).setUint32(0, value, true); return buffer;
}
function pve(config: DeepReadonly<BattleConfig>): void {
  if (config.policy.mode !== 'pve' || config.participantIds.length !== 2 || config.participantIds[0] !== 'player'
    || config.participantIds[1] !== 'wild') throw new Error('Family diagnostics admit only one player and source wild controller.');
}
function pveState(state: DeepReadonly<BattleSnapshot>): void { pve(state.config); }
export function createFamilyEngine(module: WebAssembly.Module, resources: FamilyResources, engineVersion: string) {
  const kernel = createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands',
    engineVersion, rulesVersion: FAMILY_PROFILE, contentFingerprint: FAMILY_SOURCE, engineStateVersion: 4,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: familyInitialSchema, choiceSchema: familyChoiceSchema, eventSchema: familyEventSchema,
    presentationSchema: familyPresentationSchema, checkpointSchema: familyCheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0 || new DataView(rng.buffer, rng.byteOffset, 4).getUint32(0, true) !== familySeed(initial))
        throw new Error('Family RNG must match the explicit diagnostic or post-encounter anchor.');
      return new FamilyDriver(module, resources, initial);
    },
    restore: checkpoint => FamilyDriver.restore(module, resources, checkpoint),
    metadata: checkpoint => ({ transitionSequence: checkpoint.host.sequence, eventSequence: checkpoint.host.eventSequence,
      rng: bytes(checkpoint.rng.state), draws: checkpoint.rng.draws }),
  });
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
export type FamilyEngine = ReturnType<typeof createFamilyEngine>;
export function familyConfig(engine: FamilyEngine, battleId: string): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'wild'],
    policy: { mode: 'pve', allowedDomainEffects: [] } };
}
export function makeFamilyRng(battleId: string, input: FamilyInitial): BattleRngState {
  const initial = familyInitialSchema.parse(input);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(familySeed(initial))).toString('base64') } };
}
const buildSchema = z.object({ status: z.literal('passed'), profile: z.literal(FAMILY_PROFILE),
  wasm: z.literal('.local/battle-family/primary/family.wasm'), wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  exports: z.array(z.string()), extraction: z.object({ sourceFingerprint: z.literal(FAMILY_SOURCE) }) });
export async function loadFamilyModule(): Promise<WebAssembly.Module> {
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-family-build.json', 'utf8')));
  const buffer = await readFile(report.wasm);
  if (createHash('sha256').update(buffer).digest('hex') !== report.wasmSha256) throw new Error('Family artifact differs from its build report.');
  const module = new WebAssembly.Module(buffer);
  if (WebAssembly.Module.imports(module).length !== 0 || JSON.stringify(WebAssembly.Module.exports(module).map(row => row.name).sort())
    !== JSON.stringify(['memory', ...report.exports].sort())) throw new Error('Unsupported family WASM surface.');
  return module;
}
export async function loadFamilyEngine(): Promise<FamilyEngine> {
  const [module, resources] = await Promise.all([loadFamilyModule(), loadFamilyResources()]);
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-family-build.json', 'utf8')));
  const hash = createHash('sha256').update(report.wasmSha256);
  for (const path of ['tools/battle-family/engine.ts', 'tools/battle-family/driver.ts', 'tools/battle-family/admission.ts',
    'packages/battle-core/src/contracts.ts', 'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  for (const core of [resources.progression, resources.captures, resources.evolutions, resources.encounters]) hash.update(JSON.stringify(core.compatibility));
  return createFamilyEngine(module, resources, `build-${hash.digest('hex')}`);
}
