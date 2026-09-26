import { worldManifestSchema, worldMapSchema, type WorldManifest, type WorldMap } from '@pokewaterblue/content-schema';

export interface LoadedWorld { manifest: WorldManifest; maps: Record<string, WorldMap>; mapHashes: Record<string, string> }
export async function loadWorld(): Promise<LoadedWorld> {
  const indexResponse = await fetch('/content/world.json');
  if (!indexResponse.ok) throw new Error('World content has not been built.');
  const manifest = worldManifestSchema.parse(await indexResponse.json());
  const entries = await Promise.all(manifest.maps.map(async descriptor => {
    const response = await fetch(descriptor.url);
    if (!response.ok) throw new Error(`Map content has not been built. Missing ${descriptor.displayName}.`);
    const bytes = await response.arrayBuffer();
    const map = worldMapSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (map.id !== descriptor.id || map.name !== descriptor.name) throw new Error('Map content does not match the world index. Rebuild content.');
    return [map.id, map, hash] as const;
  }));
  const maps = Object.fromEntries(entries.map(([id, map]) => [id, map]));
  const mapHashes = Object.fromEntries(entries.map(([id, , hash]) => [id, hash]));
  if (entries.length !== Object.keys(maps).length || !maps[manifest.startMap]) throw new Error('World content has duplicate maps or a missing starting area.');
  if (new Set(entries.map(([, map]) => map.source.fingerprint)).size !== 1) throw new Error('World maps use different source baselines. Rebuild content.');
  const graphicsById = new Map<string, string>();
  for (const [, map] of entries) {
    for (const graphics of map.actorGraphics) {
      const signature = JSON.stringify(graphics);
      if (graphicsById.has(graphics.graphicsId) && graphicsById.get(graphics.graphicsId) !== signature) throw new Error('NPC graphics disagree between maps. Rebuild content.');
      graphicsById.set(graphics.graphicsId, signature);
    }
    for (const warp of map.events.warps) if (warp.destinationAvailable && !maps[warp.destinationMap]) throw new Error(`Missing required warp destination for ${map.displayName}.`);
    for (const connection of map.connections) if (connection.destinationAvailable && !maps[connection.map]) throw new Error(`Missing required connection for ${map.displayName}.`);
  }
  return { manifest, maps, mapHashes };
}
