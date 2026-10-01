/** Audited scheduling over source C; no live admission or owned mutations. */
import { z } from 'zod';
import type { TurnExports } from '../battle-spike/turn-probe';
import { FAMILY_PROFILE, FAMILY_SOURCE, familyInitialSchema, familyContextSchema, familyCreatureWords, prepareFamily,
  type FamilyInitial, type FamilyResources, type PreparedFamily } from './admission';
export { FAMILY_PROFILE, FAMILY_SOURCE, FAMILY_MOVES, familyInitialSchema, familyCreatureSchema, familyDiagnosticSchema,
  familyResultSchema, createFamilyDiagnostic, createFamilyDiagnosticFromResult, loadFamilyResources } from './admission';
export type { FamilyInitial, FamilyCreature, FamilyDiagnostic, FamilyResult, FamilyResources } from './admission';

export const FAMILY_CHECKPOINT_WORDS = 154;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const actorSchema = z.union([z.literal(0), z.literal(1)]);
const statusSchema = z.union([z.literal(0), z.literal(8), z.literal(16)]);
const outcomeSchema = z.enum(['won', 'lost', 'draw', 'ran']);
export const familyChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), slot: word.max(3) }),
  z.strictObject({ kind: z.literal('struggle') }), z.strictObject({ kind: z.literal('run') }),
]);
export type FamilyChoice = z.infer<typeof familyChoiceSchema>;
const sourceEventSchema = z.strictObject({ type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  z.literal(6), z.literal(7), z.literal(8), z.literal(9)]), battler: actorSchema, value: word });
const attackSchema = z.strictObject({ baseDamage: counter, afterCritical: counter, afterType: counter, damage: counter,
  flags: word, hpDealt: counter, targetHP: counter, critical: z.union([z.literal(1), z.literal(2)]) });
export const familyEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('order'), phase: z.enum(['actions', 'residual']), actors: z.array(actorSchema).length(2) }),
  z.strictObject({ kind: z.literal('attack'), actor: actorSchema, slot: word.max(4), moveId: word,
    result: attackSchema, commands: z.array(sourceEventSchema).max(32) }),
  z.strictObject({ kind: z.literal('run'), escaped: z.boolean(), attempts: word.max(255) }),
  z.strictObject({ kind: z.literal('residual'), actor: actorSchema, status: statusSchema, commands: z.array(sourceEventSchema).max(32) }),
  z.strictObject({ kind: z.literal('faint'), actor: actorSchema, commands: z.array(sourceEventSchema).max(32) }),
  z.strictObject({ kind: z.literal('outcome'), outcome: outcomeSchema }),
]);
export type FamilyEvent = z.infer<typeof familyEventSchema>;
export const familyPresentationSchema = z.strictObject({ turn: counter.min(1), phase: z.enum(['choice', 'ended']),
  needsChoice: z.boolean(), outcome: outcomeSchema.nullable(),
  self: z.strictObject({ speciesId: word, abilityId: word, level: word.min(1).max(100), hp: word.max(65535), maxHP: word.max(65535),
    status: statusSchema, focusEnergy: z.boolean(), stages: z.array(word.max(12)).length(8),
    moves: z.array(z.strictObject({ slot: word.max(3), moveId: word, pp: word.max(255), maxPP: word.max(255), ppUps: word.max(3) })).max(4) }),
  opponent: z.strictObject({ speciesId: word, level: word.min(1).max(100), hpPercent: word.max(100), status: statusSchema }),
  inventory: familyContextSchema.shape.inventory, availableChoices: z.array(familyChoiceSchema).max(5), liveAdmission: z.literal(false),
});
export type FamilyPresentation = z.infer<typeof familyPresentationSchema>;
export const familyCheckpointSchema = z.strictObject({ schemaVersion: z.literal(1), profile: z.literal(FAMILY_PROFILE),
  sourceFingerprint: z.literal(FAMILY_SOURCE), admission: familyInitialSchema, context: familyContextSchema,
  host: z.strictObject({ sequence: counter, eventSequence: counter, turn: counter.min(1), phase: z.enum(['choice', 'ended']),
    outcome: outcomeSchema.nullable(), wildSlot: word.max(4) }),
  core: z.strictObject({ version: z.literal(4), boundary: z.union([z.literal(0), z.literal(3)]), words: z.array(word).length(FAMILY_CHECKPOINT_WORDS) }),
  rng: z.strictObject({ state: word, draws: counter.min(1) }),
});
export type FamilyCheckpoint = z.infer<typeof familyCheckpointSchema>;
type Actor = 0 | 1;
type Host = FamilyCheckpoint['host'];
interface SourceMon { types: [number, number]; maxPP: number[] }
export interface FamilyExports extends TurnExports {
  family_input_word_count(): number;
  family_input_begin(actor: number): number;
  family_input_set(actor: number, index: number, value: number): number;
  family_input_commit(actor: number): number;
  family_mon_get(actor: number, field: number): number;
  family_start(): number;
  family_choose_wild(): number;
  family_order(playerSlot: number, wildSlot: number, actionKind: number): number;
  family_run(actor: number): number;
  family_get(field: number): number;
}
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(value: number, action: string): void { require(value === 0, `Family source rejected ${action}: ${value}`); }
function checked(value: number, action: string): number { require(value >= 0, `Family source rejected ${action}: ${value}`); return value; }
export function instantiateFamily(module: WebAssembly.Module): FamilyExports {
  require(WebAssembly.Module.imports(module).length === 0, 'Family module cannot import host services');
  const api = new WebAssembly.Instance(module).exports as unknown as FamilyExports;
  require(api.spike_abi_version() === 1 && api.spike3_checkpoint_version() === 4
    && api.spike3_checkpoint_word_count() === FAMILY_CHECKPOINT_WORDS && api.family_input_word_count() === 46
    && api.memory.buffer.byteLength === 262144 && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported family ABI or memory');
  return api;
}
function configure(api: FamilyExports, prepared: PreparedFamily): [SourceMon, SourceMon] {
  ok(api.spike_reset(prepared.seed), 'RNG anchor');
  return ([0, 1] as const).map(actor => {
    const mon = prepared.mons[actor];
    ok(api.family_input_begin(actor), 'creature admission begin');
    familyCreatureWords(mon).forEach((value, index) => ok(api.family_input_set(actor, index, value), 'creature admission word'));
    ok(api.family_input_commit(actor), 'source creature admission');
    require(api.family_mon_get(actor, 0) === mon.abilityId, 'Ability differs from the source species/slot');
    return { types: [api.family_mon_get(actor, 3), api.family_mon_get(actor, 4)] as [number, number],
      maxPP: Array.from({ length: 4 }, (_, slot) => api.family_mon_get(actor, 5 + slot)) };
  }) as [SourceMon, SourceMon];
}
function draws(api: FamilyExports): number {
  const value = BigInt(api.spike3_get_rng_draws(0) >>> 0) | BigInt(api.spike3_get_rng_draws(1) >>> 0) << 32n;
  require(value <= BigInt(Number.MAX_SAFE_INTEGER), 'Family RNG count exhausted'); return Number(value);
}
function words(api: FamilyExports, boundary: 0 | 3): number[] {
  ok(api.spike3_checkpoint_export(boundary), 'checkpoint export');
  return Array.from({ length: FAMILY_CHECKPOINT_WORDS }, (_, index) => api.spike3_checkpoint_get(index) >>> 0);
}
function commands(api: FamilyExports): z.infer<typeof sourceEventSchema>[] {
  ok(api.spike_get_result(0), 'source command');
  const size = checked(api.spike_get_result(11), 'event count'); require(size <= 32, 'Source event bound exceeded');
  return Array.from({ length: size }, (_, i) => sourceEventSchema.parse({ type: api.spike_get_event(i, 0),
    battler: api.spike_get_event(i, 1), value: api.spike_get_event(i, 2) >>> 0 }));
}
function ordered(raw: number): Actor[] {
  require(raw === 0 || raw === 1 || raw === 2, 'Unsupported source order'); return raw === 0 ? [0, 1] : [1, 0];
}
function validateCheckpoint(checkpoint: FamilyCheckpoint, prepared: PreparedFamily, source: [SourceMon, SourceMon]): void {
  const { host, core, rng } = checkpoint, w = core.words, boundary = host.phase === 'choice' ? 0 : 3;
  require(core.boundary === boundary && w[3] === boundary && w[0] === 0x57424350 && w[1] === 4 && w[2] === FAMILY_CHECKPOINT_WORDS,
    'Checkpoint header or boundary differs');
  require(w[4] === rng.state && BigInt(w[5]!) + (BigInt(w[6]!) << 32n) === BigInt(rng.draws)
    && w[14] === prepared.seed && w[149] === 1 && w[150] === 0 && w[151] === 0, 'Checkpoint RNG, intro or unavailable item state differs');
  require(JSON.stringify(checkpoint.context) === JSON.stringify(prepared.context), 'Result provenance or retained bag differs');
  require(host.turn === host.sequence + (host.phase === 'choice' ? 1 : 0) && host.eventSequence >= host.sequence
    && (host.sequence !== 0 || (host.eventSequence === 0 && host.turn === 1 && host.phase === 'choice')), 'Checkpoint counters differ');
  const outcome = host.outcome === null ? 0 : { won: 1, lost: 2, draw: 3, ran: 4 }[host.outcome];
  require(w[8] === outcome && ((host.phase === 'choice') === (host.outcome === null)), 'Checkpoint outcome differs');
  for (const actor of [0, 1] as const) {
    const mon = prepared.mons[actor], row = w.slice(16 + actor * 48, 64 + actor * 48), types = source[actor].types;
    const fixed = [mon.level, null, mon.stats.hp, mon.stats.attack, mon.stats.defense, mon.stats.spAttack, mon.stats.spDefense,
      mon.stats.speed, ...types, null, null, ...types];
    require(fixed.every((value, index) => value === null || value === row[index]) && row[30] === mon.speciesId
      && row[31] === mon.abilityId && row[1]! <= mon.hp, 'Checkpoint changed creature identity, stats or health');
    require(row[10] === (row[1] === 0 ? 0 : mon.status), 'Checkpoint changed admitted major status');
    require(row[11] === 0 || (row[11] === 0x100000 && mon.moves.some(move => move.moveId === 116) && row[1]! > 0),
      'Checkpoint retains unsupported volatile state');
    const bonuses = mon.moves.reduce((bits, move, slot) => bits | move.ppUps << (slot * 2), 0);
    require(w[152 + actor] === bonuses, 'Checkpoint changed PP bonuses');
    for (let slot = 0; slot < 4; slot++) require(row[22 + slot] === mon.moves[slot]!.moveId
      && row[26 + slot]! <= mon.moves[slot]!.pp, 'Checkpoint changed moves or replenished PP');
    for (let stat = 0; stat < 8; stat++) {
      const stage = row[14 + stat]!;
      require(stage >= 0 && stage <= 12 && (![0, 4, 5, 7].includes(stat) || stage === 6)
        && (![1, 6].includes(stat) || stage <= 6), 'Checkpoint contains unsupported stat changes');
      if (row[1] === 0) require(stage === 6, 'Faint stage cleanup is missing');
    }
    for (let slot = 0; slot < 6; slot++) {
      const index = 112 + actor * 18 + slot * 3;
      require(w[index] === (slot === 0 ? mon.speciesId : 0) && w[index + 1] === (slot === 0 ? row[1] : 0)
        && w[index + 2] === 0, 'Checkpoint no longer has the admitted single active party');
    }
    if (host.sequence === 0) require(row[1] === mon.hp && row[11] === 0 && row.slice(14, 22).every(value => value === 6)
      && mon.moves.every((move, slot) => row[26 + slot] === move.pp), 'Initial checkpoint already spent creature state');
  }
  const wild = w.slice(64, 112), pp = wild.slice(26, 30);
  if (host.phase === 'choice') require(host.wildSlot === 4 ? pp.every(value => value === 0)
    : wild[22 + host.wildSlot] !== 0 && pp[host.wildSlot]! > 0, 'Pending source wild choice is unavailable');
}

export class FamilyDriver {
  private api: FamilyExports;
  private initial: FamilyInitial;
  private prepared: PreparedFamily;
  private source: [SourceMon, SourceMon];
  private host: Host;
  constructor(private readonly module: WebAssembly.Module, private readonly resources: FamilyResources, input: unknown, restore = false) {
    this.api = instantiateFamily(module);
    if (restore) {
      const checkpoint = familyCheckpointSchema.parse(input);
      this.initial = checkpoint.admission; this.prepared = prepareFamily(resources, this.initial);
      this.source = configure(this.api, this.prepared); this.host = checkpoint.host;
      validateCheckpoint(checkpoint, this.prepared, this.source);
      ok(this.api.spike3_import_begin(4, checkpoint.core.boundary, FAMILY_CHECKPOINT_WORDS), 'restore begin');
      checkpoint.core.words.forEach((value, index) => ok(this.api.spike3_import_set(index, value), 'restore word'));
      ok(this.api.spike3_import_commit(), 'source restore semantics');
      return;
    }
    this.initial = familyInitialSchema.parse(input); this.prepared = prepareFamily(resources, this.initial);
    this.source = configure(this.api, this.prepared); this.syncParty();
    ok(this.api.family_start(), 'mechanical introduction');
    this.host = { sequence: 0, eventSequence: 0, turn: 1, phase: 'choice', outcome: null, wildSlot: this.chooseWild() };
    this.snapshot();
  }
  static restore(module: WebAssembly.Module, resources: FamilyResources, checkpoint: unknown): FamilyDriver {
    return new FamilyDriver(module, resources, checkpoint, true);
  }
  snapshot(): FamilyCheckpoint {
    const boundary = this.host.phase === 'choice' ? 0 : 3;
    const checkpoint = familyCheckpointSchema.parse({ schemaVersion: 1, profile: FAMILY_PROFILE, sourceFingerprint: FAMILY_SOURCE,
      admission: this.initial, context: this.prepared.context, host: this.host,
      core: { version: 4, boundary, words: words(this.api, boundary) }, rng: { state: this.api.spike_get_rng() >>> 0, draws: draws(this.api) } });
    validateCheckpoint(checkpoint, this.prepared, this.source); return checkpoint;
  }
  requiredActors(): number[] { return this.host.phase === 'choice' ? [0] : []; }
  validateChoice(actor: number, input: unknown): FamilyChoice {
    require(actor === 0 && this.host.phase === 'choice', 'Actor has no pending choice');
    const choice = familyChoiceSchema.parse(input);
    const pp = Array.from({ length: 4 }, (_, slot) => this.api.spike2_get_move(0, slot, 1));
    if (choice.kind === 'struggle') require(pp.every(value => value === 0), 'Struggle requires all moves to be unusable');
    if (choice.kind === 'move') require(this.prepared.mons[0].moves[choice.slot]!.moveId !== 0 && pp[choice.slot]! > 0, 'Move has no usable PP');
    return choice;
  }
  advanceChoices(input: { actor: number; choice: FamilyChoice }[]): FamilyEvent[] {
    require(input.length === 1 && input[0]?.actor === 0, 'Exactly one player choice is required');
    const choice = this.validateChoice(0, input[0].choice);
    const candidate = FamilyDriver.restore(this.module, this.resources, this.snapshot());
    const events = candidate.execute(choice);
    candidate.host.sequence++; candidate.host.eventSequence += events.length;
    candidate.snapshot(); // Source failures and counter exhaustion publish nothing.
    this.api = candidate.api; this.host = candidate.host;
    return events;
  }
  project(actor: number): FamilyPresentation {
    require(actor === 0, 'Only the player can view this private diagnostic battle');
    const w = this.snapshot().core.words, own = w.slice(16, 64), wild = w.slice(64, 112), mon = this.prepared.mons[0];
    const availableChoices: FamilyChoice[] = [];
    if (this.host.phase === 'choice') {
      mon.moves.forEach((move, slot) => { if (move.moveId !== 0 && own[26 + slot]! > 0) availableChoices.push({ kind: 'move', slot }); });
      if (availableChoices.length === 0) availableChoices.push({ kind: 'struggle' });
      availableChoices.push({ kind: 'run' });
    }
    return familyPresentationSchema.parse({ turn: this.host.turn, phase: this.host.phase, needsChoice: this.host.phase === 'choice', outcome: this.host.outcome,
      self: { speciesId: mon.speciesId, abilityId: mon.abilityId, level: mon.level, hp: own[1], maxHP: own[2], status: own[10],
        focusEnergy: own[11] === 0x100000, stages: own.slice(14, 22), moves: mon.moves.flatMap((move, slot) => move.moveId === 0 ? []
          : [{ slot, moveId: move.moveId, pp: own[26 + slot], maxPP: this.source[0].maxPP[slot], ppUps: move.ppUps }]) },
      opponent: { speciesId: this.prepared.mons[1].speciesId, level: this.prepared.mons[1].level,
        hpPercent: Math.ceil(wild[1]! * 100 / wild[2]!), status: wild[10] },
      inventory: this.prepared.context.inventory, availableChoices, liveAdmission: false });
  }
  private chooseWild(): number { const slot = checked(this.api.family_choose_wild(), 'wild AI'); require(slot <= 4, 'Unsupported wild choice'); return slot; }
  private syncParty(): void {
    for (const actor of [0, 1] as const) for (let slot = 0; slot < 6; slot++) ok(this.api.spike2_set_party(actor, slot,
      slot === 0 ? this.prepared.mons[actor].speciesId : 0, slot === 0 ? this.api.spike_get_battler(actor, 0) : 0, 0), 'single-party projection');
  }
  private finish(outcome: NonNullable<Host['outcome']>, events: FamilyEvent[]): void {
    this.host.phase = 'ended'; this.host.outcome = outcome; events.push({ kind: 'outcome', outcome });
  }
  private faint(actor: Actor, events: FamilyEvent[]): void {
    ok(this.api.spike2_faint_cleanup(actor), 'faint cleanup'); events.push({ kind: 'faint', actor, commands: commands(this.api) });
  }
  private checkOutcome(events: FamilyEvent[]): boolean {
    this.syncParty(); ok(this.api.spike2_check_teams_lost(), 'source party outcome');
    const outcome = this.api.spike2_get_outcome();
    if (!outcome) return false;
    require(outcome >= 1 && outcome <= 3, 'Unsupported terminal outcome');
    this.finish(({ 1: 'won', 2: 'lost', 3: 'draw' } as const)[outcome as 1 | 2 | 3], events); return true;
  }
  private execute(choice: FamilyChoice): FamilyEvent[] {
    const events: FamilyEvent[] = [], api = this.api, playerSlot = choice.kind === 'move' ? choice.slot : 4;
    const order = ordered(api.family_order(playerSlot, this.host.wildSlot, choice.kind === 'run' ? 1 : 0));
    ok(api.spike_get_result(0), 'action order'); events.push({ kind: 'order', phase: 'actions', actors: order });
    for (const actor of order) {
      if (actor === 0 && choice.kind === 'run') {
        const escaped = checked(api.family_run(0), 'run'); require(escaped <= 1, 'Unsupported run result');
        events.push({ kind: 'run', escaped: escaped === 1, attempts: checked(api.family_get(0), 'run attempts') });
        if (escaped) { this.finish('ran', events); return events; }
        continue;
      }
      const slot = actor === 0 ? playerSlot : this.host.wildSlot;
      const moveId = slot === 4 ? 165 : this.prepared.mons[actor].moves[slot]!.moveId;
      ok(api.spike2_attack(actor, slot), 'source attack');
      events.push(familyEventSchema.parse({ kind: 'attack', actor, slot, moveId,
        result: { baseDamage: api.spike_get_result(1), afterCritical: api.spike_get_result(2), afterType: api.spike_get_result(3),
          damage: api.spike_get_result(4), flags: api.spike_get_result(5), hpDealt: api.spike_get_result(6),
          targetHP: api.spike_get_result(7), critical: api.spike_get_result(12) }, commands: commands(api) }));
      // Source recoil processes the attacker before the target.
      for (const fainted of [actor, actor === 0 ? 1 : 0] as Actor[]) if (api.spike_get_battler(fainted, 0) === 0) this.faint(fainted, events);
      if (this.checkOutcome(events)) return events;
    }
    const orderResidual = ordered(api.spike2_residual_order()); ok(api.spike_get_result(0), 'residual order');
    events.push({ kind: 'order', phase: 'residual', actors: orderResidual });
    for (const actor of orderResidual) {
      const status = api.spike_get_battler(actor, 3);
      if (!status) continue;
      ok(api.spike2_residual(actor), 'source residual'); events.push(familyEventSchema.parse({ kind: 'residual', actor, status, commands: commands(api) }));
      if (api.spike_get_battler(actor, 0) === 0) this.faint(actor, events);
      if (this.checkOutcome(events)) return events;
    }
    this.host.turn++; ok(api.spike2_begin_turn(), 'next turn'); this.host.wildSlot = this.chooseWild();
    return events;
  }
}
