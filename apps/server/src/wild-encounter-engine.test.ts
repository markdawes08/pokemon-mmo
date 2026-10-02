import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { advanceEncounterRng, checkpointDigest, loadEncounterCore, type EncounterCheckpoint, type EncounterCore } from '../../../tools/encounter-core/encounter.js';
import { pursuitCheckpointSchema } from '../../../tools/battle-pursuit/engine.js';
import { loadPracticeEngine, type PracticeEngine, type PracticeStored } from './practice-engine.js';
import { WildEncounterEngine } from './wild-encounter-engine.js';

let core: EncounterCore, engine: WildEncounterEngine, practice: PracticeEngine;
beforeAll(async () => { core = await loadEncounterCore(); engine = new WildEncounterEngine(core); practice = await loadPracticeEngine(); });
const initial = () => core.create({ mainSeed: 0, wildSeed: 17185, trainerId: 1 }).snapshot();
function ninthStep(): EncounterCheckpoint {
  let checkpoint = initial();
  for (let count = 0; count < 9; count++) checkpoint = engine.step(checkpoint, { behavior: 'grass', movement: 'walk' }).checkpoint;
  return checkpoint;
}
function admission(stored: PracticeStored) {
  return pursuitCheckpointSchema.parse(JSON.parse(Buffer.from(stored.snapshot.privateEngineState.data, 'base64').toString('utf8'))).admission;
}

describe('completed-step Route 1 testing bridge', () => {
  it('retains the independent source nine-step transcript and identical walking/running candidates', () => {
    let walk = initial(), run = initial();
    for (let count = 0; count < 9; count++) {
      const saved = structuredClone(walk);
      const next = engine.step(walk, { behavior: 'grass', movement: 'walk' });
      expect(walk).toEqual(saved);
      run = engine.step(run, { behavior: 'grass', movement: 'run' }).checkpoint;
      walk = next.checkpoint;
      expect(walk).toEqual(run); expect(next.encounter).toBe(count === 8);
    }
    const source = core.restore(walk).view();
    expect(source).toMatchObject({ phase: 'pending-encounter', encounterSerial: 1,
      generalRng: { state: 928871449, draws: 23 }, encounterRng: { state: 530373172, draws: 3 },
      creature: { speciesId: 19, level: 3, personality: 1636640678, abilityId: 50, otId: 1,
        ivs: { hp: 18, attack: 20, defense: 5, speed: 24, spAttack: 29, spDefense: 19 },
        stats: { hp: 15, attack: 8, defense: 7, speed: 10, spAttack: 6, spDefense: 7 } } });
    expect(() => engine.step(walk, { behavior: 'grass', movement: 'walk' })).toThrow(/Pending encounter/);
    expect(engine.restore(JSON.parse(JSON.stringify(walk)))).toEqual(walk);
  });
  it('plain completed steps update only previous terrain and cannot trigger or consume RNG', () => {
    const first = engine.step(initial(), { behavior: 'grass', movement: 'walk' }).checkpoint;
    const next = engine.step(first, { behavior: 'plain', movement: 'run' });
    const before = core.restore(first).view(), after = core.restore(next.checkpoint).view();
    expect(next.encounter).toBe(false);
    expect(after).toEqual({ ...before, cooldown: { ...before.cooldown, previousBehavior: 0 } });
    expect(engine.step(next.checkpoint, { behavior: 'plain', movement: 'walk' }).checkpoint).toEqual(next.checkpoint);
  });
  it('admits exact source wild identity, hides its private setup and retains immutable proof through turns', () => {
    const field = ninthStep(), id = randomUUID(), stored = practice.createWild(id, field), source = core.restore(field).view().creature!;
    const initialAdmission = admission(stored);
    expect(initialAdmission.kind).toBe('diagnostic');
    if (initialAdmission.kind !== 'diagnostic') throw new Error('Unexpected source admission.');
    expect(initialAdmission.seed).toBe(928871449);
    expect(initialAdmission.opponent).toMatchObject({ speciesId: source.speciesId, level: source.level,
      personality: source.personality, otId: source.otId, abilityId: source.abilityId, abilityNum: source.abilityNum,
      ivs: source.ivs, stats: source.stats, hp: source.hp, moves: source.moves });
    expect(initialAdmission.player[0]).toMatchObject({ speciesId: 7, level: 5, personality: 25, hp: 20 });
    const view = practice.project(id, stored);
    expect(view.origin).toBe('route1-wild-test'); expect(view.setup).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/privateEngineState|rng|wildSlot|personality|ivs|setup|seed|checkpoint/);
    expect(Object.keys(view.presentation.opponent).sort()).toEqual(['charging', 'hpPercent', 'level', 'protected', 'speciesId', 'status']);
    const advanced = practice.advance(stored, { kind: 'move', slot: 0 });
    expect(advanced.wild).toEqual(stored.wild);
    expect(practice.restore(JSON.parse(JSON.stringify(advanced)))).toEqual(advanced);
    expect(engine.restore(field)).toEqual(field);
  });
  it('continues the same field RNG after battle and recovers the same future encounter without rerolling', async () => {
    const field = ninthStep(), battle = practice.createWild(randomUUID(), field);
    const next = practice.advance(battle, { kind: 'move', slot: 0 }), saved = structuredClone(next);
    const finished = practice.finishWild(next), before = core.restore(field).view(), after = core.restore(finished).view();
    expect(next).toEqual(saved); expect(after.phase).toBe('ready');
    expect(after.generalRng.draws).toBe(before.generalRng.draws + next.snapshot.rng.draws);
    expect(after.generalRng.state).toBe(advanceEncounterRng(before.generalRng.state, next.snapshot.rng.draws, 24691));
    expect(after.encounterRng).toEqual(before.encounterRng); expect(after.cooldown).toEqual(before.cooldown);
    expect(after.creature).toEqual(before.creature);
    const fresh = await loadPracticeEngine();
    expect(fresh.finishWild(JSON.parse(JSON.stringify(next)))).toEqual(finished);
    let a = finished, b = engine.restore(JSON.parse(JSON.stringify(finished))), seen = false;
    for (let count = 0; count < 100 && !seen; count++) {
      const input = { behavior: 'grass' as const, movement: 'walk' as const };
      const candidate = engine.step(a, input); a = candidate.checkpoint; b = engine.step(b, input).checkpoint;
      expect(a).toEqual(b); seen = candidate.encounter;
    }
    expect(seen).toBe(true); expect(core.restore(a).view().encounterSerial).toBe(2);
  });
  it('rejects missing pending proof, trainer mismatch, corruption and altered battle-to-encounter binding', () => {
    expect(() => practice.createWild(randomUUID(), initial())).toThrow();
    const wrong = core.create({ mainSeed: 0, wildSeed: 17185, trainerId: 2 }); wrong.generate();
    expect(() => practice.createWild(randomUUID(), wrong.snapshot())).toThrow();
    const field = ninthStep(), stored = practice.createWild(randomUUID(), field);
    for (const mutate of [
      (copy: PracticeStored) => { copy.wild!.encounter.digest = '0'.repeat(64); },
      (copy: PracticeStored) => { copy.setup.opponent.level++; },
      (copy: PracticeStored) => { delete copy.wild; },
      (copy: PracticeStored) => {
        const { digest: _digest, ...body } = copy.wild!.encounter;
        body.words[3]++; body.words[1] = advanceEncounterRng(body.initialSeeds.mainSeed, body.words[3], 24691);
        copy.wild!.encounter = { ...body, digest: checkpointDigest(body) };
      },
    ]) {
      const copy = structuredClone(stored); mutate(copy);
      expect(() => practice.restore(copy)).toThrow();
    }
    const corruptedRng = structuredClone(stored.snapshot.rng); corruptedRng.draws++;
    expect(() => engine.continue(field, corruptedRng)).toThrow(/cannot continue/);
    expect(practice.restore(stored)).toEqual(stored);
  });
  it('resets only source rate modifiers on map transfer without consuming RNG or permitting a pending battle', () => {
    let checkpoint = initial();
    for (let count = 0; count < 8; count++) checkpoint = engine.step(checkpoint, { behavior: 'grass', movement: 'walk' }).checkpoint;
    const saved = structuredClone(checkpoint), before = core.restore(checkpoint).view(), after = core.restore(engine.mapTransfer(checkpoint)).view();
    expect(checkpoint).toEqual(saved);
    expect(before.cooldown).toMatchObject({ steps: 6, buff: 42 });
    expect(after).toEqual({ ...before, cooldown: { ...before.cooldown, steps: 0, buff: 0 } });
    expect(() => engine.mapTransfer(ninthStep())).toThrow(/pending encounter/);
  });
});
