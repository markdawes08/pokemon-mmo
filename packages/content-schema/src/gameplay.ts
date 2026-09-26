import { z } from 'zod';

const id = z.number().int().nonnegative();
const name = z.string().min(1).max(200);
const level = z.number().int().min(1).max(100);
const stat = id.min(1).max(255);
const stats = z.object({ hp: stat, attack: stat, defense: stat, speed: stat, spAttack: stat, spDefense: stat }).strict();
const species = z.object({
  id: id.positive(), name, types: z.array(id.max(17)).min(1).max(2), stats, catchRate: id.max(255), expYield: id.max(255),
  growthRate: id.max(5), abilities: z.array(id.positive()).min(1).max(2),
  levelUpLearnset: z.array(z.object({ level, move: id.positive() }).strict()).nonempty(),
  evolutions: z.array(z.object({ level, species: id.positive() }).strict()),
}).strict();

export const fieldGuideSchema = z.object({
  schemaVersion: z.literal(1), profile: z.literal('firered-private'), scope: z.literal('pallet-route1-reference'),
  species: z.array(species).nonempty(),
  moves: z.array(z.object({ id: id.positive(), name, type: id.max(17), power: id.max(255), accuracy: id.max(100), pp: id.max(255) }).strict()).nonempty(),
  items: z.array(z.object({ id: id.positive(), name, description: z.string().min(1), price: id.max(65535), pocket: name }).strict()).nonempty(),
  abilities: z.array(z.object({ id: id.positive(), name, description: z.string().min(1) }).strict()).nonempty(),
  types: z.array(z.object({ id: id.max(17), name }).strict()).length(18),
  growthRates: z.array(z.object({ id: id.max(5), name, experience: z.array(id.max(0xFFFFFFFF)).length(101) }).strict()).nonempty(),
  encounters: z.array(z.object({ mapId: z.string().regex(/^MAP_[A-Z0-9_]+$/), name, method: z.literal('land'),
    entries: z.array(z.object({ species: id.positive(), chance: id.positive().max(100), minLevel: level, maxLevel: level }).strict()).nonempty(),
  }).strict()).nonempty(),
}).strict().superRefine((guide, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  const ids = (rows: { id: number }[]) => new Set(rows.map(row => row.id));
  for (const key of ['species', 'moves', 'items', 'abilities', 'types', 'growthRates'] as const) {
    if (ids(guide[key]).size !== guide[key].length) fail(`Duplicate ${key} id`);
  }
  const speciesIds = ids(guide.species), moveIds = ids(guide.moves), abilityIds = ids(guide.abilities), growthIds = ids(guide.growthRates), typeIds = ids(guide.types);
  for (const entry of guide.species) {
    if (!growthIds.has(entry.growthRate) || entry.abilities.some(id => !abilityIds.has(id)) || entry.types.some(id => !typeIds.has(id))) fail('Missing species dependency');
    if (new Set(entry.types).size !== entry.types.length) fail('Repeated display type');
    if (entry.levelUpLearnset[0]?.level !== 1) fail('Missing initial level-up moves');
    let previous = 0;
    for (const learn of entry.levelUpLearnset) {
      if (!moveIds.has(learn.move) || learn.level < previous) fail('Missing or unordered learnset entry');
      previous = learn.level;
    }
    if (entry.evolutions.some(evolution => !speciesIds.has(evolution.species) || evolution.species === entry.id)) fail('Missing evolution target');
  }
  if (guide.moves.some(move => !typeIds.has(move.type))) fail('Missing move type');
  for (const growth of guide.growthRates) {
    if (growth.experience[0] !== 0 || growth.experience[1] !== 1 || growth.experience.some((value, index) => index > 0 && value < growth.experience[index - 1]!)) fail('Invalid experience table');
  }
  const areas = new Set<string>();
  for (const encounter of guide.encounters) {
    const key = `${encounter.mapId}:${encounter.method}`;
    if (areas.has(key)) fail('Duplicate encounter table');
    areas.add(key);
    if (encounter.entries.reduce((sum, entry) => sum + entry.chance, 0) !== 100) fail('Encounter shares must total 100');
    if (encounter.entries.some(entry => !speciesIds.has(entry.species) || entry.minLevel > entry.maxLevel)) fail('Invalid encounter species or level range');
    if (new Set(encounter.entries.map(entry => entry.species)).size !== encounter.entries.length) fail('Duplicate encounter summary species');
  }
});

export type FieldGuide = z.infer<typeof fieldGuideSchema>;
