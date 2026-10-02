/** Production catalogue/factory integration; no oracle fixtures are imported. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { practiceSessionSchema, type PracticeMon } from '@pokewaterblue/protocol';
import { loadPracticeEngine, PracticeEngineError } from '../../apps/server/src/practice-engine.js';

const retained = {
  'battle-spike/primary/probe.wasm': '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  'encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  'battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  'battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  'battle-loss/primary/loss.wasm': 'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
  'battle-capture/primary/capture.wasm': '1e6b16390cdaa4906c01b391c30984735a22e998f548e9ff7de44d890865a60b',
  'battle-evolution/primary/evolution.wasm': '1585f15e7aef6a5ed952cbf3f17041d5382163e39f51c3b1ed3ac65f41495c5c',
  'battle-family/primary/family.wasm': '810a16bcc7b714426edb80f933deaf8afefb65240c95464980d03e4f92a28e65',
  'battle-party/primary/party.wasm': '4b6935d92251703975303d65a726078f3e9bd0a1c08a61f42acc4b72d83405c9',
  'battle-tactics/primary/tactics.wasm': '662633e05265663a20a02141939c4fdc78ef0be27d53df99507596280a216f5c',
  'battle-charge/primary/charge.wasm': 'c2d5ac7786979cf0288ab624f5c8a7b81516c7c34458ceddd54923de99541151',
  'battle-protect/primary/protect.wasm': 'c8300b709626eab94f4554dca867181127b4fcc9a888c2c8fa013e7b8d220d8f',
  'battle-pursuit/primary/pursuit.wasm': 'c831be59bf3e09b93474b812fceec4072745969513ea7f6732f16e1ad9693c37',
};
for (const [path, hash] of Object.entries(retained)) assert.equal(createHash('sha256').update(await readFile(`.local/${path}`)).digest('hex'), hash, path);
const engine = await loadPracticeEngine(), catalogue = engine.catalogue();
assert.deepEqual(catalogue.species.map(row => row.id), [7, 8, 9, 16, 17, 18, 19, 20]);
assert.equal(catalogue.moves.length, 25); assert(catalogue.moves.some(row => row.id === 119));
const make = (speciesId: number, moveId: number, level = 100): PracticeMon => ({ speciesId, level, moveIds: [moveId], abilityNum: 0, status: 0, hpPercent: 100, ppPercent: 100 });
const moves = new Set<number>(), species = new Set<number>();
let admittedCombinations = 0, sourceTurns = 0;
for (const entry of catalogue.species) for (const move of entry.moves) {
  const id = randomUUID(), state = engine.create(id, { player: [make(entry.id, move.id)], opponent: make(9, 110) });
  const projected = engine.project(id, state); practiceSessionSchema.parse(projected);
  assert.equal(projected.presentation.self.moves[0]!.moveId, move.id);
  const next = engine.advance(state, { kind: 'move', slot: 0 });
  const recovered = engine.restore(JSON.parse(JSON.stringify(next)));
  assert.deepEqual(engine.project(id, recovered), engine.project(id, next));
  const publicJson = JSON.stringify(engine.project(id, next));
  assert(!/privateEngineState|wildSlot|rng|protectPolicy|afterCritical|baseDamage|commands/.test(publicJson));
  assert.deepEqual(Object.keys(projected.presentation.opponent).sort(), ['charging', 'hpPercent', 'level', 'protected', 'speciesId', 'status']);
  moves.add(move.id); species.add(entry.id); admittedCombinations++; sourceTurns++;
}
assert.equal(moves.size, 25); assert.equal(species.size, 8);
for (const entry of catalogue.species) {
  for (const level of [1, 5, 50, 100]) {
    const first = entry.moves.find(move => move.level <= level)!;
    const id = randomUUID(), state = engine.create(id, { player: [make(entry.id, first.id, level)], opponent: make(9, 110) });
    assert.equal(engine.project(id, state).presentation.self.level, level);
    assert.deepEqual(engine.restore(JSON.parse(JSON.stringify(state))), state);
  }
}
for (const preset of catalogue.presets) {
  const id = randomUUID(), state = engine.create(id, preset.setup);
  assert.equal(engine.project(id, state).presentation.phase, 'choice');
}
const starter = catalogue.presets[0]!.setup;
for (const [speciesId, moveIds, abilityNum] of [[1, [33], 0], [7, [119], 0], [7, [228], 0], [7, [33, 33], 0], [7, [33], 1]] as const) {
  assert.throws(() => engine.create(randomUUID(), { ...starter, player: [{ ...starter.player[0]!, speciesId, moveIds: [...moveIds], abilityNum }] }), PracticeEngineError);
}
const spriteManifest = JSON.parse(await readFile('content/generated/manifests/practice-sprites-manifest.json', 'utf8'));
assert.equal(spriteManifest.outputs.length, 17);
for (const row of spriteManifest.outputs) assert.equal(createHash('sha256').update(await readFile(`content/generated/${row.path}`)).digest('hex'), row.sha256);
for (const [path, hash] of Object.entries(retained)) assert.equal(createHash('sha256').update(await readFile(`.local/${path}`)).digest('hex'), hash, path);
const report = { checkedAt: new Date().toISOString(), status: 'passed', species: species.size, moves: moves.size,
  admittedCombinations, sourceTurns, extraLevelAdmissions: 32, presets: catalogue.presets.length, spriteOutputs: 17, retained,
  scope: 'Practice copies built from production source definitions and admitted by the Mirror C engine; thirteen previous artifacts retained, no test-oracle fixture dependency or owned-result application.' };
await writeFile('reports/practice-engine-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Practice engine passed: ${species.size} species, ${moves.size} moves, ${sourceTurns} source turns.`);
