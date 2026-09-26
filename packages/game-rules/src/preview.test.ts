import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { palletMapSchema } from '@pokewaterblue/content-schema';
import { previewStep } from './index';

const map = palletMapSchema.parse(JSON.parse(readFileSync('content/generated/client/maps/PalletTown.json', 'utf8')));
describe('Pallet Town local preview traversal', () => {
  it('walks on source ground but cannot leave map bounds', () => {
    expect(previewStep(map, map.previewSpawn, 'south')).toEqual({ allowed: true, position: { x: 10, y: 13, elevation: 3 } });
    expect(previewStep(map, { x: 12, y: 0, elevation: 3 }, 'north')).toEqual({ allowed: false, reason: 'boundary' });
  });
  it('does not walk through the source signpost', () => {
    expect(map.blocks[11 * map.width + 9]?.behavior).toBe(132);
    expect(previewStep(map, { x: 9, y: 12, elevation: 3 }, 'north')).toEqual({ allowed: false, reason: 'collision' });
  });
  it('does not mistake collision-free ocean for walkable ground', () => {
    const ocean = map.blocks.findIndex(block => block.behavior === 21 && block.collision === 0);
    expect(ocean).toBeGreaterThan(-1);
    expect(previewStep(map, { x: ocean % map.width, y: Math.floor(ocean / map.width) - 1, elevation: 3 }, 'south')).toEqual({ allowed: false, reason: 'unsupported-terrain' });
  });
});
