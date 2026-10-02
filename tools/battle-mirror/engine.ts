/** Private party profile of the selected source-C engine and six-method adapter. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState, BattleSnapshot, DeepReadonly } from '@pokewaterblue/battle-core';
import { MirrorDriver, MIRROR_PROFILE, MIRROR_SOURCE, PROTECT_POLICY, protectPolicySchema, mirrorInitialSchema, mirrorChoiceSchema, mirrorEventSchema,
  mirrorPresentationSchema, mirrorCheckpointSchema, type MirrorInitial, type MirrorResources } from './driver';
import { mirrorSeed, loadMirrorResources } from './admission';
export { MirrorDriver, instantiateMirror, MIRROR_PROFILE, MIRROR_SOURCE, MIRROR_MOVES, PROTECT_POLICY, protectPolicySchema, MIRROR_CHECKPOINT_WORDS,
  mirrorInitialSchema, mirrorCreatureSchema, mirrorDiagnosticSchema, mirrorChoiceSchema, mirrorEventSchema,
  mirrorPresentationSchema, mirrorCheckpointSchema, createMirrorDiagnostic, createMirrorDiagnosticFromCapture, loadMirrorResources } from './driver';
export type { MirrorInitial, MirrorCreature, MirrorDiagnostic, MirrorResources, MirrorChoice, MirrorEvent, MirrorPresentation,
  MirrorCheckpoint, MirrorExports, MirrorContext } from './driver';

function bytes(value: number): Uint8Array {
  const buffer = new Uint8Array(4); new DataView(buffer.buffer).setUint32(0, value, true); return buffer;
}
function pve(config: DeepReadonly<BattleConfig>): void {
  if (config.policy.mode !== 'pve' || config.participantIds.length !== 2 || config.participantIds[0] !== 'player'
    || config.participantIds[1] !== 'wild') throw new Error('Mirror diagnostics require one player owner and the source wild controller.');
}
function pveState(state: DeepReadonly<BattleSnapshot>): void { pve(state.config); }
export function createMirrorEngine(module: WebAssembly.Module, resources: MirrorResources, engineVersion: string) {
  const kernel = createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands',
    engineVersion, rulesVersion: MIRROR_PROFILE, contentFingerprint: MIRROR_SOURCE, engineStateVersion: 10,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: mirrorInitialSchema, choiceSchema: mirrorChoiceSchema, eventSchema: mirrorEventSchema,
    presentationSchema: mirrorPresentationSchema, checkpointSchema: mirrorCheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0 || new DataView(rng.buffer, rng.byteOffset, 4).getUint32(0, true) !== mirrorSeed(initial))
        throw new Error('Mirror RNG must match its explicit diagnostic or post-encounter anchor.');
      return new MirrorDriver(module, resources, initial);
    },
    restore: checkpoint => MirrorDriver.restore(module, resources, checkpoint),
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
export type MirrorEngine = ReturnType<typeof createMirrorEngine>;
export function mirrorConfig(engine: MirrorEngine, battleId: string): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'wild'],
    policy: { mode: 'pve', allowedDomainEffects: [] } };
}
export function makeMirrorRng(battleId: string, input: MirrorInitial): BattleRngState {
  const initial = mirrorInitialSchema.parse(input);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(mirrorSeed(initial))).toString('base64') } };
}
const buildSchema = z.object({ status: z.literal('passed'), profile: z.literal(MIRROR_PROFILE),
  wasm: z.literal('.local/battle-mirror/primary/mirror.wasm'), wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  protectPolicy: protectPolicySchema, exports: z.array(z.string()), extraction: z.object({ sourceFingerprint: z.literal(MIRROR_SOURCE) }) });
export async function loadMirrorModule(): Promise<WebAssembly.Module> {
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-mirror-build.json', 'utf8')));
  const buffer = await readFile(report.wasm);
  if (createHash('sha256').update(buffer).digest('hex') !== report.wasmSha256) throw new Error('Mirror artifact differs from its build report.');
  const module = new WebAssembly.Module(buffer);
  if (WebAssembly.Module.imports(module).length !== 0 || JSON.stringify(WebAssembly.Module.exports(module).map(row => row.name).sort())
    !== JSON.stringify(['memory', ...report.exports].sort())) throw new Error('Unsupported party WASM surface.');
  return module;
}
export async function loadMirrorEngine(): Promise<MirrorEngine> {
  const [module, resources] = await Promise.all([loadMirrorModule(), loadMirrorResources()]);
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-mirror-build.json', 'utf8')));
  const hash = createHash('sha256').update(report.wasmSha256).update(JSON.stringify(PROTECT_POLICY));
  for (const path of ['tools/battle-mirror/engine.ts', 'tools/battle-mirror/driver.ts', 'tools/battle-mirror/admission.ts',
    'tools/battle-party/admission.ts', 'tools/battle-evolution/evolution.ts',
    'tools/battle-family/admission.ts', 'tools/battle-family/driver.ts', 'packages/battle-core/src/contracts.ts',
    'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  for (const core of [resources.progression, resources.captures, resources.encounters]) hash.update(JSON.stringify(core.compatibility));
  return createMirrorEngine(module, resources, `build-${hash.digest('hex')}`);
}
