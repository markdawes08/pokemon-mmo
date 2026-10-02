import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { practiceSessionSchema, type PracticeSetup } from '@pokewaterblue/protocol';
import { loadPracticeEngine, PracticeEngineError, type PracticeEngine, type PracticeStored } from './practice-engine.js';

let engine: PracticeEngine;
beforeAll(async () => { engine = await loadPracticeEngine(); });
const setup = (): PracticeSetup => structuredClone(engine.catalogue().presets[0]!.setup);
const rawCheckpoint = (stored: PracticeStored) => JSON.parse(Buffer.from(stored.snapshot.privateEngineState.data, 'base64').toString('utf8'));

describe('source-validated practice facade', () => {
  it('constructs the neutral level-five source stats without fixture data and keeps public data separate', () => {
    const id = randomUUID(), stored = engine.create(id, setup()), view = engine.project(id, stored);
    expect(view.presentation.self).toMatchObject({ speciesId: 7, level: 5, hp: 20, maxHP: 20,
      moves: [{ moveId: 33, pp: 35 }, { moveId: 39, pp: 30 }] });
    expect(rawCheckpoint(stored).admission.player[0].stats).toEqual({ hp: 20, attack: 10, defense: 12, speed: 10, spAttack: 10, spDefense: 12 });
    expect(practiceSessionSchema.parse(view)).toEqual(view);
    expect(Object.keys(view.presentation.opponent).sort()).toEqual(['charging', 'hpPercent', 'level', 'protected', 'speciesId', 'status']);
    expect(JSON.stringify(view)).not.toMatch(/privateEngineState|rng|wildSlot|baseDamage|afterCritical|commands|protectPolicy/);
    expect(engine.restore(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
  it('rejects unsupported and illegal setups including hidden fields and duplicate moves', () => {
    const changes = [
      (s: PracticeSetup) => { s.player[0]!.speciesId = 1; },
      (s: PracticeSetup) => { s.player[0]!.abilityNum = 1; },
      (s: PracticeSetup) => { s.player[0]!.moveIds = [119]; },
      (s: PracticeSetup) => { s.player[0]!.moveIds = [33, 33]; },
      (s: PracticeSetup) => { s.player[0]!.moveIds = [130]; },
      (s: PracticeSetup) => { s.player[0]!.moveIds = [228]; },
      (s: PracticeSetup) => { Object.assign(s.player[0]!, { stats: { hp: 999 } }); },
      (s: PracticeSetup) => { s.opponent.hpPercent = 0; },
    ];
    for (const change of changes) {
      const input = setup(); change(input);
      expect(() => engine.create(randomUUID(), input)).toThrow(PracticeEngineError);
    }
  });
  it('runs all curated setups through actual source admission and preserves rejected choices', () => {
    for (const preset of engine.catalogue().presets) {
      const id = randomUUID(), stored = engine.create(id, preset.setup), saved = structuredClone(stored);
      expect(engine.project(id, stored).presentation.phase).toBe('choice');
      expect(() => engine.advance(stored, { kind: 'replace', partyIndex: 0, decisionId: '0'.repeat(64) })).toThrow(PracticeEngineError);
      expect(stored).toEqual(saved);
      const choice = engine.project(id, stored).presentation.availableChoices[0]!;
      const next = engine.advance(stored, choice);
      expect(next.snapshot.transitionSequence).toBe(1);
      expect(engine.restore(JSON.parse(JSON.stringify(next)))).toEqual(next);
      expect(stored).toEqual(saved);
    }
  });
  it('executes source Pursuit interception and uses the selected reserve name', () => {
    const id = randomUUID(), preset = engine.catalogue().presets.find(row => row.id === 'pursuit-switch')!;
    const initial = engine.create(id, preset.setup), next = engine.advance(initial, { kind: 'switch', partyIndex: 1 });
    const view = engine.project(id, next);
    expect(view.presentation.activeIndex).toBe(1);
    expect(view.events.filter(row => row.kind === 'attack')).toHaveLength(1);
    expect(view.events.some(row => row.text.includes('Pursuit intercepted'))).toBe(true);
    expect(view.events.some(row => row.text === 'Go, PIDGEOT!')).toBe(true);
    expect(view.presentation.party[0]!.hp).toBeLessThan(engine.project(id, initial).presentation.party[0]!.hp);
  });
  it('rejects incompatible or unbound persisted setup and stale charge decisions', () => {
    const preset = engine.catalogue().presets.find(row => row.id === 'protect-and-charge')!, id = randomUUID();
    const stored = engine.create(id, preset.setup);
    for (const mutate of [
      (copy: PracticeStored) => { copy.setup.player[0]!.hpPercent = 1; },
      (copy: PracticeStored) => { copy.snapshot.config.compatibility.engineVersion = 'wrong'; },
      (copy: PracticeStored) => { copy.events[0]!.sequence = 9999; },
    ]) {
      const copy = structuredClone(stored); mutate(copy);
      expect(() => engine.restore(copy)).toThrow(PracticeEngineError);
    }
    const charged = engine.advance(stored, { kind: 'move', slot: 1 });
    const choices = engine.project(id, charged).presentation.availableChoices;
    expect(choices).toHaveLength(1); expect(choices[0]!.kind).toBe('continue-charge');
    expect(() => engine.advance(charged, { kind: 'run' })).toThrow(PracticeEngineError);
    expect(() => engine.advance(charged, { kind: 'continue-charge', decisionId: '0'.repeat(64) })).toThrow(PracticeEngineError);
    expect(engine.project(id, engine.advance(charged, choices[0]!)).presentation.self.charging).toBe(false);
  });
});
