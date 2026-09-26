// Private persistence fixture. The profile deliberately grants no gameplay authority.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { worldMapSchema } from '@pokewaterblue/content-schema';
import { gameplayServerSchema, type GameplayServerContent } from '../../../packages/content-schema/src/gameplay-server.js';

export const DEVELOPMENT_PROFILE_ID = 'r1-squirtle-v1' as const;
export const DEVELOPMENT_CONTENT_HASH = 'd47ce3fa2c4c2c38e1cbae0b62f2c70ff502f06a267c7fa197d0f55bf4bd393a';
const PALLET_HASH = '74fca5a87d5b217034adb2b8139a3d10520f78cbea6ba1d93f8bd06f1deab6f4';
const SOURCE_FINGERPRINT = 'f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982';
const statKeys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
type Stats = Record<typeof statKeys[number], number>;
type Pocket = GameplayServerContent['items'][number]['pocket']['symbol'];
export interface DevelopmentProfile {
  id: typeof DEVELOPMENT_PROFILE_ID;
  contentHash: string;
  sourceFingerprint: string;
  schemaVersion: 1;
  definitions: GameplayServerContent;
  location: { mapId: 'MAP_PALLET_TOWN'; x: number; y: number };
  creature: {
    speciesId: number; abilityId: number; heldItemId: number; nickname: string; personality: number; otId: number;
    level: number; experience: number; friendship: number; ivs: Stats; evs: Stats; stats: Stats; hp: number;
    status: 'healthy'; statusTurns: 0; locationKind: 'party'; boxIndex: 0; slotIndex: 1;
    moves: { slotIndex: number; moveId: number; pp: number; ppUps: 0 }[];
  };
  inventory: { itemId: number; pocket: Pocket; slotIndex: number; quantity: number }[];
  money: number;
  flags: string[];
  variables: { key: string; value: number }[];
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fail(message: string): never { throw new Error(`Development profile unavailable: ${message}`); }

export async function loadDevelopmentProfile(root = process.cwd()): Promise<DevelopmentProfile> {
  const [contentBytes, mapBytes] = await Promise.all([
    readFile(resolve(root, 'content/generated/server/gameplay.json')),
    readFile(resolve(root, 'content/generated/client/maps/PalletTown.json')),
  ]);
  if (sha256(contentBytes) !== DEVELOPMENT_CONTENT_HASH || sha256(mapBytes) !== PALLET_HASH) fail('pinned content changed; select and audit a new profile version');
  return createDevelopmentProfile(JSON.parse(contentBytes.toString('utf8')) as unknown, JSON.parse(mapBytes.toString('utf8')) as unknown);
}

// Exported for negative contract checks. Production callers always use the pinned loader above.
export function createDevelopmentProfile(rawDefinitions: unknown, rawMap: unknown): DevelopmentProfile {
  const definitions = gameplayServerSchema.parse(rawDefinitions);
  const map = worldMapSchema.parse(rawMap);
  if (definitions.sourceFingerprint !== SOURCE_FINGERPRINT) fail('wrong source snapshot');
  const species = definitions.species.find(row => row.symbol === 'SPECIES_SQUIRTLE');
  if (!species || species.id !== 7 || species.growthRate.symbol !== 'GROWTH_MEDIUM_SLOW') fail('Squirtle definition missing');
  const ability = definitions.abilities.find(row => row.symbol === 'ABILITY_TORRENT');
  if (!ability || species.abilities[0]?.id !== ability.id || species.abilities[1]?.id !== 0) fail('Torrent ability binding changed');
  const level = 5, personality = 25;
  const ivs: Stats = { hp: 15, attack: 15, defense: 15, speed: 15, spAttack: 15, spDefense: 15 };
  const evs: Stats = { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 };
  // pokemon.c CalculateMonStats/CALC_STAT; personality % 25 = HARDY, with no stat modifier.
  const stats = Object.fromEntries(statKeys.map(key => [key,
    Math.floor((2 * species.stats[key] + ivs[key] + Math.floor(evs[key] / 4)) * level / 100) + (key === 'hp' ? level + 10 : 5),
  ])) as Stats;
  const experience = definitions.growthRates.find(row => row.id === species.growthRate.id)?.experience[level];
  if (experience !== 135 || personality % 25 !== 0) fail('initial experience/nature changed');
  const initialMoves = species.levelUpLearnset.filter(row => row.level <= level).slice(-4);
  if (initialMoves.map(row => row.move.id).join(',') !== '33,39') fail('initial moves changed');
  const moves = initialMoves.map((learn, index) => {
    const move = definitions.moves.find(row => row.id === learn.move.id);
    if (!move) return fail('initial move definition missing');
    return { slotIndex: index + 1, moveId: move.id, pp: move.pp, ppUps: 0 as const };
  });
  const inventory = [
    { symbol: 'ITEM_POTION', quantity: 5 }, { symbol: 'ITEM_POKE_BALL', quantity: 5 },
  ].map(entry => {
    const item = definitions.items.find(row => row.symbol === entry.symbol);
    if (!item) return fail(`missing ${entry.symbol}`);
    return { itemId: item.id, pocket: item.pocket.symbol, slotIndex: 1, quantity: entry.quantity };
  });
  const x = 10, y = 12, block = map.blocks[y * map.width + x];
  const occupied = [...map.events.objects, ...map.events.signs, ...map.events.triggers, ...map.events.warps]
    .some(event => event.x === x && event.y === y);
  if (map.id !== 'MAP_PALLET_TOWN' || !block || block.collision !== 0 || block.behavior !== 0 || block.elevation !== 3 || occupied) fail('safe Pallet fixture anchor changed');
  return {
    id: DEVELOPMENT_PROFILE_ID, contentHash: DEVELOPMENT_CONTENT_HASH, sourceFingerprint: SOURCE_FINGERPRINT,
    schemaVersion: 1, definitions, location: { mapId: 'MAP_PALLET_TOWN', x, y },
    creature: {
      speciesId: species.id, abilityId: ability.id, heldItemId: 0, nickname: species.name, personality, otId: 1,
      level, experience, friendship: species.friendship, ivs, evs, stats, hp: stats.hp,
      status: 'healthy', statusTurns: 0, locationKind: 'party', boxIndex: 0, slotIndex: 1, moves,
    },
    inventory, money: 3000, flags: [`development:${DEVELOPMENT_PROFILE_ID}:initialized`],
    variables: [{ key: `development:${DEVELOPMENT_PROFILE_ID}:version`, value: 1 }],
  };
}

export function assertDevelopmentGameplaySupported(_profile: DevelopmentProfile, operation: string): never {
  throw new Error(`Unsupported gameplay operation ${operation}: ${DEVELOPMENT_PROFILE_ID} is a persistence fixture only`);
}
