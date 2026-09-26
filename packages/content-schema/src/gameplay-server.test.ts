import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gameplayServerSchema, type GameplayServerContent } from './gameplay-server';

const fixture: unknown = JSON.parse(readFileSync('content/generated/server/gameplay.json', 'utf8'));
const valid = () => gameplayServerSchema.parse(structuredClone(fixture));
const reject = (mutate: (data: GameplayServerContent) => void) => {
  const data = valid();
  mutate(data);
  expect(gameplayServerSchema.safeParse(data).success).toBe(false);
};

describe('private source gameplay definitions', () => {
  it('accepts the bounded closure while retaining source-only fields and generation-three values', () => {
    const data = valid();
    expect([data.species.length, data.moves.length, data.items.length, data.abilities.length]).toEqual([14, 44, 5, 7]);
    expect(data.status).toBe('definitions-only');
    const tackle = data.moves.find(move => move.symbol === 'MOVE_TACKLE')!;
    expect([tackle.power, tackle.accuracy, tackle.pp]).toEqual([35, 95, 35]);
    const relationship = (attack: number, defense: number) => data.typeEffectiveness.find(row => row.attack.id === attack && row.defense.id === defense)!;
    expect(relationship(7, 8).multiplierTenths).toBe(5); // Ghost into Steel in this source generation.
    expect(relationship(17, 8).multiplierTenths).toBe(5); // Dark into Steel likewise.
    expect(relationship(13, 4).multiplierTenths).toBe(0); // Electric into Ground.
    expect(data.typeEffectiveness.filter(row => row.ignoreWhenForesight).map(row => [row.attack.id, row.defense.id, row.multiplierTenths]))
      .toEqual([[0, 7, 0], [1, 7, 0]]);
  });

  it('rejects missing or inconsistent references throughout the dependency graph', () => {
    reject(data => { data.moves = data.moves.filter(move => move.id !== data.species[0]!.levelUpLearnset[0]!.move.id); });
    reject(data => { data.species[0]!.heldItems.rare = { id: 1, symbol: 'ITEM_MASTER_BALL' }; });
    reject(data => { data.species[0]!.abilities[0]!.symbol = 'ABILITY_UNKNOWN'; });
    reject(data => { data.growthRates = data.growthRates.filter(growth => growth.id !== data.species[0]!.growthRate.id); });
    reject(data => { data.moves[0]!.type = { id: 1, symbol: 'TYPE_NORMAL' }; });
    reject(data => { data.encounters[0]!.slots[0]!.species = { id: 25, symbol: 'SPECIES_PIKACHU' }; });
    reject(data => { data.items = data.items.filter(item => item.id !== 0); });
    reject(data => { data.abilities = data.abilities.filter(ability => ability.id !== 0); });
  });

  it('keeps same-level move ordering but rejects missing initial and descending learnsets', () => {
    const data = valid();
    const bulbasaur = data.species.find(species => species.symbol === 'SPECIES_BULBASAUR')!;
    expect(bulbasaur.levelUpLearnset.filter(entry => entry.level === 15).map(entry => entry.move.symbol))
      .toEqual(['MOVE_POISON_POWDER', 'MOVE_SLEEP_POWDER']);
    expect(gameplayServerSchema.safeParse(data).success).toBe(true);
    reject(copy => { copy.species[0]!.levelUpLearnset = []; });
    reject(copy => { copy.species[0]!.levelUpLearnset[0]!.level = 2; });
    reject(copy => { copy.species[0]!.levelUpLearnset[1]!.level = 100; });
  });

  it('rejects evolution self-links, cycles and absent target species', () => {
    reject(data => { data.species[0]!.evolutions[0]!.targetSpecies = { id: 1, symbol: 'SPECIES_BULBASAUR' }; });
    reject(data => { data.species[1]!.evolutions[0]!.targetSpecies = { id: 1, symbol: 'SPECIES_BULBASAUR' }; });
    reject(data => { data.species[0]!.evolutions[0]!.targetSpecies = { id: 25, symbol: 'SPECIES_PIKACHU' }; });
    reject(data => { data.species[0]!.evolutions[0]!.parameter = 101; });
  });

  it('validates raw encounter slot identity, total weights and level ranges', () => {
    reject(data => { data.encounters[0]!.slots[0]!.slot = 1; });
    reject(data => { data.encounters[0]!.slots[0]!.weight += 1; });
    reject(data => { data.encounters[0]!.slots[0]!.minLevel = 100; });
    reject(data => { data.encounters[0]!.slots.pop(); });
    reject(data => { data.encounters[0]!.sourceRate = 0; });
    reject(data => { data.encounters.push(structuredClone(data.encounters[0]!)); });
    const data = valid();
    expect(gameplayServerSchema.safeParse({ ...data, encounters: [{ ...data.encounters[0], mapId: 'MAP_UNKNOWN' }] }).success).toBe(false);
  });

  it('checks species pairs, finite source enums and complete monotonic growth tables', () => {
    reject(data => { data.species[0]!.types.pop(); });
    reject(data => { data.species[0]!.eggGroups[0]!.id = 15; });
    reject(data => { data.species[0]!.bodyColor.id = 9; });
    reject(data => { data.species[0]!.genderRatio = 256; });
    reject(data => { data.species[0]!.stats.hp = 0; });
    reject(data => { data.species[0]!.evYield.hp = 4; });
    reject(data => { data.growthRates[0]!.experience.pop(); });
    reject(data => { data.growthRates[0]!.experience[50] = 0; });
    reject(data => { data.growthRates[0]!.experience[1] = 0; });
    reject(data => { data.types[0]!.symbol = 'TYPE_UNKNOWN'; });
  });

  it('rejects mismatched move flag bits, targets and numeric effect limits', () => {
    reject(data => { data.moves[0]!.flags.value ^= 1; });
    reject(data => { data.moves[0]!.flags.symbols.push(data.moves[0]!.flags.symbols[0]!); });
    reject(data => { data.moves[0]!.target.id = 3; });
    reject(data => { data.moves[0]!.effect.id = 214; });
    reject(data => { data.moves[0]!.accuracy = 101; });
    reject(data => { data.moves[0]!.priority = -129; });
  });

  it('keeps effect bytes and rejects malformed medicine bindings or item enum references', () => {
    const potion = valid().items.find(item => item.symbol === 'ITEM_POTION')!;
    expect(potion.itemEffect).toEqual({ symbol: 'sItemEffect_Potion', bytes: [0, 0, 0, 0, 4, 0, 20] });
    reject(data => { data.items.find(item => item.symbol === 'ITEM_POTION')!.itemEffect = null; });
    reject(data => { data.items.find(item => item.symbol === 'ITEM_POTION')!.itemEffect!.bytes[6] = 256; });
    reject(data => { data.items[0]!.pocket.symbol = 'POCKET_UNKNOWN'; });
    reject(data => { data.items[0]!.battleUseFunc = 'call()'; });
    reject(data => { data.items[0]!.price = 65536; });
  });

  it('rejects duplicate type pairs, sentinel IDs and invalid Foresight semantics', () => {
    reject(data => { data.typeEffectiveness.push(structuredClone(data.typeEffectiveness.at(-1)!)); });
    reject(data => { data.typeEffectiveness[0]!.attack = { id: 254, symbol: 'TYPE_FORESIGHT' }; });
    reject(data => { data.typeEffectiveness[0]!.ignoreWhenForesight = true; });
    reject(data => { data.typeEffectiveness.at(-1)!.ignoreWhenForesight = false; });
    reject(data => { data.typeEffectiveness.at(-1)!.multiplierTenths = 10; });
    reject(data => { data.typeEffectiveness = data.typeEffectiveness.filter(row => row.attack.id !== 0 || row.defense.id !== 7); });
    reject(data => { data.typeEffectiveness[0]!.defense = { id: 1, symbol: 'TYPE_NORMAL' }; });
  });

  it('requires definitions-only metadata, strict records and unique source identities', () => {
    const data = valid();
    expect(gameplayServerSchema.safeParse({ ...data, status: 'playable' }).success).toBe(false);
    expect(gameplayServerSchema.safeParse({ ...data, executeEffects: true }).success).toBe(false);
    expect(gameplayServerSchema.safeParse({ ...data, sourceFingerprint: 'unverified' }).success).toBe(false);
    reject(copy => { copy.species.push(structuredClone(copy.species[0]!)); });
    const extra = structuredClone(data);
    Object.assign(extra.moves[0]!, { damageImplementation: 'ready' });
    expect(gameplayServerSchema.safeParse(extra).success).toBe(false);
  });
});
