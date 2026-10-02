/** Private 24-move diagnostics; compatible captures retain one immutable history. */
import { z } from 'zod';
import { evolutionCreatureSchema } from '../battle-evolution/evolution';
import { PARTY_MOVES, PARTY_SOURCE, partyContextSchema, partyCreatureWords, partyInitialSchema,
  prepareParty, loadPartyResources, type PartyResources } from '../battle-party/admission';

export const PURSUIT_PROFILE = 'firered-family-pursuit-v1' as const;
export const PURSUIT_SOURCE = PARTY_SOURCE;
export const PURSUIT_MOVES = [...PARTY_MOVES, 18, 130, 162, 182, 228, 229, 240, 283] as const;
/** Explicit bounded ROM lookup compatibility; original C array access is undefined. */
export const PROTECT_POLICY = Object.freeze({ id: 'firered-protect-rom-v1' as const,
  romSha256: '3d0c79f1627022e18765766f6cb5ea067f6b5bf7dca115552189ad65a5c3a8ac' as const,
  tableSha256: '977c6928a398eab83f1b9d0ff8b5a2d4ee4c88d1beae6872da7fe5265a87bce1' as const,
  tableOffset: 2426848 as const, tableEntries: 256 as const });
export const protectPolicySchema = z.strictObject({ id: z.literal(PROTECT_POLICY.id),
  romSha256: z.literal(PROTECT_POLICY.romSha256), tableSha256: z.literal(PROTECT_POLICY.tableSha256),
  tableOffset: z.literal(PROTECT_POLICY.tableOffset), tableEntries: z.literal(PROTECT_POLICY.tableEntries) });
const word = z.number().int().min(0).max(0xFFFFFFFF);
export const pursuitCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.max(65535),
  status: z.union([z.literal(0), z.literal(8), z.literal(16)]), heldItemId: z.literal(0) })
  .refine(mon => mon.hp > 0 || mon.status === 0, 'Fainted party members must have cleared major status')
  .refine(mon => mon.moves.every(move => move.moveId === 0 || PURSUIT_MOVES.some(id => id === move.moveId)),
    'Every occupied roster move must be supported, including exhausted and benched moves');
export type PursuitCreature = z.infer<typeof pursuitCreatureSchema>;
export const pursuitDiagnosticSchema = z.strictObject({ seed: word, player: z.array(pursuitCreatureSchema).min(1).max(6),
  opponent: pursuitCreatureSchema }).refine(input => input.player.some(mon => mon.hp > 0) && input.opponent.hp > 0,
  'Both parties require a living initial member');
export type PursuitDiagnostic = z.infer<typeof pursuitDiagnosticSchema>;
const captureProofSchema = partyInitialSchema.options[1];
export const pursuitInitialSchema = z.discriminatedUnion('kind', [
  pursuitDiagnosticSchema.safeExtend({ kind: z.literal('diagnostic') }), captureProofSchema,
]);
export type PursuitInitial = z.infer<typeof pursuitInitialSchema>;
export const pursuitContextSchema = partyContextSchema;
export type PursuitContext = z.infer<typeof pursuitContextSchema>;
export type PursuitResources = PartyResources;
export interface PreparedPursuit { seed: number; player: PursuitCreature[]; opponent: PursuitCreature; context: PursuitContext }
export const pursuitCreatureWords = partyCreatureWords;
export const loadPursuitResources = loadPartyResources;
export function pursuitSeed(initial: PursuitInitial): number { return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!; }
export function preparePursuit(resources: PursuitResources, input: PursuitInitial): PreparedPursuit {
  const initial = pursuitInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, player: initial.player, opponent: initial.opponent,
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  // Actual canonical captures contain only already-supported moves. This
  // delegation restores the original modules; wider diagnostics never pass
  // through the retained sixteen-move admission schema.
  return prepareParty(resources, initial);
}
export function createPursuitDiagnostic(input: PursuitDiagnostic): PursuitInitial {
  return pursuitInitialSchema.parse({ kind: 'diagnostic', ...pursuitDiagnosticSchema.parse(input) });
}
export async function createPursuitDiagnosticFromCapture(capture: unknown, encounter: unknown): Promise<PursuitInitial> {
  const initial = pursuitInitialSchema.parse({ kind: 'capture-proof', capture, encounter });
  preparePursuit(await loadPursuitResources(), initial); return initial;
}
