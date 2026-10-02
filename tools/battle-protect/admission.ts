/** Private 23-move diagnostics; compatible captures retain one immutable history. */
import { z } from 'zod';
import { evolutionCreatureSchema } from '../battle-evolution/evolution';
import { PARTY_MOVES, PARTY_SOURCE, partyContextSchema, partyCreatureWords, partyInitialSchema,
  prepareParty, loadPartyResources, type PartyResources } from '../battle-party/admission';

export const PROTECT_PROFILE = 'firered-family-protect-v1' as const;
export const PROTECT_SOURCE = PARTY_SOURCE;
export const PROTECT_MOVES = [...PARTY_MOVES, 18, 130, 162, 182, 229, 240, 283] as const;
/** Explicit bounded ROM lookup compatibility; original C array access is undefined. */
export const PROTECT_POLICY = Object.freeze({ id: 'firered-protect-rom-v1' as const,
  romSha256: '3d0c79f1627022e18765766f6cb5ea067f6b5bf7dca115552189ad65a5c3a8ac' as const,
  tableSha256: '977c6928a398eab83f1b9d0ff8b5a2d4ee4c88d1beae6872da7fe5265a87bce1' as const,
  tableOffset: 2426848 as const, tableEntries: 256 as const });
export const protectPolicySchema = z.strictObject({ id: z.literal(PROTECT_POLICY.id),
  romSha256: z.literal(PROTECT_POLICY.romSha256), tableSha256: z.literal(PROTECT_POLICY.tableSha256),
  tableOffset: z.literal(PROTECT_POLICY.tableOffset), tableEntries: z.literal(PROTECT_POLICY.tableEntries) });
const word = z.number().int().min(0).max(0xFFFFFFFF);
export const protectCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.max(65535),
  status: z.union([z.literal(0), z.literal(8), z.literal(16)]), heldItemId: z.literal(0) })
  .refine(mon => mon.hp > 0 || mon.status === 0, 'Fainted party members must have cleared major status')
  .refine(mon => mon.moves.every(move => move.moveId === 0 || PROTECT_MOVES.some(id => id === move.moveId)),
    'Every occupied roster move must be supported, including exhausted and benched moves');
export type ProtectCreature = z.infer<typeof protectCreatureSchema>;
export const protectDiagnosticSchema = z.strictObject({ seed: word, player: z.array(protectCreatureSchema).min(1).max(6),
  opponent: protectCreatureSchema }).refine(input => input.player.some(mon => mon.hp > 0) && input.opponent.hp > 0,
  'Both parties require a living initial member');
export type ProtectDiagnostic = z.infer<typeof protectDiagnosticSchema>;
const captureProofSchema = partyInitialSchema.options[1];
export const protectInitialSchema = z.discriminatedUnion('kind', [
  protectDiagnosticSchema.safeExtend({ kind: z.literal('diagnostic') }), captureProofSchema,
]);
export type ProtectInitial = z.infer<typeof protectInitialSchema>;
export const protectContextSchema = partyContextSchema;
export type ProtectContext = z.infer<typeof protectContextSchema>;
export type ProtectResources = PartyResources;
export interface PreparedProtect { seed: number; player: ProtectCreature[]; opponent: ProtectCreature; context: ProtectContext }
export const protectCreatureWords = partyCreatureWords;
export const loadProtectResources = loadPartyResources;
export function protectSeed(initial: ProtectInitial): number { return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!; }
export function prepareProtect(resources: ProtectResources, input: ProtectInitial): PreparedProtect {
  const initial = protectInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, player: initial.player, opponent: initial.opponent,
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  // Actual canonical captures contain only already-supported moves. This
  // delegation restores the original modules; wider diagnostics never pass
  // through the retained sixteen-move admission schema.
  return prepareParty(resources, initial);
}
export function createProtectDiagnostic(input: ProtectDiagnostic): ProtectInitial {
  return protectInitialSchema.parse({ kind: 'diagnostic', ...protectDiagnosticSchema.parse(input) });
}
export async function createProtectDiagnosticFromCapture(capture: unknown, encounter: unknown): Promise<ProtectInitial> {
  const initial = protectInitialSchema.parse({ kind: 'capture-proof', capture, encounter });
  prepareProtect(await loadProtectResources(), initial); return initial;
}
