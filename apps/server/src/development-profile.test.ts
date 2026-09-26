import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertDevelopmentGameplaySupported, createDevelopmentProfile, loadDevelopmentProfile } from './development-profile.js';
import type { GameplayServerContent } from '../../../packages/content-schema/src/gameplay-server.js';
import { worldMapSchema } from '@pokewaterblue/content-schema';

describe('source-backed development persistence profile', () => {
  it('loads the pinned Squirtle at its actual level-five starting state', async () => {
    const profile = await loadDevelopmentProfile();
    expect(profile.creature).toMatchObject({
      speciesId: 7, abilityId: 67, level: 5, experience: 135, friendship: 70, personality: 25,
      stats: { hp: 20, attack: 10, defense: 12, speed: 10, spAttack: 10, spDefense: 12 },
      moves: [{ slotIndex: 1, moveId: 33, pp: 35 }, { slotIndex: 2, moveId: 39, pp: 30 }],
    });
    expect(profile.location).toEqual({ mapId: 'MAP_PALLET_TOWN', x: 10, y: 12 });
    expect(profile.flags.every(flag => flag.startsWith('development:'))).toBe(true);
    expect(profile.inventory).toEqual([
      { itemId: 13, pocket: 'POCKET_ITEMS', slotIndex: 1, quantity: 5 },
      { itemId: 4, pocket: 'POCKET_POKE_BALLS', slotIndex: 1, quantity: 5 },
    ]);
    for (const operation of ['battle', 'walk', 'item', 'capture']) {
      expect(() => assertDevelopmentGameplaySupported(profile, operation)).toThrow('persistence fixture only');
    }
  });

  it('rejects another source fingerprint or missing source dependencies', async () => {
    const definitions = JSON.parse(await readFile('content/generated/server/gameplay.json', 'utf8')) as GameplayServerContent;
    const map: unknown = JSON.parse(await readFile('content/generated/client/maps/PalletTown.json', 'utf8'));
    expect(() => createDevelopmentProfile({ ...definitions, sourceFingerprint: '0'.repeat(64) }, map)).toThrow('wrong source snapshot');
    expect(() => createDevelopmentProfile({ ...definitions, moves: definitions.moves.filter(move => move.id !== 39) }, map)).toThrow('Missing or inconsistent move reference');
  });

  it('rejects a blocked or occupied fixture position', async () => {
    const definitions: unknown = JSON.parse(await readFile('content/generated/server/gameplay.json', 'utf8'));
    const map = worldMapSchema.parse(JSON.parse(await readFile('content/generated/client/maps/PalletTown.json', 'utf8')));
    map.blocks[12 * map.width + 10]!.collision = 1;
    expect(() => createDevelopmentProfile(definitions, map)).toThrow('safe Pallet fixture anchor changed');
    map.blocks[12 * map.width + 10]!.collision = 0;
    map.events.objects[0]!.x = 10;
    map.events.objects[0]!.y = 12;
    expect(() => createDevelopmentProfile(definitions, map)).toThrow('safe Pallet fixture anchor changed');
  });
});
