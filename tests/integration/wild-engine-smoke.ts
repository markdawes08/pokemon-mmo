/** Natural completed-step source encounters to isolated playable battles. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadEncounterCore } from '../../tools/encounter-core/encounter.js';
import { pursuitCheckpointSchema } from '../../tools/battle-pursuit/engine.js';
import { loadPracticeEngine } from '../../apps/server/src/practice-engine.js';
import { loadWildEncounterEngine } from '../../apps/server/src/wild-encounter-engine.js';

const pinned = {
  'encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  'battle-pursuit/primary/pursuit.wasm': 'c831be59bf3e09b93474b812fceec4072745969513ea7f6732f16e1ad9693c37',
};
for (const [path, expected] of Object.entries(pinned))
  assert.equal(createHash('sha256').update(await readFile(`.local/${path}`)).digest('hex'), expected);
const [core, wild, practice] = await Promise.all([loadEncounterCore(), loadWildEncounterEngine(), loadPracticeEngine()]);
const slots = new Set<number>(), speciesLevels = new Set<string>(), abilities = new Set<number>(), outcomes = new Set<string>();
let candidates = 0, naturallyGenerated = 0, admitted = 0, turns = 0, recoveries = 0;
for (let seed = 0; seed < 512 && slots.size < 12; seed++) {
  let checkpoint = core.create({ mainSeed: seed, wildSeed: 17185, trainerId: 1 }).snapshot();
  for (let step = 0; step < 200; step++) {
    const saved = structuredClone(checkpoint), input = { behavior: 'grass' as const, movement: step % 2 ? 'run' as const : 'walk' as const };
    const candidate = wild.step(checkpoint, input);
    candidates++; assert.deepEqual(checkpoint, saved);
    assert.deepEqual(wild.step(saved, input), candidate);
    checkpoint = candidate.checkpoint;
    if (!candidate.encounter) continue;
    naturallyGenerated++;
    const source = core.restore(checkpoint).view().creature!;
    if (slots.has(source.slot)) break;
    slots.add(source.slot); speciesLevels.add(`${source.speciesId}:${source.level}`); abilities.add(source.abilityId);
    const id = randomUUID(); let stored = practice.createWild(id, checkpoint);
    const initial = pursuitCheckpointSchema.parse(JSON.parse(Buffer.from(stored.snapshot.privateEngineState.data, 'base64').toString('utf8'))).admission;
    assert.equal(initial.kind, 'diagnostic'); if (initial.kind !== 'diagnostic') throw new Error('Unexpected capture admission.');
    const { slot: _slot, nature: _nature, gender: _gender, ...expected } = source;
    const { evs: _evs, calculatedEvs: _calculatedEvs, ballItemId: _ballItemId, metLocation: _metLocation, ...actual } = initial.opponent;
    assert.deepEqual(actual, expected); admitted++;
    const first = practice.project(id, stored);
    assert.equal(first.origin, 'route1-wild-test'); assert(!Object.hasOwn(first, 'setup'));
    assert.equal(first.presentation.self.speciesId, 7); assert.equal(first.presentation.self.level, 5);
    assert(!/privateEngineState|wildSlot|personality|"ivs"|"rng"|"seed"|"checkpoint"/.test(JSON.stringify(first)));
    for (let turn = 0; turn < 50 && practice.project(id, stored).presentation.phase !== 'ended'; turn++) {
      const view = practice.project(id, stored), choice = view.presentation.availableChoices.find(row => row.kind === 'move')
        ?? view.presentation.availableChoices[0];
      assert(choice, 'Every nonterminal basic encounter requires an actionable source choice.');
      const savedBattle = structuredClone(stored); stored = practice.advance(stored, choice); turns++;
      assert.deepEqual(practice.restore(savedBattle), savedBattle);
      assert.deepEqual(practice.restore(JSON.parse(JSON.stringify(stored))), stored); recoveries++;
    }
    const terminal = practice.project(id, stored);
    assert.equal(terminal.presentation.phase, 'ended'); outcomes.add(terminal.presentation.outcome!);
    const resumed = practice.finishWild(stored), pendingView = core.restore(checkpoint).view(), resumedView = core.restore(resumed).view();
    assert.equal(resumed.phase, 'ready'); assert.equal(resumedView.encounterSerial, pendingView.encounterSerial);
    assert.equal(resumedView.generalRng.draws, pendingView.generalRng.draws + stored.snapshot.rng.draws);
    assert.deepEqual(resumedView.encounterRng, pendingView.encounterRng);
    assert.deepEqual(wild.restore(JSON.parse(JSON.stringify(resumed))), resumed); recoveries++;
    break;
  }
}
assert.deepEqual([...slots].sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index));
assert.deepEqual([...speciesLevels].sort(), ['16:2', '16:3', '16:4', '16:5', '19:2', '19:3', '19:4']);
assert(abilities.has(51), 'Pidgey retains Keen Eye.');
for (const [path, expected] of Object.entries(pinned))
  assert.equal(createHash('sha256').update(await readFile(`.local/${path}`)).digest('hex'), expected);
await writeFile('reports/wild-engine-verification.json', JSON.stringify({ passed: true, verifiedAt: new Date().toISOString(),
  scope: 'Local Route 1 testing copies only; completed grass steps, exact source wild identity, shared field/battle RNG and no owned results.',
  completedStepCandidates: candidates, naturallyGenerated, sourceSlots: [...slots].sort((a, b) => a - b),
  speciesLevels: [...speciesLevels].sort(), abilities: [...abilities].sort((a, b) => a - b), admitted,
  sourceTurns: turns, recoveredBoundaries: recoveries, outcomes: [...outcomes].sort(), retainedWasm: pinned,
}, null, 2) + '\n');
console.log(`Wild source bridge passed: ${slots.size} source slots, ${speciesLevels.size} species/level pairs, ${turns} turns, ${recoveries} recovered boundaries.`);
