import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { worldMapSchema, type WorldMap } from '@pokewaterblue/content-schema';
import { resolvePreviewMove, type Direction, type PreviewMoveResult } from '@pokewaterblue/game-rules';
import { WORLD_MAP_HASHES, worldLocationSchema, type WorldLocation } from '@pokewaterblue/protocol';

export const WORLD_SOURCE_FINGERPRINT = 'f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982';
const sources = [
  ['PalletTown', WORLD_MAP_HASHES.MAP_PALLET_TOWN],
  ['Route1', WORLD_MAP_HASHES.MAP_ROUTE1],
  ['PalletTown_PlayersHouse_1F', WORLD_MAP_HASHES.MAP_PALLET_TOWN_PLAYERS_HOUSE_1F],
] as const;

/** Admits only the audited exploration fixture. The character service separately
 * opts into Route 1 wild testing; story scripts remain outside this policy. */
export class WorldContent {
  private constructor(readonly maps: Readonly<Record<string, WorldMap>>) {}
  static async load(root = process.cwd()): Promise<WorldContent> {
    const maps = await Promise.all(sources.map(async ([name, expectedHash]) => {
      const bytes = await readFile(resolve(root, `content/generated/client/maps/${name}.json`));
      if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error(`Shared world content differs from its audited snapshot: ${name}`);
      const map = worldMapSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (map.source.fingerprint !== WORLD_SOURCE_FINGERPRINT) throw new Error('Shared world source fingerprint mismatch.');
      const admittedTriggers = map.id === 'MAP_PALLET_TOWN' ? ['12:1:3', '13:1:3', '13:2:3'] : [];
      const actualTriggers = map.events.triggers.map(trigger => `${trigger.x}:${trigger.y}:${trigger.elevation}`).sort();
      if (JSON.stringify(actualTriggers) !== JSON.stringify(admittedTriggers)) throw new Error('Shared exploration policy does not admit these story triggers.');
      return map;
    }));
    return new WorldContent(Object.fromEntries(maps.map(map => [map.id, map])));
  }
  validateLocation(value: unknown): WorldLocation {
    const location = worldLocationSchema.parse(value);
    const map = this.maps[location.mapId];
    const block = map?.blocks[location.y * map.width + location.x];
    if (!map || location.x >= map.width || location.y >= map.height || !block || block.collision !== 0 ||
      ![0x00, 0x02, 0x0a, 0x61, 0x62, 0x63, 0x64, 0x65, 0x6c, 0x6d, 0x6e, 0x6f].includes(block.behavior) ||
      (block.elevation !== 0 && block.elevation !== 15 && block.elevation !== location.elevation) ||
      map.events.objects.some(object => object.visible && object.x === location.x && object.y === location.y && (object.elevation === 0 || object.elevation === location.elevation))) throw new Error('Saved location is not a supported safe world tile.');
    return location;
  }
  move(from: WorldLocation, direction: Direction, run: boolean): PreviewMoveResult {
    const occupants = Object.values(this.maps).flatMap(map => map.events.objects.filter(object => object.visible).map(object => ({ mapId: map.id, x: object.x, y: object.y, elevation: object.elevation })));
    // Pure source traversal is reused as data/rules. Authorization, timing, ownership and persistence are server-owned here.
    return resolvePreviewMove(this.maps, from, direction, { mode: run ? 'run' : 'walk', occupants });
  }
}
