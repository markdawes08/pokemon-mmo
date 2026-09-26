/** Server battle boundary; the selected WASM adapter admits only its audited profile. */
import { z } from 'zod';

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const kind = z.string().min(1).max(64).regex(/^[a-z][a-z0-9.-]*$/);
const version = z.number().int().positive().max(65535);
const opaqueBytes = z.strictObject({
  encoding: z.literal('base64'),
  data: z.string().min(4).max(1_398_104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine(value => Buffer.from(value, 'base64').toString('base64') === value, 'Noncanonical base64'),
});
export const battleCompatibilitySchema = z.strictObject({
  contractVersion: z.literal(1), snapshotVersion: z.literal(1), engineId: identity, engineVersion: identity,
  rulesVersion: identity, contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/), engineStateVersion: version,
  rngAlgorithm: identity, rngVersion: version,
});
const effectKind = z.strictObject({ kind, version });
export const battlePolicySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('pve'), allowedDomainEffects: z.array(effectKind).max(64) }),
  // Initial PvP changes only battle-local copies. Match results belong in the
  // battle record, not an effect capable of touching an owned asset.
  z.strictObject({ mode: z.literal('pvp-copy'), allowedDomainEffects: z.array(effectKind).length(0) }),
]).superRefine((policy, context) => {
  if (new Set(policy.allowedDomainEffects.map(effect => effect.kind)).size !== policy.allowedDomainEffects.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate allowed domain effect kind' });
  }
});
export const battleConfigSchema = z.strictObject({
  battleId: identity, compatibility: battleCompatibilitySchema, policy: battlePolicySchema,
  participantIds: z.array(identity).min(2).max(4),
}).superRefine((config, context) => {
  if (new Set(config.participantIds).size !== config.participantIds.length) context.addIssue({ code: 'custom', message: 'Duplicate battle participant' });
});
export const battleRngSchema = z.strictObject({
  battleId: identity, algorithm: identity, version, draws: sequence, privateState: opaqueBytes,
});
export const battleSnapshotSchema = z.strictObject({
  config: battleConfigSchema, transitionSequence: sequence, eventSequence: sequence,
  rng: battleRngSchema, privateEngineState: opaqueBytes,
}).superRefine((snapshot, context) => {
  const compatibility = snapshot.config.compatibility;
  if (snapshot.rng.battleId !== snapshot.config.battleId || snapshot.rng.algorithm !== compatibility.rngAlgorithm || snapshot.rng.version !== compatibility.rngVersion) {
    context.addIssue({ code: 'custom', message: 'RNG identity or version does not match battle snapshot' });
  }
});

export type BattleCompatibility = z.infer<typeof battleCompatibilitySchema>;
export type BattleConfig = z.infer<typeof battleConfigSchema>;
export type BattleRngState = z.infer<typeof battleRngSchema>;
export type BattleSnapshot = z.infer<typeof battleSnapshotSchema>;
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface AcceptedChoice<T> {
  battleId: string;
  transitionSequence: number;
  actorId: string;
  choice: T;
}
export type ChoiceValidation<T> = { accepted: true; value: AcceptedChoice<T> }
  | { accepted: false; code: 'unsupported-choice' | 'illegal-choice' | 'stale-choice'; reason: string };
export interface BattleEvent<T> { battleId: string; transitionSequence: number; sequence: number; payload: T }
export interface DomainEffect<T = unknown> {
  battleId: string;
  transitionSequence: number;
  effectIndex: number;
  kind: string;
  version: number;
  payload: T;
}
/** Presentation is an explicit whitelist, never the private engine state. */
export interface PermittedBattleView<T> {
  battleId: string;
  transitionSequence: number;
  eventSequence: number;
  viewerId: string;
  presentation: T;
}
export interface BattleAdvance<TState, TEvent, TEffect> {
  nextState: TState;
  orderedEvents: BattleEvent<TEvent>[];
  domainEffects: DomainEffect<TEffect>[];
}

/** Methods must not mutate their inputs, published room state or durable data.
 * A concrete adapter must validate its own payload bytes and legal mechanics.
 * Server-owned RNG is supplied only through this private server interface.
 */
export interface BattleEngine<TState, TInitial, TChoice, TAccepted, TPresentation, TEvent, TEffect> {
  readonly compatibility: DeepReadonly<BattleCompatibility>;
  createBattle(config: DeepReadonly<BattleConfig>, initialState: DeepReadonly<TInitial>, rngState: DeepReadonly<BattleRngState>): TState;
  validateChoice(state: DeepReadonly<TState>, actorId: string, choice: DeepReadonly<TChoice>): ChoiceValidation<TAccepted>;
  advance(state: DeepReadonly<TState>, acceptedChoices: readonly DeepReadonly<AcceptedChoice<TAccepted>>[]): BattleAdvance<TState, TEvent, TEffect>;
  snapshot(state: DeepReadonly<TState>): BattleSnapshot;
  restore(snapshot: DeepReadonly<BattleSnapshot>): TState;
  project(state: DeepReadonly<TState>, viewerId: string): PermittedBattleView<TPresentation>;
}

export class BattleContractError extends Error {
  constructor(message: string) { super(message); this.name = 'BattleContractError'; }
}
function requireContract(condition: boolean, message: string): asserts condition {
  if (!condition) throw new BattleContractError(message);
}
function sameCompatibility(actual: BattleCompatibility, expected: BattleCompatibility): boolean {
  return (Object.keys(expected) as (keyof BattleCompatibility)[]).every(key => actual[key] === expected[key]);
}

/** Clone and validate the envelope before allowing an adapter to decode bytes. */
export function parseCompatibleSnapshot(input: unknown, expectedInput: unknown): BattleSnapshot {
  const expected = battleCompatibilitySchema.parse(expectedInput);
  const snapshot = battleSnapshotSchema.parse(input);
  requireContract(sameCompatibility(snapshot.config.compatibility, expected), 'Incompatible engine, rules, content or snapshot payload version');
  return snapshot;
}

export function createPermittedViewSchema<T extends z.ZodRawShape>(presentation: z.ZodObject<T>) {
  return z.strictObject({ battleId: identity, transitionSequence: sequence, eventSequence: sequence, viewerId: identity,
    presentation: presentation.strict() });
}

export function parsePermittedView<T extends z.ZodRawShape>(snapshotInput: unknown, input: unknown, viewerId: string, presentation: z.ZodObject<T>) {
  const snapshot = battleSnapshotSchema.parse(snapshotInput);
  const view = createPermittedViewSchema(presentation).parse(input);
  requireContract(view.viewerId === viewerId && snapshot.config.participantIds.includes(viewerId), 'Wrong or unauthorized battle viewer');
  requireContract(view.battleId === snapshot.config.battleId && view.transitionSequence === snapshot.transitionSequence
    && view.eventSequence === snapshot.eventSequence, 'Projection identity does not match current battle snapshot');
  return view;
}

export function parseAcceptedChoices<T>(snapshotInput: unknown, input: unknown, choiceSchema: z.ZodType<T>): AcceptedChoice<T>[] {
  const snapshot = battleSnapshotSchema.parse(snapshotInput);
  const choices = z.array(z.strictObject({ battleId: identity, transitionSequence: sequence, actorId: identity, choice: choiceSchema })).max(4).parse(input);
  const actors = new Set<string>();
  for (const accepted of choices) {
    requireContract(accepted.battleId === snapshot.config.battleId && accepted.transitionSequence === snapshot.transitionSequence, 'Stale or wrong-battle accepted choice');
    requireContract(snapshot.config.participantIds.includes(accepted.actorId) && !actors.has(accepted.actorId), 'Unknown or duplicate accepted-choice actor');
    actors.add(accepted.actorId);
  }
  // Mechanics decide which actors are currently required, and whether a choice
  // is legal. Passing this envelope guard alone does not accept a player action.
  return choices;
}

export interface DomainEffectRegistration { kind: string; version: number; payload: z.ZodType }
const rawEffectSchema = z.strictObject({ battleId: identity, transitionSequence: sequence, effectIndex: sequence,
  kind, version, payload: z.unknown() });

/** Validate one transition's new effects/events, never cumulative history.
 * A domain service must invoke this independently of the chosen engine and
 * persist each effect identity atomically with nextSnapshot. This is not a DB
 * deduplicator; retry safety still requires a permanent unique business key.
 */
export function createTransitionGuard<TEvent>(eventPayload: z.ZodType<TEvent>, registrations: readonly DomainEffectRegistration[]) {
  const registry = new Map<string, DomainEffectRegistration>();
  for (const registration of registrations) {
    effectKind.parse({ kind: registration.kind, version: registration.version });
    requireContract(!registry.has(registration.kind), 'Duplicate domain effect registration');
    registry.set(registration.kind, { ...registration });
  }
  const eventsSchema = z.array(z.strictObject({ battleId: identity, transitionSequence: sequence, sequence: sequence, payload: eventPayload })).max(4096);
  const transitionSchema = z.strictObject({ nextSnapshot: battleSnapshotSchema, orderedEvents: eventsSchema, domainEffects: z.array(rawEffectSchema).max(1024) });
  return (previousInput: unknown, transitionInput: unknown) => {
    const previous = battleSnapshotSchema.parse(previousInput);
    const transition = transitionSchema.parse(transitionInput);
    const next = transition.nextSnapshot;
    requireContract(sameCompatibility(next.config.compatibility, previous.config.compatibility), 'Transition changed engine, rules or content versions');
    requireContract(next.config.battleId === previous.config.battleId, 'Transition belongs to another battle');
    requireContract(JSON.stringify(next.config.policy) === JSON.stringify(previous.config.policy)
      && JSON.stringify(next.config.participantIds) === JSON.stringify(previous.config.participantIds), 'Transition changed immutable mode, policy or participants');
    requireContract(next.transitionSequence === previous.transitionSequence + 1, 'Transition sequence must advance exactly once');
    requireContract(next.rng.draws >= previous.rng.draws, 'Transition rewound per-battle RNG draw count');
    requireContract(next.rng.draws !== previous.rng.draws || next.rng.privateState.data === previous.rng.privateState.data,
      'Transition changed RNG state without drawing');
    requireContract(next.eventSequence === previous.eventSequence + transition.orderedEvents.length, 'Snapshot event sequence does not match new events');
    transition.orderedEvents.forEach((event, index) => {
      requireContract(event.battleId === previous.config.battleId && event.transitionSequence === next.transitionSequence
        && event.sequence === previous.eventSequence + index + 1, 'Wrong battle, transition or nonmonotonic event identity');
    });
    const allowed = new Map(previous.config.policy.allowedDomainEffects.map(effect => [effect.kind, effect.version]));
    for (const [effectKind, effectVersion] of allowed) {
      requireContract(registry.get(effectKind)?.version === effectVersion, 'Policy references an unregistered effect version');
    }
    requireContract(previous.config.policy.mode !== 'pvp-copy' || transition.domainEffects.length === 0, 'pvp-copy permits no persistent domain effects');
    const domainEffects: DomainEffect[] = transition.domainEffects.map((effect, index) => {
      requireContract(effect.battleId === previous.config.battleId && effect.transitionSequence === next.transitionSequence && effect.effectIndex === index,
        'Wrong battle, transition, duplicate or noncontiguous domain effect identity');
      const registration = registry.get(effect.kind);
      requireContract(registration !== undefined && registration.version === effect.version && allowed.get(effect.kind) === effect.version,
        'Unregistered or disallowed domain effect kind/version');
      return { ...effect, payload: registration.payload.parse(effect.payload) };
    });
    return { ...transition, domainEffects };
  };
}

/** Tuple components are parsed first, making delimiters unambiguous. */
export function domainEffectIdentity(effect: Pick<DomainEffect, 'battleId' | 'transitionSequence' | 'effectIndex'>): string {
  const parsed = z.strictObject({ battleId: identity, transitionSequence: sequence, effectIndex: sequence })
    .parse({ battleId: effect.battleId, transitionSequence: effect.transitionSequence, effectIndex: effect.effectIndex });
  return JSON.stringify([parsed.battleId, parsed.transitionSequence, parsed.effectIndex]);
}
