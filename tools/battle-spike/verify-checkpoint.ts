/** Raw scalar checkpoint admission/atomicity; no WASM memory bytes are copied. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { instantiateProbe, loadProbeModule, statusOk } from './probe';
import { TurnProbe, type TurnExports } from './turn-probe';

const module = await loadProbeModule();
const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8'));
const fixture = JSON.parse(await readFile('tools/battle-spike/fixtures/batch-2.json', 'utf8'));
const initial = new TurnProbe(module, fixture.cases[0].initial).snapshot();
const fresh = () => instantiateProbe(module) as TurnExports;
const api = fresh();
const count = api.spike3_checkpoint_word_count();
assert.equal(count, 148);

function put(target: TurnExports, words: number[], boundary = words[3]!): number {
  statusOk(target.spike3_import_begin(1, boundary, count), 'raw import begin');
  words.forEach((value, index) => statusOk(target.spike3_import_set(index, value), 'raw import scalar'));
  return target.spike3_import_commit();
}
function words(target: TurnExports, boundary = 0): number[] {
  statusOk(target.spike3_checkpoint_export(boundary), 'raw export');
  return Array.from({ length: count }, (_, index) => target.spike3_checkpoint_get(index) >>> 0);
}
function observations(target: TurnExports) {
  const eventCount = target.spike_get_result(11);
  return { words: words(target),
    battlers: [0, 1].map(actor => Array.from({ length: 8 }, (_, field) => target.spike_get_battler(actor, field))),
    events: Array.from({ length: eventCount }, (_, index) => [0, 1, 2].map(field => target.spike_get_event(index, field))),
    diagnostics: Array.from({ length: 15 }, (_, field) => target.spike_get_result(field + 1)),
  };
}
statusOk(put(api, initial.core.words), 'initial portable import');
assert.deepEqual(words(api), initial.core.words, 'logical scalar round trip');
// Create a nonempty live event queue before malformed imports. These calls are
// setup for atomicity observations, not independent battle-mechanics goldens.
api.spike2_order(0, 0);
statusOk(api.spike_get_result(0), 'raw setup order');
statusOk(api.spike2_attack(0, 0), 'raw setup attack0');
statusOk(api.spike2_attack(1, 0), 'raw setup attack1');
statusOk(api.spike2_begin_turn(), 'raw setup selection');
const baseline = observations(api);
assert.ok(baseline.events.length > 0, 'atomicity includes an existing event queue');
const passed: string[] = [];
function rejection(id: string, action: () => number): void {
  assert.notEqual(action(), 0, `${id}: expected rejection`);
  assert.deepEqual(observations(api), baseline, `${id}: live state must not change`);
  passed.push(id);
}

rejection('commit-without-begin', () => api.spike3_import_commit());
rejection('set-without-begin', () => api.spike3_import_set(0, 0));
rejection('wrong-version', () => api.spike3_import_begin(2, 0, count));
rejection('invalid-boundary', () => api.spike3_import_begin(1, 4, count));
rejection('short-word-count', () => api.spike3_import_begin(1, 0, count - 1));
rejection('trailing-word-count', () => api.spike3_import_begin(1, 0, count + 1));
statusOk(api.spike3_import_begin(1, 0, count), 'partial start');
statusOk(api.spike3_import_set(0, initial.core.words[0]!), 'partial scalar');
rejection('partial-import', () => api.spike3_import_commit());
rejection('duplicate-word', () => api.spike3_import_set(0, initial.core.words[0]!));
for (let index = 1; index < count; index++) statusOk(api.spike3_import_set(index, initial.core.words[index]!), 'remaining duplicate stage');
rejection('duplicate-poisons-stage', () => api.spike3_import_commit());
statusOk(api.spike3_import_begin(1, 0, count), 'out-of-bounds start');
rejection('out-of-bounds-word', () => api.spike3_import_set(count, 0));
initial.core.words.forEach((value, index) => statusOk(api.spike3_import_set(index, value), 'remaining invalid stage'));
rejection('out-of-bounds-poisons-stage', () => api.spike3_import_commit());

const invalid: [string, number, number][] = [
  ['bad-magic', 0, 0], ['embedded-version', 1, 2], ['embedded-length', 2, count - 1],
  ['embedded-boundary', 3, 1], ['rng-state-mismatch', 4, (initial.core.words[4]! ^ 1) >>> 0],
  ['rng-draw-mismatch', 5, initial.core.words[5]! + 1], ['rng-unsafe-count', 6, 0x200000],
  ['random-turn-overflow', 7, 65536], ['choice-outcome', 8, 1], ['unsupported-action', 9, 3],
  ['choice-retains-action', 9, 0], ['chosen-slot-overflow', 11, 4], ['unsupported-current-move', 13, 261],
  ['rng-seed-mismatch', 14, (initial.core.words[14]! ^ 1) >>> 0], ['header-reserved', 15, 1],
  ['level-zero', 16, 0], ['choice-fainted', 17, 0], ['hp-over-max', 17, 65536], ['maxhp-zero', 18, 0],
  ['unsafe-defense', 20, 1], ['speed-zero', 23, 0], ['mystery-type', 24, 9],
  ['unsupported-status', 26, 64], ['unsupported-volatile', 27, 1], ['base-type-mismatch', 28, 1],
  ['hp-stage', 30, 5], ['stage-overflow', 31, 13], ['unsupported-move', 38, 261],
  ['excess-pp', 42, 255], ['actor-reserved', 46, 1], ['actor-second-reserved', 47, 1],
  ['history-actor', 50, 2], ['history-flag', 52, 2], ['history-second-flag', 53, 2],
  ['history-taken-actor', 55, 2], ['history-move', 56, 261], ['history-type', 57, 9],
  ['history-last-hit', 61, 2], ['first-turn-counter', 62, 3], ['actor-tail-reserved', 63, 1],
  ['empty-party-with-hp', 113, 1], ['egg-overflow', 114, 2],
];
for (const [id, index, value] of invalid) {
  const mutated = [...initial.core.words]; mutated[index] = value;
  rejection(id, () => put(api, mutated, 0));
}
const boundaryRows = new Map<number, number[]>();
for (const row of fixture.cases) {
  const battle = new TurnProbe(module, row.initial);
  for (const step of row.steps) {
    battle.advance(step.input);
    const snapshot = battle.snapshot();
    boundaryRows.set(snapshot.core.boundary, snapshot.core.words);
  }
}
assert.deepEqual([...boundaryRows.keys()].sort(), [0, 1, 2, 3], 'all supported boundary categories');
for (const boundary of [1, 2]) {
  const valid = boundaryRows.get(boundary)!;
  const restored = fresh(); statusOk(put(restored, valid, boundary), 'replacement import');
  assert.deepEqual(words(restored, boundary), valid, 'replacement scalar round trip');
  const invalid = [...valid]; invalid[8] = 1;
  rejection(`replacement-${boundary}-outcome`, () => put(api, invalid, boundary));
  const unsettled = [...valid];
  const actorOffset = unsettled[17] === 0 ? 16 : 64;
  unsettled[actorOffset + 10] = 8;
  rejection(`replacement-${boundary}-uncleared-faint-status`, () => put(api, unsettled, boundary));
}
const terminal = boundaryRows.get(3)!;
const ended = fresh(); statusOk(put(ended, terminal, 3), 'terminal import');
assert.deepEqual(words(ended, 3), terminal, 'terminal scalar round trip');
const noOutcome = [...terminal]; noOutcome[8] = 0;
rejection('terminal-without-outcome', () => put(api, noOutcome, 3));
const wrongOutcome = [...terminal]; wrongOutcome[8] = terminal[8] === 1 ? 2 : 1;
rejection('terminal-party-outcome-mismatch', () => put(api, wrongOutcome, 3));
const livingLoser = [...terminal]; livingLoser[(terminal[8]! & 2) ? 17 : 65] = 1;
rejection('terminal-losing-active-is-alive', () => put(api, livingLoser, 3));

// Independent BigInt affine composition validates the counter rollover path.
function advanceSeed(seed: number, count: bigint): number {
  const mask = 0xFFFFFFFFn;
  let mult = 1103515245n, add = 24691n, totalMult = 1n, totalAdd = 0n;
  while (count > 0n) {
    if (count & 1n) { totalMult = totalMult * mult & mask; totalAdd = (totalAdd * mult + add) & mask; }
    add = add * (mult + 1n) & mask; mult = mult * mult & mask; count >>= 1n;
  }
  return Number((BigInt(seed) * totalMult + totalAdd) & mask);
}
const rollover = [...initial.core.words];
rollover[5] = 0xFFFFFFFF; rollover[6] = 0; rollover[4] = advanceSeed(rollover[14]!, 0xFFFFFFFFn);
const counter = fresh(); statusOk(put(counter, rollover), 'rollover import');
counter.spike_rng_next();
assert.equal(counter.spike3_get_rng_draws(0) >>> 0, 0);
assert.equal(counter.spike3_get_rng_draws(1) >>> 0, 1);
assert.equal(counter.spike_get_rng() >>> 0, advanceSeed(rollover[14]!, 0x100000000n));
const limit = [...initial.core.words]; limit[5] = 0xFFFFFFFF; limit[6] = 0x1FFFFF;
limit[4] = advanceSeed(limit[14]!, BigInt(Number.MAX_SAFE_INTEGER));
statusOk(put(counter, limit), 'safe-count limit import');
counter.spike_rng_next();
assert.notEqual(counter.spike_get_result(0), 0, 'overflow reports error');
assert.equal(counter.spike_get_rng() >>> 0, limit[4]);
assert.equal(counter.spike3_get_rng_draws(0) >>> 0, limit[5]);
assert.equal(counter.spike3_get_rng_draws(1) >>> 0, limit[6]);

const report = { schemaVersion: 1, status: 'passed', scope: 'Profile-v1 raw scalar checkpoint validation and atomic import',
  wasmSha256: build.wasmSha256, sourceFingerprint: build.extraction.sourceFingerprint,
  checkpointVersion: 1, scalarWords: count, pointerOrStructBytes: false,
  invalidCases: passed, invalidCaseCount: passed.length, validBoundaryCategories: [...boundaryRows.keys()].sort(),
  checks: ['all-words-round-trip', 'all-four-boundaries', 'invalid-import-preserves-existing-live-state-and-events',
    'independent-BigInt-LCG-count-check', 'draw-counter-low-word-rollover', 'safe-integer-count-overflow-guard'],
  verifierSha256: createHash('sha256').update(await readFile('tools/battle-spike/verify-checkpoint.ts')).digest('hex'),
};
await writeFile('reports/battle-spike-checkpoint-tests.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checkpointRejections: passed.length, boundaries: boundaryRows.size }));
