/** Private real-team profile over the selected source-C command kernel.
 * TypeScript admits identities, schedules audited boundaries and projects data;
 * source C owns AI, accuracy, stats, damage, recoil, run and outcome arithmetic. */
import { z } from 'zod';
import type { DevelopmentProfile } from '../../apps/server/src/development-profile';
import { encounterCheckpointSchema, encounterCreatureSchema, type EncounterCore, type EncounterCreature } from '../encounter-core/encounter';
import type { TurnExports } from '../battle-spike/turn-probe';

export const ROUTE1_PROFILE = 'firered-route1-singles-v2' as const;
export const ROUTE1_SOURCE = 'f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982';
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const word = z.number().int().min(0).max(0xFFFFFFFF);
const actorSchema = z.union([z.literal(0), z.literal(1)]);
export const route1InventorySchema = z.strictObject({ potion: count.max(5), pokeBall: count.max(5) });
export type Route1Inventory = z.infer<typeof route1InventorySchema>;
export const route1ChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), slot: z.number().int().min(0).max(3) }),
  z.strictObject({ kind: z.literal('struggle') }), z.strictObject({ kind: z.literal('run') }),
  z.strictObject({ kind: z.literal('item'), itemId: z.union([z.literal(13), z.literal(4)]) }),
]);
export type Route1Choice = z.infer<typeof route1ChoiceSchema>;
export const route1InitialSchema = z.strictObject({ encounter: encounterCheckpointSchema, inventory: route1InventorySchema,
  player: z.strictObject({ hp: count.min(1).max(65535), pp: z.tuple([count.max(35), count.max(30)]) }) });
export type Route1Initial = z.infer<typeof route1InitialSchema>;
const outcomeSchema = z.enum(['won', 'lost', 'draw', 'ran', 'captured']);
export const route1CaptureSchema = z.strictObject({ kind: z.literal('pending-disposition'), ballItemId: z.literal(4),
  creature: encounterCreatureSchema.extend({ evs: z.strictObject({ hp: z.literal(0), attack: z.literal(0), defense: z.literal(0),
    speed: z.literal(0), spAttack: z.literal(0), spDefense: z.literal(0) }) }).strict() });
export type Route1Capture = z.infer<typeof route1CaptureSchema>;
const sourceEventSchema = z.strictObject({ type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(7)]),
  battler: actorSchema, value: word });
const attackSchema = z.strictObject({ baseDamage: count, afterCritical: count, afterType: count, damage: count,
  flags: word, hpDealt: count, targetHP: count, critical: z.union([z.literal(1), z.literal(2)]) });
export const route1EventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('order'), phase: z.enum(['actions', 'residual']), actors: z.array(actorSchema).length(2) }),
  z.strictObject({ kind: z.literal('attack'), actor: actorSchema, slot: count.max(4), moveId: word, result: attackSchema,
    commands: z.array(sourceEventSchema).max(32) }),
  z.strictObject({ kind: z.literal('run'), escaped: z.boolean(), attempts: count.max(255) }),
  z.strictObject({ kind: z.literal('potion'), itemId: z.literal(13), restoredHp: count.max(65535), remaining: count.max(5) }),
  z.strictObject({ kind: z.literal('capture'), itemId: z.literal(4), shakes: count.max(4), caught: z.boolean(), remaining: count.max(5) }),
  z.strictObject({ kind: z.literal('faint'), actor: actorSchema, commands: z.array(sourceEventSchema).max(32) }),
  z.strictObject({ kind: z.literal('outcome'), outcome: outcomeSchema }),
]);
export type Route1Event = z.infer<typeof route1EventSchema>;
export const route1PresentationSchema = z.strictObject({
  turn: count.min(1), phase: z.enum(['choice', 'ended']), needsChoice: z.boolean(), outcome: outcomeSchema.nullable(),
  self: z.strictObject({ speciesId: z.literal(7), level: z.literal(5), hp: count.max(65535), maxHP: count.max(65535), status: z.literal(0),
    stages: z.array(count.max(12)).length(8), moves: z.array(z.strictObject({ slot: count.max(3), moveId: word, pp: count.max(35) })).length(2) }),
  opponent: z.strictObject({ speciesId: z.union([z.literal(16), z.literal(19)]), level: count.min(2).max(5), hpPercent: count.max(100), status: z.literal(0) }),
  inventory: route1InventorySchema,
  capture: z.strictObject({ speciesId: z.union([z.literal(16), z.literal(19)]), level: count.min(2).max(5), pendingDisposition: z.literal(true) }).nullable(),
  availableChoices: z.array(route1ChoiceSchema).max(5),
});
export type Route1Presentation = z.infer<typeof route1PresentationSchema>;
export const route1CheckpointSchema = z.strictObject({
  schemaVersion: z.literal(2), profile: z.literal(ROUTE1_PROFILE), sourceFingerprint: z.literal(ROUTE1_SOURCE),
  admission: route1InitialSchema,
  host: z.strictObject({ sequence: count, eventSequence: count, turn: count.min(1), phase: z.enum(['choice', 'ended']),
    outcome: outcomeSchema.nullable(), wildSlot: count.max(4), inventory: route1InventorySchema }),
  capture: route1CaptureSchema.nullable(),
  core: z.strictObject({ version: z.literal(3), boundary: z.union([z.literal(0), z.literal(3)]), words: z.array(word).length(152) }),
  rng: z.strictObject({ state: word, draws: count.min(1) }),
});
export type Route1Checkpoint = z.infer<typeof route1CheckpointSchema>;
type Actor = 0 | 1;
type Host = Route1Checkpoint['host'];
export interface Route1Exports extends TurnExports {
  route1_set_identity(actor: number, species: number, ability: number): number;
  route1_start(): number;
  route1_choose_wild(): number;
  route1_order(playerSlot: number, wildSlot: number, run: number): number;
  route1_run(actor: number): number;
  route1_get(field: number): number;
  route1_item(itemId: number): number;
  route1_item_get(field: number): number;
}
export interface Route1Resources { profile: DevelopmentProfile; encounters: EncounterCore }
interface AdmittedMon {
  speciesId: number; abilityId: number; level: number; hp: number;
  stats: DevelopmentProfile['creature']['stats']; types: [number, number];
  moves: { moveId: number; pp: number }[];
}
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(status: number, action: string): void { require(status === 0, `Route 1 C rejected ${action}: ${status}`); }
function checked(value: number, action: string): number { require(value >= 0, `Route 1 C rejected ${action}: ${value}`); return value; }
export function instantiateRoute1(module: WebAssembly.Module): Route1Exports {
  require(WebAssembly.Module.imports(module).length === 0, 'Route 1 WASM must have no imports');
  const api = new WebAssembly.Instance(module).exports as unknown as Route1Exports;
  require(api.spike_abi_version() === 1 && api.spike3_checkpoint_version() === 3 && api.spike3_checkpoint_word_count() === 152
    && api.memory.buffer.byteLength === 262144 && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported Route 1 ABI');
  return api;
}
function admit(resources: Route1Resources, initial: Route1Initial): [AdmittedMon, AdmittedMon] {
  const { profile } = resources;
  require(profile.id === 'r1-squirtle-v1' && profile.sourceFingerprint === ROUTE1_SOURCE, 'Unsupported player fixture');
  const pending = resources.encounters.restore(initial.encounter).view();
  require(pending.phase === 'pending-encounter' && pending.creature, 'An actual pending encounter is required');
  const wild: EncounterCreature = pending.creature;
  const player = profile.creature;
  require(pending.trainerId === player.otId && wild.otId === player.otId, 'Encounter trainer differs from the selected fixture trainer');
  require(player.speciesId === 7 && player.level === 5 && player.moves.length === 2 && player.moves[0]?.moveId === 33
    && player.moves[1]?.moveId === 39 && player.abilityId === 67 && player.status === 'healthy'
    && Object.values(player.evs).every(value => value === 0), 'Player fixture is outside the audited real-team profile');
  require(initial.player.hp <= player.stats.hp && initial.player.pp.every((pp, i) => pp <= player.moves[i]!.pp), 'Depleted player HP/PP exceeds its source baseline');
  require(initial.inventory.potion <= (profile.inventory.find(item => item.itemId === 13)?.quantity ?? 0)
    && initial.inventory.pokeBall <= (profile.inventory.find(item => item.itemId === 4)?.quantity ?? 0), 'Inventory exceeds the selected fixture');
  const types = (speciesId: number): [number, number] => {
    const species = profile.definitions.species.find(row => row.id === speciesId);
    require(species && species.types.length === 2, 'Missing admitted species type definition');
    return [species.types[0]!.id, species.types[1]!.id];
  };
  return [{ speciesId: 7, abilityId: player.abilityId, level: player.level, hp: initial.player.hp, stats: player.stats,
    types: types(7), moves: player.moves.map((move, index) => ({ moveId: move.moveId, pp: initial.player.pp[index]! })) },
  { speciesId: wild.speciesId, abilityId: wild.abilityId, level: wild.level, hp: wild.hp, stats: wild.stats,
    types: types(wild.speciesId), moves: wild.moves.filter(move => move.moveId !== 0).map(move => ({ moveId: move.moveId, pp: move.pp })) }];
}
function configure(api: Route1Exports, actor: Actor, mon: AdmittedMon): void {
  ok(api.spike_set_battler(actor, mon.level, mon.hp, mon.stats.hp, mon.stats.attack, mon.stats.defense, mon.stats.spAttack,
    mon.stats.spDefense, mon.types[0], mon.types[1], 0, 0), 'real battler');
  ok(api.route1_set_identity(actor, mon.speciesId, mon.abilityId), 'real identity');
  ok(api.spike2_set_speed(actor, mon.stats.speed), 'speed');
  for (let slot = 0; slot < 4; slot++) ok(api.spike2_set_move(actor, slot, mon.moves[slot]?.moveId ?? 0, mon.moves[slot]?.pp ?? 0), 'legal move/PP');
}
function draws(api: Route1Exports): number {
  const value = BigInt(api.spike3_get_rng_draws(0) >>> 0) | BigInt(api.spike3_get_rng_draws(1) >>> 0) << 32n;
  require(value <= BigInt(Number.MAX_SAFE_INTEGER), 'Battle RNG count exhausted');
  return Number(value);
}
function coreWords(api: Route1Exports, boundary: 0 | 3): number[] {
  ok(api.spike3_checkpoint_export(boundary), 'checkpoint export');
  return Array.from({ length: 152 }, (_, index) => api.spike3_checkpoint_get(index) >>> 0);
}
function commands(api: Route1Exports): z.infer<typeof sourceEventSchema>[] {
  ok(api.spike_get_result(0), 'source command');
  const size = checked(api.spike_get_result(11), 'event count');
  require(size <= 32, 'Source event limit exceeded');
  return Array.from({ length: size }, (_, index) => sourceEventSchema.parse({ type: api.spike_get_event(index, 0),
    battler: api.spike_get_event(index, 1), value: api.spike_get_event(index, 2) >>> 0 }));
}
const ordered = (raw: number): Actor[] => { require(raw === 0 || raw === 1 || raw === 2, 'Unsupported source action order'); return raw === 0 ? [0, 1] : [1, 0]; };
function captureAt(resources: Route1Resources, initial: Route1Initial, words: number[]): Route1Capture {
  const creature = resources.encounters.restore(initial.encounter).view().creature;
  require(creature, 'Captured encounter identity is missing');
  return route1CaptureSchema.parse({ kind: 'pending-disposition', ballItemId: 4,
    creature: { ...creature, hp: words[65], moves: creature.moves.map((move, slot) => ({ ...move, pp: words[90 + slot] })),
      evs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 } } });
}
function validateCheckpoint(checkpoint: Route1Checkpoint, mons: [AdmittedMon, AdmittedMon], resources: Route1Resources): void {
  const { host, core, rng } = checkpoint, w = core.words;
  const boundary = host.phase === 'choice' ? 0 : 3;
  require(core.boundary === boundary && w[3] === boundary && w[0] === 0x57424350 && w[1] === 3 && w[2] === 152, 'Checkpoint header or phase differs');
  require(w[4] === rng.state && BigInt(w[5]!) + (BigInt(w[6]!) << 32n) === BigInt(rng.draws)
    && w[14] === checkpoint.admission.encounter.words[1] && w[149] === 1, 'Checkpoint RNG admission or introduction differs');
  require(host.turn === host.sequence + (host.phase === 'choice' ? 1 : 0) && host.eventSequence >= host.sequence
    && (host.sequence !== 0 || (host.eventSequence === 0 && host.turn === 1 && host.phase === 'choice')), 'Checkpoint counters differ');
  const outcome = host.outcome === null ? 0 : { won: 1, lost: 2, draw: 3, ran: 4, captured: 7 }[host.outcome];
  require(w[8] === outcome && ((host.phase === 'choice') === (host.outcome === null)), 'Checkpoint outcome differs');
  require(host.inventory.potion <= checkpoint.admission.inventory.potion && host.inventory.pokeBall <= checkpoint.admission.inventory.pokeBall,
    'Checkpoint replenished spent inventory');
  const itemUses = checkpoint.admission.inventory.potion - host.inventory.potion
    + checkpoint.admission.inventory.pokeBall - host.inventory.pokeBall;
  require(itemUses <= host.sequence, 'Checkpoint consumed more items than completed player actions');
  if (host.outcome === 'captured') {
    require(w[17]! > 0 && w[65]! > 0, 'Captured outcome requires both combatants to be alive');
    require(host.inventory.pokeBall < checkpoint.admission.inventory.pokeBall, 'Captured outcome did not consume a ball');
    require(JSON.stringify(checkpoint.capture) === JSON.stringify(captureAt(resources, checkpoint.admission, w)), 'Capture handoff differs from the admitted creature and current battle state');
  } else require(checkpoint.capture === null, 'Capture handoff exists without a captured outcome');
  for (const actor of [0, 1] as const) {
    const mon = mons[actor], row = w.slice(16 + actor * 48, 64 + actor * 48);
    const fixed = [mon.level, null, mon.stats.hp, mon.stats.attack, mon.stats.defense, mon.stats.spAttack, mon.stats.spDefense,
      mon.stats.speed, ...mon.types, 0, 0, ...mon.types];
    // The sole fixture's maximum HP is covered by one Potion. No source healing
    // arithmetic is repeated here: a spent Potion merely permits the canonical
    // maximum bound; without one, restoration cannot invent healed admission HP.
    const hpBound = actor === 0 && host.inventory.potion < checkpoint.admission.inventory.potion ? mon.stats.hp : mon.hp;
    require(fixed.every((value, index) => value === null || value === row[index]) && row[30] === mon.speciesId
      && row[31] === mon.abilityId && row[1]! <= hpBound, 'Checkpoint changed admitted identity, stats or health bounds');
    for (let slot = 0; slot < 4; slot++) require(row[22 + slot] === (mon.moves[slot]?.moveId ?? 0)
      && row[26 + slot]! <= (mon.moves[slot]?.pp ?? 0), 'Checkpoint changed legal moves or restored spent PP');
    for (let stat = 0; stat < 8; stat++) require(row[14 + stat]! <= 6
      && ([2, 6].includes(stat) || row[14 + stat] === 6), 'Unsupported stat stage in real-team profile');
    for (let slot = 0; slot < 6; slot++) {
      const party = 112 + actor * 18 + slot * 3;
      require(w[party] === (slot === 0 ? mon.speciesId : 0) && w[party + 1] === (slot === 0 ? row[1] : 0)
        && w[party + 2] === 0, 'Checkpoint party projection differs from the admitted one-member team');
    }
  }
  const wild = w.slice(64, 112), pp = wild.slice(26, 30);
  if (host.phase === 'choice') require(host.wildSlot === 4 ? pp.every(value => value === 0)
    : wild[22 + host.wildSlot] !== 0 && pp[host.wildSlot]! > 0, 'Pending wild choice is not legal');
}

export class Route1Driver {
  private api: Route1Exports;
  private host: Host;
  private initial: Route1Initial;
  private mons: [AdmittedMon, AdmittedMon];
  constructor(private readonly module: WebAssembly.Module, private readonly resources: Route1Resources, input: unknown, restore = false) {
    this.api = instantiateRoute1(module);
    if (restore) {
      const checkpoint = route1CheckpointSchema.parse(input);
      this.initial = checkpoint.admission; this.host = checkpoint.host; this.mons = admit(resources, this.initial);
      validateCheckpoint(checkpoint, this.mons, resources);
      ok(this.api.spike3_import_begin(3, checkpoint.core.boundary, 152), 'restore begin');
      checkpoint.core.words.forEach((value, index) => ok(this.api.spike3_import_set(index, value), 'restore word'));
      ok(this.api.spike3_import_commit(), 'restore semantics');
      return;
    }
    this.initial = route1InitialSchema.parse(input); this.mons = admit(resources, this.initial);
    ok(this.api.spike_reset(this.initial.encounter.words[1]!), 'factory RNG anchor');
    for (const actor of [0, 1] as const) configure(this.api, actor, this.mons[actor]);
    this.syncParty();
    ok(this.api.route1_start(), 'mechanical introduction');
    this.host = { sequence: 0, eventSequence: 0, turn: 1, phase: 'choice', outcome: null, wildSlot: this.chooseWild(), inventory: { ...this.initial.inventory } };
    this.snapshot();
  }
  static restore(module: WebAssembly.Module, resources: Route1Resources, checkpoint: unknown): Route1Driver {
    return new Route1Driver(module, resources, checkpoint, true);
  }
  snapshot(): Route1Checkpoint {
    const boundary = this.host.phase === 'choice' ? 0 : 3;
    const words = coreWords(this.api, boundary);
    const checkpoint = route1CheckpointSchema.parse({ schemaVersion: 2, profile: ROUTE1_PROFILE, sourceFingerprint: ROUTE1_SOURCE,
      admission: this.initial, host: this.host, core: { version: 3, boundary, words },
      capture: this.host.outcome === 'captured' ? captureAt(this.resources, this.initial, words) : null,
      rng: { state: this.api.spike_get_rng() >>> 0, draws: draws(this.api) } });
    validateCheckpoint(checkpoint, this.mons, this.resources); return checkpoint;
  }
  requiredActors(): number[] { return this.host.phase === 'choice' ? [0] : []; }
  validateChoice(actor: number, input: unknown): Route1Choice {
    require(actor === 0 && this.host.phase === 'choice', 'Actor has no pending choice');
    const choice = route1ChoiceSchema.parse(input);
    const pp = Array.from({ length: 4 }, (_, slot) => this.api.spike2_get_move(0, slot, 1));
    if (choice.kind === 'struggle') require(pp.every(value => value === 0), 'Struggle is automatic only when all moves are unusable');
    if (choice.kind === 'move') require(Boolean(this.mons[0].moves[choice.slot]) && pp[choice.slot]! > 0, 'Move has no usable PP');
    if (choice.kind === 'item') {
      if (choice.itemId === 13) require(this.host.inventory.potion > 0 && this.api.spike_get_battler(0, 0) > 0
        && this.api.spike_get_battler(0, 0) < this.mons[0].stats.hp, 'Potion has no legal effect or none remains');
      else require(this.host.inventory.pokeBall > 0 && this.api.spike_get_battler(1, 0) > 0, 'No legal ball throw remains');
    }
    return choice;
  }
  advanceChoices(input: { actor: number; choice: Route1Choice }[]): Route1Event[] {
    require(input.length === 1 && input[0]?.actor === 0, 'Exactly one player choice is required');
    const choice = this.validateChoice(0, input[0].choice);
    const candidate = Route1Driver.restore(this.module, this.resources, this.snapshot());
    const events = candidate.execute(choice);
    candidate.host.sequence++; candidate.host.eventSequence += events.length;
    candidate.snapshot(); // Validation/counter exhaustion happens before publication.
    this.api = candidate.api; this.host = candidate.host;
    return events;
  }
  project(actor: number): Route1Presentation {
    require(actor === 0, 'Only the player can view this private PvE profile');
    const w = this.snapshot().core.words, own = w.slice(16, 64), wild = w.slice(64, 112);
    const availableChoices: Route1Choice[] = [];
    if (this.host.phase === 'choice') {
      for (let slot = 0; slot < this.mons[0].moves.length; slot++) {
        if (own[26 + slot]! > 0) availableChoices.push({ kind: 'move', slot });
      }
      if (availableChoices.length === 0) availableChoices.push({ kind: 'struggle' });
      availableChoices.push({ kind: 'run' });
      if (this.host.inventory.potion > 0 && own[1]! < own[2]!) availableChoices.push({ kind: 'item', itemId: 13 });
      if (this.host.inventory.pokeBall > 0) availableChoices.push({ kind: 'item', itemId: 4 });
    }
    return route1PresentationSchema.parse({ turn: this.host.turn, phase: this.host.phase, outcome: this.host.outcome,
      needsChoice: this.host.phase === 'choice', self: { speciesId: 7, level: 5, hp: own[1], maxHP: own[2], status: 0,
        stages: own.slice(14, 22), moves: this.mons[0].moves.map((move, slot) => ({ slot, moveId: move.moveId, pp: own[26 + slot] })) },
      opponent: { speciesId: this.mons[1].speciesId, level: this.mons[1].level, hpPercent: Math.ceil(wild[1]! * 100 / wild[2]!), status: 0 },
      inventory: this.host.inventory, capture: this.host.outcome === 'captured'
        ? { speciesId: this.mons[1].speciesId, level: this.mons[1].level, pendingDisposition: true } : null, availableChoices });
  }
  private chooseWild(): number { const slot = checked(this.api.route1_choose_wild(), 'wild AI'); require(slot <= 4, 'Unsupported wild choice'); return slot; }
  private syncParty(): void {
    for (const actor of [0, 1] as const) for (let slot = 0; slot < 6; slot++) ok(this.api.spike2_set_party(actor, slot,
      slot === 0 ? this.mons[actor].speciesId : 0, slot === 0 ? this.api.spike_get_battler(actor, 0) : 0, 0), 'real party projection');
  }
  private finish(outcome: Host['outcome'], events: Route1Event[]): void {
    require(outcome !== null, 'Missing terminal outcome'); this.host.phase = 'ended'; this.host.outcome = outcome;
    events.push({ kind: 'outcome', outcome });
  }
  private execute(choice: Route1Choice): Route1Event[] {
    const events: Route1Event[] = [], api = this.api;
    const playerSlot = choice.kind === 'move' ? choice.slot : 4;
    const order = ordered(api.route1_order(playerSlot, this.host.wildSlot, choice.kind === 'run' ? 1 : choice.kind === 'item' ? 2 : 0));
    ok(api.spike_get_result(0), 'action order'); events.push({ kind: 'order', phase: 'actions', actors: order });
    for (const actor of order) {
      if (actor === 0 && choice.kind === 'item') {
        // The source capture outcome is terminal. Set the exact settled party
        // projection first; no party setter is legal after successful capture.
        this.syncParty();
        ok(api.route1_item(choice.itemId), 'source item');
        require(api.route1_item_get(0) === choice.itemId, 'Source item diagnostic differs from the selected item');
        if (choice.itemId === 13) {
          this.host.inventory.potion--;
          const restoredHp = checked(api.route1_item_get(1), 'restored HP');
          require(restoredHp > 0, 'Accepted Potion did not restore HP');
          events.push({ kind: 'potion', itemId: 13, restoredHp, remaining: this.host.inventory.potion });
          this.syncParty();
        } else {
          this.host.inventory.pokeBall--;
          const caught = checked(api.route1_item_get(5), 'capture result');
          require(caught === 0 || caught === 1, 'Unsupported capture result');
          events.push(route1EventSchema.parse({ kind: 'capture', itemId: 4, shakes: checked(api.route1_item_get(4), 'ball shakes'),
            caught: caught === 1, remaining: this.host.inventory.pokeBall }));
          if (caught) { this.finish('captured', events); return events; }
        }
        continue;
      }
      if (actor === 0 && choice.kind === 'run') {
        const escaped = checked(api.route1_run(0), 'run'); require(escaped <= 1, 'Unsupported run result');
        events.push({ kind: 'run', escaped: escaped === 1, attempts: checked(api.route1_get(0), 'run attempts') });
        // Run is first and changes no HP; the settled party projection already
        // matches. C correctly forbids further party writes after its outcome.
        if (escaped) { this.finish('ran', events); return events; }
        continue;
      }
      const slot = actor === 0 ? playerSlot : this.host.wildSlot;
      const moveId = slot === 4 ? 165 : this.mons[actor].moves[slot]!.moveId;
      ok(api.spike2_attack(actor, slot), 'source attack');
      events.push(route1EventSchema.parse({ kind: 'attack', actor, slot, moveId,
        result: { baseDamage: api.spike_get_result(1), afterCritical: api.spike_get_result(2), afterType: api.spike_get_result(3),
          damage: api.spike_get_result(4), flags: api.spike_get_result(5), hpDealt: api.spike_get_result(6),
          targetHP: api.spike_get_result(7), critical: api.spike_get_result(12) }, commands: commands(api) }));
      // Source Struggle applies attacker recoil/faint before the target's faint.
      for (const fainted of [actor, actor === 0 ? 1 : 0] as Actor[]) {
        if (api.spike_get_battler(fainted, 0) === 0) {
          ok(api.spike2_faint_cleanup(fainted), 'faint cleanup'); events.push({ kind: 'faint', actor: fainted, commands: commands(api) });
        }
      }
      this.syncParty(); ok(api.spike2_check_teams_lost(), 'source party outcome');
      const outcome = api.spike2_get_outcome();
      if (outcome) { require(outcome >= 1 && outcome <= 3, 'Unsupported terminal outcome'); this.finish(({ 1: 'won', 2: 'lost', 3: 'draw' } as const)[outcome as 1 | 2 | 3], events); return events; }
    }
    const residualOrder = ordered(api.spike2_residual_order()); ok(api.spike_get_result(0), 'residual order');
    events.push({ kind: 'order', phase: 'residual', actors: residualOrder });
    // No admitted move can create major/volatile status or a residual effect.
    this.host.turn++; ok(api.spike2_begin_turn(), 'next turn'); this.host.wildSlot = this.chooseWild();
    return events;
  }
}
