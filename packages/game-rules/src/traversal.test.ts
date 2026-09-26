import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolvePreviewMove, PREVIEW_HIGH_JUMP_Y, type Direction, type PreviewBlock,
  type PreviewWorld, type PreviewWorldMap, type WorldPosition,
} from './index';

type ImportedMap = PreviewWorldMap & { blocks: (PreviewBlock & { raw: number; metatile: number })[] };
const imported = ['PalletTown', 'PalletTown_PlayersHouse_1F', 'Route1'].map(name =>
  JSON.parse(readFileSync(`content/generated/client/maps/${name}.json`, 'utf8')) as ImportedMap);
const world: PreviewWorld = Object.fromEntries(imported.map(map => [map.id, map]));
const pallet = 'MAP_PALLET_TOWN', house = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', route = 'MAP_ROUTE1';
const position = (mapId: string, x: number, y: number, elevation = 3): WorldPosition => ({ mapId, x, y, elevation });
const move = (mapId: string, x: number, y: number, direction: Direction) => resolvePreviewMove(world, position(mapId, x, y), direction);

describe('three-area source landmarks and traversal', () => {
  it('matches independently decoded source bytes at the actual warp, stair, grass and ledge anchors', () => {
    // Independently read u16 layout blocks and u32 attributes from the pinned
    // read-only source, without calling the content importer. Evidence records
    // their source hashes in reports/traversal-source-evidence.json.
    const fixtures = [
      [pallet, 6, 7, 1699, 675, 1, 0, 105],
      [house, 4, 8, 12307, 19, 0, 3, 101],
      [house, 5, 8, 12308, 20, 0, 3, 0],
      [house, 10, 2, 12317, 29, 0, 3, 108],
      [route, 12, 39, 12301, 13, 0, 3, 2],
      [route, 12, 31, 1175, 151, 1, 0, 59],
    ] as const;
    for (const [id, x, y, raw, metatile, collision, elevation, behavior] of fixtures) {
      const map = imported.find(entry => entry.id === id)!;
      expect(map.blocks[y * map.width + x]).toMatchObject({ raw, metatile, collision, elevation, behavior });
    }
  });

  it('enters the source destination warp, moves away without bounce, and exits one tile south of the exterior door', () => {
    const enter = move(pallet, 6, 8, 'north');
    expect(enter).toMatchObject({ allowed: true, kind: 'transition', via: 'warp', direction: 'north', position: position(house, 4, 8) });
    expect(move(house, 4, 8, 'north')).toMatchObject({ allowed: true, kind: 'step', position: position(house, 4, 7) });
    // Stepping ONTO an arrow is floor movement. The next outward press warps.
    expect(move(house, 4, 7, 'south')).toMatchObject({ allowed: true, kind: 'step', position: position(house, 4, 8) });
    expect(move(house, 4, 8, 'south')).toMatchObject({ allowed: true, kind: 'transition', via: 'warp', direction: 'south',
      arrival: position(pallet, 6, 7, 0), position: position(pallet, 6, 8) });
    expect(move(pallet, 6, 8, 'south')).toMatchObject({ allowed: true, kind: 'step', position: position(pallet, 6, 9) });
  });

  it('does not trigger normal-floor or inaccessible redundant warp events', () => {
    expect(move(house, 5, 8, 'south')).toEqual({ allowed: false, reason: 'collision' });
    expect(move(house, 4, 8, 'east')).toMatchObject({ allowed: true, kind: 'step', position: position(house, 5, 8) });
    expect(move(pallet, 5, 7, 'east')).toEqual({ allowed: false, reason: 'collision' });
  });

  it('reports unavailable interiors and the upstairs direction without replacing them with a spawn', () => {
    expect(move(pallet, 15, 8, 'north')).toEqual({ allowed: false, reason: 'unsupported-destination', destinationMap: 'MAP_PALLET_TOWN_RIVALS_HOUSE' });
    expect(move(pallet, 16, 14, 'north')).toEqual({ allowed: false, reason: 'unsupported-destination', destinationMap: 'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB' });
    expect(move(house, 9, 2, 'east')).toMatchObject({ allowed: true, kind: 'step', position: position(house, 10, 2) });
    expect(move(house, 10, 2, 'east')).toEqual({ allowed: false, reason: 'unsupported-destination', destinationMap: 'MAP_PALLET_TOWN_PLAYERS_HOUSE_2F' });
    expect(move(house, 10, 2, 'south')).toMatchObject({ allowed: true, kind: 'step' });
  });

  it('transfers through the aligned Route 1 border in both directions', () => {
    expect(move(pallet, 12, 0, 'north')).toMatchObject({ allowed: true, kind: 'transition', via: 'connection', position: position(route, 12, 39) });
    expect(move(route, 12, 39, 'south')).toMatchObject({ allowed: true, kind: 'transition', via: 'connection', position: position(pallet, 12, 0) });
    expect(move(route, 12, 0, 'north')).toEqual({ allowed: false, reason: 'unsupported-destination', destinationMap: 'MAP_VIRIDIAN_CITY' });
    expect(move(pallet, 0, 0, 'north')).toEqual({ allowed: false, reason: 'collision' });
  });

  it('walks through Route 1 grass, takes a valid detour up, then jumps down the one-way ledge', () => {
    let at = position(route, 12, 39);
    const walk = (direction: Direction, count: number) => {
      for (let i = 0; i < count; i++) {
        const result = resolvePreviewMove(world, at, direction);
        expect(result).toMatchObject({ allowed: true, kind: 'step', durationFrames: 16 });
        if (!result.allowed) throw new Error(`Unexpected blocked ${at.x},${at.y}: ${result.reason}`);
        at = result.position;
      }
    };
    walk('north', 7);
    expect(resolvePreviewMove(world, at, 'north')).toEqual({ allowed: false, reason: 'ledge-direction' });
    walk('west', 6); walk('north', 2); walk('east', 6);
    expect(at).toEqual(position(route, 12, 30));
    expect(resolvePreviewMove(world, at, 'south')).toMatchObject({ allowed: true, kind: 'jump', durationFrames: 32, position: position(route, 12, 32) });
    expect(PREVIEW_HIGH_JUMP_Y).toEqual([-4, -6, -8, -10, -11, -12, -12, -12, -11, -10, -9, -8, -6, -4, 0, 0]);
  });

  it('rejects water traversal, solid objects and mismatched or absent destination references', () => {
    expect(move(pallet, 9, 12, 'north')).toEqual({ allowed: false, reason: 'collision' });
    const town = world[pallet];
    const ocean = town.blocks.findIndex(block => block.behavior === 21 && block.collision === 0);
    expect(resolvePreviewMove(world, position(pallet, ocean % town.width, Math.floor(ocean / town.width) - 1), 'south'))
      .toEqual({ allowed: false, reason: 'unsupported-terrain' });
    const missing = { ...world }; delete missing[house];
    expect(resolvePreviewMove(missing, position(pallet, 6, 8), 'north')).toEqual({ allowed: false, reason: 'unsupported-destination', destinationMap: house });
    for (const corruption of ['index', 'anchor', 'target-id', 'landing'] as const) {
      const invalid = structuredClone(world);
      if (corruption === 'index') invalid[pallet].events.warps[0].destinationWarp = 400;
      if (corruption === 'anchor') invalid[pallet].events.warps[0].destination!.x++;
      if (corruption === 'target-id') invalid[house].id = 'STALE_MAP_ID';
      if (corruption === 'landing') invalid[house].blocks[8 * invalid[house].width + 4].collision = 1;
      expect(resolvePreviewMove(invalid, position(pallet, 6, 8), 'north')).toEqual({ allowed: false, reason: 'invalid-warp' });
    }
  });
});

function floorMap(id: string, width = 5, height = 5): PreviewWorldMap {
  return { id, width, height, blocks: Array.from({ length: width * height }, () => ({ behavior: 0, elevation: 3, collision: 0 })), events: { warps: [] }, connections: [] };
}

describe('preview traversal edge invariants', () => {
  it.each([
    ['north', 'up', 'down', 3, 0, 1, 4], ['south', 'down', 'up', 3, 4, 1, 0],
    ['west', 'left', 'right', 0, 3, 4, 1], ['east', 'right', 'left', 4, 3, 0, 1],
  ] as const)('subtracts positive and negative connection offsets when crossing %s', (direction, outward, inward, x, y, targetX, targetY) => {
    const a = floorMap('a'), b = floorMap('b');
    a.connections.push({ map: 'b', direction: outward, offset: 2, destinationAvailable: true });
    b.connections.push({ map: 'a', direction: inward, offset: -2, destinationAvailable: true });
    const maps = { a, b };
    expect(resolvePreviewMove(maps, position('a', x, y), direction)).toMatchObject({ allowed: true, position: position('b', targetX, targetY) });
    const reverse: Record<Direction, Direction> = { north: 'south', south: 'north', west: 'east', east: 'west' };
    expect(resolvePreviewMove(maps, position('b', targetX, targetY), reverse[direction])).toMatchObject({ allowed: true, position: position('a', x, y) });
  });

  it('guards connection overlap, direction, out-of-range coordinates and destination collision', () => {
    const a = floorMap('a'), b = floorMap('b');
    a.connections.push({ map: 'b', direction: 'up', offset: 2, destinationAvailable: true });
    const maps = { a, b };
    expect(resolvePreviewMove(maps, position('a', 1, 0), 'north')).toEqual({ allowed: false, reason: 'boundary' });
    expect(resolvePreviewMove(maps, position('a', 4, 0), 'east')).toEqual({ allowed: false, reason: 'boundary' });
    expect(resolvePreviewMove(maps, position('a', 3, -1), 'north')).toEqual({ allowed: false, reason: 'invalid-position' });
    b.blocks[4 * b.width + 1].collision = 1;
    expect(resolvePreviewMove(maps, position('a', 3, 0), 'north')).toEqual({ allowed: false, reason: 'collision' });
  });

  it('uses the source elevation 0 and 15 exceptions, while rejecting other elevation changes', () => {
    const a = floorMap('a', 2, 1);
    const maps = { a };
    a.blocks[1].elevation = 4;
    expect(resolvePreviewMove(maps, position('a', 0, 0), 'east')).toEqual({ allowed: false, reason: 'elevation' });
    a.blocks[0].elevation = 0;
    expect(resolvePreviewMove(maps, position('a', 0, 0, 0), 'east')).toMatchObject({ allowed: true, position: position('a', 1, 0, 4) });
    a.blocks[0].elevation = 3; a.blocks[1].elevation = 0;
    expect(resolvePreviewMove(maps, position('a', 0, 0), 'east')).toMatchObject({ allowed: true, position: position('a', 1, 0, 0) });
    a.blocks[1].elevation = 15;
    expect(resolvePreviewMove(maps, position('a', 0, 0), 'east')).toMatchObject({ allowed: true, position: position('a', 1, 0, 3) });
    expect(resolvePreviewMove(maps, position('a', 1, 0), 'west')).toMatchObject({ allowed: true, position: position('a', 0, 0, 3) });
  });

  it('does not jump across the import boundary or land in collision', () => {
    const a = floorMap('a', 1, 3);
    a.blocks[1] = { behavior: 0x3b, elevation: 0, collision: 1 };
    a.blocks[2].collision = 1;
    expect(resolvePreviewMove({ a }, position('a', 0, 0), 'south')).toEqual({ allowed: false, reason: 'collision' });
    a.blocks[1].behavior = 0x3a;
    expect(resolvePreviewMove({ a }, position('a', 0, 2), 'north')).toMatchObject({ allowed: true, kind: 'jump', position: position('a', 0, 0) });
    a.blocks[0] = { behavior: 0x3a, elevation: 0, collision: 1 };
    expect(resolvePreviewMove({ a }, position('a', 0, 1), 'north')).toEqual({ allowed: false, reason: 'boundary' });
  });
});
