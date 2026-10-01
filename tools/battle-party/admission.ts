/** Private party diagnostics. A coherent capture proof is not account ownership. */
import { z } from 'zod';
import { evolutionCreatureSchema } from '../battle-evolution/evolution';
import { FAMILY_MOVES, FAMILY_SOURCE, familyCreatureWords } from '../battle-family/admission';
import { captureCheckpointSchema, loadCaptureCore, type CaptureCore } from '../battle-capture/capture';
import { loadProgressionCore, type ProgressionCore } from '../battle-progression/progression';
import { encounterCheckpointSchema, loadEncounterCore, type EncounterCore } from '../encounter-core/encounter';
import { route1InventorySchema } from '../battle-route1/driver';

export const PARTY_PROFILE = 'firered-family-party-v1' as const;
export const PARTY_SOURCE = FAMILY_SOURCE;
export const PARTY_MOVES = FAMILY_MOVES;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const partyCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.max(65535),
  status: z.union([z.literal(0), z.literal(8), z.literal(16)]), heldItemId: z.literal(0) })
  .refine(mon => mon.hp > 0 || mon.status === 0, 'Fainted party members must have cleared major status')
  .refine(mon => mon.moves.every(move => move.moveId === 0 || PARTY_MOVES.some(id => id === move.moveId)),
    'Every occupied move slot must be supported, including exhausted moves');
export type PartyCreature = z.infer<typeof partyCreatureSchema>;
export const partyDiagnosticSchema = z.strictObject({ seed: word, player: z.array(partyCreatureSchema).min(1).max(6),
  opponent: partyCreatureSchema }).refine(input => input.player.some(mon => mon.hp > 0) && input.opponent.hp > 0,
  'Both parties require a living initial member');
export type PartyDiagnostic = z.infer<typeof partyDiagnosticSchema>;
export const partyInitialSchema = z.discriminatedUnion('kind', [
  partyDiagnosticSchema.safeExtend({ kind: z.literal('diagnostic') }),
  z.strictObject({ kind: z.literal('capture-proof'), capture: captureCheckpointSchema, encounter: encounterCheckpointSchema }),
]);
export type PartyInitial = z.infer<typeof partyInitialSchema>;
export const partyContextSchema = z.strictObject({ inventory: route1InventorySchema.nullable(),
  origin: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('diagnostic') }),
    z.strictObject({ kind: z.literal('private-capture-proof'), captureDigest: digest, battleId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
      terminalSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), terminalDigest: digest,
      diagnosticSource: z.literal(false), ownershipApplication: z.literal('pending') })]), liveAdmission: z.literal(false) });
export type PartyContext = z.infer<typeof partyContextSchema>;
export interface PartyResources { captures: CaptureCore; progression: ProgressionCore; encounters: EncounterCore }
export interface PreparedParty { seed: number; player: PartyCreature[]; opponent: PartyCreature; context: PartyContext }
const zeroEvs = () => ({ hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/** Shared numeric transport only; all creature mechanics remain source validated. */
export const partyCreatureWords = familyCreatureWords;
export function partySeed(initial: PartyInitial): number { return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!; }
export function prepareParty(resources: PartyResources, input: PartyInitial): PreparedParty {
  const initial = partyInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, player: initial.player, opponent: initial.opponent,
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  const capture = resources.captures.restore(initial.capture).view();
  require(capture.phase === 'pending-ownership-application' && capture.placement?.kind === 'party'
    && capture.placement.slot === 1 && capture.origin.kind === 'battle-terminal',
  'A settled actual two-member party capture is required');
  const admission = initial.capture.admission;
  require(admission.kind !== 'diagnostic', 'Diagnostic capture cannot establish a coherent actual party');
  const parent = admission.kind === 'battle-terminal' ? resources.progression.fromBattle(admission.battle)
    : resources.progression.restore(admission.progression);
  const previous = parent.view();
  require(previous.phase === 'pending-capture' && previous.origin.kind === 'battle-terminal'
    && previous.origin.outcome === 'captured' && previous.origin.battleId === capture.origin.battleId
    && previous.origin.terminalDigest === capture.origin.terminalDigest
    && JSON.stringify(previous.inventory) === JSON.stringify(capture.inventory), 'Capture and player must share one terminal history');
  const player = partyCreatureSchema.parse({ ...previous.creature, abilityNum: 0, ballItemId: null, metLocation: null });
  const { nature: _nature, gender: _gender, ...caught } = capture.placement.creature;
  const teammate = partyCreatureSchema.parse({ ...caught, calculatedEvs: zeroEvs(),
    ballItemId: capture.metadata.ballItemId, metLocation: capture.metadata.metLocation });
  const pending = resources.encounters.restore(initial.encounter).view();
  require(pending.phase === 'pending-encounter' && pending.creature && pending.trainerId === player.otId
    && pending.creature.otId === player.otId && teammate.otId === player.otId, 'A matching fresh pending source encounter is required');
  const { slot: _slot, nature: _wildNature, gender: _wildGender, ...wild } = pending.creature;
  const opponent = partyCreatureSchema.parse({ ...wild, evs: zeroEvs(), calculatedEvs: zeroEvs(), ballItemId: null, metLocation: null });
  return { seed: partySeed(initial), player: [player, teammate], opponent, context: partyContextSchema.parse({ inventory: capture.inventory,
    origin: { kind: 'private-capture-proof', captureDigest: initial.capture.digest, battleId: capture.origin.battleId,
      terminalSequence: capture.origin.terminalSequence, terminalDigest: capture.origin.terminalDigest,
      diagnosticSource: false, ownershipApplication: 'pending' }, liveAdmission: false }) };
}
export function createPartyDiagnostic(input: PartyDiagnostic): PartyInitial {
  return partyInitialSchema.parse({ kind: 'diagnostic', ...partyDiagnosticSchema.parse(input) });
}
export async function loadPartyResources(): Promise<PartyResources> {
  const [captures, progression, encounters] = await Promise.all([loadCaptureCore(), loadProgressionCore(), loadEncounterCore()]);
  return { captures, progression, encounters };
}
export async function createPartyDiagnosticFromCapture(capture: unknown, encounter: unknown): Promise<PartyInitial> {
  const initial = partyInitialSchema.parse({ kind: 'capture-proof', capture, encounter });
  prepareParty(await loadPartyResources(), initial); return initial;
}
