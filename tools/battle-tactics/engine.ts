/** Private party profile of the selected source-C engine and six-method adapter. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState, BattleSnapshot, DeepReadonly } from '@pokewaterblue/battle-core';
import { TacticsDriver, TACTICS_PROFILE, TACTICS_SOURCE, tacticsInitialSchema, tacticsChoiceSchema, tacticsEventSchema,
  tacticsPresentationSchema, tacticsCheckpointSchema, type TacticsInitial, type TacticsResources } from './driver';
import { tacticsSeed, loadTacticsResources } from './admission';
export { TacticsDriver, instantiateTactics, TACTICS_PROFILE, TACTICS_SOURCE, TACTICS_MOVES, TACTICS_CHECKPOINT_WORDS,
  tacticsInitialSchema, tacticsCreatureSchema, tacticsDiagnosticSchema, tacticsChoiceSchema, tacticsEventSchema,
  tacticsPresentationSchema, tacticsCheckpointSchema, createTacticsDiagnostic, createTacticsDiagnosticFromCapture, loadTacticsResources } from './driver';
export type { TacticsInitial, TacticsCreature, TacticsDiagnostic, TacticsResources, TacticsChoice, TacticsEvent, TacticsPresentation,
  TacticsCheckpoint, TacticsExports, TacticsContext } from './driver';

function bytes(value: number): Uint8Array {
  const buffer = new Uint8Array(4); new DataView(buffer.buffer).setUint32(0, value, true); return buffer;
}
function pve(config: DeepReadonly<BattleConfig>): void {
  if (config.policy.mode !== 'pve' || config.participantIds.length !== 2 || config.participantIds[0] !== 'player'
    || config.participantIds[1] !== 'wild') throw new Error('Tactics diagnostics require one player owner and the source wild controller.');
}
function pveState(state: DeepReadonly<BattleSnapshot>): void { pve(state.config); }
export function createTacticsEngine(module: WebAssembly.Module, resources: TacticsResources, engineVersion: string) {
  const kernel = createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands',
    engineVersion, rulesVersion: TACTICS_PROFILE, contentFingerprint: TACTICS_SOURCE, engineStateVersion: 6,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: tacticsInitialSchema, choiceSchema: tacticsChoiceSchema, eventSchema: tacticsEventSchema,
    presentationSchema: tacticsPresentationSchema, checkpointSchema: tacticsCheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0 || new DataView(rng.buffer, rng.byteOffset, 4).getUint32(0, true) !== tacticsSeed(initial))
        throw new Error('Tactics RNG must match its explicit diagnostic or post-encounter anchor.');
      return new TacticsDriver(module, resources, initial);
    },
    restore: checkpoint => TacticsDriver.restore(module, resources, checkpoint),
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
export type TacticsEngine = ReturnType<typeof createTacticsEngine>;
export function tacticsConfig(engine: TacticsEngine, battleId: string): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'wild'],
    policy: { mode: 'pve', allowedDomainEffects: [] } };
}
export function makeTacticsRng(battleId: string, input: TacticsInitial): BattleRngState {
  const initial = tacticsInitialSchema.parse(input);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(tacticsSeed(initial))).toString('base64') } };
}
const buildSchema = z.object({ status: z.literal('passed'), profile: z.literal(TACTICS_PROFILE),
  wasm: z.literal('.local/battle-tactics/primary/tactics.wasm'), wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  exports: z.array(z.string()), extraction: z.object({ sourceFingerprint: z.literal(TACTICS_SOURCE) }) });
export async function loadTacticsModule(): Promise<WebAssembly.Module> {
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-tactics-build.json', 'utf8')));
  const buffer = await readFile(report.wasm);
  if (createHash('sha256').update(buffer).digest('hex') !== report.wasmSha256) throw new Error('Tactics artifact differs from its build report.');
  const module = new WebAssembly.Module(buffer);
  if (WebAssembly.Module.imports(module).length !== 0 || JSON.stringify(WebAssembly.Module.exports(module).map(row => row.name).sort())
    !== JSON.stringify(['memory', ...report.exports].sort())) throw new Error('Unsupported party WASM surface.');
  return module;
}
export async function loadTacticsEngine(): Promise<TacticsEngine> {
  const [module, resources] = await Promise.all([loadTacticsModule(), loadTacticsResources()]);
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-tactics-build.json', 'utf8')));
  const hash = createHash('sha256').update(report.wasmSha256);
  for (const path of ['tools/battle-tactics/engine.ts', 'tools/battle-tactics/driver.ts', 'tools/battle-tactics/admission.ts',
    'tools/battle-party/admission.ts', 'tools/battle-evolution/evolution.ts',
    'tools/battle-family/admission.ts', 'tools/battle-family/driver.ts', 'packages/battle-core/src/contracts.ts',
    'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  for (const core of [resources.progression, resources.captures, resources.encounters]) hash.update(JSON.stringify(core.compatibility));
  return createTacticsEngine(module, resources, `build-${hash.digest('hex')}`);
}
