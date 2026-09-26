// Private definition contract. Deliberately absent from the browser package
// entry point: these source bindings do not implement executable mechanics.
import { z } from 'zod';

const integer = z.number().int().nonnegative();
const byte = integer.max(255);
const level = integer.min(1).max(100);
const text = z.string().min(1);
const identifier = z.string().regex(/^[A-Za-z_]\w*$/);
const reference = (prefix: string, maximum: number, minimum = 0) => z.object({
  id: integer.min(minimum).max(maximum), symbol: z.string().regex(new RegExp(`^${prefix}[A-Z0-9_]+$`)),
}).strict();
const enumReference = (prefix: string, names: readonly string[], offset = 0) => z.object({
  id: integer.min(offset).max(names.length - 1 + offset), symbol: z.enum(names.map(name => prefix + name)),
}).strict().refine(value => value.symbol === prefix + names[value.id - offset], 'Mismatched source enum id/symbol');
const typeReference = enumReference('TYPE_', ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL',
  'MYSTERY', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK']);
const growthReference = enumReference('GROWTH_', ['MEDIUM_FAST', 'ERRATIC', 'FLUCTUATING', 'MEDIUM_SLOW', 'FAST', 'SLOW']);
const eggReference = enumReference('EGG_GROUP_', ['NONE', 'MONSTER', 'WATER_1', 'BUG', 'FLYING', 'FIELD', 'FAIRY', 'GRASS',
  'HUMAN_LIKE', 'WATER_3', 'MINERAL', 'AMORPHOUS', 'WATER_2', 'DITTO', 'DRAGON', 'UNDISCOVERED']);
const colorReference = enumReference('BODY_COLOR_', ['RED', 'BLUE', 'YELLOW', 'GREEN', 'BLACK', 'BROWN', 'PURPLE', 'GRAY', 'WHITE', 'PINK']);
const pocketReference = enumReference('POCKET_', ['ITEMS', 'KEY_ITEMS', 'POKE_BALLS', 'TM_CASE', 'BERRY_POUCH'], 1);
const speciesReference = reference('SPECIES_', 411, 1);
const moveReference = reference('MOVE_', 354, 1);
const itemReference = reference('ITEM_', 374);
const abilityReference = reference('ABILITY_', 77);
const stats = (value: z.ZodNumber) => z.object({ hp: value, attack: value, defense: value, speed: value, spAttack: value, spDefense: value }).strict();
const flagBits = {
  FLAG_MAKES_CONTACT: 1, FLAG_PROTECT_AFFECTED: 2, FLAG_MAGIC_COAT_AFFECTED: 4,
  FLAG_SNATCH_AFFECTED: 8, FLAG_MIRROR_MOVE_AFFECTED: 16, FLAG_KINGS_ROCK_AFFECTED: 32,
} as const;
const targetIds = {
  MOVE_TARGET_SELECTED: 0, MOVE_TARGET_DEPENDS: 1, MOVE_TARGET_USER_OR_SELECTED: 2, MOVE_TARGET_RANDOM: 4,
  MOVE_TARGET_BOTH: 8, MOVE_TARGET_USER: 16, MOVE_TARGET_FOES_AND_ALLY: 32, MOVE_TARGET_OPPONENTS_FIELD: 64,
} as const;
const moveTarget = z.object({ id: integer.max(64), symbol: z.enum(Object.keys(targetIds) as [keyof typeof targetIds, ...(keyof typeof targetIds)[]]) })
  .strict().refine(value => targetIds[value.symbol] === value.id, 'Mismatched move target');
const moveFlags = z.object({ value: integer.max(63), symbols: z.array(z.enum(Object.keys(flagBits) as [keyof typeof flagBits, ...(keyof typeof flagBits)[]])).max(6) })
  .strict().refine(value => new Set(value.symbols).size === value.symbols.length
    && value.symbols.reduce((bits, symbol) => bits | flagBits[symbol], 0) === value.value, 'Mismatched move flags');

const species = speciesReference.extend({
  name: text.max(10), stats: stats(byte.min(1)), evYield: stats(integer.max(3)), types: z.array(typeReference).length(2),
  catchRate: byte.min(1), expYield: byte.min(1), heldItems: z.object({ common: itemReference, rare: itemReference }).strict(),
  genderRatio: byte, eggCycles: byte, friendship: byte, growthRate: growthReference, eggGroups: z.array(eggReference).length(2),
  abilities: z.array(abilityReference).length(2), safariZoneFleeRate: byte, bodyColor: colorReference, noFlip: z.boolean(),
  levelUpLearnset: z.array(z.object({ level, move: moveReference }).strict()).nonempty(),
  evolutions: z.array(z.object({
    method: z.object({ id: z.literal(4), symbol: z.literal('EVO_LEVEL') }).strict(), parameter: level, targetSpecies: speciesReference,
  }).strict()).max(5),
}).strict();
const move = moveReference.extend({
  name: text.max(12), effect: reference('EFFECT_', 213), type: typeReference, power: byte, accuracy: integer.max(100), pp: byte,
  secondaryEffectChance: integer.max(100), target: moveTarget, priority: z.number().int().min(-128).max(127), flags: moveFlags,
}).strict();
const item = itemReference.extend({
  name: text.max(14), description: text, price: integer.max(65535), holdEffect: reference('HOLD_EFFECT_', 66), holdEffectParam: byte,
  importance: byte, registrability: byte, pocket: pocketReference, type: byte, fieldUseFunc: identifier.nullable(), battleUsage: byte,
  battleUseFunc: identifier.nullable(), secondaryId: byte,
  itemEffect: z.object({ symbol: z.string().regex(/^sItemEffect_[A-Za-z0-9_]+$/), bytes: z.array(byte).min(6).max(255) }).strict().nullable(),
}).strict();
const encounter = z.object({
  mapId: z.literal('MAP_ROUTE1'), name: text, method: z.literal('land'), sourceLabel: z.literal('sRoute1_FireRed'), sourceRate: byte.min(1),
  slots: z.array(z.object({ slot: integer.max(11), weight: integer.min(1).max(100), minLevel: level, maxLevel: level, species: speciesReference }).strict()).length(12),
}).strict();

export const gameplayServerSchema = z.object({
  schemaVersion: z.literal(1), profile: z.literal('firered-private'), scope: z.literal('pallet-route1-levelup'), status: z.literal('definitions-only'),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), neutralTypeMultiplierTenths: z.literal(10), limitations: z.array(text).nonempty(),
  species: z.array(species).nonempty().max(411), moves: z.array(move).nonempty().max(354), items: z.array(item).nonempty().max(375),
  abilities: z.array(abilityReference.extend({ name: text.max(12), description: text }).strict()).nonempty().max(78),
  types: z.array(typeReference.safeExtend({ name: text })).length(18),
  growthRates: z.array(growthReference.safeExtend({ name: text, experience: z.array(integer.max(4294967295)).length(101) })).nonempty().max(6),
  encounters: z.array(encounter).nonempty(),
  typeEffectiveness: z.array(z.object({ attack: typeReference, defense: typeReference,
    multiplierTenths: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]), ignoreWhenForesight: z.boolean(),
  }).strict()).nonempty().max(324),
}).strict().superRefine((data, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  const lookup = (rows: { id: number; symbol: string }[]) => new Map(rows.map(row => [row.id, row.symbol]));
  for (const key of ['species', 'moves', 'items', 'abilities', 'types', 'growthRates'] as const) {
    if (lookup(data[key]).size !== data[key].length || new Set(data[key].map(row => row.symbol)).size !== data[key].length) fail(`Duplicate ${key} id or symbol`);
  }
  const speciesIds = lookup(data.species), moveIds = lookup(data.moves), itemIds = lookup(data.items), abilityIds = lookup(data.abilities),
    typeIds = lookup(data.types), growthIds = lookup(data.growthRates);
  const check = (ref: { id: number; symbol: string }, collection: Map<number, string>, label: string) => {
    if (collection.get(ref.id) !== ref.symbol) fail(`Missing or inconsistent ${label} reference ${ref.symbol}`);
  };
  if (itemIds.get(0) !== 'ITEM_NONE' || abilityIds.get(0) !== 'ABILITY_NONE') fail('Missing explicit none item/ability reference');
  for (const entry of data.species) {
    entry.types.forEach(ref => check(ref, typeIds, 'type'));
    entry.abilities.forEach(ref => check(ref, abilityIds, 'ability'));
    Object.values(entry.heldItems).forEach(ref => check(ref, itemIds, 'item'));
    check(entry.growthRate, growthIds, 'growth');
    if (entry.abilities[0]?.id === 0) fail('Selected species requires an initial ability');
    if (entry.levelUpLearnset[0]?.level !== 1) fail('Missing initial level-one move');
    let previous = 0;
    for (const learn of entry.levelUpLearnset) {
      check(learn.move, moveIds, 'move');
      if (learn.level < previous) fail('Unordered level-up learnset');
      previous = learn.level;
    }
    const targets = new Set<number>();
    for (const evolution of entry.evolutions) {
      check(evolution.targetSpecies, speciesIds, 'evolution');
      if (evolution.targetSpecies.id === entry.id || targets.has(evolution.targetSpecies.id)) fail('Self or duplicate evolution');
      targets.add(evolution.targetSpecies.id);
    }
  }
  // A malformed definition must not create an infinite evolution traversal.
  const speciesById = new Map(data.species.map(entry => [entry.id, entry]));
  const visited = new Set<number>(), active = new Set<number>();
  const visit = (id: number) => {
    if (active.has(id)) { fail('Cyclic evolution dependencies'); return; }
    if (visited.has(id)) return;
    active.add(id);
    speciesById.get(id)?.evolutions.forEach(evolution => visit(evolution.targetSpecies.id));
    active.delete(id);
    visited.add(id);
  };
  data.species.forEach(entry => visit(entry.id));
  data.moves.forEach(entry => check(entry.type, typeIds, 'move type'));
  for (const entry of data.items) {
    if (entry.battleUseFunc === 'BattleUseFunc_Medicine' && entry.itemEffect === null) fail('Missing medicine effect-byte binding');
  }
  for (const growth of data.growthRates) {
    if (growth.experience[0] !== 0 || growth.experience[1] !== 1
      || growth.experience.some((value, index) => index > 0 && value < growth.experience[index - 1]!)) fail('Invalid experience progression');
  }
  const areas = new Set<string>();
  for (const area of data.encounters) {
    const key = `${area.mapId}:${area.method}`;
    if (areas.has(key)) fail('Duplicate encounter area/method');
    areas.add(key);
    if (area.slots.reduce((sum, slot) => sum + slot.weight, 0) !== 100) fail('Encounter weights must total 100');
    area.slots.forEach((slot, index) => {
      if (slot.slot !== index || slot.minLevel > slot.maxLevel) fail('Invalid encounter slot index or level range');
      check(slot.species, speciesIds, 'encounter species');
    });
  }
  const relationships = new Set<string>(), foresight = new Set<number>();
  let afterForesight = false;
  for (const row of data.typeEffectiveness) {
    check(row.attack, typeIds, 'attacking type');
    check(row.defense, typeIds, 'defending type');
    const key = `${row.attack.id}:${row.defense.id}`;
    if (relationships.has(key)) fail('Duplicate type relationship');
    relationships.add(key);
    if (row.ignoreWhenForesight) {
      afterForesight = true;
      if (![0, 1].includes(row.attack.id) || row.defense.id !== 7 || row.multiplierTenths !== 0) fail('Invalid Foresight immunity row');
      foresight.add(row.attack.id);
    } else if (afterForesight) fail('Type relationship follows the Foresight section');
  }
  if (foresight.size !== 2 || !foresight.has(0) || !foresight.has(1)) fail('Missing Normal/Fighting Ghost Foresight immunities');
});

export type GameplayServerContent = z.infer<typeof gameplayServerSchema>;
