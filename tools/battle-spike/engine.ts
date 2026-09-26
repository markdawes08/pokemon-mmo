/** Private experiment wiring for the server's selected-adapter boundary. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createWasmBattleAdapter, type KernelSession } from '@pokewaterblue/battle-core/wasm-adapter';
import type { BattleConfig, BattleRngState } from '@pokewaterblue/battle-core';
import { loadProbeModule } from './probe';
import { TurnProbe, choiceSchema, sourceFingerprint, turnCheckpointSchema, turnInputSchema,
  type TurnChoice, type TurnEvent, type TurnCheckpoint } from './turn-probe';

const count = z.number().int().nonnegative();
const actor = z.union([z.literal(0), z.literal(1)]);
const sourceEvent = z.strictObject({ type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), battler: actor, value: count });
const attack = z.strictObject({ baseDamage: count, afterCritical: count, afterType: count, damage: count,
  flags: count, hpDealt: count, targetHP: count, critical: z.union([z.literal(1), z.literal(2)]) });
export const turnEventSchema: z.ZodType<TurnEvent> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('order'), phase: z.enum(['actions', 'residual']), actors: z.array(actor).length(2) }),
  z.strictObject({ kind: z.literal('attack'), actor, partyIndex: count.max(1), slot: count.max(3), move: count, result: attack, commands: z.array(sourceEvent).max(16) }),
  z.strictObject({ kind: z.literal('switch'), actor, from: count.max(1), to: count.max(1), forced: z.boolean() }),
  z.strictObject({ kind: z.literal('residual'), actor, status: z.union([z.literal(8), z.literal(16)]), commands: z.array(sourceEvent).max(16) }),
  z.strictObject({ kind: z.literal('faint'), actor, partyIndex: count.max(1), commands: z.array(sourceEvent).max(16) }),
  z.strictObject({ kind: z.literal('outcome'), outcome: z.enum(['won', 'lost', 'draw']) }),
]);
const status = z.union([z.literal(0), z.literal(8), z.literal(16)]);
export const probePresentationSchema = z.strictObject({
  turn: count.min(1), phase: z.enum(['choice', 'replacement', 'ended']), needsChoice: z.boolean(),
  outcome: z.enum(['won', 'lost', 'draw']).nullable(),
  self: z.strictObject({ active: count.max(1), party: z.array(z.strictObject({
    level: count.min(1).max(100), hp: count.max(65535), maxHP: count.min(1).max(65535), status,
    moves: z.array(z.strictObject({ slot: count.max(3), move: count, pp: count.max(35) })).min(1).max(4),
  })).min(1).max(2) }),
  opponent: z.strictObject({ level: count.min(1).max(100), hpPercent: count.max(100), status }),
  availableChoices: z.array(choiceSchema).max(5),
});
type Presentation = z.infer<typeof probePresentationSchema>;
export const probeInitialSchema = z.strictObject({ parties: turnInputSchema.shape.parties });

function bytes(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
export function makeProbeRng(battleId: string, seed: number): BattleRngState {
  z.number().int().min(0).max(0xFFFFFFFF).parse(seed);
  return { battleId, algorithm: 'firered-lcg32', version: 1, draws: 0,
    privateState: { encoding: 'base64', data: Buffer.from(bytes(seed)).toString('base64') } };
}
function session(probe: TurnProbe): KernelSession<TurnChoice, TurnEvent, Presentation, TurnCheckpoint> {
  return {
    snapshot: () => probe.snapshot(), requiredActors: () => probe.requiredActors(),
    validateChoice: (actor, choice) => probe.validateChoice(actor, choice), advanceChoices: choices => probe.advanceChoices(choices),
    project(actor) {
      if (actor !== 0 && actor !== 1) throw new Error('Unsupported viewer');
      const checkpoint = probe.snapshot();
      const { host } = checkpoint;
      const other = actor === 0 ? 1 : 0;
      const opponent = host.parties[other][host.active[other]]!;
      const availableChoices: TurnChoice[] = [];
      if (probe.requiredActors().includes(actor)) {
        const mon = host.parties[actor][host.active[actor]]!;
        for (let slot = 0; slot < mon.moves.length; slot++) {
          try { availableChoices.push(probe.validateChoice(actor, { kind: 'move', slot })); } catch { /* Unavailable at this phase. */ }
        }
        for (let partyIndex = 0; partyIndex < host.parties[actor].length; partyIndex++) {
          try { availableChoices.push(probe.validateChoice(actor, { kind: 'switch', partyIndex })); } catch { /* Current/fainted member. */ }
        }
      }
      const outcome = actor === 0 || host.outcome === null || host.outcome === 'draw' ? host.outcome : host.outcome === 'won' ? 'lost' : 'won';
      // Explicit whitelist: no opponent reserve/moves/stats, raw core words,
      // chosen slots, continuation detail, initial seed or future RNG state.
      return probePresentationSchema.parse({ turn: host.turn, phase: host.phase, needsChoice: probe.requiredActors().includes(actor), outcome,
        self: { active: host.active[actor], party: host.parties[actor].map(mon => ({ level: mon.level, hp: mon.hp, maxHP: mon.maxHP,
          status: mon.status1, moves: mon.moves.map((move, slot) => ({ slot, move: move.move, pp: move.pp })) })) },
        opponent: { level: opponent.level, hpPercent: Math.ceil(opponent.hp * 100 / opponent.maxHP), status: opponent.status1 }, availableChoices });
    },
  };
}

export function createProbeEngine(module: WebAssembly.Module, engineVersion = 'p03-c-wasm-v3') {
  return createWasmBattleAdapter({ contractVersion: 1, snapshotVersion: 1, engineId: 'firered-source-commands', engineVersion,
    rulesVersion: 'firered-synthetic-singles-v1', contentFingerprint: sourceFingerprint, engineStateVersion: 1,
    rngAlgorithm: 'firered-lcg32', rngVersion: 1 }, {
    initialSchema: probeInitialSchema, choiceSchema, eventSchema: turnEventSchema, presentationSchema: probePresentationSchema,
    checkpointSchema: turnCheckpointSchema,
    create(initial, rng, draws) {
      if (rng.byteLength !== 4 || draws !== 0) throw new Error('Initial RNG must be a fresh four-byte source state');
      const seed = new DataView(rng.buffer, rng.byteOffset, rng.byteLength).getUint32(0, true);
      return session(new TurnProbe(module, { ...initial, seed }));
    },
    restore: checkpoint => session(TurnProbe.restore(module, checkpoint)),
    metadata: checkpoint => ({ transitionSequence: checkpoint.host.sequence, eventSequence: checkpoint.host.eventSequence,
      rng: bytes(checkpoint.rng.state), draws: checkpoint.rng.draws }),
  });
}

export function probeConfig(engine: ReturnType<typeof createProbeEngine>, battleId: string, mode: 'pve' | 'pvp-copy' = 'pve'): BattleConfig {
  return { battleId, compatibility: { ...engine.compatibility }, participantIds: ['player', 'opponent'], policy: { mode, allowedDomainEffects: [] } };
}

/** Verified private loader binds compatibility to C and host implementation
 * bytes. No runtime download, browser export or database access is involved.
 */
export async function loadProbeEngine() {
  const module = await loadProbeModule();
  const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8'));
  const hash = createHash('sha256').update(build.wasmSha256);
  for (const path of ['tools/battle-spike/probe.ts', 'tools/battle-spike/turn-probe.ts', 'tools/battle-spike/engine.ts',
    'packages/battle-core/src/contracts.ts', 'packages/battle-core/src/wasm-adapter.ts']) hash.update(await readFile(path));
  return createProbeEngine(module, `build-${hash.digest('hex')}`);
}
