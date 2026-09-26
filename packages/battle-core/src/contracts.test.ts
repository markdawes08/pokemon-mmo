import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  battleSnapshotSchema, createPermittedViewSchema, createTransitionGuard, domainEffectIdentity,
  parseAcceptedChoices, parseCompatibleSnapshot, parsePermittedView, type BattleSnapshot,
} from './contracts';

const compatibility = {
  contractVersion: 1, snapshotVersion: 1, engineId: 'contract-fixture', engineVersion: 'test-v1',
  rulesVersion: 'firered-fixture-v1', contentFingerprint: 'a'.repeat(64), engineStateVersion: 1,
  rngAlgorithm: 'test-rng', rngVersion: 1,
} as const;
const snapshot = (): BattleSnapshot => ({
  config: { battleId: 'battle:one', compatibility: { ...compatibility }, participantIds: ['player', 'opponent'],
    policy: { mode: 'pve', allowedDomainEffects: [{ kind: 'test-consume', version: 1 }] } },
  transitionSequence: 8, eventSequence: 12,
  rng: { battleId: 'battle:one', algorithm: 'test-rng', version: 1, draws: 5, privateState: { encoding: 'base64', data: 'AQIDBA==' } },
  privateEngineState: { encoding: 'base64', data: 'c3RhdGU=' },
});
// Test-only effect/event schemas exercise the boundary; they implement no item
// consumption or battle engine and are not a production mechanics catalog.
const eventSchema = z.strictObject({ text: z.string().min(1) });
const effectSchema = z.strictObject({ itemId: z.number().int().positive(), count: z.number().int().positive().max(999) });
const registration = { kind: 'test-consume', version: 1, payload: effectSchema };
const guard = createTransitionGuard(eventSchema, [registration]);
const transition = () => {
  const nextSnapshot = snapshot();
  nextSnapshot.transitionSequence = 9;
  nextSnapshot.eventSequence = 14;
  nextSnapshot.rng.draws = 6;
  nextSnapshot.rng.privateState.data = 'BQYHCA==';
  nextSnapshot.privateEngineState.data = 'bmV4dA==';
  return { nextSnapshot, orderedEvents: [
    { battleId: 'battle:one', transitionSequence: 9, sequence: 13, payload: { text: 'First' } },
    { battleId: 'battle:one', transitionSequence: 9, sequence: 14, payload: { text: 'Second' } },
  ], domainEffects: [
    { battleId: 'battle:one', transitionSequence: 9, effectIndex: 0, kind: 'test-consume', version: 1, payload: { itemId: 13, count: 1 } },
    { battleId: 'battle:one', transitionSequence: 9, effectIndex: 1, kind: 'test-consume', version: 1, payload: { itemId: 4, count: 1 } },
  ] };
};
function freeze(value: object): void {
  Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); });
  Object.freeze(value);
}

describe('provisional server battle boundary', () => {
  it('clones compatible private snapshot envelopes without mutating frozen inputs', () => {
    const input = snapshot();
    const before = JSON.stringify(input);
    freeze(input);
    const parsed = parseCompatibleSnapshot(input, compatibility);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    parsed.rng.draws = 99;
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rejects incompatible engine, rules, content and payload versions before restore', () => {
    for (const change of [{ engineId: 'another-engine' }, { engineVersion: 'v2' }, { rulesVersion: 'rules2' },
      { contentFingerprint: 'b'.repeat(64) }, { engineStateVersion: 2 }, { rngAlgorithm: 'another-rng' }, { rngVersion: 2 },
      { contractVersion: 2 }, { snapshotVersion: 2 }]) {
      expect(() => parseCompatibleSnapshot(snapshot(), { ...compatibility, ...change })).toThrow();
    }
  });

  it('rejects malformed opaque bytes, extra fields, unsafe counters and crossed RNG identity', () => {
    for (const bytes of ['', 'not base64!', 'Zh==']) {
      const input = snapshot(); input.privateEngineState.data = bytes;
      expect(battleSnapshotSchema.safeParse(input).success).toBe(false);
    }
    const wrongRng = snapshot(); wrongRng.rng.battleId = 'battle:two';
    expect(battleSnapshotSchema.safeParse(wrongRng).success).toBe(false);
    const counter = snapshot(); counter.eventSequence = Number.MAX_SAFE_INTEGER + 1;
    expect(battleSnapshotSchema.safeParse(counter).success).toBe(false);
    expect(battleSnapshotSchema.safeParse({ ...snapshot(), temporaryPointer: 123 }).success).toBe(false);
  });

  it('validates one immutable transition and yields stable per-effect tuple identities', () => {
    const previous = snapshot(), result = transition();
    const oldState = JSON.stringify(previous), oldResult = JSON.stringify(result);
    freeze(previous); freeze(result);
    const parsed = guard(previous, result);
    expect(parsed.nextSnapshot.transitionSequence).toBe(9);
    expect(parsed.orderedEvents.map(event => event.sequence)).toEqual([13, 14]);
    expect(parsed.domainEffects.map(domainEffectIdentity)).toEqual(['["battle:one",9,0]', '["battle:one",9,1]']);
    parsed.domainEffects[0]!.effectIndex = 99;
    expect(JSON.stringify(previous)).toBe(oldState);
    expect(JSON.stringify(result)).toBe(oldResult);
  });

  it('rejects duplicate, reordered, wrong-battle and cumulative domain effect identities', () => {
    for (const change of [{ battleId: 'battle:two' }, { transitionSequence: 8 }, { transitionSequence: 10 }, { effectIndex: 1 }]) {
      const result = transition(); Object.assign(result.domainEffects[0]!, change);
      expect(() => guard(snapshot(), result)).toThrow(/domain effect identity/);
    }
    const duplicate = transition(); duplicate.domainEffects[1]!.effectIndex = 0;
    expect(() => guard(snapshot(), duplicate)).toThrow(/domain effect identity/);
    const cumulative = transition(); cumulative.domainEffects.unshift({ ...cumulative.domainEffects[0]!, transitionSequence: 7 });
    expect(() => guard(snapshot(), cumulative)).toThrow(/domain effect identity/);
    expect(() => domainEffectIdentity({ battleId: 'unsafe id', transitionSequence: 1, effectIndex: 0 })).toThrow();
  });

  it('rejects unknown or incompatible effect kinds and malformed registered payloads', () => {
    for (const change of [{ kind: 'unregistered' }, { version: 2 }, { payload: { itemId: 13, count: -1 } },
      { payload: { itemId: 13, count: 1, ownerOverride: 'other' } }]) {
      const result = transition(); Object.assign(result.domainEffects[0]!, change);
      expect(() => guard(snapshot(), result)).toThrow();
    }
    expect(() => createTransitionGuard(eventSchema, [registration, registration])).toThrow(/Duplicate/);
    const previous = snapshot(); previous.config.policy.allowedDomainEffects[0]!.version = 2;
    const result = transition(); result.nextSnapshot.config.policy = structuredClone(previous.config.policy);
    expect(() => guard(previous, result)).toThrow(/unregistered effect version/);
  });

  it('rejects changes to immutable battle, mode, participants, versions and RNG progress', () => {
    const changes = [
      (next: BattleSnapshot) => { next.config.battleId = 'battle:two'; next.rng.battleId = 'battle:two'; },
      (next: BattleSnapshot) => { next.config.policy = { mode: 'pvp-copy', allowedDomainEffects: [] }; },
      (next: BattleSnapshot) => { next.config.participantIds.reverse(); },
      (next: BattleSnapshot) => { next.config.compatibility.contentFingerprint = 'b'.repeat(64); },
      (next: BattleSnapshot) => { next.transitionSequence = 10; },
      (next: BattleSnapshot) => { next.rng.draws = 4; },
      (next: BattleSnapshot) => { next.rng.draws = 5; },
    ];
    for (const change of changes) {
      const result = transition(); change(result.nextSnapshot);
      expect(() => guard(snapshot(), result)).toThrow();
    }
  });

  it('rejects skipped, repeated or misidentified event sequences and mismatched snapshots', () => {
    for (const change of [{ sequence: 12 }, { sequence: 14 }, { battleId: 'battle:two' }, { transitionSequence: 8 },
      { payload: { text: 'Event', privateChoice: 'hidden' } }]) {
      const result = transition(); Object.assign(result.orderedEvents[0]!, change);
      expect(() => guard(snapshot(), result)).toThrow();
    }
    const result = transition(); result.nextSnapshot.eventSequence = 15;
    expect(() => guard(snapshot(), result)).toThrow(/event sequence/);
  });

  it('permits only battle-local copy updates and zero domain effects for initial PvP', () => {
    const previous = snapshot(); previous.config.policy = { mode: 'pvp-copy', allowedDomainEffects: [] };
    const result = transition(); result.nextSnapshot.config.policy = structuredClone(previous.config.policy);
    expect(() => guard(previous, result)).toThrow(/pvp-copy permits no persistent domain effects/);
    result.domainEffects = [];
    expect(guard(previous, result).nextSnapshot.privateEngineState.data).toBe('bmV4dA==');
    const invalidPolicy = { ...previous, config: { ...previous.config, policy: { mode: 'pvp-copy', allowedDomainEffects: [{ kind: 'test-consume', version: 1 }] } } };
    expect(battleSnapshotSchema.safeParse(invalidPolicy).success).toBe(false);
  });

  it('checks accepted-choice actor, battle and revision bindings without pretending to validate mechanics', () => {
    const choiceSchema = z.strictObject({ slot: z.number().int().min(0).max(3) });
    const input = [{ battleId: 'battle:one', transitionSequence: 8, actorId: 'player', choice: { slot: 0 } }];
    expect(parseAcceptedChoices(snapshot(), input, choiceSchema)).toEqual(input);
    for (const change of [{ actorId: 'stranger' }, { battleId: 'battle:two' }, { transitionSequence: 7 }, { choice: { slot: 4 } }]) {
      expect(() => parseAcceptedChoices(snapshot(), [{ ...input[0], ...change }], choiceSchema)).toThrow();
    }
    expect(() => parseAcceptedChoices(snapshot(), [input[0], input[0]], choiceSchema)).toThrow(/duplicate/);
  });

  it('requires an explicit public whitelist and rejects private snapshot/RNG fields', () => {
    const presentation = z.strictObject({ phaseLabel: z.string() });
    const schema = createPermittedViewSchema(presentation);
    const publicView = { battleId: 'battle:one', transitionSequence: 8, eventSequence: 12, viewerId: 'player', presentation: { phaseLabel: 'Fixture only' } };
    expect(schema.parse(publicView)).toEqual(publicView);
    expect(parsePermittedView(snapshot(), publicView, 'player', presentation)).toEqual(publicView);
    for (const change of [{ viewerId: 'opponent' }, { battleId: 'battle:two' }, { transitionSequence: 7 }, { eventSequence: 13 }]) {
      expect(() => parsePermittedView(snapshot(), { ...publicView, ...change }, 'player', presentation)).toThrow();
    }
    expect(() => parsePermittedView(snapshot(), { ...publicView, viewerId: 'stranger' }, 'stranger', presentation)).toThrow();
    for (const key of ['rng', 'privateEngineState', 'acceptedChoices', 'opponentTeam']) {
      expect(schema.safeParse({ ...publicView, [key]: 'private' }).success).toBe(false);
      expect(schema.safeParse({ ...publicView, presentation: { ...publicView.presentation, [key]: 'private' } }).success).toBe(false);
    }
    expect(schema.safeParse(snapshot()).success).toBe(false);
  });
});
