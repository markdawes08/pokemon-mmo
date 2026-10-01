import Phaser from 'phaser';
import type { WorldMap, LayerUrls, Interaction, ActorGraphics } from '@pokewaterblue/content-schema';
import { resolvePreviewMove, PREVIEW_HIGH_JUMP_Y, arePreviewElevationsCompatible, type Direction, type WorldPosition, type PreviewMovementMode } from '@pokewaterblue/game-rules';
import type { LoadedWorld } from './content';
import { WORLD_MAP_HASHES, type WorldSnapshot, type WorldAvatar } from '@pokewaterblue/protocol';
import type { WorldConnectionState } from './accounts';

const layerDepth = { bottom: 0, middle: 10, top: 30 };
const strata = Object.keys(layerDepth) as (keyof LayerUrls)[];
const vectors: Record<Direction, { x: number; y: number }> = {
  north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 }, east: { x: 1, y: 0 },
};
const keyDirections: Record<string, Direction> = { ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east', w: 'north', s: 'south', a: 'west', d: 'east' };
interface Rectangle { x: number; y: number; width: number; height: number }
interface Placement extends Rectangle { map: WorldMap }
interface Track { images: Phaser.GameObjects.Image[]; duration: number; phase: number; count: number; key: string; frame: number }
interface RenderedActor { object: WorldMap['events']['objects'][number]; graphics: ActorGraphics; sprite: Phaser.GameObjects.Sprite }
interface RemoteAvatar { sprite: Phaser.GameObjects.Sprite; name: Phaser.GameObjects.Text; motionKey: string; stride: number; durationFrames: number }
export interface DialoguePage { speaker: string; text: string; page: number; total: number }
const opposite: Record<Direction, Direction> = { north: 'south', south: 'north', east: 'west', west: 'east' };
type AcceptedMove = Extract<ReturnType<typeof resolvePreviewMove>, { allowed: true }>;

function subtractRectangle(rect: Rectangle, cut: Rectangle): Rectangle[] {
  const left = Math.max(rect.x, cut.x), top = Math.max(rect.y, cut.y);
  const right = Math.min(rect.x + rect.width, cut.x + cut.width), bottom = Math.min(rect.y + rect.height, cut.y + cut.height);
  if (left >= right || top >= bottom) return [rect];
  return [
    { x: rect.x, y: rect.y, width: left - rect.x, height: rect.height },
    { x: right, y: rect.y, width: rect.x + rect.width - right, height: rect.height },
    { x: left, y: rect.y, width: right - left, height: top - rect.y },
    { x: left, y: bottom, width: right - left, height: rect.y + rect.height - bottom },
  ].filter(piece => piece.width > 0 && piece.height > 0);
}

export class WorldScene extends Phaser.Scene {
  private map: WorldMap;
  private position: WorldPosition;
  private anchor!: Phaser.GameObjects.Container;
  private avatar!: Phaser.GameObjects.Sprite;
  private grid!: Phaser.GameObjects.Graphics;
  private scenery: Phaser.GameObjects.GameObject[] = [];
  private animationImages: Track[] = [];
  private direction: Direction = 'south';
  private pendingDirection: Direction | undefined;
  private pressed = new Set<string>();
  private suppressed = new Set<string>();
  private listeners = new AbortController();
  private moving = false;
  private transitioning = false;
  private suppressTransferInput = false;
  private jumping = false;
  private stepStarted = 0;
  private nextStep = 0;
  private walkingFrames = 0;
  private stepSerial = 0;
  private action = 0;
  private mapOpenedAt = 0;
  private debugEnabled = false;
  private failedAsset: string | undefined;
  private timers = new Set<Phaser.Time.TimerEvent>();
  private doorOverlay: Phaser.GameObjects.Image | undefined;
  private actors = new Map<number, RenderedActor>();
  private occupants: WorldPosition[];
  private runHeld = false;
  private menuOpen = false;
  private movementMode: PreviewMovementMode = 'walk';
  private dialogue: { speaker: string; pages: string[]; index: number; actor?: RenderedActor } | undefined;
  private worldState: WorldConnectionState = 'preview';
  private sharedSnapshot: WorldSnapshot | undefined;
  private sharedReceivedAt = 0;
  private sharedServerBase = 0;
  private sharedVisualServerTime = 0;
  private pendingWorldSequence: number | undefined;
  private lastSharedDirection: Direction = 'south';
  private sharedMotionKey = '';
  private sharedMotionFinished = false;
  private sharedTransitionId = '';
  private previewPosition: WorldPosition | undefined;
  private remoteAvatars = new Map<string, RemoteAvatar>();
  private sendWorldInput: ((direction: Direction, run: boolean) => number | undefined) | undefined;

  constructor(private world: LoadedWorld, private screen: HTMLElement, private report: (text: string) => void,
    private onMapChanged: (map: WorldMap) => void, private onFatalError: (message: string) => void,
    private onDialogue: (page: DialoguePage | null) => void) {
    super('Overworld');
    this.map = world.maps[world.manifest.startMap]!;
    this.position = { mapId: this.map.id, ...this.map.previewSpawn };
    this.occupants = Object.values(world.maps).flatMap(map => map.events.objects.filter(object => object.visible).map(object => ({ mapId: map.id, x: object.x, y: object.y, elevation: object.elevation })));
  }
  preload() {
    const graphicsLoaded = new Set<string>();
    for (const map of Object.values(this.world.maps)) {
      for (const graphics of map.actorGraphics) if (!graphicsLoaded.has(graphics.graphicsId)) {
        graphicsLoaded.add(graphics.graphicsId);
        this.load.spritesheet(`npc:${graphics.graphicsId}`, graphics.image, { frameWidth: graphics.frameWidth, frameHeight: graphics.frameHeight });
      }
      for (const layer of strata) {
        this.load.image(`${map.id}:${layer}`, map.layers[layer]);
        this.load.image(`${map.id}:border:${layer}`, map.border.layers[layer]);
      }
      for (const track of map.animations) track.frames.forEach((frame, index) => {
        for (const layer of strata) this.load.image(`${map.id}:${track.id}:${index}:${layer}`, frame[layer]);
      });
      for (const door of map.doors) door.frames.forEach((url, index) => this.load.image(`${map.id}:door:${door.metatile}:${index}`, url));
    }
    this.load.spritesheet('player', this.map.player.image, { frameWidth: this.map.player.frameWidth, frameHeight: this.map.player.frameHeight });
    this.load.on('loaderror', (file: Phaser.Loader.File) => { this.failedAsset = file.key; });
  }
  create() {
    if (this.failedAsset) {
      this.screen.dataset.loadError = 'true';
      this.onFatalError(`Could not load scenery (${this.failedAsset}). Rebuild content and reload.`); return;
    }
    this.avatar = this.add.sprite(0, 0, 'player', 0).setOrigin(0.5, 1);
    this.anchor = this.add.container(0, 0, [this.avatar]).setDepth(20);
    this.grid = this.add.graphics().setDepth(50).setVisible(false);
    this.renderMap(this.position);
    this.cameras.main.removeBounds().startFollow(this.anchor, true, 1, 1, 0, -8);
    this.cameras.main.roundPixels = true;
    this.attachControls();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.listeners.abort(); this.releaseKeys(); this.cancelAction(); });
    this.screen.dataset.ready = 'true'; this.syncReadout();
    this.report('Walk with arrows or WASD. Hold Shift to run. Face a person or sign and press E.');
  }
  private attachControls() {
    this.input.keyboard?.disableGlobalCapture();
    const options = { signal: this.listeners.signal };
    this.screen.addEventListener('keydown', event => {
      if (this.menuOpen || this.worldState === 'disconnected' || this.worldState === 'reconnecting') return;
      if (event.altKey || event.ctrlKey || event.metaKey || document.hidden) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      this.runHeld = event.shiftKey;
      if (key === 'Escape' && this.dialogue) { event.preventDefault(); this.closeDialogue(); return; }
      if (key === 'e' || key === 'Enter' || key === ' ') {
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        if (!event.repeat) { if (this.dialogue) this.advanceDialogue(); else this.interact(); }
        return;
      }
      const direction = keyDirections[key];
      if (!direction) return;
      event.preventDefault();
      // A key held while a modal or another element had focus must be released
      // before it can start a fresh movement in the map.
      if (event.repeat && !this.pressed.has(key)) { this.suppressed.add(key); return; }
      if (this.dialogue || (this.transitioning && this.suppressTransferInput)) this.suppressed.add(key);
      else if (!this.transitioning && !this.pressed.has(key) && !this.suppressed.has(key)) this.pendingDirection = direction;
      this.pressed.add(key);
    }, options);
    this.screen.addEventListener('keyup', event => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      this.runHeld = event.shiftKey;
      this.pressed.delete(key); this.suppressed.delete(key);
    }, options);
    this.screen.addEventListener('blur', () => this.releaseKeys(), options);
    window.addEventListener('blur', () => this.releaseKeys(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseKeys(); }, options);
  }
  private releaseKeys() { this.pressed.clear(); this.suppressed.clear(); this.pendingDirection = undefined; this.runHeld = false; }
  private placements(): Placement[] {
    const placements: Placement[] = [{ map: this.map, x: 0, y: 0, width: this.map.width * 16, height: this.map.height * 16 }];
    for (const connection of this.map.connections) {
      const neighbor = this.world.maps[connection.map];
      if (!connection.destinationAvailable || !neighbor) continue;
      const width = neighbor.width * 16, height = neighbor.height * 16, offset = connection.offset * 16;
      let x = 0, y = 0;
      if (connection.direction === 'up') { x = offset; y = -height; }
      if (connection.direction === 'down') { x = offset; y = this.map.height * 16; }
      if (connection.direction === 'left') { x = -width; y = offset; }
      if (connection.direction === 'right') { x = this.map.width * 16; y = offset; }
      placements.push({ map: neighbor, x, y, width, height });
    }
    return placements;
  }
  private renderMap(position: WorldPosition) {
    this.closeDialogue();
    this.position = position; this.map = this.world.maps[position.mapId]!;
    for (const object of this.scenery) object.destroy();
    this.doorOverlay?.destroy(); this.doorOverlay = undefined;
    this.scenery = []; this.animationImages = []; this.actors.clear(); this.mapOpenedAt = this.time.now;
    const placements = this.placements();
    // Exclude both current and neighboring map rectangles before repeating borders;
    // otherwise transparent map layers could reveal border graphics underneath.
    let border: Rectangle[] = [{ x: -240, y: -160, width: this.map.width * 16 + 480, height: this.map.height * 16 + 320 }];
    for (const placement of placements) border = border.flatMap(rect => subtractRectangle(rect, placement));
    for (const layer of strata) for (const rect of border) {
      const image = this.add.tileSprite(rect.x, rect.y, rect.width, rect.height, `${this.map.id}:border:${layer}`).setOrigin(0).setDepth(layerDepth[layer]);
      image.tilePositionX = rect.x; image.tilePositionY = rect.y; this.scenery.push(image);
    }
    for (const placement of placements) {
      for (const layer of strata) this.scenery.push(this.add.image(placement.x, placement.y, `${placement.map.id}:${layer}`).setOrigin(0).setDepth(layerDepth[layer]));
      for (const track of placement.map.animations) {
        const key = `${placement.map.id}:${track.id}`;
        const images = strata.map(layer => this.add.image(placement.x, placement.y, `${key}:0:${layer}`).setOrigin(0).setDepth(layerDepth[layer] + 1));
        this.scenery.push(...images);
        this.animationImages.push({ images, duration: track.durationFrames, phase: track.phaseFrames, count: track.frames.length, key, frame: 0 });
      }
      for (const object of placement.map.events.objects.filter(object => object.visible)) {
        const graphics = placement.map.actorGraphics.find(graphics => graphics.graphicsId === object.graphicsId)!;
        const groundY = placement.y + object.y * 16 + 16;
        const sprite = this.add.sprite(placement.x + object.x * 16 + 8, groundY, `npc:${object.graphicsId}`).setOrigin(0.5, 1)
          .setDepth(20 + groundY / 10000).setName(`${placement.map.id}:${object.localId}`);
        const actor = { object, graphics, sprite };
        this.faceActor(actor, object.direction); this.scenery.push(sprite);
        if (placement.map.id === this.map.id) this.actors.set(object.localId, actor);
      }
    }
    this.anchor.setPosition(position.x * 16 + 8, position.y * 16 + 16);
    this.anchor.setDepth(20 + this.anchor.y / 10000);
    this.avatar.setY(0).setVisible(true);
    this.drawDebug(); this.idle(); this.onMapChanged(this.map); this.syncReadout();
  }
  update(time: number) {
    if (!this.avatar) return;
    const frameTime = Math.floor((time - this.mapOpenedAt) * 60 / 1000);
    for (const track of this.animationImages) {
      const frame = Math.floor(Math.max(0, frameTime - track.phase) / track.duration) % track.count;
      if (frame !== track.frame) { track.images.forEach((image, i) => image.setTexture(`${track.key}:${frame}:${strata[i]}`)); track.frame = frame; }
    }
    if (this.worldState !== 'preview') {
      this.updateSharedWorld(time);
      return;
    }
    if (this.moving) {
      const sourceFrames = Math.floor((time - this.stepStarted) * 60 / 1000);
      this.setMovementFrame(sourceFrames);
      if (this.jumping) this.avatar.setY(PREVIEW_HIGH_JUMP_Y[Math.min(PREVIEW_HIGH_JUMP_Y.length - 1, Math.floor(sourceFrames / 2))]!);
      return;
    }
    if (this.menuOpen || this.dialogue || this.transitioning || time < this.nextStep) return;
    let direction = this.pendingDirection; this.pendingDirection = undefined;
    if (document.activeElement === this.screen && !document.hidden) {
      const held = [...this.pressed].filter(key => !this.suppressed.has(key));
      direction ??= keyDirections[held[held.length - 1] ?? ''];
    } else direction = undefined;
    if (!direction) { this.idle(); return; }
    this.direction = direction;
    const move = resolvePreviewMove(this.world.maps, this.position, direction, { mode: this.runHeld ? 'run' : 'walk', occupants: this.occupants });
    if (!move.allowed) {
      this.idle(); this.nextStep = time + 120; this.stepSerial++; this.syncReadout();
      const reasons: Record<string, string> = { boundary: 'This edge is outside the current preview.', collision: 'That path is blocked.', occupied: 'Face them and press E to interact.', elevation: 'There is no walkable connection between these heights.', 'ledge-direction': 'Ledges can only be crossed in one direction.', 'unsupported-terrain': 'This terrain is not available in the movement preview.', 'invalid-warp': 'This map exit could not be resolved. Rebuild content.' };
      this.report(move.destinationMap ? 'That area is not included in this preview yet.' : (reasons[move.reason] ?? 'That movement is not supported in this preview.')); return;
    }
    if (move.kind === 'transition') this.transition(move, direction);
    else {
      this.report(move.kind === 'jump' ? 'One-way ledge jump' : 'Exploration preview · progress is not saved');
      this.walkTo(move.position.x, move.position.y, move.durationFrames, () => { this.position = move.position; this.finishAction(); }, move.kind === 'jump', move.movementMode);
    }
  }
  private setMovementFrame(sourceFrames: number) {
    const frames = this.map.player.animations[`${this.movementMode}-${this.direction}`];
    let elapsed = (this.walkingFrames + sourceFrames) % frames.reduce((sum, frame) => sum + frame.durationFrames, 0);
    for (const frame of frames) {
      if (elapsed < frame.durationFrames) { this.avatar.setFrame(frame.frame).setFlipX(frame.flipX); return; }
      elapsed -= frame.durationFrames;
    }
  }
  private walkTo(x: number, y: number, frames: number, complete: () => void, jump = false, mode: PreviewMovementMode = 'walk') {
    const action = this.action;
    this.moving = true; this.jumping = jump; this.movementMode = mode; this.stepStarted = this.time.now;
    // Keep the alternating stride phase across tile boundaries instead of
    // briefly flashing the first leg again on every new step.
    this.setMovementFrame(0);
    this.screen.dataset.stepDurationFrames = String(frames); this.syncReadout();
    this.tweens.add({ targets: this.anchor, x: x * 16 + 8, y: y * 16 + 16, duration: frames * 1000 / 60, ease: 'Linear',
      // Camera scroll is pixel-rounded, but Phaser preserves fractional container
      // transforms. Snap the shared render/follow anchor to prevent screen jitter.
      // Tween interpolation retains its own start/end values, so this cannot drift.
      onUpdate: () => this.anchor.setPosition(Math.round(this.anchor.x), Math.round(this.anchor.y)).setDepth(20 + Math.round(this.anchor.y) / 10000), onComplete: () => {
      if (action !== this.action) return;
      this.moving = false; this.jumping = false; this.avatar.setY(0); this.walkingFrames = (this.walkingFrames + frames) % 32; complete();
    } });
  }
  private animateDoor(x: number, y: number, opening: boolean, complete: () => void) {
    const block = this.map.blocks[y * this.map.width + x];
    const door = this.map.doors.find(item => item.metatile === block?.metatile);
    if (!door) { complete(); return; }
    this.doorOverlay?.destroy();
    this.doorOverlay = this.add.image(x * 16, y * 16, `${this.map.id}:door:${door.metatile}:${opening ? 0 : 2}`).setOrigin(0).setDepth(15).setVisible(!opening);
    const key = `${this.map.id}:door:${door.metatile}`;
    const tick = door.frameDurationFrames * 1000 / 60;
    // Every source frame lasts five task ticks (counter 0 through 4).
    const indices = opening ? [0, 1, 2] : [2, 1, 0];
    indices.forEach((frame, index) => this.delay(tick * (index + (opening ? 1 : 0)), () => this.doorOverlay?.setTexture(`${key}:${frame}`).setVisible(true)));
    if (!opening) this.delay(tick * 3, () => { this.doorOverlay?.destroy(); this.doorOverlay = undefined; });
    this.delay(tick * 4, complete);
  }
  private transition(move: Extract<AcceptedMove, { kind: 'transition' }>, approach: Direction) {
    this.transitioning = true; this.pendingDirection = undefined;
    this.suppressTransferInput = move.via === 'warp';
    if (this.suppressTransferInput) for (const key of this.pressed) this.suppressed.add(key);
    this.syncReadout();
    const vector = vectors[approach], x = this.position.x + vector.x, y = this.position.y + vector.y;
    const warpFade = () => {
      this.cameras.main.fadeOut(120, 0, 0, 0);
      this.delay(130, () => {
        this.direction = move.direction;
        const arrival = move.arrival ?? move.position;
        this.renderMap(arrival);
        const door = this.map.doors.find(item => item.metatile === this.map.blocks[arrival.y * this.map.width + arrival.x]?.metatile);
        if (door) this.doorOverlay = this.add.image(arrival.x * 16, arrival.y * 16, `${this.map.id}:door:${door.metatile}:2`).setOrigin(0).setDepth(15);
        this.cameras.main.fadeIn(120, 0, 0, 0);
        const finish = () => { this.position = move.position; this.finishAction(); this.report(`${this.map.displayName} · ${this.worldState === 'shared' ? 'shared development world' : 'exploration preview'}`); };
        if (arrival.x !== move.position.x || arrival.y !== move.position.y) this.walkTo(move.position.x, move.position.y, 16, () => this.animateDoor(arrival.x, arrival.y, false, finish));
        else this.delay(130, finish);
      });
    };
    const depart = () => this.walkTo(x, y, move.durationFrames, () => {
      if (move.via === 'connection') {
        this.direction = move.direction; this.renderMap(move.position); this.finishAction(); this.report(`${this.map.displayName} · ${this.worldState === 'shared' ? 'shared development world' : 'exploration preview'}`);
      } else {
        this.avatar.setVisible(false);
        this.animateDoor(x, y, false, warpFade);
      }
    }, false, move.movementMode);
    // Directional exit arrows trigger from the current tile. Walking into the
    // blocked tile beyond the mat would invent an extra source movement.
    const currentBehavior = this.map.blocks[this.position.y * this.map.width + this.position.x]?.behavior;
    if (move.via === 'warp' && currentBehavior !== undefined && currentBehavior >= 0x62 && currentBehavior <= 0x65) warpFade();
    else if (move.via === 'warp') this.animateDoor(x, y, true, depart);
    else depart();
  }
  private delay(milliseconds: number, callback: () => void) {
    const action = this.action;
    const timer = this.time.delayedCall(milliseconds, () => { this.timers.delete(timer); if (action === this.action) callback(); });
    this.timers.add(timer);
  }
  private finishAction() {
    this.moving = false; this.transitioning = false; this.suppressTransferInput = false; this.jumping = false; this.stepSerial++;
    this.avatar.setY(0); this.syncReadout();
    if (this.worldState === 'shared') { this.releaseKeys(); this.report(`${this.map.displayName} · shared development world`); }
  }
  private faceActor(actor: RenderedActor, direction: Direction) {
    const frame = actor.graphics.animations[`idle-${direction}`][0]!;
    actor.sprite.setFrame(frame.frame).setFlipX(frame.flipX);
  }
  private suppressHeldDirections() {
    this.pendingDirection = undefined;
    for (const key of this.pressed) this.suppressed.add(key);
  }
  interact() {
    if (this.menuOpen || !this.avatar || this.moving || this.transitioning || this.dialogue) return;
    if (this.worldState !== 'preview') { this.releaseKeys(); this.report('Shared-world dialogue and story interactions are not available yet.'); return; }
    const offset = vectors[this.direction], x = this.position.x + offset.x, y = this.position.y + offset.y;
    const actor = [...this.actors.values()].find(actor => actor.object.x === x && actor.object.y === y
      && arePreviewElevationsCompatible(actor.object.elevation, this.position.elevation));
    if (actor) { this.openDialogue(actor.object.displayName, actor.object.interaction, actor); return; }
    const sign = this.map.events.signs.find(sign => sign.x === x && sign.y === y
      && arePreviewElevationsCompatible(sign.elevation, this.position.elevation));
    if (sign) { this.openDialogue('Sign', sign.interaction); return; }
    this.report('Face a person or sign, then press E or Enter.');
  }
  private openDialogue(speaker: string, interaction: Interaction, actor?: RenderedActor) {
    if (interaction.kind === 'none') { this.report('There is nothing to read here yet.'); return; }
    this.suppressHeldDirections(); this.idle();
    if (actor) this.faceActor(actor, opposite[this.direction]);
    this.dialogue = { speaker, pages: interaction.kind === 'dialogue' ? interaction.pages : [interaction.reason], index: 0, actor };
    this.showDialoguePage();
  }
  private showDialoguePage() {
    const dialogue = this.dialogue!;
    this.onDialogue({ speaker: dialogue.speaker, text: dialogue.pages[dialogue.index]!, page: dialogue.index + 1, total: dialogue.pages.length });
    this.syncReadout();
  }
  advanceDialogue() {
    if (!this.dialogue) return;
    if (this.dialogue.index + 1 === this.dialogue.pages.length) this.closeDialogue();
    else { this.dialogue.index++; this.showDialoguePage(); }
  }
  closeDialogue() {
    if (!this.dialogue) return;
    if (this.dialogue.actor?.sprite.active) this.faceActor(this.dialogue.actor, this.dialogue.actor.object.direction);
    this.dialogue = undefined; this.suppressHeldDirections(); this.onDialogue(null); this.syncReadout();
  }
  setMenuOpen(open: boolean) {
    this.menuOpen = open;
    this.releaseKeys();
    if (open) this.closeDialogue();
  }
  private idle() { const frame = this.map.player.animations[`idle-${this.direction}`][0]!; this.avatar.setFrame(frame.frame).setFlipX(frame.flipX); }
  private syncReadout() {
    Object.assign(this.screen.dataset, { mapId: this.position.mapId, tileX: String(this.position.x), tileY: String(this.position.y), elevation: String(this.position.elevation), moving: String(this.moving), transitioning: String(this.transitioning), stepSerial: String(this.stepSerial), movementMode: this.movementMode, dialogueOpen: String(!!this.dialogue) });
  }
  toggleDebug() { this.debugEnabled = !this.debugEnabled; this.grid?.setVisible(this.debugEnabled); return this.debugEnabled; }
  private cancelAction() {
    this.action++; for (const timer of this.timers) timer.remove(false); this.timers.clear();
    if (this.anchor) this.tweens.killTweensOf(this.anchor); this.cameras.main.resetFX();
  }
  resetPosition() {
    if (!this.avatar || this.worldState !== 'preview') return;
    this.cancelAction(); this.releaseKeys(); this.nextStep = 0; this.direction = 'south';
    this.moving = false; this.transitioning = false; this.jumping = false;
    const map = this.world.maps[this.world.manifest.startMap]!;
    this.renderMap({ mapId: map.id, ...map.previewSpawn }); this.finishAction(); this.report('Returned to Pallet Town.');
  }
  bindWorldInput(send: (direction: Direction, run: boolean) => number | undefined) { this.sendWorldInput = send; }
  setWorldState(state: WorldConnectionState) {
    if (state === this.worldState) return;
    const previous = this.worldState;
    if (previous === 'preview' && state !== 'preview') this.previewPosition = { ...this.position };
    this.worldState = state; this.releaseKeys(); this.closeDialogue(); this.cancelAction();
    this.moving = false; this.transitioning = false; this.jumping = false; this.pendingWorldSequence = undefined;
    this.sharedMotionKey = ''; this.sharedTransitionId = ''; this.clearRemoteAvatars();
    this.walkingFrames = 0; this.sharedMotionFinished = false;
    this.sharedServerBase = 0; this.sharedVisualServerTime = 0;
    if (state === 'preview') {
      this.sharedSnapshot = undefined;
      if (this.previewPosition) this.renderMap(this.previewPosition);
      this.previewPosition = undefined; this.report('Anonymous exploration preview · progress is not saved');
    } else if (state === 'disconnected' || state === 'reconnecting') {
      this.sharedSnapshot = undefined; this.avatar?.setY(0);
      this.report(state === 'reconnecting' ? 'Connection interrupted. Movement is paused while your trainer reconnects (up to 60 seconds).'
        : 'Shared world disconnected. Open Account to reconnect, or leave the shared world.');
    }
    this.screen.dataset.worldMode = state; this.screen.dataset.worldReady = String(state === 'shared'); this.syncReadout();
  }
  receiveWorld(snapshot: WorldSnapshot): boolean {
    if (!this.avatar) return false;
    const map = this.world.maps[snapshot.self.mapId];
    const validPosition = (position: WorldPosition) => {
      const area = this.world.maps[position.mapId]; return !!area && position.x >= 0 && position.y >= 0 && position.x < area.width && position.y < area.height;
    };
    if (Object.entries(WORLD_MAP_HASHES).some(([id, hash]) => this.world.mapHashes[id] !== hash)
      || !map || map.source.fingerprint !== snapshot.sourceFingerprint || !validPosition(snapshot.self)
      || snapshot.nearby.some(avatar => !validPosition(avatar) || avatar.id === snapshot.self.id)
      || new Set(snapshot.nearby.map(avatar => avatar.id)).size !== snapshot.nearby.length
      || [snapshot.self, ...snapshot.nearby].some(avatar => avatar.motion && (!validPosition(avatar.motion.from) || !validPosition(avatar.motion.to)))
      || (snapshot.transition && (!validPosition(snapshot.transition.from) || !validPosition(snapshot.transition.to) || (snapshot.transition.arrival && !validPosition(snapshot.transition.arrival))))) return false;
    const previous = this.sharedSnapshot;
    if (previous?.self.motion && this.motionKey(previous.self) !== this.motionKey(snapshot.self) && !this.sharedMotionFinished) {
      this.walkingFrames = (this.walkingFrames + Math.round(previous.self.motion.durationMs * 60 / 1000)) % 32;
      this.stepSerial++; this.sharedMotionFinished = true;
    }
    this.sharedSnapshot = snapshot; this.sharedReceivedAt = this.time.now;
    // Publication/network jitter must never rewind an already rendered step.
    // Keep one advancing visual clock for this authenticated connection.
    this.sharedServerBase = Math.max(snapshot.serverTime, this.sharedVisualServerTime);
    if (this.pendingWorldSequence !== undefined && snapshot.lastInputSequence >= this.pendingWorldSequence) this.pendingWorldSequence = undefined;
    Object.assign(this.screen.dataset, { serverMapId: snapshot.self.mapId, serverTileX: String(snapshot.self.x), serverTileY: String(snapshot.self.y), worldReady: 'true' });
    const transferred = !!previous && (previous.zoneGeneration !== snapshot.zoneGeneration || previous.self.mapId !== snapshot.self.mapId);
    if (transferred) {
      this.releaseKeys(); this.pendingWorldSequence = undefined; this.clearRemoteAvatars(); this.sharedMotionKey = '';
      const transfer = snapshot.transition;
      if (transfer && transfer.id !== this.sharedTransitionId && transfer.from.mapId === this.map.id) {
        this.sharedTransitionId = transfer.id; this.cancelAction(); this.moving = false;
        this.position = { ...transfer.from };
        const durationFrames = transfer.durationMs < 200 ? 8 : 16;
        this.transition({ allowed: true, kind: 'transition', via: transfer.via, position: transfer.to,
          direction: transfer.direction, durationFrames, movementMode: durationFrames === 8 ? 'run' : 'walk',
          ...(transfer.arrival ? { arrival: transfer.arrival } : {}) }, this.lastSharedDirection);
      } else { this.cancelAction(); this.moving = false; this.transitioning = false; this.renderMap(snapshot.self); }
    } else if (!previous) {
      this.cancelAction(); this.moving = false; this.transitioning = false; this.direction = snapshot.self.direction; this.renderMap(snapshot.self);
      this.sharedTransitionId = snapshot.transition?.id ?? '';
      this.report('Shared development world · walk with arrows or WASD, hold Shift to run outdoors.');
    }
    if (!this.transitioning) this.syncRemoteAvatars(snapshot.nearby);
    return true;
  }
  sharedWorldError(message: string) {
    this.pendingWorldSequence = undefined; this.releaseKeys(); this.nextStep = this.time.now + 150; this.report(message);
  }
  sharedWorldBusy() {
    this.pendingWorldSequence = undefined; this.nextStep = this.time.now + 150;
    // A room heartbeat may briefly own the command slot. Retain one focused
    // movement intent; focus/menu/transfer release still cancels it normally.
    if (document.activeElement === this.screen && !document.hidden && !this.menuOpen && !this.transitioning) this.pendingDirection ??= this.lastSharedDirection;
  }
  private clearRemoteAvatars() {
    for (const remote of this.remoteAvatars.values()) { remote.sprite.destroy(); remote.name.destroy(); }
    this.remoteAvatars.clear(); this.screen.dataset.nearbyCount = '0';
  }
  private syncRemoteAvatars(avatars: WorldAvatar[]) {
    const visible = avatars.filter(avatar => avatar.mapId === this.map.id);
    const ids = new Set(visible.map(avatar => avatar.id));
    for (const [id, remote] of this.remoteAvatars) if (!ids.has(id)) { remote.sprite.destroy(); remote.name.destroy(); this.remoteAvatars.delete(id); }
    for (const avatar of visible) if (!this.remoteAvatars.has(avatar.id)) {
      this.remoteAvatars.set(avatar.id, {
        sprite: this.add.sprite(avatar.x * 16 + 8, avatar.y * 16 + 16, 'player', 0).setOrigin(0.5, 1),
        name: this.add.text(avatar.x * 16 + 8, avatar.y * 16 - 17, avatar.name, { fontFamily: 'monospace', fontSize: '6px', color: '#ffffff', backgroundColor: '#173045', padding: { x: 2, y: 1 } }).setOrigin(0.5, 1).setDepth(32),
        motionKey: '', stride: 0, durationFrames: 0,
      });
    }
    this.screen.dataset.nearbyCount = String(visible.length);
  }
  private motionKey(avatar: WorldAvatar) { return avatar.motion ? `${avatar.motion.startedAt}:${avatar.motion.to.mapId}:${avatar.motion.to.x}:${avatar.motion.to.y}` : ''; }
  private projectAvatar(avatar: WorldAvatar, serverTime: number, stride: number) {
    const motion = avatar.motion;
    const age = motion ? Math.max(0, serverTime - motion.startedAt) : 0;
    const ratio = motion ? Math.min(1, age / motion.durationMs) : 1;
    const sourceFrames = Math.floor(age * 60 / 1000);
    const x = motion ? motion.from.x + (motion.to.x - motion.from.x) * ratio : avatar.x;
    const y = motion ? motion.from.y + (motion.to.y - motion.from.y) * ratio : avatar.y;
    const jumping = !!motion && motion.kind === 'jump' && ratio < 1;
    const mode = motion?.movementMode ?? 'walk';
    const animation = this.map.player.animations[`${motion && ratio < 1 ? mode : 'idle'}-${avatar.direction}`];
    let elapsed = (stride + sourceFrames) % animation.reduce((sum, frame) => sum + frame.durationFrames, 0);
    let frame = animation[0]!;
    for (const entry of animation) { frame = entry; if (elapsed < entry.durationFrames) break; elapsed -= entry.durationFrames; }
    return { x: Math.round(x * 16 + 8), y: Math.round(y * 16 + 16), jumpY: jumping ? PREVIEW_HIGH_JUMP_Y[Math.min(PREVIEW_HIGH_JUMP_Y.length - 1, Math.floor(sourceFrames / 2))]! : 0,
      frame, finished: ratio === 1, mode, sourceFrames };
  }
  private updateSharedWorld(time: number) {
    if (this.worldState !== 'shared' || !this.sharedSnapshot) return;
    const snapshot = this.sharedSnapshot;
    const serverTime = Math.max(this.sharedVisualServerTime, this.sharedServerBase + Math.max(0, time - this.sharedReceivedAt));
    this.sharedVisualServerTime = serverTime;
    if (this.transitioning) {
      if (this.moving) { const frames = Math.floor((time - this.stepStarted) * 60 / 1000); this.setMovementFrame(frames); }
      return;
    }
    this.syncRemoteAvatars(snapshot.nearby);
    for (const avatar of snapshot.nearby) {
      const remote = this.remoteAvatars.get(avatar.id); if (!remote) continue;
      const key = this.motionKey(avatar);
      if (key && key !== remote.motionKey) {
        remote.stride = (remote.stride + remote.durationFrames) % 32;
        remote.motionKey = key; remote.durationFrames = Math.round(avatar.motion!.durationMs * 60 / 1000);
      }
      const projected = this.projectAvatar(avatar, serverTime, remote.stride);
      remote.sprite.setPosition(projected.x, projected.y + projected.jumpY).setDepth(20 + projected.y / 10000).setFrame(projected.frame.frame).setFlipX(projected.frame.flipX);
      remote.name.setPosition(projected.x, projected.y + projected.jumpY - 32);
    }
    const self = snapshot.self, key = this.motionKey(self);
    if (key && key !== this.sharedMotionKey) { this.sharedMotionKey = key; this.sharedMotionFinished = false; }
    const projected = this.projectAvatar(self, serverTime, this.walkingFrames);
    this.anchor.setPosition(projected.x, projected.y).setDepth(20 + projected.y / 10000);
    this.avatar.setY(projected.jumpY).setVisible(true).setFrame(projected.frame.frame).setFlipX(projected.frame.flipX);
    this.direction = self.direction; this.movementMode = projected.mode; this.moving = !!self.motion && !projected.finished;
    this.position = { ...(self.motion && projected.finished ? self.motion.to : self), mapId: self.mapId };
    if (self.motion) this.screen.dataset.stepDurationFrames = String(Math.round(self.motion.durationMs * 60 / 1000));
    if (self.motion && projected.finished && !this.sharedMotionFinished) {
      this.sharedMotionFinished = true; this.walkingFrames = (this.walkingFrames + Math.round(self.motion.durationMs * 60 / 1000)) % 32; this.stepSerial++;
    }
    this.syncReadout();
    if (this.moving || this.pendingWorldSequence !== undefined || this.menuOpen || this.dialogue || time < this.nextStep) return;
    let direction = this.pendingDirection; this.pendingDirection = undefined;
    if (document.activeElement === this.screen && !document.hidden) {
      const held = [...this.pressed].filter(key => !this.suppressed.has(key)); direction ??= keyDirections[held[held.length - 1] ?? ''];
    } else direction = undefined;
    if (direction) {
      this.direction = direction; this.lastSharedDirection = direction;
      this.pendingWorldSequence = this.sendWorldInput?.(direction, this.runHeld);
      // A blocked tile may acknowledge immediately with no motion. Bound held
      // retries below the room message limit; 8-frame running still takes longer.
      this.nextStep = time + 120;
    }
  }
  private drawDebug() {
    this.grid.clear().setVisible(this.debugEnabled);
    this.map.blocks.forEach((block, index) => {
      const x = (index % this.map.width) * 16, y = Math.floor(index / this.map.width) * 16, ledge = block.behavior >= 56 && block.behavior <= 63;
      if (block.collision || block.behavior === 21 || ledge) this.grid.fillStyle(ledge ? 0xffb35b : block.behavior === 21 ? 0x458ee8 : 0xf06678, 0.28).fillRect(x, y, 16, 16);
      this.grid.lineStyle(1, 0xffffff, 0.15).strokeRect(x, y, 16, 16);
    });
    for (const warp of this.map.events.warps) this.grid.lineStyle(1, warp.destinationAvailable ? 0xffe26a : 0xf06678, 1).strokeRect(warp.x * 16 + 1, warp.y * 16 + 1, 14, 14);
    for (const trigger of this.map.events.triggers) this.grid.lineStyle(1, 0xa485fa, 1).strokeRect(trigger.x * 16 + 1, trigger.y * 16 + 1, 14, 14);
  }
}
