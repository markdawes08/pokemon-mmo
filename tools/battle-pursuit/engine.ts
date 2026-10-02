/** Private party profile of the selected source-C engine and six-method adapter. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState, BattleSnapshot, DeepReadonly } from '@pokewaterblue/battle-core';
import { PursuitDriver, PURSUIT_PROFILE, PURSUIT_SOURCE, PROTECT_POLICY, protectPolicySchema, pursuitInitialSchema, pursuitChoiceSchema, pursuitEventSchema,
  pursuitPresentationSchema, pursuitCheckpointSchema, type PursuitInitial, type PursuitResources } from './driver';
import { pursuitSeed, loadPursuitResources } from './admission';
export { PursuitDriver, instantiatePursuit, PURSUIT_PROFILE, PURSUIT_SOURCE, PURSUIT_MOVES, PROTECT_POLICY, protectPolicySchema, PURSUIT_CHECKPOINT_WORDS,
  pursuitInitialSchema, pursuitCreatureSchema, pursuitDiagnosticSchema, pursuitChoiceSchema, pursuitEventSchema,
  pursuitPresentationSchema, pursuitCheckpointSchema, createPursuitDiagnostic, createPursuitDiagnosticFromCapture, loadPursuitResources } from './driver';
export type { PursuitInitial, PursuitCreature, PursuitDiagnostic, PursuitResources, PursuitChoice, PursuitEvent, PursuitPresentation,
  PursuitCheckpoint, PursuitExports, PursuitContext } from './driver';

function bytes(value: number): Uint8Array {
  const buffer = new Uint8Array(4); new DataView(buffer.buffer).setUint32(0, value, true); return buffer;
}
function pve(config: DeepReadonly<BattleConfig>): void {
  if (config.policy.mode !== 'pve' || config.participantIds.length !== 2 || config.participantIds[0] !== 'player'
    || config.participantIds[1] !== 'wild') throw new Error('Pursuit diagnostics require one player owner and the source wild controller.');
}
function pveState(state: DeepReadonly<BattleSnapshot>): void { pve(state.config); }
export function createPursuitEngine(module: WebAssembly.Module, resources: PursuitResources, engineVersion: string) {
  const kernel = createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands',
    engineVersion, rulesVersion: PURSUIT_PROFILE, contentFingerprint: PURSUIT_SOURCE, engineStateVersion: 9,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: pursuitInitialSchema, choiceSchema: pursuitChoiceSchema, eventSchema: pursuitEventSchema,
    presentationSchema: pursuitPresentationSchema, checkpointSchema: pursuitCheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0 || new DataView(rng.buffer, rng.byteOffset, 4).getUint32(0, true) !== pursuitSeed(initial))
        throw new Error('Pursuit RNG must match its explicit diagnostic or post-encounter anchor.');
      return new PursuitDriver(module, resources, initial);
    },
    restore: checkpoint => PursuitDriver.restore(module, resources, checkpoint),
    metadata: checkpoint => ({ transitionSequence: checkpoint.host.sequence, eventSequence: checkpoint.host.eventSequence,
      rng: bytes(checkpoint.rng.state), draws: checkpoint.rng.draws }),
  });
  return { compatibility: kernel.compatibility,
    createBattle(...args: Parameters<typeof kernel.createBattle>) { pve(args[0]); return kernel.createBattle(...args); },
    validateChoice(...args: Parameters<typeof kernel.validateChoice>) { pveState(args[0]); return kernel.validateChoice(...args); },
    advance(...args: Parameters<typeof kernel.advance>) { pveState(args[0]); return kernel.advance(...args); },
    snapshot(...args: Parameters<typeof kernel.snapshot>) { pveState(args[0]); return kernel.snapshot(...args); },
    restore(...args: Parameters<typeof kernel.restore>) { pveState(args[0]); return kernel.restore(...args); },
    project(...args: Parameters<typeof kernel.project>) { pveState(args[0]); return kernel.project(...args); } };
}
export type PursuitEngine = ReturnType<typeof createPursuitEngine>;
export function pursuitConfig(engine: PursuitEngine, battleId: string): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'wild'],
    policy: { mode: 'pve', allowedDomainEffects: [] } };
}
export function makePursuitRng(battleId: string, input: PursuitInitial): BattleRngState {
  const initial = pursuitInitialSchema.parse(input);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(pursuitSeed(initial))).toString('base64') } };
}
const buildSchema = z.object({ status: z.literal('passed'), profile: z.literal(PURSUIT_PROFILE),
  wasm: z.literal('.local/battle-pursuit/primary/pursuit.wasm'), wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  protectPolicy: protectPolicySchema, exports: z.array(z.string()), extraction: z.object({ sourceFingerprint: z.literal(PURSUIT_SOURCE) }) });
export async function loadPursuitModule(): Promise<WebAssembly.Module> {
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-pursuit-build.json', 'utf8')));
  const buffer = await readFile(report.wasm);
  if (createHash('sha256').update(buffer).digest('hex') !== report.wasmSha256) throw new Error('Pursuit artifact differs from its build report.');
  const module = new WebAssembly.Module(buffer);
  if (WebAssembly.Module.imports(module).length !== 0 || JSON.stringify(WebAssembly.Module.exports(module).map(row => row.name).sort())
    !== JSON.stringify(['memory', ...report.exports].sort())) throw new Error('Unsupported party WASM surface.');
  return module;
}
export async function loadPursuitEngine(): Promise<PursuitEngine> {
  const [module, resources] = await Promise.all([loadPursuitModule(), loadPursuitResources()]);
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-pursuit-build.json', 'utf8')));
  const hash = createHash('sha256').update(report.wasmSha256).update(JSON.stringify(PROTECT_POLICY));
  for (const path of ['tools/battle-pursuit/engine.ts', 'tools/battle-pursuit/driver.ts', 'tools/battle-pursuit/admission.ts',
    'tools/battle-party/admission.ts', 'tools/battle-evolution/evolution.ts',
    'tools/battle-family/admission.ts', 'tools/battle-family/driver.ts', 'packages/battle-core/src/contracts.ts',
    'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  for (const core of [resources.progression, resources.captures, resources.encounters]) hash.update(JSON.stringify(core.compatibility));
  return createPursuitEngine(module, resources, `build-${hash.digest('hex')}`);
}
