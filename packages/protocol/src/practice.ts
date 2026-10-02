import { z } from 'zod';
import { worldDirectionSchema, worldLocationSchema } from './world.js';

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id = z.number().int().min(1).max(65535);
const slot = z.number().int().min(0).max(3);
const partyIndex = z.number().int().min(0).max(5);
const actor = z.union([z.literal(0), z.literal(1)]);
const status = z.union([z.literal(0), z.literal(8), z.literal(16)]);
const decisionId = z.string().regex(/^[a-f0-9]{64}$/);
export const practiceMonSchema = z.strictObject({
  speciesId: id, level: z.number().int().min(1).max(100), abilityNum: actor,
  moveIds: z.array(id).min(1).max(4), status,
  hpPercent: z.number().int().min(1).max(100), ppPercent: z.number().int().min(0).max(100),
});
export const practiceSetupSchema = z.strictObject({ player: z.array(practiceMonSchema).min(1).max(6), opponent: practiceMonSchema });
export const practiceChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), slot }),
  z.strictObject({ kind: z.literal('continue-charge'), decisionId }),
  z.strictObject({ kind: z.literal('struggle') }), z.strictObject({ kind: z.literal('run') }),
  z.strictObject({ kind: z.literal('switch'), partyIndex }),
  z.strictObject({ kind: z.literal('use-next'), decisionId }), z.strictObject({ kind: z.literal('attempt-run'), decisionId }),
  z.strictObject({ kind: z.literal('replace'), partyIndex, decisionId }),
]);
const commandBase = { commandId: z.uuid(), expectedRevision: counter };
export const practiceCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...commandBase, kind: z.literal('start'), setup: practiceSetupSchema }),
  z.strictObject({ ...commandBase, kind: z.literal('choose'), battleId: z.uuid(), choice: practiceChoiceSchema }),
  z.strictObject({ ...commandBase, kind: z.literal('close'), battleId: z.uuid() }),
]);
const monView = z.strictObject({ partyIndex, speciesId: id, abilityId: id,
  level: z.number().int().min(1).max(100), hp: counter.max(65535), maxHP: counter.min(1).max(65535), status,
  moves: z.array(z.strictObject({ slot, moveId: id, pp: counter.max(255), maxPP: counter.max(255) })).max(4),
});
export const practicePresentationSchema = z.strictObject({
  turn: counter.min(1), phase: z.enum(['choice', 'post-faint', 'replacement', 'ended']),
  outcome: z.enum(['won', 'lost', 'draw', 'ran', 'forced-escape']).nullable(), activeIndex: partyIndex,
  party: z.array(monView).min(1).max(6),
  self: monView.extend({ focusEnergy: z.boolean(), charging: z.boolean(), protected: z.boolean(), stages: z.array(counter.max(12)).length(8) }).strict(),
  opponent: z.strictObject({ speciesId: id, level: z.number().int().min(1).max(100), hpPercent: counter.max(100), status,
    charging: z.boolean(), protected: z.boolean() }),
  weather: z.strictObject({ kind: z.enum(['clear', 'rain']), turnsRemaining: counter.max(5) }),
  availableChoices: z.array(practiceChoiceSchema).max(10),
});
export const practiceEventSchema = z.strictObject({ sequence: counter, text: z.string().min(1).max(240),
  kind: z.enum(['attack', 'damage', 'switch', 'faint', 'weather', 'status', 'result', 'info']), actor: actor.optional() });
export const wildReturnLocationSchema = worldLocationSchema.extend({ direction: worldDirectionSchema }).strict();
export const practiceSessionSchema = z.strictObject({ battleId: z.uuid(), setup: practiceSetupSchema.optional(),
  origin: z.literal('route1-wild-test').optional(), returnLocation: wildReturnLocationSchema.optional(),
  presentation: practicePresentationSchema, events: z.array(practiceEventSchema).max(200) });
export const practiceStateSchema = z.strictObject({ revision: counter, session: practiceSessionSchema.nullable(),
  unavailable: z.strictObject({ battleId: z.uuid(), message: z.string().min(1).max(240),
    origin: z.literal('route1-wild-test').optional(), returnLocation: wildReturnLocationSchema.optional() }).optional() });
export const practiceCatalogueSchema = z.strictObject({ version: z.literal('practice-v1'),
  species: z.array(z.strictObject({ id, name: z.string().min(1).max(30),
    abilities: z.array(z.strictObject({ slot: actor, id, name: z.string().min(1).max(40) })).min(1).max(2),
    moves: z.array(z.strictObject({ id, level: counter.min(1).max(100) })).max(100),
    frontSprite: z.string().regex(/^\/content\/practice\/sprites\/[0-9]+-front\.png$/),
    backSprite: z.string().regex(/^\/content\/practice\/sprites\/[0-9]+-back\.png$/),
  })).min(1).max(400),
  moves: z.array(z.strictObject({ id, name: z.string().min(1).max(40), type: z.string().min(1).max(20),
    power: counter.max(255), accuracy: counter.max(100), pp: counter.max(255) })).min(1).max(400),
  presets: z.array(z.strictObject({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(60),
    description: z.string().min(1).max(240), setup: practiceSetupSchema })).min(1).max(30),
});
export const practiceSnapshotSchema = z.strictObject({
  commandId: z.uuid().nullable(), replayed: z.boolean(), catalogue: practiceCatalogueSchema, state: practiceStateSchema,
});
export type PracticeMon = z.infer<typeof practiceMonSchema>;
export type PracticeSetup = z.infer<typeof practiceSetupSchema>;
export type PracticeChoice = z.infer<typeof practiceChoiceSchema>;
export type PracticeCommand = z.infer<typeof practiceCommandSchema>;
export type PracticePresentation = z.infer<typeof practicePresentationSchema>;
export type PracticeEvent = z.infer<typeof practiceEventSchema>;
export type PracticeState = z.infer<typeof practiceStateSchema>;
export type PracticeSession = z.infer<typeof practiceSessionSchema>;
export type PracticeCatalogue = z.infer<typeof practiceCatalogueSchema>;
export type PracticeSnapshot = z.infer<typeof practiceSnapshotSchema>;
