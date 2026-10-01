/** Private diagnostic admission. A prior result is evidence, never ownership. */
import { z } from 'zod';
import { evolutionCreatureSchema, evolutionCheckpointSchema, loadEvolutionCore, type EvolutionCore } from '../battle-evolution/evolution';
import { progressionCheckpointSchema, loadProgressionCore, type ProgressionCore } from '../battle-progression/progression';
import { captureCheckpointSchema, loadCaptureCore, type CaptureCore } from '../battle-capture/capture';
import { encounterCheckpointSchema, loadEncounterCore, type EncounterCore } from '../encounter-core/encounter';
import { route1InventorySchema } from '../battle-route1/driver';

export const FAMILY_PROFILE = 'firered-family-singles-v1' as const;
export const FAMILY_SOURCE = 'f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982';
export const FAMILY_MOVES = [16, 17, 28, 33, 39, 44, 55, 56, 97, 98, 110, 116, 145, 158, 184, 297] as const;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const status = z.union([z.literal(0), z.literal(8), z.literal(16)]);
export const familyCreatureSchema = evolutionCreatureSchema.safeExtend({ hp: word.min(1).max(65535),
  status, heldItemId: z.literal(0) }).refine(mon => mon.moves.every(move => move.moveId === 0 || FAMILY_MOVES.some(id => id === move.moveId)),
  'The complete move set must belong to this private mechanics profile');
export type FamilyCreature = z.infer<typeof familyCreatureSchema>;
export const familyDiagnosticSchema = z.strictObject({ seed: word, player: familyCreatureSchema, opponent: familyCreatureSchema });
export type FamilyDiagnostic = z.infer<typeof familyDiagnosticSchema>;
export const familyResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('progression'), checkpoint: progressionCheckpointSchema }),
  z.strictObject({ kind: z.literal('capture-party'), checkpoint: captureCheckpointSchema }),
  z.strictObject({ kind: z.literal('evolution'), checkpoint: evolutionCheckpointSchema }),
]);
export type FamilyResult = z.infer<typeof familyResultSchema>;
export const familyInitialSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('diagnostic'), seed: word, player: familyCreatureSchema, opponent: familyCreatureSchema }),
  z.strictObject({ kind: z.literal('result-proof'), result: familyResultSchema, encounter: encounterCheckpointSchema }),
]);
export type FamilyInitial = z.infer<typeof familyInitialSchema>;
export const familyContextSchema = z.strictObject({ inventory: route1InventorySchema.nullable(),
  origin: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('diagnostic') }),
    z.strictObject({ kind: z.literal('private-result-proof'), resultKind: z.enum(['progression', 'capture-party', 'evolution']),
      resultDigest: z.string().regex(/^[a-f0-9]{64}$/), diagnosticSource: z.boolean(), ownershipApplication: z.literal('pending') }),
  ]), liveAdmission: z.literal(false) });
export type FamilyContext = z.infer<typeof familyContextSchema>;
export interface FamilyResources { progression: ProgressionCore; captures: CaptureCore; evolutions: EvolutionCore; encounters: EncounterCore }
export interface PreparedFamily { seed: number; mons: [FamilyCreature, FamilyCreature]; context: FamilyContext }
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const zeroEvs = () => ({ hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });

/** No mechanical formula is duplicated here; C validates every source field. */
export function familyCreatureWords(mon: FamilyCreature): number[] {
  const names = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
  return [mon.speciesId, mon.personality, mon.otId, mon.experience, mon.level, mon.friendship, mon.hp,
    ...names.map(key => mon.stats[key]), ...names.map(key => mon.ivs[key]), ...names.map(key => mon.evs[key]),
    ...mon.moves.map(move => move.moveId), ...mon.moves.map(move => move.pp),
    mon.moves.reduce((bits, move, slot) => bits | move.ppUps << (slot * 2), 0), mon.ballItemId ?? 0xFFFFFFFF,
    mon.metLocation ?? 0xFFFFFFFF, mon.status, mon.heldItemId, 0, mon.abilityNum,
    ...names.map(key => mon.calculatedEvs[key])];
}
export function familySeed(initial: FamilyInitial): number {
  return initial.kind === 'diagnostic' ? initial.seed : initial.encounter.words[1]!;
}
export function prepareFamily(resources: FamilyResources, input: FamilyInitial): PreparedFamily {
  const initial = familyInitialSchema.parse(input);
  if (initial.kind === 'diagnostic') return { seed: initial.seed, mons: [initial.player, initial.opponent],
    context: { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false } };
  const result = initial.result;
  let creature: FamilyCreature, inventory: FamilyContext['inventory'], diagnosticSource: boolean;
  if (result.kind === 'progression') {
    const session = resources.progression.restore(result.checkpoint), view = session.view(), checkpoint = session.snapshot();
    require(view.phase === 'complete', 'Progression still has an unresolved continuation');
    const ball = checkpoint.words?.[58], met = checkpoint.words?.[59];
    creature = familyCreatureSchema.parse({ ...view.creature, abilityNum: 0,
      ballItemId: ball === undefined || ball === 0xFFFFFFFF ? null : ball,
      metLocation: met === undefined || met === 0xFFFFFFFF ? null : met });
    inventory = view.inventory; diagnosticSource = view.origin.kind === 'diagnostic';
  } else if (result.kind === 'capture-party') {
    const view = resources.captures.restore(result.checkpoint).view();
    require(view.phase === 'pending-ownership-application' && view.placement?.kind === 'party',
      'Only a settled party capture is a runtime creature; boxed data requires source reconstruction');
    const { nature: _nature, gender: _gender, ...mon } = view.placement.creature;
    creature = familyCreatureSchema.parse({ ...mon, calculatedEvs: zeroEvs(),
      ballItemId: view.metadata.ballItemId, metLocation: view.metadata.metLocation });
    inventory = view.inventory; diagnosticSource = view.origin.kind === 'diagnostic';
  } else {
    const view = resources.evolutions.restore(result.checkpoint).view();
    require(view.phase === 'pending-ownership-application', 'Evolution still has an unresolved decision');
    creature = familyCreatureSchema.parse(view.creature);
    inventory = view.inventory; diagnosticSource = true;
  }
  const pending = resources.encounters.restore(initial.encounter).view();
  require(pending.phase === 'pending-encounter' && pending.creature, 'A fresh pending source encounter is required');
  require(pending.trainerId === creature.otId && pending.creature.otId === creature.otId, 'Encounter trainer differs from result identity');
  const { slot: _slot, nature: _nature, gender: _gender, ...wild } = pending.creature;
  const opponent = familyCreatureSchema.parse({ ...wild, evs: zeroEvs(), calculatedEvs: zeroEvs(), ballItemId: null, metLocation: null });
  return { seed: initial.encounter.words[1]!, mons: [creature, opponent], context: familyContextSchema.parse({ inventory,
    origin: { kind: 'private-result-proof', resultKind: result.kind, resultDigest: result.checkpoint.digest,
      diagnosticSource, ownershipApplication: 'pending' }, liveAdmission: false }) };
}
export function createFamilyDiagnostic(input: FamilyDiagnostic): FamilyInitial {
  return familyInitialSchema.parse({ kind: 'diagnostic', ...familyDiagnosticSchema.parse(input) });
}
export async function loadFamilyResources(): Promise<FamilyResources> {
  const [progression, captures, evolutions, encounters] = await Promise.all([
    loadProgressionCore(), loadCaptureCore(), loadEvolutionCore(), loadEncounterCore(),
  ]);
  return { progression, captures, evolutions, encounters };
}
export async function createFamilyDiagnosticFromResult(result: FamilyResult, encounter: unknown): Promise<FamilyInitial> {
  const initial = familyInitialSchema.parse({ kind: 'result-proof', result, encounter });
  prepareFamily(await loadFamilyResources(), initial);
  return initial;
}
