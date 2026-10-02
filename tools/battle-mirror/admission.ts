/** Private 25-move diagnostics; compatible captures retain one immutable history. */
import { z } from 'zod';
import { evolutionCreatureSchema } from '../battle-evolution/evolution';
import { PARTY_MOVES, PARTY_SOURCE, partyContextSchema, partyCreatureWords, partyInitialSchema,
  prepareParty, loadPartyResources, type PartyResources } from '../battle-party/admission';

export const MIRROR_PROFILE = 'firered-family-mirror-v1' as const;
export const MIRROR_SOURCE = PARTY_SOURCE;
export const MIRROR_MOVES = [...PARTY_MOVES, 18, 119, 130, 162, 182, 228, 229, 240, 283] as const;
/** Source FLAG_MIRROR_MOVE_AFFECTED within this profile, including automatic Struggle. */
export const MIRROR_COPYABLE_MOVES = [16, 17, 18, 28, 33, 39, 44, 55, 56, 98, 130, 145, 158, 162, 165, 184, 228, 229, 283, 297] as const;
/** Explicit bounded ROM lookup compatibility; original C array access is undefined. */
export const PROTECT_POLICY = Object.freeze({ id: 'firered-protect-rom-v1' as const,
  romSha256: '3d0c79f1627022e18765766f6cb5ea067f6b5bf7dca115552189ad65a5c3a8ac' as const,
  tableSha256: '977c6928a398eab83f1b9d0ff8b5a2d4ee4c88d1beae6872da7fe5265a87bce1' as const,
  tableOffset: 2426848 as const, tableEntries: 256 as const });
export const protectPolicySchema = z.strictObject({ id: z.literal(PROTECT_POLICY.id),
  romSha256: z.literal(PROTECT_POLICY.romSha256), tableSha256: z.literal(PROTECT_POLICY.tableSha256),
  tableOffset: z.literal(PROTECT_POLICY.tableOffset), tableEntries: z.literal(PROTECT_POLICY.tableEntries) });
const word = z.number().int().min(0).max(0xFFFFFFFF);
export const mirrorCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.max(65535),
  status: z.union([z.literal(0), z.literal(8), z.literal(16)]), heldItemId: z.literal(0) })
  .refine(mon => mon.hp > 0 || mon.status === 0, 'Fainted party members must have cleared major status')
  .refine(mon => mon.moves.every(move => move.moveId === 0 || MIRROR_MOVES.some(id => id === move.moveId)),
    'Every occupied roster move must be supported, including exhausted and benched moves');
export type MirrorCreature = z.infer<typeof mirrorCreatureSchema>;
export const mirrorDiagnosticSchema = z.strictObject({ seed: word, player: z.array(mirrorCreatureSchema).min(1).max(6),
  opponent: mirrorCreatureSchema }).refine(input => input.player.some(mon => mon.hp > 0) && input.opponent.hp > 0,
  'Both parties require a living initial member');
export type MirrorDiagnostic = z.infer<typeof mirrorDiagnosticSchema>;
const captureProofSchema = partyInitialSchema.options[1];
export const mirrorInitialSchema = z.discriminatedUnion('kind', [
  mirrorDiagnosticSchema.safeExtend({ kind: z.literal('diagnostic') }), captureProofSchema,
]);
export type MirrorInitial = z.infer<typeof mirrorInitialSchema>;
export const mirrorContextSchema = partyContextSchema;
export type MirrorContext = z.infer<typeof mirrorContextSchema>;
export type MirrorResources = PartyResources;
export interface PreparedMirror { seed: number; player: MirrorCreature[]; opponent: MirrorCreature; context: MirrorContext }
export const mirrorCreatureWords = partyCreatureWords;
export const loadMirrorResources = loadPartyResources;
export function mirrorSeed(initial: MirrorInitial): number { return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!; }
export function prepareMirror(resources: MirrorResources, input: MirrorInitial): PreparedMirror {
  const initial = mirrorInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, player: initial.player, opponent: initial.opponent,
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  // Actual canonical captures contain only already-supported moves. This
  // delegation restores the original modules; wider diagnostics never pass
  // through the retained sixteen-move admission schema.
  return prepareParty(resources, initial);
}
export function createMirrorDiagnostic(input: MirrorDiagnostic): MirrorInitial {
  return mirrorInitialSchema.parse({ kind: 'diagnostic', ...mirrorDiagnosticSchema.parse(input) });
}
export async function createMirrorDiagnosticFromCapture(capture: unknown, encounter: unknown): Promise<MirrorInitial> {
  const initial = mirrorInitialSchema.parse({ kind: 'capture-proof', capture, encounter });
  prepareMirror(await loadMirrorResources(), initial); return initial;
}
