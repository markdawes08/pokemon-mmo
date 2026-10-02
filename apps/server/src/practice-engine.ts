/** Server-only practice copies. No test fixtures, owned assets or reward effects. */
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { battleSnapshotSchema, type BattleSnapshot } from '@pokewaterblue/battle-core';
import { practiceCatalogueSchema, practiceChoiceSchema, practiceEventSchema, practiceSessionSchema, practiceSetupSchema,
  type PracticeCatalogue, type PracticeChoice, type PracticeEvent, type PracticeMon, type PracticeSetup } from '@pokewaterblue/protocol';
import { gameplayServerSchema, type GameplayServerContent } from '../../../packages/content-schema/src/gameplay-server.js';
import { createPursuitDiagnostic, loadPursuitEngine, makePursuitRng, pursuitConfig, pursuitCheckpointSchema,
  PURSUIT_MOVES, PURSUIT_SOURCE, type PursuitCreature, type PursuitEngine, type PursuitEvent } from '../../../tools/battle-pursuit/engine.js';
import { DEVELOPMENT_CONTENT_HASH } from './development-profile.js';

type PracticeSession = z.infer<typeof practiceSessionSchema>;
export interface PracticeStored { snapshot: BattleSnapshot; setup: PracticeSetup; events: PracticeEvent[] }
const storedSchema = z.strictObject({ snapshot: battleSnapshotSchema, setup: practiceSetupSchema, events: z.array(practiceEventSchema).max(200) });
export class PracticeEngineError extends Error {
  constructor(readonly code: 'INVALID_MESSAGE' | 'NOT_READY', message: string) { super(message); this.name = 'PracticeEngineError'; }
}
const speciesIds = [7, 8, 9, 16, 17, 18, 19, 20];
const statKeys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
type Stats = PursuitCreature['stats'];
function stats(value: number): Stats { return { hp: value, attack: value, defense: value, speed: value, spAttack: value, spDefense: value }; }
function invalid(message: string): never { throw new PracticeEngineError('INVALID_MESSAGE', message); }
function unavailable(): never { throw new PracticeEngineError('NOT_READY', 'This practice battle is incompatible or unavailable. Close it and start a new practice battle.'); }
function mon(speciesId: number, moveIds: number[], overrides: Partial<PracticeMon> = {}): PracticeMon {
  return { speciesId, moveIds, level: 50, abilityNum: 0, status: 0, hpPercent: 100, ppPercent: 100, ...overrides };
}
function presets(): PracticeCatalogue['presets'] {
  const row = (id: string, name: string, description: string, player: PracticeMon[], opponent: PracticeMon) => ({ id, name, description, setup: { player, opponent } });
  return [
    row('first-battle', 'First battle', 'Level-five Squirtle versus a Route 1 Rattata. These are practice copies.',
      [mon(7, [33, 39], { level: 5 })], mon(19, [33, 39], { level: 3 })),
    row('rain-and-water', 'Rain and water moves', 'Try Rain Dance, Bubble, Water Gun and Hydro Pump. Customise any supported species or move below.',
      [mon(7, [240, 145, 55, 56])], mon(9, [110, 33])),
    row('protect-and-charge', 'Protect and Skull Bash', 'The opponent charges Skull Bash. Protect can block its release; your own charge must finish or be interrupted.',
      [mon(7, [182, 130, 110, 33])], mon(9, [130])),
    row('pursuit-switch', 'Pursuit interception', 'Switch to your reserve while the wild Raticate has Pursuit. The outgoing member takes the interception.',
      [mon(7, [33, 44, 229, 110]), mon(18, [16, 17, 98, 97])], mon(20, [228])),
    row('stat-changes', 'Stat changes and Whirlwind', 'Try accuracy, Attack and Speed changes, then Whirlwind. Wild Whirlwind ends this practice battle.',
      [mon(18, [28, 297, 97, 18])], mon(20, [184, 116, 98])),
    row('torrent', 'Torrent at low HP', 'Squirtle starts at 30% HP to activate Torrent for Water moves.',
      [mon(7, [55, 145, 56, 240], { hpPercent: 30 })], mon(9, [110])),
    row('guts', 'Guts and burn', 'A burned Guts Raticate tests physical damage and residual burn. Pursuit remains a special Dark move.',
      [mon(20, [33, 158, 228, 116], { abilityNum: 1, status: 16 })], mon(9, [110, 33])),
    row('fixed-damage', 'Super Fang and Endeavor', 'Raticate starts at 25% HP. Compare Super Fang and Endeavor with an ordinary attack.',
      [mon(20, [162, 283, 158, 98], { hpPercent: 25 })], mon(9, [110])),
    row('struggle', 'Out of PP', 'All your move PP is empty, so the source offers automatic Struggle and recoil.',
      [mon(7, [33], { ppPercent: 0 })], mon(9, [110])),
  ];
}

export class PracticeEngine {
  private readonly catalog: PracticeCatalogue;
  constructor(private readonly engine: PursuitEngine, private readonly definitions: GameplayServerContent) {
    if (definitions.sourceFingerprint !== PURSUIT_SOURCE) unavailable();
    const allowed = new Set<number>(PURSUIT_MOVES);
    const types = new Map(definitions.types.map(row => [row.id, row.name]));
    this.catalog = practiceCatalogueSchema.parse({ version: 'practice-v1',
      species: speciesIds.map(id => {
        const entry = definitions.species.find(row => row.id === id); if (!entry) return unavailable();
        const first = id <= 9 ? 7 : id <= 18 ? 16 : 19;
        const legal = new Map<number, number>();
        for (const ancestor of definitions.species.filter(row => row.id >= first && row.id <= id)) {
          for (const learn of ancestor.levelUpLearnset) if (allowed.has(learn.move.id))
            legal.set(learn.move.id, Math.min(learn.level, legal.get(learn.move.id) ?? 100));
        }
        return { id, name: entry.name, abilities: entry.abilities.flatMap((ability, slot) => ability.id === 0 ? []
          : [{ slot, id: ability.id, name: definitions.abilities.find(row => row.id === ability.id)!.name }]),
        moves: [...legal].map(([id, level]) => ({ id, level })).sort((a, b) => a.level - b.level || a.id - b.id),
        frontSprite: `/content/practice/sprites/${id}-front.png`, backSprite: `/content/practice/sprites/${id}-back.png` };
      }),
      moves: definitions.moves.filter(move => allowed.has(move.id)).map(move => ({ id: move.id, name: move.name,
        type: types.get(move.type.id), power: move.power, accuracy: move.accuracy, pp: move.pp })), presets: presets(),
    });
    if (this.catalog.moves.length !== 24 || this.catalog.species.length !== 8) unavailable();
  }
  catalogue(): PracticeCatalogue { return structuredClone(this.catalog); }
  private creature(input: PracticeMon): PursuitCreature {
    const entry = this.definitions.species.find(row => row.id === input.speciesId);
    const legal = this.catalog.species.find(row => row.id === input.speciesId);
    if (!entry || !legal) invalid('Select one of the eight supported practice species.');
    if (!legal.abilities.some(ability => ability.slot === input.abilityNum)) invalid('This species does not have that ability slot.');
    if (new Set(input.moveIds).size !== input.moveIds.length || input.moveIds.some(move => !legal.moves.some(row => row.id === move && row.level <= input.level)))
      invalid('Select distinct supported moves learned by this species or its pre-evolution at the chosen level.');
    // Candidate construction follows CalculateMonStats/CALC_STAT for the fixed
    // neutral personality25, IV15/EV0 policy. Unchanged source C independently
    // recomputes and validates every statistic/XP/PP/ability during admission.
    const calculated = Object.fromEntries(statKeys.map(key => [key,
      Math.floor((2 * entry.stats[key] + 15) * input.level / 100) + (key === 'hp' ? input.level + 10 : 5),
    ])) as Stats;
    const moves = input.moveIds.map(moveId => ({ moveId,
      pp: Math.floor(this.definitions.moves.find(row => row.id === moveId)!.pp * input.ppPercent / 100), ppUps: 0 }));
    while (moves.length < 4) moves.push({ moveId: 0, pp: 0, ppUps: 0 });
    return { speciesId: input.speciesId as PursuitCreature['speciesId'], abilityId: entry.abilities[input.abilityNum]!.id as PursuitCreature['abilityId'],
      abilityNum: input.abilityNum, personality: 25, otId: 1, level: input.level,
      experience: this.definitions.growthRates.find(row => row.id === entry.growthRate.id)!.experience[input.level]!,
      friendship: entry.friendship, hp: Math.max(1, Math.floor(calculated.hp * input.hpPercent / 100)), stats: calculated,
      ivs: stats(15), evs: stats(0), calculatedEvs: stats(0), moves, status: input.status,
      heldItemId: 0, ballItemId: null, metLocation: null };
  }
  create(battleId: string, rawSetup: PracticeSetup): PracticeStored {
    try {
      z.uuid().parse(battleId);
      const setup = practiceSetupSchema.parse(rawSetup);
      const initial = createPursuitDiagnostic({ seed: randomBytes(4).readUInt32LE(),
        player: setup.player.map(value => this.creature(value)), opponent: this.creature(setup.opponent) });
      const snapshot = this.engine.createBattle(pursuitConfig(this.engine, battleId), initial, makePursuitRng(battleId, initial));
      return { snapshot, setup, events: [{ sequence: 0, kind: 'info', text: 'Practice battle started. Account Pokémon, items, money and progress are unchanged.' }] };
    } catch (error) {
      if (error instanceof PracticeEngineError) throw error;
      invalid('The practice setup is invalid or failed source creature validation.');
    }
  }
  restore(raw: PracticeStored): PracticeStored {
    try {
      const stored = storedSchema.parse(raw), snapshot = this.engine.restore(stored.snapshot);
      const checkpoint = pursuitCheckpointSchema.parse(JSON.parse(Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8')));
      const expected = { player: stored.setup.player.map(value => this.creature(value)), opponent: this.creature(stored.setup.opponent) };
      if (checkpoint.admission.kind !== 'diagnostic' || !isDeepStrictEqual(checkpoint.admission.player, expected.player)
        || !isDeepStrictEqual(checkpoint.admission.opponent, expected.opponent)) unavailable();
      let previous = -1;
      for (const event of stored.events) {
        if (event.sequence <= previous || event.sequence > snapshot.eventSequence) unavailable();
        previous = event.sequence;
      }
      return { snapshot, setup: stored.setup, events: stored.events };
    } catch { return unavailable(); }
  }
  advance(raw: PracticeStored, rawChoice: PracticeChoice): PracticeStored {
    const stored = this.restore(raw), choice = practiceChoiceSchema.safeParse(rawChoice);
    if (!choice.success) invalid('Unsupported practice choice.');
    const accepted = this.engine.validateChoice(stored.snapshot, 'player', choice.data);
    if (!accepted.accepted) invalid(accepted.reason);
    try {
      const before = this.engine.project(stored.snapshot, 'player').presentation;
      const advanced = this.engine.advance(stored.snapshot, [accepted.value]);
      if (advanced.domainEffects.length) unavailable();
      let active = before.activeIndex;
      const events = [...stored.events];
      for (const event of advanced.orderedEvents) {
        const names = [this.speciesName(stored.setup.player[active]!.speciesId), `Wild ${this.speciesName(stored.setup.opponent.speciesId)}`];
        const visible = this.eventText(event.payload, names, stored.setup);
        if (visible) events.push(practiceEventSchema.parse({ sequence: event.sequence, ...visible }));
        if (event.payload.kind === 'switch') active = event.payload.to;
      }
      return this.restore({ snapshot: advanced.nextState, setup: stored.setup, events: events.slice(-200) });
    } catch (error) {
      if (error instanceof PracticeEngineError) throw error;
      return unavailable();
    }
  }
  project(battleId: string, raw: PracticeStored): PracticeSession {
    const stored = this.restore(raw);
    if (stored.snapshot.config.battleId !== battleId) unavailable();
    const view = this.engine.project(stored.snapshot, 'player').presentation;
    const publicMon = (value: typeof view.self | typeof view.party[number]) => ({ partyIndex: value.partyIndex, speciesId: value.speciesId,
      abilityId: value.abilityId, level: value.level, hp: value.hp, maxHP: value.maxHP, status: value.status,
      moves: value.moves.map(move => ({ slot: move.slot, moveId: move.moveId, pp: move.pp, maxPP: move.maxPP })) });
    return practiceSessionSchema.parse({ battleId, setup: stored.setup, events: stored.events, presentation: {
      turn: view.turn, phase: view.phase, outcome: view.outcome, activeIndex: view.activeIndex, party: view.party.map(publicMon),
      self: { ...publicMon(view.self), focusEnergy: view.self.focusEnergy, charging: view.self.charging,
        protected: view.self.protected, stages: view.self.stages }, opponent: view.opponent, weather: view.weather, availableChoices: view.availableChoices,
    } });
  }
  private speciesName(id: number): string { return this.catalog.species.find(row => row.id === id)!.name; }
  private eventText(event: PursuitEvent, names: string[], setup: PracticeSetup): Omit<PracticeEvent, 'sequence'> | null {
    const outcome = { won: 'You won the practice battle.', lost: 'Your practice party fainted.', draw: 'Both practice parties fainted.',
      ran: 'You escaped from the practice battle.', 'forced-escape': 'Whirlwind ended the practice battle.' };
    switch (event.kind) {
      case 'order': return null;
      case 'attack': {
        const actor = event.actor, name = this.catalog.moves.find(move => move.id === event.moveId)?.name ?? 'STRUGGLE';
        const cancelled = event.commands.some(command => command.type === 9);
        let text = cancelled ? `${names[actor]} flinched and could not move.` : `${names[actor]} used ${name}.`;
        if (!cancelled) {
          if (event.result.flags & 1) text += ' It missed or was blocked.';
          else if (event.result.flags & 32) text += ' It failed.';
          else if (event.result.critical === 2) text += ' A critical hit!';
          if (event.commands.some(command => command.type === 6)) text += ' Stat stages changed.';
          for (const command of event.commands.filter(command => command.type === 7)) {
            const ability = this.definitions.abilities.find(row => row.id === command.value);
            if (ability) text += ` ${ability.name} activated.`;
          }
        }
        return { kind: 'attack', actor, text };
      }
      case 'switch': return { kind: 'switch', actor: 0, text: `Go, ${this.speciesName(setup.player[event.to]!.speciesId)}!` };
      case 'pursuit-intercept': return { kind: 'info', actor: 1, text: 'Pursuit intercepted your switching Pokémon!' };
      case 'faint': return { kind: 'faint', actor: event.actor, text: `${names[event.actor]} fainted.` };
      case 'residual': return { kind: 'damage', actor: event.actor, text: `${names[event.actor]} was hurt by ${event.status === 8 ? 'poison' : 'burn'}.` };
      case 'weather': return { kind: 'weather', text: event.weather === 'rain' ? `Rain is falling (${event.turnsRemaining} turns remaining).` : 'The rain stopped.' };
      case 'charge': return { kind: 'status', actor: event.actor as 0 | 1, text: event.charging ? `${names[event.actor]} is charging Skull Bash.` : `${names[event.actor]}'s charge ended.` };
      case 'protect': return { kind: 'status', actor: event.actor as 0 | 1, text: event.protected ? `${names[event.actor]} protected itself.` : `${names[event.actor]}'s Protect did not take effect.` };
      case 'run': return { kind: 'info', actor: 0, text: event.escaped ? 'You got away safely.' : 'You could not escape.' };
      case 'pending-replacement': return { kind: 'info', text: 'Use your next Pokémon, or attempt to escape?' };
      case 'replacement-decision': return { kind: 'info', text: event.escaped ? 'You escaped.' : event.decision === 'attempt-run' ? 'Escape failed. Choose a replacement.' : 'Choose a replacement.' };
      case 'outcome': return { kind: 'result', text: `${outcome[event.outcome]} No account rewards or losses were applied.` };
    }
  }
}

export async function loadPracticeEngine(): Promise<PracticeEngine> {
  const [bytes, engine] = await Promise.all([readFile('content/generated/server/gameplay.json'), loadPursuitEngine()]);
  if (createHash('sha256').update(bytes).digest('hex') !== DEVELOPMENT_CONTENT_HASH) unavailable();
  return new PracticeEngine(engine, gameplayServerSchema.parse(JSON.parse(bytes.toString('utf8'))));
}
