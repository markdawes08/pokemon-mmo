import { describe, expect, it } from 'vitest';
import { trainerAssetsSchema } from './assets.js';

const projection = {
  version: 1, characterId: 'fba655d0-6244-4a22-a33d-be586ee34803', revision: 1, profileId: 'r1-squirtle-v1',
  party: [{ slot: 0, id: 'dcf1e394-e66e-4f50-acb6-fc87758187fa', speciesId: 7, name: 'SQUIRTLE', nickname: null,
    level: 5, hp: 20, maxHp: 20, status: 'healthy', moves: [{ slot: 0, moveId: 33, name: 'TACKLE', pp: 35, maxPp: 35 }] }],
  storage: { used: 0, capacity: 420 }, inventory: [{ itemId: 4, name: 'POKé BALL', quantity: 5, pocket: 'POKE_BALLS' }],
  money: 3000, location: { mapId: 'MAP_PALLET_TOWN', x: 10, y: 12 }, developmentFlags: ['DEV_R1_FIXTURE'],
};

describe('owner asset projection boundary', () => {
  it('admits saved display records and empty normal trainers', () => {
    expect(trainerAssetsSchema.parse(projection).party[0].speciesId).toBe(7);
    expect(trainerAssetsSchema.parse({ ...projection, profileId: null, party: [], inventory: [], money: 0, location: null, developmentFlags: [] }).party).toEqual([]);
  });
  it('rejects private persistence fields even when nested in an otherwise valid response', () => {
    for (const privateField of ['ownerId', 'leaseGeneration', 'payloadHash', 'sessionToken', 'storyFlags']) {
      expect(trainerAssetsSchema.safeParse({ ...projection, [privateField]: 'private' }).success).toBe(false);
    }
    expect(trainerAssetsSchema.safeParse({ ...projection, party: [{ ...projection.party[0], personality: 25 }] }).success).toBe(false);
  });
  it('rejects inconsistent HP, PP and duplicate asset identities', () => {
    expect(trainerAssetsSchema.safeParse({ ...projection, party: [{ ...projection.party[0], hp: 21 }] }).success).toBe(false);
    expect(trainerAssetsSchema.safeParse({ ...projection, party: [{ ...projection.party[0], moves: [{ ...projection.party[0].moves[0], pp: 36 }] }] }).success).toBe(false);
    expect(trainerAssetsSchema.safeParse({ ...projection, party: [projection.party[0], { ...projection.party[0], slot: 1 }] }).success).toBe(false);
    expect(trainerAssetsSchema.safeParse({ ...projection, inventory: [projection.inventory[0], projection.inventory[0]] }).success).toBe(false);
  });
});
