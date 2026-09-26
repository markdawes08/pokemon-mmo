import { z } from "zod";
export { previewAudioSchema, type PreviewAudioContent } from "./audio";
export { fieldGuideSchema, type FieldGuide } from "./gameplay";

const integer = z.number().int().nonnegative();
const point = z.object({ x: integer, y: integer, elevation: integer.max(15) });
export const mapBlockSchema = z.object({
  raw: integer.max(65535),
  metatile: integer.max(1023),
  collision: integer.max(3),
  elevation: integer.max(15),
  attributes: integer.max(4294967295),
  behavior: integer.max(511),
  behaviorName: z.string().optional(),
  terrain: integer.max(31),
  encounter: integer.max(7),
  layerType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});
// Generated image requests stay under the public content directory. No external
// origins, encoded traversal, query strings, or parent-directory segments.
const contentImageUrl = z.string().regex(/^\/content\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/);
const contentJsonUrl = z.string().regex(/^\/content\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);
export const dialogueFontSchema = z.object({
  schemaVersion: z.literal(1), id: z.literal("firered-latin-normal"), image: contentImageUrl,
  atlasWidth: integer.positive().max(2048), atlasHeight: integer.positive().max(2048),
  lineHeight: integer.positive().max(32), letterSpacing: integer.max(8),
  glyphs: z.record(z.string().min(1), z.object({
    x: integer, y: integer, width: integer.positive().max(32), height: integer.positive().max(32), advance: integer.positive().max(32),
  })),
}).superRefine((font, context) => {
  if (!font.glyphs[' ']) context.addIssue({ code: "custom", message: "Font lacks a space glyph" });
  for (const [character, glyph] of Object.entries(font.glyphs)) {
    if ([...character].length !== 1 || glyph.x + glyph.width > font.atlasWidth || glyph.y + glyph.height > font.atlasHeight || glyph.height > font.lineHeight) {
      context.addIssue({ code: "custom", message: `Invalid font glyph bounds: ${character}` });
    }
  }
});
const mapId = z.string().regex(/^MAP_[A-Z0-9_]+$/);
const mapName = z.string().regex(/^[A-Za-z0-9_]+$/);
export const layerUrlsSchema = z.object({ bottom: contentImageUrl, middle: contentImageUrl, top: contentImageUrl });
const animationFrame = z.object({ frame: integer.max(17), durationFrames: integer.positive(), flipX: z.boolean() });
const animationSequence = z.array(animationFrame).nonempty();
const actorAnimationsSchema = z.object({
  "idle-south": animationSequence,
  "idle-north": animationSequence,
  "idle-west": animationSequence,
  "idle-east": animationSequence,
  "walk-south": animationSequence,
  "walk-north": animationSequence,
  "walk-west": animationSequence,
  "walk-east": animationSequence,
});
const playerAnimationsSchema = actorAnimationsSchema.extend({
  "run-south": animationSequence, "run-north": animationSequence,
  "run-west": animationSequence, "run-east": animationSequence,
});
const direction = z.enum(["north", "south", "west", "east"]);
export const interactionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dialogue"), pages: z.array(z.string().min(1)).nonempty() }),
  z.object({ kind: z.literal("unavailable"), pages: z.array(z.string()).length(0), reason: z.string().min(1) }),
  z.object({ kind: z.literal("none"), pages: z.array(z.string()).length(0) }),
]);
const actorGraphicsSchema = z.object({
  graphicsId: z.string(), image: contentImageUrl,
  frameWidth: z.literal(16), frameHeight: z.literal(32), frameCount: z.literal(9), sourceFrameRate: z.literal(60),
  animations: actorAnimationsSchema,
}).superRefine((actor, context) => {
  for (const frames of Object.values(actor.animations)) for (const frame of frames) {
    if (frame.frame >= actor.frameCount) context.addIssue({ code: "custom", message: "Actor animation frame outside sheet" });
  }
});
export const worldManifestSchema = z.object({
  schemaVersion: z.literal(5),
  profile: z.literal("firered-private"),
  previewNames: z.object({ player: z.literal("RED"), rival: z.literal("BLUE") }),
  dialogueFont: contentJsonUrl,
  fieldGuide: contentJsonUrl,
  audio: z.object({ url: contentJsonUrl, music: z.literal("MUS_PALLET"), soundEffect: z.literal("SE_SELECT"), status: z.literal("bounded-prototype") }),
  startMap: mapId,
  maps: z.array(z.object({ id: mapId, name: mapName, displayName: z.string().min(1), url: contentJsonUrl })).nonempty(),
}).superRefine((world, context) => {
  if (new Set(world.maps.map((map) => map.id)).size !== world.maps.length) context.addIssue({ code: "custom", message: "Duplicate map id" });
  if (new Set(world.maps.map((map) => map.name)).size !== world.maps.length) context.addIssue({ code: "custom", message: "Duplicate map name" });
  if (!world.maps.some((map) => map.id === world.startMap)) context.addIssue({ code: "custom", message: "Start map missing from world" });
});
export const worldMapSchema = z.object({
  schemaVersion: z.literal(5),
  profile: z.literal("firered-private"),
  id: mapId,
  name: mapName,
  displayName: z.string().min(1),
  mapType: z.enum(["MAP_TYPE_TOWN", "MAP_TYPE_INDOOR", "MAP_TYPE_ROUTE"]),
  music: z.string().regex(/^MUS_[A-Z0-9_]+$/),
  allowRunning: z.boolean(),
  width: integer.positive(), height: integer.positive(), tileSize: z.literal(16),
  blocks: z.array(mapBlockSchema),
  border: z.object({ width: integer.positive(), height: integer.positive(), blocks: z.array(mapBlockSchema), layers: layerUrlsSchema }),
  layers: layerUrlsSchema,
  events: z.object({
    warps: z.array(point.extend({ warpId: integer, destinationMap: mapId, destinationWarp: integer, destinationAvailable: z.boolean(), destination: point.nullable() })),
    objects: z.array(point.extend({
      graphicsId: z.string(), implemented: z.boolean(), localId: integer.positive(), displayName: z.string().min(1),
      visible: z.boolean(), direction, movementType: z.string(), movementRange: z.object({ x: integer, y: integer }),
      visibilityReason: z.string(), interaction: interactionSchema,
    })),
    triggers: z.array(point.extend({ implemented: z.literal(false) })),
    signs: z.array(point.extend({ implemented: z.boolean(), signId: integer, facing: z.literal("any"), interaction: interactionSchema })),
  }),
  actorGraphics: z.array(actorGraphicsSchema),
  connections: z.array(z.object({ map: mapId, offset: z.number().int(), direction: z.enum(["up", "down", "left", "right"]), destinationAvailable: z.boolean() })),
  animations: z.array(z.object({
    id: z.string(), durationFrames: integer.positive(), phaseFrames: integer,
    sourceFrameRate: z.literal(60), frames: z.array(layerUrlsSchema).nonempty(), componentCount: integer,
  })),
  doors: z.array(z.object({ metatile: integer.max(1023), frames: z.array(contentImageUrl).length(3), frameDurationFrames: integer.positive(), sourceFrameRate: z.literal(60) })),
  player: z.object({
    image: contentImageUrl, frameWidth: z.literal(16), frameHeight: z.literal(32), frameCount: z.literal(18), sourceFrameRate: z.literal(60),
    animations: playerAnimationsSchema,
  }),
  previewSpawn: point,
  limitations: z.array(z.string()),
  source: z.object({ map: z.string(), layout: z.string(), upstreamCommit: z.null(), fingerprint: z.string().nullable() }),
}).superRefine((map, context) => {
  if (map.blocks.length !== map.width * map.height) context.addIssue({ code: "custom", message: "Map block count differs from dimensions" });
  if (map.border.blocks.length !== map.border.width * map.border.height) context.addIssue({ code: "custom", message: "Border block count differs from dimensions" });
  if (map.previewSpawn.x >= map.width || map.previewSpawn.y >= map.height) context.addIssue({ code: "custom", message: "Preview spawn outside map" });
  for (const [index, warp] of map.events.warps.entries()) {
    if (warp.warpId !== index) context.addIssue({ code: "custom", message: "Warp id differs from source array index" });
    if (warp.x >= map.width || warp.y >= map.height) context.addIssue({ code: "custom", message: "Warp outside map" });
    if (warp.destinationAvailable !== (warp.destination !== null)) context.addIssue({ code: "custom", message: "Warp availability differs from resolved destination" });
  }
  const graphics = new Set(map.actorGraphics.map((actor) => actor.graphicsId));
  if (graphics.size !== map.actorGraphics.length) context.addIssue({ code: "custom", message: "Duplicate actor graphics" });
  if (new Set(map.events.objects.map((object) => object.localId)).size !== map.events.objects.length) context.addIssue({ code: "custom", message: "Duplicate object local id" });
  for (const object of map.events.objects) {
    if (object.x >= map.width || object.y >= map.height) context.addIssue({ code: "custom", message: "Object outside map" });
    if (object.visible && (!object.implemented || !graphics.has(object.graphicsId))) context.addIssue({ code: "custom", message: "Visible object lacks implemented graphics" });
  }
});

export type MapBlock = z.infer<typeof mapBlockSchema>;
export type LayerUrls = z.infer<typeof layerUrlsSchema>;
export type WorldMap = z.infer<typeof worldMapSchema>;
export type WorldManifest = z.infer<typeof worldManifestSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type ActorGraphics = z.infer<typeof actorGraphicsSchema>;
export type DialogueFont = z.infer<typeof dialogueFontSchema>;
// Kept while existing consumers migrate to the generic three-area contract.
export const palletMapSchema = worldMapSchema;
export type PalletMap = WorldMap;
