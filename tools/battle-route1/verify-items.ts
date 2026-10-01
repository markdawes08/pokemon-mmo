/** Independent literal item/capture mechanics; no DB, room, user account or UI. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { Route1Driver, instantiateRoute1, type Route1Checkpoint, type Route1Exports } from './driver';
import { loadRoute1Module } from './engine';
import { checkTrace, exportRaw, importRaw, initialize } from './verify-support';
import { assertItemState, assertItemStep, type ItemFixtures, type ItemRecoveryJob } from './items-support';

async function child(command: string, args: string[], input = '', timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Owned item verifier child exceeded ${timeout}ms`)); }, timeout);
    child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(`Item child failed ${code}: ${stderr}`)); });
    child.stdin.end(input);
  });
}
await child('.venv/Scripts/python.exe', ['tools/battle-route1/fixtures/generate_items.py', '--check']);
const fixtureBytes = await readFile('tools/battle-route1/fixtures/items-cases.json');
const fixtures = JSON.parse(fixtureBytes.toString('utf8')) as ItemFixtures;
const [module, rebuildBytes, profile, encounters] = await Promise.all([loadRoute1Module(), readFile('.local/battle-route1/rebuild/route1.wasm'),
  loadDevelopmentProfile(), loadEncounterCore()]);
const resources = { profile, encounters }, rebuild = new WebAssembly.Module(rebuildBytes);
const build = JSON.parse(await readFile('reports/battle-route1-build.json', 'utf8')) as { wasmSha256: string };
assert.equal(createHash('sha256').update(rebuildBytes).digest('hex'), build.wasmSha256);
assert.equal(fixtures.sourceFingerprint, profile.sourceFingerprint);
// The prior literal expectations remain exact bytes; v2 supplies an empty bag
// only in the test harness, never rewrites the retained source transcripts.
assert.equal(createHash('sha256').update(await readFile('tools/battle-route1/fixtures/source-cases.json')).digest('hex'),
  '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac');
const jobs: ItemRecoveryJob[] = [], observations = [];
let transitions = 0, boundaries = 0, restoredTransitions = 0, checkedDraws = 0;
for (const fixture of fixtures.cases) {
  const driver = initialize(module, resources, fixture);
  assertItemState(driver.snapshot(), fixture.initial.state, `${fixture.id} initial`);
  checkTrace(fixture.initial.trace, fixture.encounterState.main.state, 0); checkedDraws += fixture.initial.trace.length;
  for (let index = 0; index <= fixture.steps.length; index++) {
    const checkpoint = driver.snapshot(), expected = index === 0 ? fixture.initial.state : fixture.steps[index - 1]!.expected.state;
    assertItemState(checkpoint, expected, `${fixture.id} boundary ${index}`);
    const recovered = Route1Driver.restore(rebuild, resources, checkpoint);
    assert.deepEqual(recovered.snapshot(), checkpoint, 'Cross-build restore cannot consume an item or repeat a shake');
    jobs.push({ id: `${fixture.id}:${index}`, checkpoint: structuredClone(checkpoint), expected, remaining: fixture.steps.slice(index) });
    boundaries++;
    for (const [offset, step] of fixture.steps.slice(index).entries()) {
      const events = recovered.advanceChoices([{ actor: 0, choice: step.choice }]);
      assertItemStep(events, recovered.snapshot(), step.expected, `${fixture.id} recovered ${index}+${offset}`); restoredTransitions++;
    }
    if (index === fixture.steps.length) break;
    const step = fixture.steps[index]!;
    checkTrace(step.expected.trace, checkpoint.rng.state, checkpoint.rng.draws); checkedDraws += step.expected.trace.length;
    const events = driver.advanceChoices([{ actor: 0, choice: step.choice }]);
    assertItemStep(events, driver.snapshot(), step.expected, `${fixture.id} turn ${index}`); transitions++;
  }
  observations.push({ id: fixture.id, status: 'passed', turns: fixture.steps.length, outcome: driver.snapshot().host.outcome });
}

const interleavedFixtures = [fixtures.cases.find(row => row.id === 'potion-repeat-consumes-exactly-one-each')!,
  fixtures.cases.find(row => row.id === 'poke-ball-failure-then-capture-keeps-spent-wild-pp')!];
const interleaved = interleavedFixtures.map(row => initialize(module, resources, row));
let interleavedTransitions = 0;
for (let turn = 0; turn < Math.max(...interleavedFixtures.map(row => row.steps.length)); turn++) {
  for (const [index, fixture] of interleavedFixtures.entries()) {
    const step = fixture.steps[turn]; if (!step) continue;
    const peer = interleaved[index ^ 1]!.snapshot();
    const events = interleaved[index]!.advanceChoices([{ actor: 0, choice: step.choice }]);
    assertItemStep(events, interleaved[index]!.snapshot(), step.expected, `${fixture.id} interleaved ${turn}`);
    assert.deepEqual(interleaved[index ^ 1]!.snapshot(), peer, 'Interleaved item diagnostics, bag and capture are instance-local');
    interleavedTransitions++;
  }
}

const rawCheckpoints = new Map<number, Route1Checkpoint>();
function rawStart(seed: number): Route1Checkpoint {
  let result = rawCheckpoints.get(seed);
  if (!result) {
    const factory = encounters.create({ mainSeed: seed, wildSeed: 0x4321, trainerId: 1 }); factory.generate();
    result = new Route1Driver(module, resources, { encounter: factory.snapshot(), player: { hp: 20, pp: [35, 30] },
      inventory: { potion: 5, pokeBall: 5 } }).snapshot();
    rawCheckpoints.set(seed, result);
  }
  return structuredClone(result);
}
for (const row of fixtures.captureArithmetic) {
  const snapshot = rawStart(row.mainSeed), words = snapshot.core.words;
  assert.equal(words[66], row.maxHP, 'Arithmetic case maximum came from real source generation');
  words[65] = words[131] = row.hp;
  const raw = instantiateRoute1(module); assert.equal(importRaw(raw, words), 0); assert.equal(raw.route1_item(4), 0);
  assert.equal(raw.route1_item_get(2), row.odds); assert.equal(raw.route1_item_get(3), row.threshold);
}
for (const row of fixtures.thresholdEdges) {
  const words = rawStart(row.mainSeed).core.words;
  words[65] = words[131] = row.hp; words[14] = row.rngAnchor; words[4] = row.rngStateBefore; words[5] = 1; words[6] = 0;
  const raw = instantiateRoute1(module); assert.equal(importRaw(raw, words), 0); assert.equal(raw.route1_item(4), 0);
  assert.equal(raw.route1_item_get(3), row.threshold); assert.equal(raw.route1_item_get(4), row.shakes);
  assert.equal(raw.route1_item_get(5), Number(row.caught)); assert.equal(raw.spike_get_rng() >>> 0, row.rngStateAfter);
  assert.equal(raw.spike3_get_rng_draws(0), 1 + row.values.length, 'Strict equality and early exit draw count');
}
const sqrt = instantiateRoute1(module) as Route1Exports & { route1_sqrt(value: number): number };
for (const row of fixtures.sqrtCases) assert.equal(sqrt.route1_sqrt(row.input), row.expected, `BIOS replacement sqrt ${row.input}`);

const full = rawStart(0), active = Route1Driver.restore(module, resources, full), before = active.snapshot();
assert.throws(() => active.validateChoice(0, { kind: 'item', itemId: 13 }));
assert.throws(() => active.advanceChoices([{ actor: 0, choice: { kind: 'item', itemId: 13 } }]));
assert.deepEqual(active.snapshot(), before, 'No-effect Potion consumes no HP, inventory, turn, RNG or pending AI');
const noInventory = structuredClone(full); noInventory.admission.inventory = noInventory.host.inventory = { potion: 0, pokeBall: 0 };
const empty = Route1Driver.restore(module, resources, noInventory), emptyBefore = empty.snapshot();
for (const itemId of [13, 4] as const) {
  assert.throws(() => empty.advanceChoices([{ actor: 0, choice: { kind: 'item', itemId } }])); assert.deepEqual(empty.snapshot(), emptyBefore);
}
for (const choice of [{ kind: 'item', itemId: 1 }, { kind: 'item', itemId: 3 }, { kind: 'item', itemId: 13, target: 1 },
  { kind: 'item', itemId: 4, count: 2 }, { kind: 'item', itemId: 4, rng: 0 }]) {
  assert.throws(() => active.validateChoice(0, choice)); assert.deepEqual(active.snapshot(), before);
}
const raw = instantiateRoute1(module); assert.equal(importRaw(raw, before.core.words), 0);
const rawBefore = exportRaw(raw);
assert.notEqual(raw.route1_item(13), 0); assert.deepEqual(exportRaw(raw), rawBefore);
assert.notEqual(raw.route1_item(3), 0); assert.deepEqual(exportRaw(raw), rawBefore);

const captured = jobs.find(job => job.checkpoint.host.outcome === 'captured')!.checkpoint;
const healed = jobs.find(job => job.id === 'potion-low-hp-clamps-to-maximum:1')!.checkpoint;
const rejected: string[] = [];
const mutations: [string, Route1Checkpoint, (copy: Route1Checkpoint) => void][] = [
  ['capture-descriptor-missing', captured, c => { c.capture = null; }],
  ['capture-hp', captured, c => { c.capture!.creature.hp--; }],
  ['capture-pp', captured, c => { c.capture!.creature.moves[0]!.pp--; }],
  ['capture-personality', captured, c => { c.capture!.creature.personality ^= 1; }],
  ['capture-ivs', captured, c => { c.capture!.creature.ivs.hp ^= 1; }],
  ['capture-stats', captured, c => { c.capture!.creature.stats.attack++; }],
  ['capture-false-ball', captured, c => { c.core.words[150] = 3; }],
  ['capture-fewer-shakes', captured, c => { c.core.words[151] = 3; }],
  ['capture-without-consumption', captured, c => { c.host.inventory.pokeBall = c.admission.inventory.pokeBall; }],
  ['capture-unearned-extra-field', captured, c => { Object.assign(c.capture!.creature, { metLocation: 101 }); }],
  ['nonterminal-capture', before, c => { c.capture = structuredClone(captured.capture); }],
  ['nonterminal-ball-marker', before, c => { c.core.words[150] = 4; c.core.words[151] = 4; }],
  ['initial-item-spend', before, c => { c.host.inventory.potion--; }],
  ['inventory-over-cap', before, c => { c.host.inventory.potion = 6; }],
  ['negative-inventory', before, c => { c.host.inventory.pokeBall = -1; }],
  ['old-profile', before, c => { Object.assign(c, { profile: 'firered-route1-singles-v1' }); }],
  ['old-core-version', before, c => { Object.assign(c.core, { version: 2 }); c.core.words[1] = 2; }],
  ['healed-without-spent-potion', healed, c => { c.host.inventory.potion = c.admission.inventory.potion; }],
  ['two-items-in-one-transition', healed, c => { c.host.inventory.potion = c.admission.inventory.potion - 2; }],
];
for (const [id, source, edit] of mutations) {
  const copy = structuredClone(source); edit(copy); assert.throws(() => Route1Driver.restore(module, resources, copy), id);
  assert.deepEqual(active.snapshot(), before); rejected.push(id);
}
const rawRejected: string[] = [];
for (const [label, source, edit] of [
  ['captured-wrong-ball', captured, (words: number[]) => { words[150] = 3; }],
  ['captured-missing-shake', captured, (words: number[]) => { words[151] = 3; }],
  ['captured-missing-ball', captured, (words: number[]) => { words[150] = 0; }],
  ['nonterminal-capture-tail', before, (words: number[]) => { words[150] = 4; words[151] = 4; }],
] as const) {
  const words = [...source.core.words]; edit(words);
  assert.notEqual(importRaw(raw, words, source.core.boundary), 0, label);
  assert.deepEqual(exportRaw(raw), rawBefore, 'Rejected capture-tail import preserves the raw accepted state');
  rawRejected.push(label);
}
const terminal = Route1Driver.restore(module, resources, captured), terminalBefore = terminal.snapshot();
assert.throws(() => terminal.advanceChoices([{ actor: 0, choice: { kind: 'item', itemId: 4 } }]));
assert.deepEqual(terminal.snapshot(), terminalBefore, 'Terminal capture cannot consume a second ball or grant twice');
const detached = terminal.snapshot(); detached.capture!.creature.hp = 0; detached.host.inventory.pokeBall = 0;
assert.deepEqual(terminal.snapshot(), terminalBefore, 'Capture handoff is detached from internal state');

const potionFixture = fixtures.cases.find(row => row.id === 'potion-low-hp-clamps-to-maximum')!;
const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-route1/items-recovery-worker.ts'],
  JSON.stringify({ parentPid: process.pid, jobs, potion: initialize(module, resources, potionFixture).snapshot(), ball: before }))) as {
    status: string; pid: number; results: { id: string; transitions: number }[]; exhaustion: string[];
  };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid); assert.deepEqual(worker.results.map(row => row.id), jobs.map(row => row.id));
const checkedAt = new Date().toISOString();
await writeFile('reports/battle-route1-items.json', `${JSON.stringify({ schemaVersion: 1, status: 'passed', checkedAt,
  sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: build.wasmSha256, fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  fixtureReproducibility: 'Independent Python --check passed without writes', old21LiteralBytesUnchanged: true,
  scope: fixtures.scope, independence: fixtures.independence, sqrtBoundary: fixtures.sqrtBoundary,
  schedulingAdaptation: fixtures.schedulingAdaptation, originalGameOrEmulatorComparison: false,
  cases: fixtures.cases.length, transitions, goldenBoundaries: boundaries, checkedLiteralDraws: checkedDraws,
  hpOddsCases: fixtures.captureArithmetic.length, strictThresholdCases: fixtures.thresholdEdges.length, sqrtCases: fixtures.sqrtCases.length,
  observations, sourceRecords: fixtures.sourceRecords }, null, 2)}\n`);
await writeFile('reports/battle-route1-items-recovery.json', `${JSON.stringify({ schemaVersion: 1, status: 'passed', checkedAt,
  crossBuildRestores: boundaries, crossBuildReplayedTransitions: restoredTransitions, rejectedCheckpoints: rejected,
  interleavedTransitions,
  freshProcess: { parentPid: process.pid, pid: worker.pid, checkpoints: jobs.length, replayedTransitions: worker.results.reduce((sum, row) => sum + row.transitions, 0) },
  candidateFailures: worker.exhaustion, noEffectAndInvalidChoiceAtomicity: true, terminalCaptureStableAndDetached: true,
  rawNegativeAtomicity: ['no-effect-potion', 'unsupported-item', ...rawRejected],
  trustedBoundary: 'Private logical continuation checkpoints permit valid handcrafted state. Capture remains a pending-disposition descriptor; no ownership, dex, nickname, storage allocation, rewards or DB effects are executed.' }, null, 2)}\n`);
process.stdout.write(`Route1 items passed ${fixtures.cases.length} cases/${transitions} turns, ${boundaries} fresh-process boundaries, ${fixtures.captureArithmetic.length} odds and ${fixtures.thresholdEdges.length} threshold edges.\n`);
