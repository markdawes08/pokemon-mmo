import { readFixtureBytes } from '../fixtures/io';
/** Independent source-literal mechanics and portable recovery verification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { jump } from '../encounter-core/verify-support';
import { Route1Driver, instantiateRoute1, type Route1Checkpoint } from './driver';
import { loadRoute1Module } from './engine';
import { assertState, assertStep, checkTrace, exportRaw, importRaw, initialize, type Fixtures, type RecoveryJob } from './verify-support';

async function child(command: string, args: string[], input = '', timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { process.kill(); reject(new Error(`Owned verifier child exceeded ${timeout} ms`)); }, timeout);
    process.stdout.on('data', data => { stdout += String(data); }); process.stderr.on('data', data => { stderr += String(data); });
    process.once('error', error => { clearTimeout(timer); reject(error); });
    process.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(`Verifier child failed ${code}: ${stderr}`)); });
    process.stdin.end(input);
  });
}

await child('.venv/Scripts/python.exe', ['tools/battle-route1/fixtures/generate_fixtures.py', '--check']);
const fixtureBytes = await readFixtureBytes('tools/battle-route1/fixtures/source-cases.json');
const fixtures = JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
const [module, rebuildBytes, profile, encounters] = await Promise.all([loadRoute1Module(), readFile('.local/battle-route1/rebuild/route1.wasm'),
  loadDevelopmentProfile(), loadEncounterCore()]);
const rebuild = new WebAssembly.Module(rebuildBytes), resources = { profile, encounters };
const build = JSON.parse(await readFile('reports/battle-route1-build.json', 'utf8')) as { wasmSha256: string };
assert.equal(createHash('sha256').update(rebuildBytes).digest('hex'), build.wasmSha256);
assert.equal(fixtures.sourceFingerprint, profile.sourceFingerprint);
assert.equal(new Set(fixtures.cases.map(row => row.id)).size, fixtures.cases.length);
const jobs: RecoveryJob[] = [], observations = [];
let boundaries = 0, transitions = 0, checkedDraws = 0, restoredTransitions = 0;
for (const fixture of fixtures.cases) {
  const driver = initialize(module, resources, fixture);
  assertState(driver.snapshot(), fixture.initial.state, `${fixture.id} initial`);
  checkTrace(fixture.initial.trace, fixture.encounterState.main.state, 0); checkedDraws += fixture.initial.trace.length;
  for (let index = 0; index <= fixture.steps.length; index++) {
    const checkpoint = driver.snapshot(), expected = index === 0 ? fixture.initial.state : fixture.steps[index - 1]!.expected.state;
    assertState(checkpoint, expected, `${fixture.id} boundary ${index}`);
    const recovered = Route1Driver.restore(rebuild, resources, checkpoint);
    assert.deepEqual(recovered.snapshot(), checkpoint, `${fixture.id}: cross-build exact restore`);
    // Snapshot objects are detached from their live instance.
    const detached = driver.snapshot(); detached.core.words[17] = 65535; detached.host.wildSlot = 9;
    assert.deepEqual(driver.snapshot(), checkpoint);
    jobs.push({ id: `${fixture.id}:${index}`, checkpoint: structuredClone(checkpoint), expected, remaining: fixture.steps.slice(index) });
    boundaries++;
    for (const [remainingIndex, step] of fixture.steps.slice(index).entries()) {
      const events = recovered.advanceChoices([{ actor: 0, choice: step.choice }]);
      assertStep(events, recovered.snapshot(), step.expected, `${fixture.id} restored ${index}+${remainingIndex}`); restoredTransitions++;
    }
    if (index === fixture.steps.length) break;
    const step = fixture.steps[index]!;
    checkTrace(step.expected.trace, checkpoint.rng.state, checkpoint.rng.draws); checkedDraws += step.expected.trace.length;
    const events = driver.advanceChoices([{ actor: 0, choice: step.choice }]);
    assertStep(events, driver.snapshot(), step.expected, `${fixture.id} turn ${index}`); transitions++;
  }
  observations.push({ id: fixture.id, status: 'passed', diagnosticBoundary: Boolean(fixture.rawBoundaryOverrides),
    turns: fixture.steps.length, outcome: driver.snapshot().host.outcome, rngDraws: driver.snapshot().rng.draws });
}

// Interleaving cannot share WASM globals, pending AI or counters.
const pair = [fixtures.cases[0]!, fixtures.cases[1]!], interleaved = pair.map(row => initialize(module, resources, row));
let interleavedTransitions = 0;
for (let turn = 0; turn < Math.max(...pair.map(row => row.steps.length)); turn++) {
  for (const [index, row] of pair.entries()) {
    const step = row.steps[turn]; if (!step) continue;
    const events = interleaved[index]!.advanceChoices([{ actor: 0, choice: step.choice }]);
    assertStep(events, interleaved[index]!.snapshot(), step.expected, `${row.id} interleaved ${turn}`); interleavedTransitions++;
  }
}

const baseline = initialize(module, resources, fixtures.cases[0]!), before = baseline.snapshot();
const rejectedChoices: unknown[] = [{ kind: 'move', slot: 2 }, { kind: 'move', slot: 4 }, { kind: 'struggle' },
  { kind: 'move', slot: -1 }, { kind: 'move', slot: 0, rng: 0 }, { kind: 'switch', partyIndex: 1 }, { kind: 'item', itemId: 13 }];
for (const choice of rejectedChoices) {
  assert.throws(() => baseline.validateChoice(0, choice));
  assert.deepEqual(baseline.snapshot(), before, 'Rejected choices cannot reroll the retained wild choice');
}
assert.throws(() => baseline.validateChoice(1, { kind: 'move', slot: 0 }));
assert.throws(() => baseline.advanceChoices([]));
assert.throws(() => baseline.advanceChoices([{ actor: 1, choice: { kind: 'run' } }]));
assert.deepEqual(baseline.snapshot(), before);

const rejected: string[] = [];
const mutations: [string, (copy: Route1Checkpoint) => void][] = [
  ['header', c => { c.core.words[0] = 0; }], ['version', c => { c.core.words[1] = 1; }],
  ['word-count', c => { c.core.words.pop(); }], ['reserved', c => { c.core.words[150] = 1; }],
  ['rng-state', c => { c.rng.state ^= 1; c.core.words[4] = c.rng.state; }],
  ['rng-count', c => { c.rng.draws++; c.core.words[5] = c.rng.draws; }],
  ['intro-missing', c => { c.core.words[149] = 0; }], ['run-byte', c => { c.core.words[148] = 256; }],
  ['species', c => { c.core.words[46] = 19; }], ['ability', c => { c.core.words[47] = 0; }],
  ['stats', c => { c.core.words[19]++; }], ['max-hp', c => { c.core.words[18]++; }],
  ['healed-hp', c => { c.core.words[17]++; }], ['illegal-move', c => { c.core.words[38] = 55; }],
  ['excess-pp', c => { c.core.words[42] = 36; }], ['boosted-stage', c => { c.core.words[32] = 7; }],
  ['unsupported-speed-stage', c => { c.core.words[33] = 5; }], ['status', c => { c.core.words[26] = 8; }],
  ['turn', c => { c.host.turn++; }], ['sequence', c => { c.host.sequence++; }],
  ['outcome', c => { c.host.outcome = 'won'; }], ['illegal-wild-choice', c => { c.host.wildSlot = 4; }],
  ['party-species', c => { c.core.words[112] = 19; }], ['party-hp', c => { c.core.words[113]--; }],
  ['hidden-party', c => { c.core.words[115] = 7; c.core.words[116] = 1; }],
  ['initial-overflow', c => { c.admission.player.hp = 21; }],
  ['source', c => { (c as { sourceFingerprint: string }).sourceFingerprint = '0'.repeat(64); }],
];
for (const [id, edit] of mutations) {
  const copy = structuredClone(before); edit(copy);
  assert.throws(() => Route1Driver.restore(module, resources, copy), id);
  assert.deepEqual(baseline.snapshot(), before, `${id}: rejected restore cannot mutate another instance`); rejected.push(id);
}

// Mathematically valid private exhaustion boundaries, not natural battle histories.
const exhausted = structuredClone(before), count = Number.MAX_SAFE_INTEGER;
exhausted.rng.draws = count; exhausted.core.words[5] = count >>> 0; exhausted.core.words[6] = Math.floor(count / 0x100000000);
exhausted.rng.state = exhausted.core.words[4] = jump(exhausted.core.words[14]!, count, 24691);
const nearLimit = Route1Driver.restore(module, resources, exhausted), limitBefore = nearLimit.snapshot();
assert.throws(() => nearLimit.advanceChoices([{ actor: 0, choice: { kind: 'move', slot: 0 } }]));
assert.deepEqual(nearLimit.snapshot(), limitBefore, 'Counter exhaustion discards the entire failed candidate');
const eventLimit = structuredClone(before); eventLimit.host.eventSequence = Number.MAX_SAFE_INTEGER;
eventLimit.host.sequence = 1; eventLimit.host.turn = 2;
const eventDriver = Route1Driver.restore(module, resources, eventLimit), eventBefore = eventDriver.snapshot();
assert.throws(() => eventDriver.advanceChoices([{ actor: 0, choice: { kind: 'move', slot: 0 } }]));
assert.deepEqual(eventDriver.snapshot(), eventBefore);

const raw = instantiateRoute1(module);
assert.notEqual(raw.route1_start(), 0); assert(raw.route1_choose_wild() < 0);
assert.equal(importRaw(raw, before.core.words), 0);
const rawBefore = exportRaw(raw), rawRejected: string[] = [];
for (const [id, index, value] of [['magic', 0, 0], ['version', 1, 1], ['count', 2, 151], ['intro', 149, 0], ['run', 148, 256],
  ['reserved', 151, 1], ['identity', 46, 1], ['ability', 47, 0], ['rng', 4, before.core.words[4]! ^ 1],
  ['pp', 42, 36], ['stage', 32, 13]] as const) {
  const words = [...rawBefore]; words[index] = value >>> 0;
  assert.notEqual(importRaw(raw, words), 0, `raw ${id}`);
  assert.deepEqual(exportRaw(raw), rawBefore, `raw ${id}: atomic failed import`); rawRejected.push(id);
}
assert.equal(raw.spike3_import_begin(3, 0, 152), 0); assert.equal(raw.spike3_import_set(0, rawBefore[0]!), 0);
assert.notEqual(raw.spike3_import_set(0, rawBefore[0]!), 0); assert.notEqual(raw.spike3_import_commit(), 0);
assert.deepEqual(exportRaw(raw), rawBefore); rawRejected.push('duplicate-word');
assert.equal(raw.spike3_import_begin(3, 0, 152), 0); assert.notEqual(raw.spike3_import_set(152, 0), 0);
assert.notEqual(raw.spike3_import_commit(), 0); assert.deepEqual(exportRaw(raw), rawBefore); rawRejected.push('out-of-range-word');
assert.equal(raw.spike3_import_begin(3, 0, 152), 0); assert.notEqual(raw.spike3_import_commit(), 0);
assert.deepEqual(exportRaw(raw), rawBefore); rawRejected.push('incomplete-stage');

const depletedWild = fixtures.cases.find(row => row.id === 'raw-wild-exhausted-slot-rerolls'); assert(depletedWild);
const exhaustionWorker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-route1/exhaustion-worker.ts'],
  JSON.stringify({ parentPid: process.pid, checkpoint: initialize(module, resources, depletedWild).snapshot() }), 15000)) as {
    status: string; pid: number; checks: string[];
  };
assert.equal(exhaustionWorker.status, 'passed'); assert.notEqual(exhaustionWorker.pid, process.pid);

const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-route1/recovery-worker.ts'],
  JSON.stringify({ parentPid: process.pid, jobs }))) as { status: string; pid: number; results: { id: string; transitions: number }[] };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid);
assert.deepEqual(worker.results.map(row => row.id), jobs.map(row => row.id));
const checkedAt = new Date().toISOString();
await writeFile('reports/battle-route1-verification.json', `${JSON.stringify({ schemaVersion: 1, status: 'passed', checkedAt,
  scope: fixtures.scope, sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: build.wasmSha256,
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'), fixtureReproducibility: 'Independent Python --check passed without writes',
  independence: fixtures.independence, schedulingAdaptation: fixtures.schedulingAdaptation, originalGameOrEmulatorComparison: false,
  cases: fixtures.cases.length, transitions, checkedLiteralDraws: checkedDraws, goldenBoundaries: boundaries,
  rawBoundaryPolicy: fixtures.rawBoundaryPolicy, observations, sourceRecords: fixtures.sourceRecords }, null, 2)}\n`);
await writeFile('reports/battle-route1-recovery.json', `${JSON.stringify({ schemaVersion: 1, status: 'passed', checkedAt,
  scope: 'Private battle checkpoints only; no database, durable rewards, live transport or client save authority',
  crossBuildRestores: boundaries, crossBuildReplayedTransitions: restoredTransitions, interleavedTransitions,
  freshProcess: { parentPid: process.pid, pid: worker.pid, checkpoints: jobs.length, replayedTransitions: worker.results.reduce((sum, row) => sum + row.transitions, 0) },
  rejectedChoices: rejectedChoices.length + 3, rejectedCheckpoints: rejected, rawAtomicRejections: rawRejected,
  candidateCounterExhaustion: ['rng-safe-integer', 'event-sequence-safe-integer'],
  boundedAiExhaustionProcess: exhaustionWorker,
  trustedStateLimit: 'Valid handcrafted private continuation states are allowed; no signature or historical reachability proof is claimed.',
  atomicity: 'Failed raw imports preserve accepted logical state; source execution occurs in isolated candidates and failed candidates are discarded.' }, null, 2)}\n`);
process.stdout.write(`Route1 mechanics passed ${fixtures.cases.length} cases/${transitions} turns, ${boundaries} boundaries and ${jobs.length} fresh-process restores.\n`);
