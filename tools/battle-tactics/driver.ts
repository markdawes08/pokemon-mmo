/** Source-owned party state with audited, resumable command scheduling. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TurnExports } from '../battle-spike/turn-probe';
import { familyEventSchema } from '../battle-family/driver';
import { TACTICS_PROFILE, TACTICS_SOURCE, tacticsInitialSchema, tacticsContextSchema, tacticsCreatureWords, prepareTactics,
  type TacticsInitial, type TacticsResources, type PreparedTactics } from './admission';
export { TACTICS_PROFILE, TACTICS_SOURCE, TACTICS_MOVES, tacticsInitialSchema, tacticsCreatureSchema, tacticsDiagnosticSchema,
  createTacticsDiagnostic, createTacticsDiagnosticFromCapture, loadTacticsResources } from './admission';
export type { TacticsInitial, TacticsCreature, TacticsDiagnostic, TacticsResources, TacticsContext } from './admission';

export const TACTICS_CHECKPOINT_WORDS = 512;
const word = z.number().int().min(0).max(0xFFFFFFFF);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const decisionId = z.string().regex(/^[a-f0-9]{64}$/);
const statusSchema = z.union([z.literal(0), z.literal(8), z.literal(16)]);
const outcomeSchema = z.enum(['won', 'lost', 'draw', 'ran', 'forced-escape']);
const weatherSchema = z.strictObject({ kind: z.enum(['clear', 'rain']), turnsRemaining: word.max(5) });
const phaseSchema = z.enum(['choice', 'post-faint', 'replacement', 'ended']);
const resumeSchema = z.enum(['before-residual', 'after-residual']);
export const tacticsChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), slot: word.max(3) }),
  z.strictObject({ kind: z.literal('struggle') }), z.strictObject({ kind: z.literal('run') }),
  z.strictObject({ kind: z.literal('switch'), partyIndex: word.max(5) }),
  z.strictObject({ kind: z.literal('use-next'), decisionId }), z.strictObject({ kind: z.literal('attempt-run'), decisionId }),
  z.strictObject({ kind: z.literal('replace'), partyIndex: word.max(5), decisionId }),
]);
export type TacticsChoice = z.infer<typeof tacticsChoiceSchema>;
export const tacticsEventSchema = z.union([familyEventSchema,
  z.strictObject({ kind: z.literal('outcome'), outcome: z.literal('forced-escape') }),
  z.strictObject({ kind: z.literal('weather'), phase: z.enum(['move', 'end-turn']), weather: z.enum(['clear', 'rain']), turnsRemaining: word.max(5) }),
  z.strictObject({ kind: z.literal('switch'), from: word.max(5), to: word.max(5), forced: z.boolean() }),
  z.strictObject({ kind: z.literal('pending-replacement'), resume: resumeSchema }),
  z.strictObject({ kind: z.literal('replacement-decision'), decision: z.enum(['use-next', 'attempt-run']), escaped: z.boolean() }),
]);
export type TacticsEvent = z.infer<typeof tacticsEventSchema>;
const ownerMonSchema = z.strictObject({ partyIndex: word.max(5), speciesId: word, abilityId: word, level: word.min(1).max(100),
  hp: word.max(65535), maxHP: word.max(65535), status: statusSchema, friendship: word.max(255),
  moves: z.array(z.strictObject({ slot: word.max(3), moveId: word, pp: word.max(255), maxPP: word.max(255), ppUps: word.max(3) })).max(4) });
export const tacticsPresentationSchema = z.strictObject({ turn: counter.min(1), phase: phaseSchema, needsChoice: z.boolean(),
  outcome: outcomeSchema.nullable(), activeIndex: word.max(5), party: z.array(ownerMonSchema).min(1).max(6),
  self: ownerMonSchema.extend({ focusEnergy: z.boolean(), stages: z.array(word.max(12)).length(8) }).strict(),
  opponent: z.strictObject({ speciesId: word, level: word.min(1).max(100), hpPercent: word.max(100), status: statusSchema }),
  pendingDecision: z.strictObject({ decisionId, resume: resumeSchema }).nullable(),
  weather: weatherSchema, inventory: tacticsContextSchema.shape.inventory,
  availableChoices: z.array(tacticsChoiceSchema).max(10), liveAdmission: z.literal(false) });
export type TacticsPresentation = z.infer<typeof tacticsPresentationSchema>;
export const tacticsCheckpointSchema = z.strictObject({ schemaVersion: z.literal(1), profile: z.literal(TACTICS_PROFILE),
  sourceFingerprint: z.literal(TACTICS_SOURCE), admission: tacticsInitialSchema, context: tacticsContextSchema,
  host: z.strictObject({ sequence: counter, eventSequence: counter, turn: counter.min(1), turnActions: counter,
    decisionCount: counter, phase: phaseSchema, outcome: outcomeSchema.nullable(), wildSlot: word.max(4) }),
  core: z.strictObject({ version: z.literal(6), boundary: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    words: z.array(word).length(TACTICS_CHECKPOINT_WORDS) }), rng: z.strictObject({ state: word, draws: counter.min(1) }) });
export type TacticsCheckpoint = z.infer<typeof tacticsCheckpointSchema>;
type Actor = 0 | 1;
type Host = TacticsCheckpoint['host'];
type Boundary = TacticsCheckpoint['core']['boundary'];
interface SourceMon { types: [number, number]; maxPP: number[] }
export interface TacticsExports extends TurnExports {
  tactics_field_end_turn(): number;
  tactics_get(field: number): number;
  family_choose_wild(): number;
  family_run(actor: number): number;
  family_get(field: number): number;
  party_input_word_count(): number;
  party_input_begin(index: number): number;
  party_input_set(index: number, word: number, value: number): number;
  party_input_commit(index: number): number;
  party_mon_get(index: number, field: number): number;
  party_roster_get(index: number, word: number): number;
  party_start(count: number): number;
  party_sync(): number;
  party_order(playerSlot: number, wildSlot: number, actionKind: number): number;
  party_switch(index: number, forced: number): number;
  party_replacement_begin(phase: number): number;
  party_replacement_decide(kind: number): number;
  party_residual_order(): number;
  party_faint_cleanup(actor: number): number;
  party_get(field: number): number;
}
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(value: number, action: string): void { require(value === 0, `Tactics source rejected ${action}: ${value}`); }
function checked(value: number, action: string): number { require(value >= 0, `Tactics source rejected ${action}: ${value}`); return value; }
export function instantiateTactics(module: WebAssembly.Module): TacticsExports {
  require(WebAssembly.Module.imports(module).length === 0, 'Tactics module cannot import host services');
  const api = new WebAssembly.Instance(module).exports as unknown as TacticsExports;
  require(api.spike_abi_version() === 1 && api.spike3_checkpoint_version() === 6
    && api.spike3_checkpoint_word_count() === TACTICS_CHECKPOINT_WORDS && api.party_input_word_count() === 46
    && api.memory.buffer.byteLength === 262144 && !(api.memory.buffer instanceof SharedArrayBuffer), 'Unsupported party ABI or memory');
  return api;
}
function configure(api: TacticsExports, prepared: PreparedTactics): SourceMon[] {
  ok(api.spike_reset(prepared.seed), 'RNG anchor');
  const source: SourceMon[] = [];
  for (const [index, mon] of [...prepared.player.map((mon, index) => [index, mon] as const), [6, prepared.opponent] as const]) {
    ok(api.party_input_begin(index), 'roster admission begin');
    tacticsCreatureWords(mon).forEach((value, field) => ok(api.party_input_set(index, field, value), 'roster admission word'));
    ok(api.party_input_commit(index), 'source roster admission');
    require(api.party_mon_get(index, 0) === mon.abilityId, 'Ability differs from the source species/slot');
    source[index] = { types: [api.party_mon_get(index, 3), api.party_mon_get(index, 4)],
      maxPP: Array.from({ length: 4 }, (_, slot) => api.party_mon_get(index, 5 + slot)) };
  }
  return source;
}
function draws(api: TacticsExports): number {
  const value = BigInt(api.spike3_get_rng_draws(0) >>> 0) | BigInt(api.spike3_get_rng_draws(1) >>> 0) << 32n;
  require(value <= BigInt(Number.MAX_SAFE_INTEGER), 'Tactics RNG count exhausted'); return Number(value);
}
function words(api: TacticsExports, boundary: Boundary): number[] {
  ok(api.spike3_checkpoint_export(boundary), 'checkpoint export');
  return Array.from({ length: TACTICS_CHECKPOINT_WORDS }, (_, index) => api.spike3_checkpoint_get(index) >>> 0);
}
function commands(api: TacticsExports) {
  ok(api.spike_get_result(0), 'source command');
  const size = checked(api.spike_get_result(11), 'event count'); require(size <= 32, 'Source event bound exceeded');
  return Array.from({ length: size }, (_, i) => ({ type: api.spike_get_event(i, 0),
    battler: api.spike_get_event(i, 1), value: api.spike_get_event(i, 2) >>> 0 }));
}
function ordered(raw: number): Actor[] {
  require(raw === 0 || raw === 1 || raw === 2, 'Unsupported source order'); return raw === 0 ? [0, 1] : [1, 0];
}
function boundary(phase: Host['phase'], pendingPhase: number): Boundary {
  if (phase === 'ended') return 3;
  if (phase === 'choice') return 0;
  require(pendingPhase === 1 || pendingPhase === 2, 'Missing source pending boundary'); return pendingPhase;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function pendingId(checkpoint: TacticsCheckpoint): string {
  return createHash('sha256').update(canonical(checkpoint)).digest('hex');
}
function validateCheckpoint(checkpoint: TacticsCheckpoint, prepared: PreparedTactics, source: SourceMon[]): void {
  const { host, core, rng } = checkpoint, w = core.words, expectedBoundary = boundary(host.phase, w[158]!), active = w[155]!;
  require(core.boundary === expectedBoundary && w[3] === expectedBoundary && w[0] === 0x57424350 && w[1] === 6
    && w[2] === TACTICS_CHECKPOINT_WORDS, 'Checkpoint header or boundary differs');
  require(w[4] === rng.state && BigInt(w[5]!) + (BigInt(w[6]!) << 32n) === BigInt(rng.draws)
    && w[14] === prepared.seed && w[149] === 1 && w[150] === 0 && w[151] === 0, 'Checkpoint RNG or unavailable item state differs');
  require(canonical(checkpoint.context) === canonical(prepared.context), 'Tactics provenance or retained bag differs');
  require(host.sequence === host.turnActions + host.decisionCount && host.eventSequence >= host.sequence
    && host.turn === host.turnActions + (host.phase === 'choice' ? 1 : 0)
    && (host.sequence !== 0 || (host.eventSequence === 0 && host.turn === 1 && host.phase === 'choice')), 'Checkpoint counters differ');
  const outcome = host.outcome === null ? 0 : { won: 1, lost: 2, draw: 3, ran: 4, 'forced-escape': 5 }[host.outcome];
  require(w[8] === outcome && ((host.phase === 'ended') === (host.outcome !== null)), 'Checkpoint outcome differs');
  require((w[483] === 0 && w[484] === 0) || (w[483] === 1 && w[484]! >= 1 && w[484]! <= 5),
    'Checkpoint contains unsupported weather or timer');
  if (w[483] === 1) {
    const rainUsed = [...prepared.player.map((mon, index) => ({ mon, index })), { mon: prepared.opponent, index: 6 }]
      .some(({ mon, index }) => mon.moves.some((move, slot) => move.moveId === 240 && w[189 + index * 46 + slot]! < move.pp));
    require(rainUsed && host.sequence > 0, 'Rain has no admitted source move use');
  }
  if (host.sequence === 0) require(w[483] === 0 && w[484] === 0, 'Initial weather must be clear');
  require(w[154] === prepared.player.length && active < prepared.player.length && w[156]! < (1 << prepared.player.length)
    && (w[156]! & (1 << active)) !== 0, 'Checkpoint party count, active index or participation differs');
  if (host.outcome === 'forced-escape') require(w[13] === 18 && w[17]! > 0 && w[65]! > 0
    && [{ mon: prepared.player[active]!, index: active }, { mon: prepared.opponent, index: 6 }]
      .some(({ mon, index }) => mon.moves.some((move, slot) => move.moveId === 18 && w[189 + index * 46 + slot]! < move.pp)),
  'Forced escape lacks a source Whirlwind action');
  const sentCount = prepared.player.filter((_mon, index) => (w[156]! & (1 << index)) !== 0).length;
  require(w[157]! <= host.sequence && sentCount <= 1 + w[157]!
    && prepared.player.every((mon, index) => mon.hp > 0 || (w[156]! & (1 << index)) === 0),
  'Checkpoint participation exceeds accepted switch decisions');
  require(host.phase === 'post-faint' ? (w[158] === 1 || w[158] === 2) && w[159] === 0
    : host.phase === 'replacement' ? (w[158] === 1 || w[158] === 2) && (w[159] === 1 || w[159] === 2)
      : w[158] === 0 && w[159] === 0, 'Pending replacement source state differs');
  for (let index = 0; index < 7; index++) {
    const mon = index === 6 ? prepared.opponent : prepared.player[index], row = w.slice(160 + index * 46, 206 + index * 46);
    if (!mon) { require(row.every(value => value === 0), 'Checkpoint invented a bench member'); continue; }
    const original = tacticsCreatureWords(mon), mutable = [5, 6, 29, 30, 31, 32, 36];
    require(original.every((value, field) => mutable.includes(field) || row[field] === value), 'Checkpoint changed immutable roster identity');
    require(row[6]! <= mon.hp && row[36] === (row[6] === 0 ? 0 : mon.status)
      && row.slice(29, 33).every((pp, slot) => pp <= mon.moves[slot]!.pp), 'Checkpoint replenished health/PP or changed status');
    require(row[5]! <= mon.friendship && (index !== 6 && mon.hp > 0 && row[6] === 0 || row[5] === mon.friendship),
      'Checkpoint changed friendship without an eligible player faint');
    if (index !== 6 && (row[6] !== mon.hp || row[5] !== mon.friendship || row.slice(29, 33).some((pp, slot) => pp !== mon.moves[slot]!.pp)))
      require((w[156]! & (1 << index)) !== 0, 'A changed party member has no source participation');
    if (host.sequence === 0) require(row.every((value, field) => value === original[field]), 'Initial checkpoint already changed roster state');
  }
  for (const actor of [0, 1] as const) {
    const index = actor === 0 ? active : 6, mon = actor === 0 ? prepared.player[active]! : prepared.opponent;
    const row = w.slice(16 + actor * 48, 64 + actor * 48), roster = w.slice(160 + index * 46, 206 + index * 46), types = source[index]!.types;
    const fixed = [mon.level, roster[6], mon.stats.hp, mon.stats.attack, mon.stats.defense, mon.stats.spAttack, mon.stats.spDefense,
      mon.stats.speed, ...types, roster[36], null, ...types];
    require(fixed.every((value, field) => value === null || value === row[field]) && row[30] === mon.speciesId
      && row[31] === mon.abilityId && w[152 + actor] === roster[33], 'Active battler differs from its source roster');
    require(row[11] === 0 || (row[11] === 0x100000 && mon.moves.some(move => move.moveId === 116) && row[1]! > 0), 'Unsupported settled volatile state');
    for (let slot = 0; slot < 4; slot++) require(row[22 + slot] === roster[25 + slot] && row[26 + slot] === roster[29 + slot], 'Active moves differ from party data');
    for (let stat = 0; stat < 8; stat++) require(row[14 + stat]! <= 12 && (![0, 4, 5, 7].includes(stat) || row[14 + stat] === 6)
      && (![1, 6].includes(stat) || row[14 + stat]! <= 6) && (row[1] !== 0 || row[14 + stat] === 6), 'Unsupported stages or missing faint cleanup');
    for (let slot = 0; slot < 6; slot++) {
      const member = actor === 0 ? prepared.player[slot] : slot === 0 ? prepared.opponent : undefined;
      const r = 160 + (actor === 0 ? slot : 6) * 46, p = 112 + actor * 18 + slot * 3;
      require(w[p] === (member?.speciesId ?? 0) && w[p + 1] === (member ? w[r + 6] : 0) && w[p + 2] === 0,
        'Source team-loss projection differs from the admitted roster');
    }
  }
  if (host.phase === 'choice') require(w[17]! > 0 && w[65]! > 0 && (host.wildSlot === 4 ? w.slice(90, 94).every(pp => pp === 0)
    : w[86 + host.wildSlot] !== 0 && w[90 + host.wildSlot]! > 0), 'Choice lacks a living actor or usable pending wild move');
  if (host.phase === 'post-faint' || host.phase === 'replacement') require(w[17] === 0 && w[65]! > 0
    && prepared.player.some((_mon, index) => w[166 + index * 46]! > 0), 'Replacement lacks a fainted active and living reserve');
  if (host.sequence === 0) require(active === prepared.player.findIndex(mon => mon.hp > 0) && w[156] === (1 << active)
    && w[157] === 0 && w.slice(30, 38).every(value => value === 6) && w.slice(78, 86).every(value => value === 6),
  'Initial party selection or stages differ');
}

export class TacticsDriver {
  private api: TacticsExports;
  private initial: TacticsInitial;
  private prepared: PreparedTactics;
  private source: SourceMon[];
  private host: Host;
  constructor(private readonly module: WebAssembly.Module, private readonly resources: TacticsResources, input: unknown, restore = false) {
    this.api = instantiateTactics(module);
    if (restore) {
      const checkpoint = tacticsCheckpointSchema.parse(input);
      this.initial = checkpoint.admission; this.prepared = prepareTactics(resources, this.initial);
      this.source = configure(this.api, this.prepared); this.host = checkpoint.host;
      validateCheckpoint(checkpoint, this.prepared, this.source);
      ok(this.api.spike3_import_begin(6, checkpoint.core.boundary, TACTICS_CHECKPOINT_WORDS), 'restore begin');
      checkpoint.core.words.forEach((value, index) => ok(this.api.spike3_import_set(index, value), 'restore word'));
      ok(this.api.spike3_import_commit(), 'source restore semantics'); return;
    }
    this.initial = tacticsInitialSchema.parse(input); this.prepared = prepareTactics(resources, this.initial);
    this.source = configure(this.api, this.prepared); ok(this.api.party_start(this.prepared.player.length), 'source party introduction');
    this.host = { sequence: 0, eventSequence: 0, turn: 1, turnActions: 0, decisionCount: 0,
      phase: 'choice', outcome: null, wildSlot: this.chooseWild() }; this.snapshot();
  }
  static restore(module: WebAssembly.Module, resources: TacticsResources, checkpoint: unknown): TacticsDriver { return new TacticsDriver(module, resources, checkpoint, true); }
  snapshot(): TacticsCheckpoint {
    const checkpointBoundary = boundary(this.host.phase, this.api.party_get(4));
    const checkpoint = tacticsCheckpointSchema.parse({ schemaVersion: 1, profile: TACTICS_PROFILE, sourceFingerprint: TACTICS_SOURCE,
      admission: this.initial, context: this.prepared.context, host: this.host,
      core: { version: 6, boundary: checkpointBoundary, words: words(this.api, checkpointBoundary) },
      rng: { state: this.api.spike_get_rng() >>> 0, draws: draws(this.api) } });
    validateCheckpoint(checkpoint, this.prepared, this.source); return checkpoint;
  }
  requiredActors(): number[] { return this.host.phase === 'ended' ? [] : [0]; }
  validateChoice(actor: number, input: unknown): TacticsChoice {
    require(actor === 0 && this.host.phase !== 'ended', 'Actor has no pending choice');
    const choice = tacticsChoiceSchema.parse(input), active = this.api.party_get(1);
    if (this.host.phase !== 'choice') {
      require('decisionId' in choice && choice.decisionId === pendingId(this.snapshot()), 'Stale party decision');
      require(this.host.phase === 'post-faint' ? choice.kind === 'use-next' || choice.kind === 'attempt-run' : choice.kind === 'replace',
        'Choice is unavailable at this replacement stage');
    } else {
      require(choice.kind === 'move' || choice.kind === 'struggle' || choice.kind === 'run' || choice.kind === 'switch', 'No pending faint decision');
      const pp = Array.from({ length: 4 }, (_, slot) => this.api.spike2_get_move(0, slot, 1));
      if (choice.kind === 'struggle') require(pp.every(value => value === 0), 'Struggle requires all moves to be unusable');
      if (choice.kind === 'move') require(this.prepared.player[active]!.moves[choice.slot]!.moveId !== 0 && pp[choice.slot]! > 0, 'Move has no usable PP');
    }
    if (choice.kind === 'switch' || choice.kind === 'replace') require(choice.partyIndex < this.prepared.player.length
      && choice.partyIndex !== active && this.api.party_roster_get(choice.partyIndex, 6) > 0, 'Replacement must be a living reserve');
    return choice;
  }
  advanceChoices(input: { actor: number; choice: TacticsChoice }[]): TacticsEvent[] {
    require(input.length === 1 && input[0]?.actor === 0, 'Exactly one player choice is required');
    const choice = this.validateChoice(0, input[0].choice), candidate = TacticsDriver.restore(this.module, this.resources, this.snapshot());
    const events = candidate.execute(choice);
    candidate.host.sequence++; candidate.host.eventSequence += events.length;
    candidate.snapshot(); this.api = candidate.api; this.host = candidate.host; return events;
  }
  project(actor: number): TacticsPresentation {
    require(actor === 0, 'Only the player can view this private diagnostic battle');
    const snapshot = this.snapshot(), w = snapshot.core.words, active = w[155]!, own = w.slice(16, 64), wild = w.slice(64, 112);
    const party = this.prepared.player.map((mon, index) => ({ partyIndex: index, speciesId: mon.speciesId, abilityId: mon.abilityId,
      level: mon.level, hp: w[166 + index * 46], maxHP: mon.stats.hp, status: w[196 + index * 46], friendship: w[165 + index * 46],
      moves: mon.moves.flatMap((move, slot) => move.moveId === 0 ? [] : [{ slot, moveId: move.moveId, pp: w[189 + index * 46 + slot],
        maxPP: this.source[index]!.maxPP[slot], ppUps: move.ppUps }]) }));
    const availableChoices: TacticsChoice[] = [], pending = this.host.phase === 'post-faint' || this.host.phase === 'replacement'
      ? { decisionId: pendingId(snapshot), resume: w[158] === 1 ? 'before-residual' as const : 'after-residual' as const } : null;
    if (this.host.phase === 'choice') {
      party[active]!.moves.forEach(move => { if (move.pp! > 0) availableChoices.push({ kind: 'move', slot: move.slot }); });
      if (availableChoices.length === 0) availableChoices.push({ kind: 'struggle' }); availableChoices.push({ kind: 'run' });
      party.forEach(mon => { if (mon.partyIndex !== active && mon.hp! > 0) availableChoices.push({ kind: 'switch', partyIndex: mon.partyIndex }); });
    } else if (this.host.phase === 'post-faint') availableChoices.push({ kind: 'use-next', decisionId: pending!.decisionId }, { kind: 'attempt-run', decisionId: pending!.decisionId });
    else if (this.host.phase === 'replacement') party.forEach(mon => { if (mon.partyIndex !== active && mon.hp! > 0)
      availableChoices.push({ kind: 'replace', partyIndex: mon.partyIndex, decisionId: pending!.decisionId }); });
    return tacticsPresentationSchema.parse({ turn: this.host.turn, phase: this.host.phase, needsChoice: this.host.phase !== 'ended', outcome: this.host.outcome,
      activeIndex: active, party, self: { ...party[active], focusEnergy: own[11] === 0x100000, stages: own.slice(14, 22) },
      opponent: { speciesId: this.prepared.opponent.speciesId, level: this.prepared.opponent.level,
        hpPercent: Math.ceil(wild[1]! * 100 / wild[2]!), status: wild[10] }, pendingDecision: pending,
      weather: { kind: w[483] === 1 ? 'rain' : 'clear', turnsRemaining: w[484] },
      inventory: this.prepared.context.inventory, availableChoices, liveAdmission: false });
  }
  private chooseWild(): number { const slot = checked(this.api.family_choose_wild(), 'wild AI'); require(slot <= 4, 'Unsupported wild choice'); return slot; }
  private finish(outcome: NonNullable<Host['outcome']>, events: TacticsEvent[]): void {
    this.host.phase = 'ended'; this.host.outcome = outcome; events.push(tacticsEventSchema.parse({ kind: 'outcome', outcome }));
  }
  private faint(actor: Actor, events: TacticsEvent[]): void {
    ok(this.api.party_faint_cleanup(actor), 'source faint and friendship');
    events.push(tacticsEventSchema.parse({ kind: 'faint', actor, commands: commands(this.api) }));
  }
  private checkOutcome(events: TacticsEvent[]): boolean {
    ok(this.api.party_sync(), 'source roster sync'); ok(this.api.spike2_check_teams_lost(), 'source full-party outcome');
    const outcome = this.api.spike2_get_outcome(); if (!outcome) return false;
    require(outcome >= 1 && outcome <= 3, 'Unsupported terminal outcome');
    this.finish(({ 1: 'won', 2: 'lost', 3: 'draw' } as const)[outcome as 1 | 2 | 3], events); return true;
  }
  private pending(phase: 1 | 2, events: TacticsEvent[]): void {
    ok(this.api.party_replacement_begin(phase), 'source faint prompt'); this.host.phase = 'post-faint';
    events.push({ kind: 'pending-replacement', resume: phase === 1 ? 'before-residual' : 'after-residual' });
  }
  private switchIn(index: number, forced: boolean, events: TacticsEvent[]): void {
    const from = this.api.party_get(1); ok(this.api.party_switch(index, forced ? 1 : 0), 'source party switch');
    events.push({ kind: 'switch', from, to: index, forced });
  }
  private nextTurn(): void {
    this.host.phase = 'choice'; this.host.turn++; ok(this.api.spike2_begin_turn(), 'next turn'); this.host.wildSlot = this.chooseWild();
  }
  private residual(events: TacticsEvent[]): void {
    const api = this.api, order = ordered(api.party_residual_order());
    ok(api.spike_get_result(0), 'residual order'); events.push({ kind: 'order', phase: 'residual', actors: order });
    const hadRain = api.tactics_get(0) === 1;
    ok(api.tactics_field_end_turn(), 'source field end-turn');
    if (hadRain) this.weatherEvent('end-turn', events);
    for (const actor of order) {
      const status = api.spike_get_battler(actor, 3);
      if (api.spike_get_battler(actor, 0) === 0 || !status) continue;
      ok(api.spike2_residual(actor), 'source residual'); events.push(tacticsEventSchema.parse({ kind: 'residual', actor, status, commands: commands(api) }));
      if (api.spike_get_battler(actor, 0) === 0) this.faint(actor, events);
      if (this.checkOutcome(events)) return;
    }
    if (api.spike_get_battler(0, 0) === 0) this.pending(2, events); else this.nextTurn();
  }
  private weatherEvent(phase: 'move' | 'end-turn', events: TacticsEvent[]): void {
    events.push(tacticsEventSchema.parse({ kind: 'weather', phase, weather: this.api.tactics_get(0) === 1 ? 'rain' : 'clear',
      turnsRemaining: this.api.tactics_get(1) }));
  }
  private execute(choice: TacticsChoice): TacticsEvent[] {
    const events: TacticsEvent[] = [], api = this.api;
    if (choice.kind === 'use-next' || choice.kind === 'attempt-run') {
      this.host.decisionCount++;
      const escaped = checked(api.party_replacement_decide(choice.kind === 'attempt-run' ? 1 : 0), 'source use-next decision');
      require(escaped <= 1, 'Unsupported replacement escape result');
      events.push({ kind: 'replacement-decision', decision: choice.kind, escaped: escaped === 1 });
      if (escaped) this.finish('ran', events); else this.host.phase = 'replacement'; return events;
    }
    if (choice.kind === 'replace') {
      this.host.decisionCount++; const resume = api.party_get(4);
      this.switchIn(choice.partyIndex, true, events);
      if (resume === 1) this.residual(events); else { require(resume === 2, 'Missing source residual continuation'); this.nextTurn(); }
      return events;
    }
    this.host.turnActions++;
    const playerSlot = choice.kind === 'move' ? choice.slot : 4;
    const order = ordered(api.party_order(playerSlot, this.host.wildSlot, choice.kind === 'run' ? 1 : choice.kind === 'switch' ? 2 : 0));
    ok(api.spike_get_result(0), 'action order'); events.push({ kind: 'order', phase: 'actions', actors: order });
    for (const actor of order) {
      if (actor === 0 && choice.kind === 'switch') { this.switchIn(choice.partyIndex, false, events); continue; }
      if (actor === 0 && choice.kind === 'run') {
        const escaped = checked(api.family_run(0), 'run'); require(escaped <= 1, 'Unsupported run result');
        events.push({ kind: 'run', escaped: escaped === 1, attempts: checked(api.party_get(6), 'run attempts') });
        if (escaped) { ok(api.party_sync(), 'escaped roster'); this.finish('ran', events); return events; } continue;
      }
      const slot = actor === 0 ? playerSlot : this.host.wildSlot;
      const moveId = slot === 4 ? 165 : api.spike2_get_move(actor, slot, 0);
      ok(api.spike2_attack(actor, slot), 'source attack');
      const attackCommands = commands(api);
      events.push(tacticsEventSchema.parse({ kind: 'attack', actor, slot, moveId,
        result: { baseDamage: api.spike_get_result(1), afterCritical: api.spike_get_result(2), afterType: api.spike_get_result(3),
          damage: api.spike_get_result(4), flags: api.spike_get_result(5), hpDealt: api.spike_get_result(6),
          targetHP: api.spike_get_result(7), critical: api.spike_get_result(12) }, commands: attackCommands }));
      if (moveId === 240 && !attackCommands.some(command => command.type === 9)) this.weatherEvent('move', events);
      if (api.spike2_get_outcome() === 5) {
        ok(api.party_sync(), 'forced-escape roster'); this.finish('forced-escape', events); return events;
      }
      for (const fainted of [actor, actor === 0 ? 1 : 0] as Actor[]) if (api.spike_get_battler(fainted, 0) === 0) this.faint(fainted, events);
      if (this.checkOutcome(events)) return events;
      if (api.spike_get_battler(0, 0) === 0) { this.pending(1, events); return events; }
    }
    this.residual(events); return events;
  }
}
