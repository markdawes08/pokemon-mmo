/** Synchronous server adapter around an isolated, versioned WASM kernel.
 * The injected kernel defines the admitted rules. This module owns envelopes,
 * participant mapping, event identities and the no-persistent-effects policy.
 */
import { z } from 'zod';
import {
  battleCompatibilitySchema, battleConfigSchema, battleRngSchema, parseCompatibleSnapshot, parseAcceptedChoices,
  parsePermittedView, createTransitionGuard, type AcceptedChoice, type BattleAdvance, type BattleCompatibility,
  type BattleConfig, type BattleEngine, type BattleRngState, type BattleSnapshot, type ChoiceValidation,
  type DeepReadonly, type PermittedBattleView,
} from './contracts';

export interface KernelSession<Choice, Event, Presentation, Checkpoint> {
  snapshot(): Checkpoint;
  requiredActors(): number[];
  validateChoice(actor: number, choice: unknown): Choice;
  advanceChoices(choices: { actor: number; choice: Choice }[]): Event[];
  project(actor: number): Presentation;
}
export interface WasmKernel<Initial, Choice, Event, Shape extends z.ZodRawShape, Checkpoint> {
  initialSchema: z.ZodType<Initial>;
  choiceSchema: z.ZodType<Choice>;
  eventSchema: z.ZodType<Event>;
  presentationSchema: z.ZodObject<Shape>;
  checkpointSchema: z.ZodType<Checkpoint>;
  create(initial: Initial, rng: Uint8Array, draws: number): KernelSession<Choice, Event, z.infer<z.ZodObject<Shape>>, Checkpoint>;
  restore(checkpoint: Checkpoint): KernelSession<Choice, Event, z.infer<z.ZodObject<Shape>>, Checkpoint>;
  metadata(checkpoint: Checkpoint): { transitionSequence: number; eventSequence: number; rng: Uint8Array; draws: number };
}

function require(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
const encode = (value: unknown) => ({ encoding: 'base64' as const, data: Buffer.from(JSON.stringify(value), 'utf8').toString('base64') });
const encodeRng = (bytes: Uint8Array) => ({ encoding: 'base64' as const, data: Buffer.from(bytes).toString('base64') });
function decode(value: BattleSnapshot['privateEngineState']): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value.data, 'base64'));
  return JSON.parse(text);
}

/** This initial adapter admits only policies with no durable effects. A future
 * effects implementation must register real payloads and pass the independent
 * transition guard before it can be enabled; unsupported effects fail here.
 */
export function createWasmBattleAdapter<Initial, Choice, Event, Shape extends z.ZodRawShape, Checkpoint>(
  compatibilityInput: BattleCompatibility, kernel: WasmKernel<Initial, Choice, Event, Shape, Checkpoint>,
): BattleEngine<BattleSnapshot, Initial, Choice, Choice, z.infer<z.ZodObject<Shape>>, Event, never> {
  const compatibility = Object.freeze(battleCompatibilitySchema.parse(compatibilityInput));
  const guard = createTransitionGuard(kernel.eventSchema, []);
  const config = (input: unknown) => {
    const value = battleConfigSchema.parse(input);
    require(value.participantIds.length === 2, 'This adapter admits exactly two participants');
    require(value.policy.allowedDomainEffects.length === 0, 'Persistent effects are not implemented by this adapter');
    require(JSON.stringify(value.compatibility) === JSON.stringify(compatibility), 'Incompatible battle creation configuration');
    return value;
  };
  const pack = (battleConfig: BattleConfig, checkpointInput: unknown): BattleSnapshot => {
    const checkpoint = kernel.checkpointSchema.parse(checkpointInput);
    const metadata = kernel.metadata(checkpoint);
    return parseCompatibleSnapshot({ config: battleConfig, transitionSequence: metadata.transitionSequence, eventSequence: metadata.eventSequence,
      rng: { battleId: battleConfig.battleId, algorithm: compatibility.rngAlgorithm, version: compatibility.rngVersion,
        draws: metadata.draws, privateState: encodeRng(metadata.rng) }, privateEngineState: encode(checkpoint) }, compatibility);
  };
  const open = (input: unknown) => {
    const snapshot = parseCompatibleSnapshot(input, compatibility);
    const battleConfig = config(snapshot.config);
    const checkpoint = kernel.checkpointSchema.parse(decode(snapshot.privateEngineState));
    const session = kernel.restore(checkpoint);
    const canonical = pack(battleConfig, session.snapshot());
    require(canonical.privateEngineState.data === snapshot.privateEngineState.data, 'Noncanonical engine checkpoint');
    require(canonical.transitionSequence === snapshot.transitionSequence && canonical.eventSequence === snapshot.eventSequence,
      'Snapshot counters differ from the engine checkpoint');
    require(canonical.rng.draws === snapshot.rng.draws && canonical.rng.privateState.data === snapshot.rng.privateState.data,
      'Snapshot RNG differs from the engine checkpoint');
    return { snapshot: canonical, session };
  };
  return {
    compatibility,
    createBattle(configInput: DeepReadonly<BattleConfig>, initialInput: DeepReadonly<Initial>, rngInput: DeepReadonly<BattleRngState>): BattleSnapshot {
      const battleConfig = config(configInput);
      const rng = battleRngSchema.parse(rngInput);
      require(rng.battleId === battleConfig.battleId && rng.algorithm === compatibility.rngAlgorithm && rng.version === compatibility.rngVersion,
        'Wrong initial RNG identity');
      const session = kernel.create(kernel.initialSchema.parse(initialInput), Buffer.from(rng.privateState.data, 'base64'), rng.draws);
      return pack(battleConfig, session.snapshot());
    },
    validateChoice(state: DeepReadonly<BattleSnapshot>, actorId: string, choice: DeepReadonly<Choice>): ChoiceValidation<Choice> {
      const { snapshot, session } = open(state);
      const actor = snapshot.config.participantIds.indexOf(actorId);
      if (actor < 0 || !session.requiredActors().includes(actor)) return { accepted: false, code: 'illegal-choice', reason: 'Actor has no pending choice' };
      const parsed = kernel.choiceSchema.safeParse(choice);
      if (!parsed.success) return { accepted: false, code: 'unsupported-choice', reason: 'Unsupported choice shape' };
      try {
        const accepted = session.validateChoice(actor, parsed.data);
        return { accepted: true, value: { battleId: snapshot.config.battleId, transitionSequence: snapshot.transitionSequence, actorId, choice: accepted } };
      } catch {
        return { accepted: false, code: 'illegal-choice', reason: 'Choice is unavailable at this checkpoint' };
      }
    },
    advance(state: DeepReadonly<BattleSnapshot>, input: readonly DeepReadonly<AcceptedChoice<Choice>>[]): BattleAdvance<BattleSnapshot, Event, never> {
      const { snapshot, session } = open(state);
      const accepted = parseAcceptedChoices(snapshot, input, kernel.choiceSchema);
      const required = session.requiredActors();
      require(required.length > 0 && accepted.length === required.length, 'All required choices must be present for a transition');
      const choices = accepted.map(row => ({ actor: snapshot.config.participantIds.indexOf(row.actorId), choice: row.choice }));
      require(required.every(actor => choices.some(row => row.actor === actor)), 'Wrong accepted-choice actors');
      // Accepted envelopes can be forged or recovered independently; recheck
      // legal choices against this exact snapshot before executing the kernel.
      for (const row of choices) row.choice = session.validateChoice(row.actor, row.choice);
      const events = session.advanceChoices(choices);
      const nextSnapshot = pack(snapshot.config, session.snapshot());
      const checked = guard(snapshot, { nextSnapshot,
        orderedEvents: events.map((payload, index) => ({ battleId: snapshot.config.battleId,
          transitionSequence: nextSnapshot.transitionSequence, sequence: snapshot.eventSequence + index + 1, payload })), domainEffects: [] });
      return { nextState: checked.nextSnapshot, orderedEvents: checked.orderedEvents, domainEffects: [] };
    },
    snapshot(state: DeepReadonly<BattleSnapshot>): BattleSnapshot { return open(state).snapshot; },
    restore(snapshot: DeepReadonly<BattleSnapshot>): BattleSnapshot { return open(snapshot).snapshot; },
    project(state: DeepReadonly<BattleSnapshot>, viewerId: string): PermittedBattleView<z.infer<z.ZodObject<Shape>>> {
      const { snapshot, session } = open(state);
      const actor = snapshot.config.participantIds.indexOf(viewerId);
      require(actor >= 0, 'Unauthorized battle viewer');
      return parsePermittedView(snapshot, { battleId: snapshot.config.battleId, transitionSequence: snapshot.transitionSequence,
        eventSequence: snapshot.eventSequence, viewerId, presentation: session.project(actor) }, viewerId, kernel.presentationSchema);
    },
  };
}
