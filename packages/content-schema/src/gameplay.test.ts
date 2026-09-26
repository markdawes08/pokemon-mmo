import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fieldGuideSchema } from './gameplay';

const guide = fieldGuideSchema.parse(JSON.parse(readFileSync('content/generated/client/field-guide.json', 'utf8')));

describe('public field-guide boundary', () => {
  it('accepts the selected source closure and preserves same-level move order', () => {
    expect(guide.species).toHaveLength(14);
    expect(guide.moves).toHaveLength(44);
    expect(guide.items).toHaveLength(4);
    expect(guide.species.find(species => species.id === 1)!.levelUpLearnset.filter(move => move.level === 15))
      .toEqual([{ level: 15, move: 77 }, { level: 15, move: 79 }]);
  });
  it('rejects private binding fields rather than silently accepting them in public data', () => {
    const leaked = structuredClone(guide);
    Object.assign(leaked.items[0]!, { battleUseFunc: 'BattleUseFunc_PokeBallEtc' });
    expect(fieldGuideSchema.safeParse(leaked).success).toBe(false);
    const rawSlots = structuredClone(guide);
    Object.assign(rawSlots.encounters[0]!, { slots: [] });
    expect(fieldGuideSchema.safeParse(rawSlots).success).toBe(false);
  });
  it('rejects dangling moves, evolution targets, duplicate IDs and unordered learnsets', () => {
    const dangling = structuredClone(guide);
    dangling.species[0]!.levelUpLearnset[0]!.move = 999;
    expect(fieldGuideSchema.safeParse(dangling).success).toBe(false);
    const evolution = structuredClone(guide);
    evolution.species[0]!.evolutions[0]!.species = 999;
    expect(fieldGuideSchema.safeParse(evolution).success).toBe(false);
    const duplicate = structuredClone(guide);
    duplicate.species.push(duplicate.species[0]!);
    expect(fieldGuideSchema.safeParse(duplicate).success).toBe(false);
    const unordered = structuredClone(guide);
    unordered.species[0]!.levelUpLearnset.reverse();
    expect(fieldGuideSchema.safeParse(unordered).success).toBe(false);
  });
  it('rejects impossible encounter summaries and malformed experience curves', () => {
    const chance = structuredClone(guide);
    chance.encounters[0]!.entries[0]!.chance = 49;
    expect(fieldGuideSchema.safeParse(chance).success).toBe(false);
    const level = structuredClone(guide);
    level.encounters[0]!.entries[0]!.minLevel = 100;
    expect(fieldGuideSchema.safeParse(level).success).toBe(false);
    const curve = structuredClone(guide);
    curve.growthRates[0]!.experience[1] = 0;
    expect(fieldGuideSchema.safeParse(curve).success).toBe(false);
    const missing = structuredClone(guide);
    missing.growthRates[0]!.experience.pop();
    expect(fieldGuideSchema.safeParse(missing).success).toBe(false);
  });
  it('rejects zero base stats, missing initial moves and overflowing source experience', () => {
    const stats = structuredClone(guide);
    stats.species[0]!.stats.hp = 0;
    expect(fieldGuideSchema.safeParse(stats).success).toBe(false);
    const initial = structuredClone(guide);
    initial.species[0]!.levelUpLearnset = initial.species[0]!.levelUpLearnset.filter(move => move.level > 1);
    expect(fieldGuideSchema.safeParse(initial).success).toBe(false);
    const experience = structuredClone(guide);
    experience.growthRates[0]!.experience[100] = 0x100000000;
    expect(fieldGuideSchema.safeParse(experience).success).toBe(false);
  });
});
