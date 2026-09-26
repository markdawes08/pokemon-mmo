import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolvePreviewMove, type PreviewMovementMode, type PreviewWorld,
  type PreviewWorldMap, type WorldPosition,
} from './index';

const maps = ['PalletTown', 'PalletTown_PlayersHouse_1F', 'Route1'].map(name =>
  JSON.parse(readFileSync(`content/generated/client/maps/${name}.json`, 'utf8')) as PreviewWorldMap);
const world: PreviewWorld = Object.fromEntries(maps.map(map => [map.id, map]));
const pallet = 'MAP_PALLET_TOWN', house = 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', route = 'MAP_ROUTE1';
const at = (mapId: string, x: number, y: number, elevation = 3): WorldPosition => ({ mapId, x, y, elevation });

describe('source running permissions and traversal timing', () => {
  it('uses the source map permissions and doubles ordinary outdoor speed without changing the destination', () => {
    expect([world[pallet].allowRunning, world[house].allowRunning, world[route].allowRunning]).toEqual([true, false, true]);
    const from = at(pallet, 10, 12);
    const run = resolvePreviewMove(world, from, 'south', { mode: 'run' });
    expect(run).toMatchObject({ allowed: true, kind: 'step', position: at(pallet, 10, 13), movementMode: 'run', durationFrames: 8 });
    expect(resolvePreviewMove(world, from, 'south', { mode: 'walk' })).toMatchObject({
      allowed: true, kind: 'step', position: at(pallet, 10, 13), movementMode: 'walk', durationFrames: 16,
    });
    expect(resolvePreviewMove(world, from, 'south')).toMatchObject({ movementMode: 'walk', durationFrames: 16 });
  });

  it('runs through source grass but obeys the house header and forced door or ledge movement', () => {
    expect(resolvePreviewMove(world, at(route, 12, 39), 'north', { mode: 'run' })).toMatchObject({
      allowed: true, kind: 'step', position: at(route, 12, 38), movementMode: 'run', durationFrames: 8,
    });
    expect(resolvePreviewMove(world, at(house, 4, 8), 'north', { mode: 'run' })).toMatchObject({
      allowed: true, kind: 'step', position: at(house, 4, 7), movementMode: 'walk', durationFrames: 16,
    });
    for (const [mapId, x, y, direction] of [[pallet, 6, 8, 'north'], [house, 4, 8, 'south']] as const) {
      expect(resolvePreviewMove(world, at(mapId, x, y), direction, { mode: 'run' })).toMatchObject({
        allowed: true, kind: 'transition', via: 'warp', movementMode: 'walk', durationFrames: 16,
      });
    }
    expect(resolvePreviewMove(world, at(route, 12, 30), 'south', { mode: 'run' })).toMatchObject({
      allowed: true, kind: 'jump', position: at(route, 12, 32), movementMode: 'walk', durationFrames: 32,
    });
  });

  it('keeps the running preference across eligible connections and walks when either header forbids it', () => {
    const options = { mode: 'run' as const };
    expect(resolvePreviewMove(world, at(pallet, 12, 0), 'north', options)).toMatchObject({
      allowed: true, kind: 'transition', via: 'connection', position: at(route, 12, 39), movementMode: 'run', durationFrames: 8,
    });
    expect(resolvePreviewMove(world, at(route, 12, 39), 'south', options)).toMatchObject({
      allowed: true, position: at(pallet, 12, 0), movementMode: 'run', durationFrames: 8,
    });
    const restricted = structuredClone(world);
    restricted[route].allowRunning = false;
    expect(resolvePreviewMove(restricted, at(pallet, 12, 0), 'north', options)).toMatchObject({ allowed: true, movementMode: 'walk', durationFrames: 16 });
    expect(resolvePreviewMove(restricted, at(route, 12, 39), 'south', options)).toMatchObject({ allowed: true, movementMode: 'walk', durationFrames: 16 });
  });

  it('checks running restrictions on the current tile, following PlayerNotOnBikeMoving', () => {
    const floor: PreviewWorldMap = {
      id: 'floor', width: 2, height: 1, allowRunning: true, events: { warps: [] }, connections: [],
      blocks: [{ collision: 0, elevation: 3, behavior: 0 }, { collision: 0, elevation: 3, behavior: 0x0a }],
    };
    expect(resolvePreviewMove({ floor }, at('floor', 0, 0), 'east', { mode: 'run' })).toMatchObject({ allowed: true, movementMode: 'run', durationFrames: 8 });
    expect(resolvePreviewMove({ floor }, at('floor', 1, 0), 'west', { mode: 'run' })).toMatchObject({ allowed: true, movementMode: 'walk', durationFrames: 16 });
    delete floor.allowRunning;
    expect(resolvePreviewMove({ floor }, at('floor', 0, 0), 'east', { mode: 'run' })).toMatchObject({ allowed: true, movementMode: 'walk', durationFrames: 16 });
  });

  it.each(['walk', 'run'] as const)('preserves collision and unsupported destination checks while requesting %s', mode => {
    expect(resolvePreviewMove(world, at(pallet, 9, 12), 'north', { mode })).toEqual({ allowed: false, reason: 'collision' });
    expect(resolvePreviewMove(world, at(route, 12, 32), 'north', { mode })).toEqual({ allowed: false, reason: 'ledge-direction' });
    expect(resolvePreviewMove(world, at(pallet, 15, 8), 'north', { mode })).toEqual({
      allowed: false, reason: 'unsupported-destination', destinationMap: 'MAP_PALLET_TOWN_RIVALS_HOUSE',
    });
  });
});

describe('active preview NPC occupancy', () => {
  it.each([[pallet, 3, 10], [route, 6, 28], [route, 19, 16]] as const)(
    'stops an outdoor run before the source NPC at %s (%i,%i)', (mapId, x, y) => {
      expect(resolvePreviewMove(world, at(mapId, x, y + 1), 'north', { mode: 'run', occupants: [at(mapId, x, y)] }))
        .toEqual({ allowed: false, reason: 'occupied' });
    },
  );

  it.each(['walk', 'run'] as const)('blocks the source Mom position in %s mode without modifying the snapshot', mode => {
    // data/maps/PalletTown_PlayersHouse_1F/map.json: Mom at (8,4), elevation 3.
    const mom = Object.freeze(at(house, 8, 4));
    const occupants = Object.freeze([mom]);
    expect(resolvePreviewMove(world, at(house, 7, 4), 'east', { mode, occupants })).toEqual({ allowed: false, reason: 'occupied' });
    expect(occupants).toEqual([at(house, 8, 4)]);
    expect(resolvePreviewMove(world, at(house, 7, 4), 'east', { mode, occupants: [] })).toMatchObject({ allowed: true, position: at(house, 8, 4) });
  });

  it('only collides with occupants in the same map and compatible source elevation', () => {
    const from = at(house, 7, 4);
    for (const occupant of [at(pallet, 8, 4), at(house, 8, 4, 4)]) {
      expect(resolvePreviewMove(world, from, 'east', { occupants: [occupant] })).toMatchObject({ allowed: true });
    }
    expect(resolvePreviewMove(world, from, 'east', { occupants: [at(house, 8, 4, 0)] })).toEqual({ allowed: false, reason: 'occupied' });
    expect(resolvePreviewMove(world, { ...from, elevation: 0 }, 'east', { occupants: [at(house, 8, 4, 4)] })).toEqual({ allowed: false, reason: 'occupied' });
  });

  it.each(['walk', 'run'] as const)('rejects occupied jump landings and connected map entry tiles in %s mode', (mode: PreviewMovementMode) => {
    expect(resolvePreviewMove(world, at(route, 12, 30), 'south', { mode, occupants: [at(route, 12, 32)] }))
      .toEqual({ allowed: false, reason: 'occupied' });
    expect(resolvePreviewMove(world, at(pallet, 12, 0), 'north', { mode, occupants: [at(route, 12, 39)] }))
      .toEqual({ allowed: false, reason: 'occupied' });
    expect(resolvePreviewMove(world, at(route, 12, 39), 'south', { mode, occupants: [at(pallet, 12, 0)] }))
      .toEqual({ allowed: false, reason: 'occupied' });
  });

  it('rejects occupied warp arrival anchors and the exterior forced outward step', () => {
    expect(resolvePreviewMove(world, at(pallet, 6, 8), 'north', { occupants: [at(house, 4, 8)] })).toEqual({ allowed: false, reason: 'occupied' });
    for (const occupant of [at(pallet, 6, 7), at(pallet, 6, 8)]) {
      expect(resolvePreviewMove(world, at(house, 4, 8), 'south', { occupants: [occupant] })).toEqual({ allowed: false, reason: 'occupied' });
    }
    expect(resolvePreviewMove(world, at(pallet, 6, 8), 'north', { occupants: [at(house, 4, 8, 4)] })).toMatchObject({ allowed: true });
  });
});
