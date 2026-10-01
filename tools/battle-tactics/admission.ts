/** Private 21-move diagnostics; compatible captures retain one immutable history. */
import { z } from 'zod';
import { evolutionCreatureSchema } from '../battle-evolution/evolution';
import { PARTY_MOVES, PARTY_SOURCE, partyContextSchema, partyCreatureWords, partyInitialSchema,
  prepareParty, loadPartyResources, type PartyResources } from '../battle-party/admission';

export const TACTICS_PROFILE = 'firered-family-tactics-v1' as const;
export const TACTICS_SOURCE = PARTY_SOURCE;
export const TACTICS_MOVES = [...PARTY_MOVES, 18, 162, 229, 240, 283] as const;
const word = z.number().int().min(0).max(0xFFFFFFFF);
export const tacticsCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.max(65535),
  status: z.union([z.literal(0), z.literal(8), z.literal(16)]), heldItemId: z.literal(0) })
  .refine(mon => mon.hp > 0 || mon.status === 0, 'Fainted party members must have cleared major status')
  .refine(mon => mon.moves.every(move => move.moveId === 0 || TACTICS_MOVES.some(id => id === move.moveId)),
    'Every occupied roster move must be supported, including exhausted and benched moves');
export type TacticsCreature = z.infer<typeof tacticsCreatureSchema>;
export const tacticsDiagnosticSchema = z.strictObject({ seed: word, player: z.array(tacticsCreatureSchema).min(1).max(6),
  opponent: tacticsCreatureSchema }).refine(input => input.player.some(mon => mon.hp > 0) && input.opponent.hp > 0,
  'Both parties require a living initial member');
export type TacticsDiagnostic = z.infer<typeof tacticsDiagnosticSchema>;
const captureProofSchema = partyInitialSchema.options[1];
export const tacticsInitialSchema = z.discriminatedUnion('kind', [
  tacticsDiagnosticSchema.safeExtend({ kind: z.literal('diagnostic') }), captureProofSchema,
]);
export type TacticsInitial = z.infer<typeof tacticsInitialSchema>;
export const tacticsContextSchema = partyContextSchema;
export type TacticsContext = z.infer<typeof tacticsContextSchema>;
export type TacticsResources = PartyResources;
export interface PreparedTactics { seed: number; player: TacticsCreature[]; opponent: TacticsCreature; context: TacticsContext }
export const tacticsCreatureWords = partyCreatureWords;
export const loadTacticsResources = loadPartyResources;
export function tacticsSeed(initial: TacticsInitial): number { return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!; }
export function prepareTactics(resources: TacticsResources, input: TacticsInitial): PreparedTactics {
  const initial = tacticsInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, player: initial.player, opponent: initial.opponent,
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  // Actual canonical captures contain only already-supported moves. This
  // delegation restores the original modules; wider diagnostics never pass
  // through the retained sixteen-move admission schema.
  return prepareParty(resources, initial);
}
export function createTacticsDiagnostic(input: TacticsDiagnostic): TacticsInitial {
  return tacticsInitialSchema.parse({ kind: 'diagnostic', ...tacticsDiagnosticSchema.parse(input) });
}
export async function createTacticsDiagnosticFromCapture(capture: unknown, encounter: unknown): Promise<TacticsInitial> {
  const initial = tacticsInitialSchema.parse({ kind: 'capture-proof', capture, encounter });
  prepareTactics(await loadTacticsResources(), initial); return initial;
}
