import { z } from 'zod';

const id = z.number().int().min(1).max(65535);
const name = z.string().min(1).max(64);
const move = z.strictObject({ slot: z.number().int().min(0).max(3), moveId: id, name,
  pp: z.number().int().min(0).max(255), maxPp: z.number().int().min(1).max(255) });
const creature = z.strictObject({
  slot: z.number().int().min(0).max(5), id: z.uuid(), speciesId: id, name,
  nickname: z.string().min(1).max(12).nullable(), level: z.number().int().min(1).max(100),
  hp: z.number().int().min(0).max(65535), maxHp: z.number().int().min(1).max(65535),
  status: z.enum(['healthy', 'poison', 'burn', 'sleep', 'paralysis', 'freeze', 'bad-poison']),
  moves: z.array(move).min(1).max(4),
});

/** Owner-only display values. Identity seeds, receipts and operational story state stay server-side. */
export const trainerAssetsSchema = z.strictObject({
  version: z.literal(1), characterId: z.uuid(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  profileId: z.literal('r1-squirtle-v1').nullable(),
  party: z.array(creature).max(6), storage: z.strictObject({ used: z.number().int().min(0).max(420), capacity: z.literal(420) }),
  inventory: z.array(z.strictObject({ itemId: id, name, quantity: z.number().int().min(1).max(999), pocket: z.string().min(1).max(32) })).max(300),
  money: z.number().int().min(0).max(999999),
  location: z.strictObject({ mapId: z.string().regex(/^MAP_[A-Z0-9_]+$/), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).nullable(),
  developmentFlags: z.array(z.string().min(1).max(128)).max(16),
}).superRefine((assets, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(assets.party.map(entry => entry.slot)).size !== assets.party.length || new Set(assets.party.map(entry => entry.id)).size !== assets.party.length) fail('Repeated party member or slot.');
  if (new Set(assets.inventory.map(entry => entry.itemId)).size !== assets.inventory.length) fail('Repeated bag item.');
  for (const entry of assets.party) {
    if (entry.hp > entry.maxHp || entry.moves.some(move => move.pp > move.maxPp)) fail('Invalid remaining HP or PP.');
    if (new Set(entry.moves.map(move => move.slot)).size !== entry.moves.length || new Set(entry.moves.map(move => move.moveId)).size !== entry.moves.length) fail('Repeated move or slot.');
  }
});
export type TrainerAssets = z.infer<typeof trainerAssetsSchema>;
