/** Private source dependency ledger, not permission to admit a live battle. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { worldMapSchema } from '@pokewaterblue/content-schema';
import { turnInputSchema } from '../battle-spike/turn-probe';

const profile = await loadDevelopmentProfile();
const content = profile.definitions;
const encounter = content.encounters.find(row => row.mapId === 'MAP_ROUTE1' && row.method === 'land');
assert(encounter);
assert.equal(encounter.sourceRate, 21);
assert.equal(encounter.slots.length, 12);
const routeBytes = await readFile('content/generated/client/maps/Route1.json');
const routeMapHash = createHash('sha256').update(routeBytes).digest('hex');
assert.equal(routeMapHash, 'd3cec4551bad92ccbaa4ff05dc6e7ef624eb78f0c0a63d9f00c88438316d6249');
const routeMap = worldMapSchema.parse(JSON.parse(routeBytes.toString('utf8')));
const grass = routeMap.blocks.filter(row => row.encounter === 1);
assert.equal(grass.length, 178);
assert(grass.every(row => row.behavior === 2 && row.attributes === 16777730));
assert(routeMap.blocks.every(row => row.encounter === 0 || row.encounter === 1));
const lookup = (id: number) => {
  const species = content.species.find(row => row.id === id);
  assert(species, `Missing species ${id}`);
  return species;
};
const initial = new Map<string, { speciesId: number; level: number }>();
initial.set('7:5', { speciesId: profile.creature.speciesId, level: profile.creature.level });
for (const slot of encounter.slots) {
  for (let level = slot.minLevel; level <= slot.maxLevel; level++) {
    initial.set(`${slot.species.id}:${level}`, { speciesId: slot.species.id, level });
  }
}
const initialTeams = [...initial.values()].map(row => {
  const species = lookup(row.speciesId);
  return { ...row, species: species.symbol,
    moves: species.levelUpLearnset.filter(move => move.level <= row.level).slice(-4).map(move => move.move),
    abilities: species.abilities.filter(ability => ability.id !== 0) };
});
const firstMoves = [...new Set(initialTeams.flatMap(row => row.moves.map(move => move.id)))].sort((a, b) => a - b);
assert.deepEqual(firstMoves, [28, 33, 39]);
const family = new Set(initialTeams.map(row => row.speciesId));
const pending = [...family];
while (pending.length) {
  for (const evolution of lookup(pending.pop()!).evolutions) {
    assert.equal(evolution.method.symbol, 'EVO_LEVEL', 'Review newly reachable evolution methods');
    if (!family.has(evolution.targetSpecies.id)) {
      family.add(evolution.targetSpecies.id);
      pending.push(evolution.targetSpecies.id);
    }
  }
}
const repeatedSpecies = [...family].sort((a, b) => a - b).map(lookup);
assert.deepEqual(repeatedSpecies.map(row => row.id), [7, 8, 9, 16, 17, 18, 19, 20]);
const repeatedMoveIds = [...new Set(repeatedSpecies.flatMap(row => row.levelUpLearnset.map(move => move.move.id)))].sort((a, b) => a - b);
assert.equal(repeatedMoveIds.length, 25);
const repeatedMoves = repeatedMoveIds.map(id => {
  const move = content.moves.find(row => row.id === id);
  assert(move);
  return { id, symbol: move.symbol, effect: move.effect };
});
const shares = [...new Set(encounter.slots.map(row => row.species.id))].map(speciesId => ({ speciesId,
  weight: encounter.slots.filter(row => row.species.id === speciesId).reduce((sum, row) => sum + row.weight, 0) }));
assert.deepEqual(shares, [{ speciesId: 16, weight: 50 }, { speciesId: 19, weight: 50 }]);
// Exercise the existing admission contract. This only describes its synthetic
// moves; it must not mistake matching a move ID for real-species support.
const syntheticMon = { level: 5, hp: 20, maxHP: 20, attack: 10, defense: 10, spAttack: 10, spDefense: 10,
  speed: 10, type1: 0, type2: 0, status1: 0, status2: 0, stages: Array<number>(8).fill(6) };
const currentSynthetic = [28, 33, 39, 55, 77, 98, 165].map(moveId => ({ moveId,
  admitted: turnInputSchema.safeParse({ seed: 1, parties: [
    [{ ...syntheticMon, moves: [{ move: moveId, pp: 1 }] }],
    [{ ...syntheticMon, moves: [{ move: 33, pp: 1 }] }],
  ] }).success }));
assert.deepEqual(currentSynthetic.filter(row => row.admitted).map(row => row.moveId), [33, 55, 77, 98]);
assert.equal(content.moves.some(row => row.id === 165), false, 'Struggle definition was added: update this ledger');
const growth = content.growthRates.find(row => row.id === lookup(7).growthRate.id)!;
const firstVictoryExperience = encounter.slots.map(row => Math.floor(lookup(row.species.id).expYield * row.maxLevel / 7));
assert.equal(profile.creature.experience, 135);
assert.equal(Math.max(...firstVictoryExperience), 39);
assert.equal(growth.experience[6], 179);
assert.equal(growth.experience[7], 236);

const sourcePaths = ['src/wild_encounter.c', 'src/random.c', 'include/random.h', 'src/pokemon.c',
  'src/data/wild_encounters.json', 'src/data/pokemon/species_info.h', 'src/data/pokemon/level_up_learnsets.h',
  'src/data/battle_moves.h', 'src/field_control_avatar.c', 'data/battle_scripts_1.s',
  'src/battle_script_commands.c', 'src/battle_controller_opponent.c', 'src/battle_main.c',
  'src/item_use.c', 'src/overworld.c', 'src/heal_location.c'];
const sourceLock = JSON.parse(await readFile('source-lock.json', 'utf8')) as { reference: { localPath: string } };
const manifest = JSON.parse(await readFile('reports/source-manifest.json', 'utf8')) as {
  sourceFingerprint: string; records: { path: string; sha256: string }[];
};
assert.equal(manifest.sourceFingerprint, profile.sourceFingerprint);
const sourceEvidence = [];
for (const path of sourcePaths) {
  const pin = manifest.records.find(row => row.path === path);
  assert(pin, `Missing pinned source: ${path}`);
  const actual = createHash('sha256').update(await readFile(resolve(sourceLock.reference.localPath, path))).digest('hex');
  assert.equal(actual, pin.sha256, `Source differs: ${path}`);
  sourceEvidence.push({ path, sha256: actual });
}
const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Dependency audit only; encounter generation is verified separately and no live battle is admitted',
  sourceFingerprint: profile.sourceFingerprint, profileId: profile.id, contentHash: profile.contentHash,
  route: encounter, importedMapEvidence: { mapId: routeMap.id, sha256: routeMapHash,
    grassBlocks: grass.length, behavior: 2, attributes: 16777730 },
  speciesShares: shares, initialTeams, firstBattleMoveIds: [...firstMoves, 165],
  mandatoryFallback: { id: 165, symbol: 'MOVE_STRUGGLE', definitionImported: false, syntheticAdapterImplemented: false },
  syntheticAdapterMoveAdmission: currentSynthetic, liveBattleReady: false,
  repeatedEncounterClosure: { species: repeatedSpecies.map(row => ({ id: row.id, symbol: row.symbol })),
    levelUpMoves: repeatedMoves, additionalFallback: 165,
    note: 'Evolution-family level-up definition closure, not a proof of every reachable mechanics path. No hidden level cap.' },
  firstVictory: { initialExperience: 135, maximumUnboostedAward: 39, level6Threshold: 179, level7Threshold: 236,
    nextNewSquirtleMove: { id: 145, symbol: 'MOVE_BUBBLE', level: 7 } },
  dependencyChecklist: ['real species/ability battle initialization', 'Tail Whip and Sand-Attack source commands',
    'Struggle and wild choice/PP rules', 'run and available bag commands',
    'durable encounter admission and choice/snapshot transactions', 'HP/PP, experience/EV, level/move/evolution continuations',
    'capture ownership/storage and faint/loss continuation', 'private projections and restart/unknown-COMMIT recovery'],
  capabilityBoundary: 'Move admission above describes only the retained synthetic adapter. Later real-team profile evidence is recorded separately; this source dependency ledger does not establish live readiness.',
  sourceEvidence };
await writeFile('reports/encounter-dependencies.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Encounter dependency audit passed: ${initialTeams.length} initial species/level combinations; ${repeatedSpecies.length} species / ${repeatedMoves.length} level-up moves in evolution families. Live battles remain unavailable.`);
