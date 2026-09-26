/** Private, bounded P03 turn experiment. No network or owned-party entry point. */
import { z } from 'zod';
import { instantiateProbe, statusOk, type ProbeExports } from './probe';

const integer = z.number().int().nonnegative();
const stat = integer.min(1).max(999);
const type = integer.max(17).refine(value => value !== 9, 'Mystery type is unsupported');
const moveIds = [33, 55, 98, 77] as const;
const ppLimits: Record<number, number> = { 33: 35, 55: 25, 98: 30, 77: 35 };
const moveSchema = z.strictObject({ move: z.union(moveIds.map(move => z.literal(move))), pp: integer.max(35) })
  .refine(row => row.pp <= ppLimits[row.move]!, 'PP exceeds the source base PP; PP Ups are outside this experiment');
const monSchema = z.strictObject({
  level: integer.min(1).max(100), hp: integer.max(65535), maxHP: integer.min(1).max(65535),
  attack: stat, defense: stat.min(4), spAttack: stat, spDefense: stat.min(4), speed: stat,
  type1: type, type2: type,
  status1: z.union([z.literal(0), z.literal(8), z.literal(16)]),
  status2: z.union([z.literal(0), z.literal(0x20000000)]),
  stages: z.array(integer.max(12)).length(8).refine(values => values[0] === 6, 'Unused HP stage must be neutral'),
  moves: z.array(moveSchema).min(1).max(4),
}).refine(mon => mon.hp <= mon.maxHP, 'HP exceeds maximum');
export const turnInputSchema = z.strictObject({
  seed: integer.max(0xFFFFFFFF),
  parties: z.tuple([z.array(monSchema).min(1).max(2), z.array(monSchema).min(1).max(2)]),
}).refine(input => input.parties.every(party => party[0]!.hp > 0), 'Initial active battlers must be alive')
  .refine(input => input.parties.every(party => party.reduce((total, mon) => total + mon.maxHP, 0) <= 65535), 'Party HP must fit the source team HP accumulator');
export type TurnInput = z.infer<typeof turnInputSchema>;
type Mon = TurnInput['parties'][number][number];
export type Actor = 0 | 1;
const actors: Actor[] = [0, 1];
const moveChoice = z.strictObject({ kind: z.literal('move'), slot: integer.max(3) });
const switchChoice = z.strictObject({ kind: z.literal('switch'), partyIndex: integer.max(1) });
export const choiceSchema = z.discriminatedUnion('kind', [moveChoice, switchChoice]);
export type TurnChoice = z.infer<typeof choiceSchema>;
export const stepSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('turn'), choices: z.tuple([choiceSchema, choiceSchema]) }),
  z.strictObject({ kind: z.literal('replace'), choices: z.tuple([switchChoice.nullable(), switchChoice.nullable()]) }),
]);
export type Step = z.infer<typeof stepSchema>;

// Functions below are the separate private batch-two ABI, not BattleEngine.
export interface TurnExports extends ProbeExports {
  spike2_set_speed(actor: number, speed: number): number;
  spike2_set_move(actor: number, slot: number, move: number, pp: number): number;
  spike2_set_stage(actor: number, stat: number, stage: number): number;
  spike2_set_status(actor: number, status: number): number;
  spike2_get_stage(actor: number, stat: number): number;
  spike2_get_move(actor: number, slot: number, field: number): number;
  spike2_begin_turn(): number;
  spike2_order(slot0: number, slot1: number): number;
  spike2_residual_order(): number;
  spike2_attack(actor: number, slot: number): number;
  spike2_switch_cleanup(actor: number): number;
  spike2_faint_cleanup(actor: number): number;
  spike2_residual(actor: number): number;
  spike2_set_party(side: number, index: number, species: number, hp: number, isEgg: number): number;
  spike2_get_party(side: number, index: number, field: number): number;
  spike2_check_teams_lost(): number;
  spike2_get_outcome(): number;
  spike3_checkpoint_version(): number;
  spike3_checkpoint_word_count(): number;
  spike3_checkpoint_export(boundary: number): number;
  spike3_checkpoint_get(index: number): number;
  spike3_import_begin(version: number, boundary: number, count: number): number;
  spike3_import_set(index: number, value: number): number;
  spike3_import_commit(): number;
  spike3_get_rng_draws(part: number): number;
}
const instantiateTurn = (module: WebAssembly.Module): TurnExports => instantiateProbe(module) as TurnExports;

export interface SourceEvent { type: number; battler: number; value: number }
export interface AttackResult {
  baseDamage: number; afterCritical: number; afterType: number; damage: number;
  flags: number; hpDealt: number; targetHP: number; critical: number;
}
export type TurnEvent =
  | { kind: 'order'; phase: 'actions' | 'residual'; actors: Actor[] }
  | { kind: 'attack'; actor: Actor; partyIndex: number; slot: number; move: number; result: AttackResult; commands: SourceEvent[] }
  | { kind: 'switch'; actor: Actor; from: number; to: number; forced: boolean }
  | { kind: 'residual'; actor: Actor; status: number; commands: SourceEvent[] }
  | { kind: 'faint'; actor: Actor; partyIndex: number; commands: SourceEvent[] }
  | { kind: 'outcome'; outcome: 'won' | 'lost' | 'draw' };

export interface TurnSummary {
  sequence: number; turn: number; phase: 'choice' | 'replacement' | 'ended';
  resume: 'before-residual' | 'after-residual' | null;
  outcome: 'won' | 'lost' | 'draw' | null; active: [number, number]; rngState: number;
  parties: { hp: number; status1: number; status2: number; stages: number[]; pp: number[] }[][];
}

interface HostState {
  parties: TurnInput['parties']; active: [number, number]; sequence: number; turn: number;
  eventSequence: number;
  phase: TurnSummary['phase']; outcome: TurnSummary['outcome'];
  resume: TurnSummary['resume'];
}

export const sourceFingerprint = 'f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982';
const counter = integer.max(Number.MAX_SAFE_INTEGER);
const partiesSchema = z.tuple([z.array(monSchema).min(1).max(2), z.array(monSchema).min(1).max(2)]);
const hostSchema = z.strictObject({
  parties: partiesSchema, active: z.tuple([integer.max(1), integer.max(1)]), sequence: counter, eventSequence: counter,
  turn: counter.min(1), phase: z.enum(['choice', 'replacement', 'ended']),
  resume: z.enum(['before-residual', 'after-residual']).nullable(), outcome: z.enum(['won', 'lost', 'draw']).nullable(),
}).superRefine((state, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (state.turn > state.sequence + 1 || state.eventSequence < state.sequence) fail('Inconsistent checkpoint counters');
  if (state.sequence === 0 && (state.eventSequence !== 0 || state.phase !== 'choice')) fail('Invalid initial checkpoint');
  if (!state.parties.every(party => party.reduce((total, mon) => total + mon.maxHP, 0) <= 65535)) fail('Party HP accumulator overflow');
  if (!actors.every(actor => state.parties[actor][state.active[actor]])) { fail('Missing active party member'); return; }
  const alive = actors.map(actor => state.parties[actor].some(mon => mon.hp > 0));
  const fainted = actors.filter(actor => current(state, actor).hp === 0);
  for (const actor of fainted) {
    const mon = current(state, actor);
    if (mon.status1 || mon.status2 || mon.stages.some(stage => stage !== 6)) fail('Faint cleanup is missing');
  }
  if (state.phase === 'ended') {
    const expected = alive[0] && !alive[1] ? 'won' : !alive[0] && alive[1] ? 'lost' : !alive[0] && !alive[1] ? 'draw' : null;
    if (state.outcome === null || state.outcome !== expected || state.resume !== null) fail('Invalid terminal checkpoint');
  } else {
    if (state.outcome !== null || !alive.every(Boolean)) fail('Nonterminal checkpoint has a terminal party');
    if (state.phase === 'choice' && (fainted.length !== 0 || state.resume !== null)) fail('Invalid choice boundary');
    if (state.phase === 'replacement' && (!fainted.length || state.resume === null
      || (state.resume === 'before-residual' && fainted.length !== 1))) fail('Invalid replacement boundary');
  }
});
export const turnCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1), profile: z.literal('firered-synthetic-singles-v1'), sourceFingerprint: z.literal(sourceFingerprint),
  host: hostSchema,
  core: z.strictObject({ version: z.literal(1), boundary: integer.max(3), words: z.array(integer.max(0xFFFFFFFF)).length(148) }),
  rng: z.strictObject({ state: integer.max(0xFFFFFFFF), draws: counter.min(1) }),
});
export type TurnCheckpoint = z.infer<typeof turnCheckpointSchema>;
class ResumeCheckpoint { constructor(readonly value: TurnCheckpoint) {} }

function boundaryOf(state: HostState): number {
  return state.phase === 'choice' ? 0 : state.phase === 'ended' ? 3 : state.resume === 'before-residual' ? 1 : 2;
}

function rngDraws(api: TurnExports): number {
  const draws = BigInt(api.spike3_get_rng_draws(0) >>> 0) | (BigInt(api.spike3_get_rng_draws(1) >>> 0) << 32n);
  if (draws > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('RNG draw counter exceeds the contract range');
  return Number(draws);
}

function checkCheckpoint(input: unknown): TurnCheckpoint {
  const checkpoint = turnCheckpointSchema.parse(input);
  const { host, core, rng } = checkpoint;
  const words = core.words;
  const require = (condition: boolean, message: string) => { if (!condition) throw new Error(`Invalid checkpoint: ${message}`); };
  require(core.boundary === boundaryOf(host) && words[3] === core.boundary, 'boundary mismatch');
  require(words[0] === 0x57424350 && words[1] === 1 && words[2] === 148, 'core header mismatch');
  require(words[4] === rng.state && BigInt(words[5]!) + (BigInt(words[6]!) << 32n) === BigInt(rng.draws), 'RNG mismatch');
  require(words[8] === (host.outcome === null ? 0 : host.outcome === 'won' ? 1 : host.outcome === 'lost' ? 2 : 3), 'outcome mismatch');
  for (const actor of actors) {
    const mon = current(host, actor);
    const expected = [mon.level, mon.hp, mon.maxHP, mon.attack, mon.defense, mon.spAttack, mon.spDefense, mon.speed,
      mon.type1, mon.type2, mon.status1, mon.status2, mon.type1, mon.type2, ...mon.stages,
      ...Array.from({ length: 4 }, (_, slot) => mon.moves[slot]?.move ?? 0),
      ...Array.from({ length: 4 }, (_, slot) => mon.moves[slot]?.pp ?? 0)];
    require(expected.every((value, field) => value === words[16 + actor * 48 + field]), `active battler ${actor} differs from party state`);
  }
  return checkpoint;
}

const current = (state: HostState, actor: Actor): Mon => state.parties[actor][state.active[actor]]!;
const checked = (value: number, action: string): number => {
  if (value < 0) throw new Error(`Invalid source diagnostic for ${action}`);
  return value;
};

function configure(api: TurnExports, actor: Actor, mon: Mon): void {
  statusOk(api.spike_set_battler(actor, mon.level, mon.hp, mon.maxHP, mon.attack, mon.defense,
    mon.spAttack, mon.spDefense, mon.type1, mon.type2, 0, mon.status2), 'active battler');
  statusOk(api.spike2_set_status(actor, mon.status1), 'initial status');
  statusOk(api.spike2_set_speed(actor, mon.speed), 'speed');
  mon.stages.forEach((stage, index) => statusOk(api.spike2_set_stage(actor, index, stage), 'stage'));
  for (let slot = 0; slot < 4; slot++) {
    const move = mon.moves[slot];
    statusOk(api.spike2_set_move(actor, slot, move?.move ?? 0, move?.pp ?? 0), 'move and PP');
  }
}

function sync(api: TurnExports, state: HostState): void {
  for (const actor of actors) {
    const mon = current(state, actor);
    mon.hp = checked(api.spike_get_battler(actor, 0), 'HP');
    mon.status1 = checked(api.spike_get_battler(actor, 3), 'status') as Mon['status1'];
    mon.status2 = checked(api.spike_get_battler(actor, 4), 'volatile status') as Mon['status2'];
    mon.stages = mon.stages.map((_, index) => checked(api.spike2_get_stage(actor, index), 'stage'));
    mon.moves.forEach((move, slot) => { move.pp = checked(api.spike2_get_move(actor, slot, 1), 'PP'); });
  }
}

function readEvents(api: TurnExports): SourceEvent[] {
  statusOk(api.spike_get_result(0), 'source operation');
  const count = checked(api.spike_get_result(11), 'event count');
  if (count > 32) throw new Error('Source event limit exceeded');
  return Array.from({ length: count }, (_, index) => ({ type: checked(api.spike_get_event(index, 0), 'event kind'),
    battler: checked(api.spike_get_event(index, 1), 'event actor'), value: checked(api.spike_get_event(index, 2), 'event value') }));
}

function attackResult(api: TurnExports): AttackResult {
  return { baseDamage: api.spike_get_result(1), afterCritical: api.spike_get_result(2), afterType: api.spike_get_result(3),
    damage: api.spike_get_result(4), flags: api.spike_get_result(5), hpDealt: api.spike_get_result(6),
    targetHP: api.spike_get_result(7), critical: api.spike_get_result(12) };
}

function ordered(raw: number): Actor[] {
  if (raw !== 0 && raw !== 1 && raw !== 2) throw new Error(`Invalid source order result ${raw}`);
  return raw === 0 ? [0, 1] : [1, 0];
}

function outcome(api: TurnExports, state: HostState, events: TurnEvent[]): boolean {
  for (const actor of actors) {
    for (let slot = 0; slot < 6; slot++) {
      const mon = state.parties[actor][slot];
      // The original predicate only asks nonempty/non-egg/HP. Species 1 is an
      // explicit occupied marker here, not a claim about the synthetic battler.
      statusOk(api.spike2_set_party(actor, slot, mon ? 1 : 0, mon?.hp ?? 0, 0), 'party outcome projection');
    }
  }
  statusOk(api.spike2_check_teams_lost(), 'source team outcome');
  const result = api.spike2_get_outcome();
  if (result === 0) return false;
  if (result < 1 || result > 3) throw new Error('Unsupported source outcome');
  state.outcome = result === 1 ? 'won' : result === 2 ? 'lost' : 'draw';
  state.phase = 'ended';
  state.resume = null;
  events.push({ kind: 'outcome', outcome: state.outcome });
  return true;
}

function faint(api: TurnExports, state: HostState, actor: Actor, events: TurnEvent[]): void {
  statusOk(api.spike2_faint_cleanup(actor), 'faint cleanup');
  const commands = readEvents(api);
  sync(api, state);
  events.push({ kind: 'faint', actor, partyIndex: state.active[actor], commands });
}

function switchIn(api: TurnExports, state: HostState, actor: Actor, to: number, forced: boolean, events: TurnEvent[]): void {
  const from = state.active[actor];
  const outgoing = current(state, actor);
  // Party records retain no battle stages or volatile status; the original
  // party representation likewise keeps these only in its active BattlePokemon.
  outgoing.status2 = 0;
  outgoing.stages.fill(6);
  state.active[actor] = to;
  configure(api, actor, current(state, actor));
  statusOk(api.spike2_switch_cleanup(actor), 'source switch cleanup');
  sync(api, state);
  events.push({ kind: 'switch', actor, from, to, forced });
}

function nextTurn(api: TurnExports, state: HostState): void {
  state.phase = 'choice';
  state.resume = null;
  state.turn++;
  statusOk(api.spike2_begin_turn(), 'next turn selection');
}

function summary(api: TurnExports, state: HostState): TurnSummary {
  return { sequence: state.sequence, turn: state.turn, phase: state.phase, resume: state.resume, outcome: state.outcome,
    active: [...state.active], rngState: api.spike_get_rng() >>> 0,
    parties: state.parties.map(party => party.map(mon => ({ hp: mon.hp, status1: mon.status1, status2: mon.status2,
      stages: [...mon.stages], pp: mon.moves.map(move => move.pp) }))) };
}

function validate(state: HostState, step: Step): void {
  if (state.phase === 'ended') throw new Error('Battle already ended');
  if ((step.kind === 'replace') !== (state.phase === 'replacement')) throw new Error('Choice does not match the battle phase');
  for (const actor of actors) {
    const choice = step.choices[actor];
    const mon = current(state, actor);
    if (step.kind === 'replace' && mon.hp > 0) {
      if (choice !== null) throw new Error('Living battler cannot replace during a faint replacement');
      continue;
    }
    if (choice === null) throw new Error('Fainted battler requires replacement');
    if (choice.kind === 'move') {
      if (mon.hp === 0) throw new Error('Fainted battler cannot attack');
      const move = mon.moves[choice.slot];
      if (!move || move.pp === 0) throw new Error('Move is unavailable; Struggle is outside this experiment');
    } else {
      const next = state.parties[actor][choice.partyIndex];
      if (choice.partyIndex === state.active[actor] || !next || next.hp === 0) throw new Error('Invalid switch destination');
    }
  }
}

/** Each transition runs in a fresh instance restored from logical state. */
export class TurnProbe {
  private api: TurnExports;
  private state: HostState;
  constructor(private readonly module: WebAssembly.Module, input: unknown,
    private readonly instantiate: (module: WebAssembly.Module) => TurnExports = instantiateTurn) {
    if (input instanceof ResumeCheckpoint) {
      const checkpoint = checkCheckpoint(input.value);
      this.state = checkpoint.host;
      this.api = this.instantiate(module);
      if (this.api.spike3_checkpoint_version() !== 1 || this.api.spike3_checkpoint_word_count() !== 148) throw new Error('Unsupported checkpoint ABI');
      statusOk(this.api.spike3_import_begin(checkpoint.core.version, checkpoint.core.boundary, checkpoint.core.words.length), 'checkpoint import begin');
      checkpoint.core.words.forEach((word, index) => statusOk(this.api.spike3_import_set(index, word), 'checkpoint import word'));
      statusOk(this.api.spike3_import_commit(), 'validated checkpoint commit');
      if (this.api.spike_get_rng() >>> 0 !== checkpoint.rng.state || rngDraws(this.api) !== checkpoint.rng.draws) throw new Error('Restored RNG differs');
      return;
    }
    const parsed = turnInputSchema.parse(input);
    this.api = this.instantiate(module);
    statusOk(this.api.spike_reset(parsed.seed), 'reset');
    this.state = { parties: parsed.parties, active: [0, 0], sequence: 0, eventSequence: 0, turn: 1, phase: 'choice', resume: null, outcome: null };
    for (const actor of actors) configure(this.api, actor, current(this.state, actor));
    statusOk(this.api.spike2_begin_turn(), 'initial turn selection');
  }

  inspect(): TurnSummary { return summary(this.api, this.state); }

  snapshot(): TurnCheckpoint {
    const boundary = boundaryOf(this.state);
    if (this.api.spike3_checkpoint_version() !== 1 || this.api.spike3_checkpoint_word_count() !== 148) throw new Error('Unsupported checkpoint ABI');
    statusOk(this.api.spike3_checkpoint_export(boundary), 'checkpoint export');
    return checkCheckpoint({ schemaVersion: 1, profile: 'firered-synthetic-singles-v1', sourceFingerprint,
      host: this.state, core: { version: 1, boundary, words: Array.from({ length: 148 }, (_, index) => this.api.spike3_checkpoint_get(index) >>> 0) },
      rng: { state: this.api.spike_get_rng() >>> 0, draws: rngDraws(this.api) } });
  }

  static restore(module: WebAssembly.Module, input: unknown): TurnProbe {
    return new TurnProbe(module, new ResumeCheckpoint(checkCheckpoint(input)));
  }

  requiredActors(): Actor[] {
    return this.state.phase === 'ended' ? [] : actors.filter(actor => this.state.phase === 'choice' || current(this.state, actor).hp === 0);
  }

  validateChoice(actor: number, input: unknown): TurnChoice {
    if ((actor !== 0 && actor !== 1) || !this.requiredActors().includes(actor)) throw new Error('Actor has no pending choice');
    const choice = choiceSchema.parse(input);
    if (this.state.phase === 'replacement' && choice.kind !== 'switch') throw new Error('Replacement requires a switch');
    const mon = current(this.state, actor);
    if (choice.kind === 'move') {
      if (!mon.moves[choice.slot] || mon.moves[choice.slot]!.pp === 0) throw new Error('Move is unavailable');
    } else {
      const next = this.state.parties[actor][choice.partyIndex];
      if (!next || next.hp === 0 || choice.partyIndex === this.state.active[actor]) throw new Error('Invalid switch destination');
    }
    return choice;
  }

  advanceChoices(input: { actor: number; choice: TurnChoice }[]): TurnEvent[] {
    const required = this.requiredActors();
    if (!required.length || input.length !== required.length || new Set(input.map(row => row.actor)).size !== input.length) throw new Error('Required choices missing or duplicated');
    const choices = new Map(input.map(row => [row.actor, this.validateChoice(row.actor, row.choice)]));
    if (!required.every(actor => choices.has(actor))) throw new Error('Wrong choice actors');
    const step = this.state.phase === 'choice'
      ? { kind: 'turn', choices: [choices.get(0), choices.get(1)] }
      : { kind: 'replace', choices: [choices.get(0) ?? null, choices.get(1) ?? null] };
    return this.advance(step).events;
  }

  advance(input: unknown): { state: TurnSummary; events: TurnEvent[] } {
    const step = stepSchema.parse(input);
    validate(this.state, step);
    const candidate = new TurnProbe(this.module, new ResumeCheckpoint(this.snapshot()), this.instantiate);
    const { state, api } = candidate;
    const events: TurnEvent[] = [];
    this.execute(api, state, step, events);
    state.sequence++;
    state.eventSequence += events.length;
    if (!Number.isSafeInteger(state.sequence) || !Number.isSafeInteger(state.eventSequence)
      || !Number.isSafeInteger(state.turn)) throw new Error('Battle sequence exhausted');
    this.api = api;
    this.state = state;
    return { state: this.inspect(), events };
  }

  private execute(api: TurnExports, state: HostState, step: Step, events: TurnEvent[]): void {
    if (step.kind === 'replace') {
      for (const actor of actors) {
        const choice = step.choices[actor];
        if (choice) switchIn(api, state, actor, choice.partyIndex, true, events);
      }
      if (state.resume === 'before-residual') this.residual(api, state, events);
      else nextTurn(api, state);
      return;
    }
    const [left, right] = step.choices;
    // SetActionsAndBattlersTurnOrder places switches in side order before moves;
    // only a pair of move actions invokes its priority/speed comparison.
    const actionOrder = ordered(api.spike2_order(left.kind === 'move' ? left.slot : 4, right.kind === 'move' ? right.slot : 4));
    statusOk(api.spike_get_result(0), 'source action order');
    events.push({ kind: 'order', phase: 'actions', actors: actionOrder });
    for (const actor of actionOrder) {
      if (current(state, actor).hp === 0) continue;
      const choice = step.choices[actor];
      if (choice.kind === 'switch') {
        switchIn(api, state, actor, choice.partyIndex, false, events);
      } else {
        const move = current(state, actor).moves[choice.slot]!.move;
        statusOk(api.spike2_attack(actor, choice.slot), 'source attack');
        events.push({ kind: 'attack', actor, partyIndex: state.active[actor], slot: choice.slot, move,
          result: attackResult(api), commands: readEvents(api) });
        sync(api, state);
        const target: Actor = actor === 0 ? 1 : 0;
        if (current(state, target).hp === 0) {
          faint(api, state, target, events);
          if (outcome(api, state, events)) return;
          // Source Cmd_end/TryFinish handles replacements here. Its singles
          // send-out script cancels the other selected action before residuals.
          state.phase = 'replacement';
          state.resume = 'before-residual';
          return;
        }
      }
    }
    this.residual(api, state, events);
  }

  private residual(api: TurnExports, state: HostState, events: TurnEvent[]): void {
    const residualOrder = ordered(api.spike2_residual_order());
    statusOk(api.spike_get_result(0), 'source residual order');
    events.push({ kind: 'order', phase: 'residual', actors: residualOrder });
    for (const actor of residualOrder) {
      const mon = current(state, actor);
      if (mon.hp === 0 || mon.status1 === 0) continue;
      const status = mon.status1;
      statusOk(api.spike2_residual(actor), 'source status residual');
      events.push({ kind: 'residual', actor, status, commands: readEvents(api) });
      sync(api, state);
      if (current(state, actor).hp === 0) faint(api, state, actor, events);
      if (outcome(api, state, events)) return;
    }
    if (actors.some(actor => current(state, actor).hp === 0)) {
      state.phase = 'replacement';
      state.resume = 'after-residual';
    } else nextTurn(api, state);
  }
}
