/** Private party profile of the selected source-C engine and six-method adapter. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState, BattleSnapshot, DeepReadonly } from '@pokewaterblue/battle-core';
import { PartyDriver, PARTY_PROFILE, PARTY_SOURCE, partyInitialSchema, partyChoiceSchema, partyEventSchema,
  partyPresentationSchema, partyCheckpointSchema, type PartyInitial, type PartyResources } from './driver';
import { partySeed, loadPartyResources } from './admission';
export { PartyDriver, instantiateParty, PARTY_PROFILE, PARTY_SOURCE, PARTY_MOVES, PARTY_CHECKPOINT_WORDS,
  partyInitialSchema, partyCreatureSchema, partyDiagnosticSchema, partyChoiceSchema, partyEventSchema,
  partyPresentationSchema, partyCheckpointSchema, createPartyDiagnostic, createPartyDiagnosticFromCapture, loadPartyResources } from './driver';
export type { PartyInitial, PartyCreature, PartyDiagnostic, PartyResources, PartyChoice, PartyEvent, PartyPresentation,
  PartyCheckpoint, PartyExports, PartyContext } from './driver';

function bytes(value: number): Uint8Array {
  const buffer = new Uint8Array(4); new DataView(buffer.buffer).setUint32(0, value, true); return buffer;
}
function pve(config: DeepReadonly<BattleConfig>): void {
  if (config.policy.mode !== 'pve' || config.participantIds.length !== 2 || config.participantIds[0] !== 'player'
    || config.participantIds[1] !== 'wild') throw new Error('Party diagnostics require one player owner and the source wild controller.');
}
function pveState(state: DeepReadonly<BattleSnapshot>): void { pve(state.config); }
export function createPartyEngine(module: WebAssembly.Module, resources: PartyResources, engineVersion: string) {
  const kernel = createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands',
    engineVersion, rulesVersion: PARTY_PROFILE, contentFingerprint: PARTY_SOURCE, engineStateVersion: 5,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: partyInitialSchema, choiceSchema: partyChoiceSchema, eventSchema: partyEventSchema,
    presentationSchema: partyPresentationSchema, checkpointSchema: partyCheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0 || new DataView(rng.buffer, rng.byteOffset, 4).getUint32(0, true) !== partySeed(initial))
        throw new Error('Party RNG must match its explicit diagnostic or post-encounter anchor.');
      return new PartyDriver(module, resources, initial);
    },
    restore: checkpoint => PartyDriver.restore(module, resources, checkpoint),
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
export type PartyEngine = ReturnType<typeof createPartyEngine>;
export function partyConfig(engine: PartyEngine, battleId: string): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'wild'],
    policy: { mode: 'pve', allowedDomainEffects: [] } };
}
export function makePartyRng(battleId: string, input: PartyInitial): BattleRngState {
  const initial = partyInitialSchema.parse(input);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(partySeed(initial))).toString('base64') } };
}
const buildSchema = z.object({ status: z.literal('passed'), profile: z.literal(PARTY_PROFILE),
  wasm: z.literal('.local/battle-party/primary/party.wasm'), wasmSha256: z.string().regex(/^[a-f0-9]{64}$/),
  exports: z.array(z.string()), extraction: z.object({ sourceFingerprint: z.literal(PARTY_SOURCE) }) });
export async function loadPartyModule(): Promise<WebAssembly.Module> {
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-party-build.json', 'utf8')));
  const buffer = await readFile(report.wasm);
  if (createHash('sha256').update(buffer).digest('hex') !== report.wasmSha256) throw new Error('Party artifact differs from its build report.');
  const module = new WebAssembly.Module(buffer);
  if (WebAssembly.Module.imports(module).length !== 0 || JSON.stringify(WebAssembly.Module.exports(module).map(row => row.name).sort())
    !== JSON.stringify(['memory', ...report.exports].sort())) throw new Error('Unsupported party WASM surface.');
  return module;
}
export async function loadPartyEngine(): Promise<PartyEngine> {
  const [module, resources] = await Promise.all([loadPartyModule(), loadPartyResources()]);
  const report = buildSchema.parse(JSON.parse(await readFile('reports/battle-party-build.json', 'utf8')));
  const hash = createHash('sha256').update(report.wasmSha256);
  for (const path of ['tools/battle-party/engine.ts', 'tools/battle-party/driver.ts', 'tools/battle-party/admission.ts',
    'tools/battle-family/admission.ts', 'tools/battle-family/driver.ts', 'packages/battle-core/src/contracts.ts',
    'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  for (const core of [resources.progression, resources.captures, resources.encounters]) hash.update(JSON.stringify(core.compatibility));
  return createPartyEngine(module, resources, `build-${hash.digest('hex')}`);
}
