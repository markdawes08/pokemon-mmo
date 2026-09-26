/** P02 renderer preview only. Server-authoritative traversal remains P05. */
export interface PreviewBlock { collision: number; elevation: number; behavior: number }
export interface PreviewMap { width: number; height: number; blocks: PreviewBlock[] }
export interface Position { x: number; y: number; elevation: number }
export type Direction = 'north' | 'south' | 'west' | 'east';
const offsets: Record<Direction, { x: number; y: number }> = {
  north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 }, east: { x: 1, y: 0 },
};
export function previewStep(map: PreviewMap, from: Position, direction: Direction):
  { allowed: true; position: Position } | { allowed: false; reason: 'boundary' | 'collision' | 'unsupported-terrain' } {
  const offset = offsets[direction];
  const x = from.x + offset.x, y = from.y + offset.y;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return { allowed: false, reason: 'boundary' };
  const block = map.blocks[y * map.width + x];
  if (!block || block.collision !== 0) return { allowed: false, reason: 'collision' };
  // Legacy first-pass single-map helper. Multi-map preview movement uses
  // resolvePreviewMove below; this API deliberately cannot trigger transfers.
  if (block.behavior !== 0 || block.elevation !== from.elevation) return { allowed: false, reason: 'unsupported-terrain' };
  return { allowed: true, position: { x, y, elevation: block.elevation } };
}

export interface PreviewWarp extends Position {
  warpId: number;
  destinationMap: string;
  destinationWarp: number;
  destinationAvailable: boolean;
  destination: Position | null;
}
export interface PreviewConnection {
  map: string;
  offset: number;
  direction: 'up' | 'down' | 'left' | 'right';
  destinationAvailable: boolean;
}
export interface PreviewWorldMap extends PreviewMap {
  id: string;
  /** Source map header permission; absent content conservatively walks. */
  allowRunning?: boolean;
  events: { warps: PreviewWarp[] };
  connections: PreviewConnection[];
}
export interface WorldPosition extends Position { mapId: string }
export type PreviewWorld = Readonly<Record<string, PreviewWorldMap>>;
export type PreviewMovementMode = 'walk' | 'run';
export interface PreviewMoveOptions {
  /** Input preference only: map permissions and forced traversal still apply. */
  mode?: PreviewMovementMode;
  /** Visible, active occupants. Reserve both coordinates here if an NPC moves. */
  occupants?: readonly WorldPosition[];
}
export type PreviewBlockedReason = 'boundary' | 'collision' | 'elevation' | 'unsupported-terrain'
  | 'unsupported-destination' | 'invalid-position' | 'invalid-warp' | 'ledge-direction' | 'occupied';
export type PreviewMoveResult =
  | { allowed: false; reason: PreviewBlockedReason; destinationMap?: string }
  | { allowed: true; kind: 'step' | 'jump'; position: WorldPosition; direction: Direction; durationFrames: 8 | 16 | 32; movementMode: PreviewMovementMode }
  | { allowed: true; kind: 'transition'; via: 'warp' | 'connection'; position: WorldPosition;
      direction: Direction; durationFrames: 8 | 16; movementMode: PreviewMovementMode; arrival?: WorldPosition };

export const PREVIEW_WALK_FRAMES = 16;
export const PREVIEW_RUN_FRAMES = 8;
export const PREVIEW_JUMP_FRAMES = 32;
// event_object_movement.c sJumpY_High / DoJumpSpriteMovement: each height lasts
// two frames for a two-tile ledge jump; horizontal displacement is 1 px/frame.
export const PREVIEW_HIGH_JUMP_Y = [-4, -6, -8, -10, -11, -12, -12, -12, -11, -10, -9, -8, -6, -4, 0, 0] as const;

const MB_NORMAL = 0x00, MB_TALL_GRASS = 0x02, MB_RUNNING_DISALLOWED = 0x0a, MB_CAVE_DOOR = 0x60, MB_LADDER = 0x61, MB_WARP_DOOR = 0x69;
const ledgeDirections: Partial<Record<number, Direction>> = { 0x38: 'east', 0x39: 'west', 0x3a: 'north', 0x3b: 'south' };
const arrowDirections: Partial<Record<number, Direction>> = { 0x62: 'east', 0x63: 'west', 0x64: 'north', 0x65: 'south' };
const stairDirections: Partial<Record<number, Direction>> = { 0x6c: 'east', 0x6d: 'west', 0x6e: 'east', 0x6f: 'west' };
const opposite: Record<Direction, Direction> = { north: 'south', south: 'north', east: 'west', west: 'east' };
const connectionDirections: Record<Direction, PreviewConnection['direction']> = { north: 'up', south: 'down', west: 'left', east: 'right' };

function inside(map: PreviewMap, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
}
function blockAt(map: PreviewMap, point: Pick<Position, 'x' | 'y'>): PreviewBlock | undefined {
  return inside(map, point.x, point.y) ? map.blocks[point.y * map.width + point.x] : undefined;
}
function shifted(from: WorldPosition, direction: Direction, distance = 1): WorldPosition {
  return { ...from, x: from.x + offsets[direction].x * distance, y: from.y + offsets[direction].y * distance };
}
function blocked(reason: PreviewBlockedReason, destinationMap?: string): PreviewMoveResult & { allowed: false } {
  return destinationMap ? { allowed: false, reason, destinationMap } : { allowed: false, reason };
}
function walkableBehavior(behavior: number): boolean {
  // Grass is traversable here; encounters and grass ground-effect sprites are
  // deliberately absent. Arrow warp tiles are ordinary floor until facing out.
  return behavior === MB_NORMAL || behavior === MB_TALL_GRASS || behavior === MB_RUNNING_DISALLOWED
    || arrowDirections[behavior] !== undefined || stairDirections[behavior] !== undefined;
}
/** event_object_movement.c AreElevationsCompatible: elevation 0 is a wildcard. */
export function arePreviewElevationsCompatible(a: number, b: number): boolean {
  return a === 0 || b === 0 || a === b;
}
function occupied(options: PreviewMoveOptions, point: WorldPosition, elevation = point.elevation): boolean {
  return options.occupants?.some(occupant => occupant.mapId === point.mapId && occupant.x === point.x && occupant.y === point.y
    && arePreviewElevationsCompatible(elevation, occupant.elevation)) ?? false;
}
function stepMode(map: PreviewWorldMap, source: PreviewBlock, options: PreviewMoveOptions, destinationMap = map): PreviewMovementMode {
  // PlayerNotOnBikeMoving checks the CURRENT tile before selecting PlayerRun.
  // bike.c IsRunningDisallowed uses allowRunning, not a general indoor ban.
  // Requiring both map permissions preserves a safe connected-map boundary.
  return options.mode === 'run' && map.allowRunning === true && destinationMap.allowRunning === true
    && source.behavior !== MB_RUNNING_DISALLOWED ? 'run' : 'walk';
}
function stepDuration(mode: PreviewMovementMode): 8 | 16 {
  // sSpeedFast1StepFuncs: eight Step2 calls. Normal: sixteen Step1 calls.
  return mode === 'run' ? PREVIEW_RUN_FRAMES : PREVIEW_WALK_FRAMES;
}
function walkBlockReason(block: PreviewBlock, elevation: number): PreviewBlockedReason | undefined {
  if (block.collision !== 0) return 'collision';
  if (!walkableBehavior(block.behavior)) return 'unsupported-terrain';
  // event_object_movement.c IsElevationMismatchAt, including 0 and 15.
  if (elevation !== 0 && block.elevation !== 0 && block.elevation !== 15 && block.elevation !== elevation) return 'elevation';
  return undefined;
}
function nextElevation(from: Position, source: PreviewBlock, target: PreviewBlock): number {
  // ObjectEventUpdateElevation does not change current elevation while either
  // the current or previous metatile has elevation 15.
  return source.elevation === 15 || target.elevation === 15 ? from.elevation : target.elevation;
}
function warpAt(map: PreviewWorldMap, point: Position): PreviewWarp | undefined {
  return map.events.warps.find(warp => warp.x === point.x && warp.y === point.y
    && (warp.elevation === 0 || warp.elevation === point.elevation));
}

function resolveWarp(world: PreviewWorld, warp: PreviewWarp | undefined, direction: Direction, from: WorldPosition, options: PreviewMoveOptions): PreviewMoveResult {
  if (!warp) return blocked('invalid-warp');
  const targetMap = world[warp.destinationMap];
  if (!warp.destinationAvailable || !targetMap) return blocked('unsupported-destination', warp.destinationMap);
  if (targetMap.id !== warp.destinationMap || !Number.isInteger(warp.destinationWarp) || warp.destinationWarp < 0) return blocked('invalid-warp');
  const anchor = targetMap.events.warps[warp.destinationWarp];
  const declared = warp.destination;
  // Resolve the source destination warp index, never a convenient preview spawn.
  // Reject a stale exported anchor rather than silently teleport elsewhere.
  if (!anchor || anchor.warpId !== warp.destinationWarp || !declared || anchor.x !== declared.x
    || anchor.y !== declared.y || anchor.elevation !== declared.elevation) return blocked('invalid-warp');
  const targetBlock = blockAt(targetMap, anchor);
  if (!targetBlock) return blocked('invalid-warp');
  const arrival: WorldPosition = { mapId: targetMap.id, x: anchor.x, y: anchor.y,
    elevation: targetBlock.elevation === 15 ? from.elevation : targetBlock.elevation };
  const arrow = arrowDirections[targetBlock.behavior] ?? stairDirections[targetBlock.behavior];
  let facing: Direction = arrow ? opposite[arrow] : targetBlock.behavior === MB_LADDER ? direction : 'south';
  let position = arrival;
  if (targetBlock.behavior === MB_WARP_DOOR || targetBlock.behavior === MB_CAVE_DOOR) {
    // field_fadetransition.c Task_ExitDoor / Task_ExitNonAnimDoor and
    // overworld.c GetAdjustedInitialDirection walk south from the door anchor.
    facing = 'south';
    position = shifted(arrival, facing);
    const landing = blockAt(targetMap, position);
    if (!landing || walkBlockReason(landing, arrival.elevation)) return blocked('invalid-warp');
    position.elevation = nextElevation(arrival, targetBlock, landing);
  } else if (targetBlock.collision !== 0 || (!walkableBehavior(targetBlock.behavior) && targetBlock.behavior !== MB_LADDER)) {
    return blocked('invalid-warp');
  }
  // The preview has no scripted NPC relocation during transfers. Refuse an
  // occupied anchor or forced outward step rather than overlap on arrival.
  if (occupied(options, arrival) || occupied(options, position)) return blocked('occupied');
  // durationFrames is the renderer's transfer/step interpolation budget.
  // Door graphics belong to the renderer; full source wipe/fade/audio timing is
  // outside these pure traversal rules.
  return { allowed: true, kind: 'transition', via: 'warp', position, direction: facing, durationFrames: PREVIEW_WALK_FRAMES, movementMode: 'walk', arrival };
}

function resolveBoundary(world: PreviewWorld, map: PreviewWorldMap, from: WorldPosition, direction: Direction, options: PreviewMoveOptions): PreviewMoveResult {
  for (const connection of map.connections) {
    if (connection.direction !== connectionDirections[direction]) continue;
    const targetMap = world[connection.map];
    if (!connection.destinationAvailable || !targetMap) return blocked('unsupported-destination', connection.map);
    if (targetMap.id !== connection.map || !Number.isInteger(connection.offset)) return blocked('boundary');
    // fieldmap.c SetPositionFromConnection subtracts offset along the shared
    // edge. Validate overlap, so a connection cannot wrap a corner of its map.
    const x = direction === 'west' ? targetMap.width - 1 : direction === 'east' ? 0 : from.x - connection.offset;
    const y = direction === 'north' ? targetMap.height - 1 : direction === 'south' ? 0 : from.y - connection.offset;
    const position: WorldPosition = { mapId: targetMap.id, x, y, elevation: from.elevation };
    const target = blockAt(targetMap, position);
    if (!target) continue;
    const reason = walkBlockReason(target, from.elevation);
    if (reason) return blocked(reason);
    if (occupied(options, position, from.elevation)) return blocked('occupied');
    position.elevation = nextElevation(from, blockAt(map, from)!, target);
    const movementMode = stepMode(map, blockAt(map, from)!, options, targetMap);
    return { allowed: true, kind: 'transition', via: 'connection', position, direction, durationFrames: stepDuration(movementMode), movementMode };
  }
  return blocked('boundary');
}

/** Pure, bounded P02 renderer preview. No authority, story state, wild encounters,
 * or persistence. Callers supply the active NPC occupancy snapshot.
 * Pallet's source story triggers are bypassed
 * only by this explicitly labeled exploration preview. */
export function resolvePreviewMove(world: PreviewWorld, from: WorldPosition, direction: Direction, options: PreviewMoveOptions = {}): PreviewMoveResult {
  const map = world[from.mapId];
  if (!map || map.id !== from.mapId || !offsets[direction] || !Number.isInteger(from.elevation)
    || from.elevation < 0 || from.elevation > 15) return blocked('invalid-position');
  const source = blockAt(map, from);
  if (!source) return blocked('invalid-position');

  // field_control_avatar.c TryArrowWarp uses the player's current tile. In
  // particular, arriving on house (4,8) cannot immediately send the player back.
  if ((arrowDirections[source.behavior] ?? stairDirections[source.behavior]) === direction) return resolveWarp(world, warpAt(map, from), direction, from, options);

  const next = shifted(from, direction);
  if (!inside(map, next.x, next.y)) return resolveBoundary(world, map, from, direction, options);
  const target = blockAt(map, next);
  if (!target) return blocked('collision');
  if (target.behavior === MB_WARP_DOOR && direction === 'north') {
    // TryDoorWarp runs before collision; exterior doors carry collision bits.
    if (occupied(options, next, from.elevation)) return blocked('occupied');
    return resolveWarp(world, warpAt(map, { ...next, elevation: source.elevation === 0 ? 0 : from.elevation }), direction, from, options);
  }
  const ledge = ledgeDirections[target.behavior];
  if (ledge) {
    if (ledge !== direction) return blocked('ledge-direction');
    const landingPosition = shifted(from, direction, 2);
    const landing = blockAt(map, landingPosition);
    if (!landing) return blocked('boundary');
    // Source CheckForObjectEventCollision gives the matching ledge precedence
    // over its collision bits. Also validate our bounded preview landing.
    const reason = walkBlockReason(landing, from.elevation);
    if (reason) return blocked(reason);
    if (occupied(options, landingPosition, from.elevation)) return blocked('occupied');
    landingPosition.elevation = nextElevation(from, source, landing);
    return { allowed: true, kind: 'jump', position: landingPosition, direction, durationFrames: PREVIEW_JUMP_FRAMES, movementMode: 'walk' };
  }
  if (target.behavior === MB_LADDER || target.behavior === MB_CAVE_DOOR) {
    if (target.collision !== 0) return blocked('collision');
    next.elevation = nextElevation(from, source, target);
    if (from.elevation !== 0 && target.elevation !== 0 && target.elevation !== 15 && target.elevation !== from.elevation) return blocked('elevation');
    if (occupied(options, next, from.elevation)) return blocked('occupied');
    return resolveWarp(world, warpAt(map, next), direction, from, options);
  }
  const reason = walkBlockReason(target, from.elevation);
  if (reason) return blocked(reason);
  if (occupied(options, next, from.elevation)) return blocked('occupied');
  next.elevation = nextElevation(from, source, target);
  const movementMode = stepMode(map, source, options);
  return { allowed: true, kind: 'step', position: next, direction, durationFrames: stepDuration(movementMode), movementMode };
}
