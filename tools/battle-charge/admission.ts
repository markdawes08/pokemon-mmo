/** Private 22-move diagnostics; compatible captures retain one immutable history. */
import { z } from 'zod';
import { evolutionCreatureSchema } from '../battle-evolution/evolution';
import { PARTY_MOVES, PARTY_SOURCE, partyContextSchema, partyCreatureWords, partyInitialSchema,
  prepareParty, loadPartyResources, type PartyResources } from '../battle-party/admission';

export const CHARGE_PROFILE = 'firered-family-charge-v1' as const;
export const CHARGE_SOURCE = PARTY_SOURCE;
export const CHARGE_MOVES = [...PARTY_MOVES, 18, 130, 162, 229, 240, 283] as const;
const word = z.number().int().min(0).max(0xFFFFFFFF);
export const chargeCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.max(65535),
  status: z.union([z.literal(0), z.literal(8), z.literal(16)]), heldItemId: z.literal(0) })
  .refine(mon => mon.hp > 0 || mon.status === 0, 'Fainted party members must have cleared major status')
  .refine(mon => mon.moves.every(move => move.moveId === 0 || CHARGE_MOVES.some(id => id === move.moveId)),
    'Every occupied roster move must be supported, including exhausted and benched moves');
export type ChargeCreature = z.infer<typeof chargeCreatureSchema>;
export const chargeDiagnosticSchema = z.strictObject({ seed: word, player: z.array(chargeCreatureSchema).min(1).max(6),
  opponent: chargeCreatureSchema }).refine(input => input.player.some(mon => mon.hp > 0) && input.opponent.hp > 0,
  'Both parties require a living initial member');
export type ChargeDiagnostic = z.infer<typeof chargeDiagnosticSchema>;
const captureProofSchema = partyInitialSchema.options[1];
export const chargeInitialSchema = z.discriminatedUnion('kind', [
  chargeDiagnosticSchema.safeExtend({ kind: z.literal('diagnostic') }), captureProofSchema,
]);
export type ChargeInitial = z.infer<typeof chargeInitialSchema>;
export const chargeContextSchema = partyContextSchema;
export type ChargeContext = z.infer<typeof chargeContextSchema>;
export type ChargeResources = PartyResources;
export interface PreparedCharge { seed: number; player: ChargeCreature[]; opponent: ChargeCreature; context: ChargeContext }
export const chargeCreatureWords = partyCreatureWords;
export const loadChargeResources = loadPartyResources;
export function chargeSeed(initial: ChargeInitial): number { return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!; }
export function prepareCharge(resources: ChargeResources, input: ChargeInitial): PreparedCharge {
  const initial = chargeInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, player: initial.player, opponent: initial.opponent,
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  // Actual canonical captures contain only already-supported moves. This
  // delegation restores the original modules; wider diagnostics never pass
  // through the retained sixteen-move admission schema.
  return prepareParty(resources, initial);
}
export function createChargeDiagnostic(input: ChargeDiagnostic): ChargeInitial {
  return chargeInitialSchema.parse({ kind: 'diagnostic', ...chargeDiagnosticSchema.parse(input) });
}
export async function createChargeDiagnosticFromCapture(capture: unknown, encounter: unknown): Promise<ChargeInitial> {
  const initial = chargeInitialSchema.parse({ kind: 'capture-proof', capture, encounter });
  prepareCharge(await loadChargeResources(), initial); return initial;
}
