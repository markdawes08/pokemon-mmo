/** Measures admitted logical battle paths in a clean child with explicit GC.
 * This is neither a database benchmark nor the plan's 60-minute soak gate.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import type { BattleSnapshot, AcceptedChoice } from '@pokewaterblue/battle-core';
import { loadProbeModule } from './probe';
import { createProbeEngine, makeProbeRng, probeConfig } from './engine';
import { TurnProbe, stepSchema, turnInputSchema, type TurnChoice, type Step } from './turn-probe';

const fixtureSchema = z.object({ sourceFingerprint: z.string(), cases: z.array(z.object({
  id: z.string(), initial: turnInputSchema,
  steps: z.array(z.object({ input: stepSchema, expected: z.object({ state: z.unknown(), goldenEvents: z.unknown() }) })).nonempty(),
})).nonempty() });
const fixtureBytes = await readFile('tools/battle-spike/fixtures/batch-2.json');
const fixture = fixtureSchema.parse(JSON.parse(fixtureBytes.toString('utf8')));
const implementation = await Promise.all(['tools/battle-spike/turn-probe.ts', 'tools/battle-spike/engine.ts',
  'packages/battle-core/src/contracts.ts', 'packages/battle-core/src/wasm-adapter.ts',
  'tools/battle-spike/measure.ts', 'tools/battle-spike/measure-worker.ts'].map(async path => ({ path,
  sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8')) as {
  status: string; wasmSha256: string; wasmBytes: number; fixedLinearMemoryBytes: number;
  extraction: { sourceFingerprint: string };
};
assert.equal(build.status, 'passed');
assert.equal(build.extraction.sourceFingerprint, fixture.sourceFingerprint);
const loadStart = performance.now();
const module = await loadProbeModule();
const moduleLoadAndCompileMilliseconds = performance.now() - loadStart;
const engine = createProbeEngine(module);
const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
assert.ok(gc, 'Run the measurement child with --expose-gc');
const collect = async () => { gc(); await setImmediate(); gc(); await setImmediate(); };
const memory = () => ({ ...process.memoryUsage() });
type Sample = { operation: string; milliseconds: number; fixture: string; phase: string };
const samples: Sample[] = [];
const snapshotSizes: number[] = [];
const envelopeSizes: number[] = [];
const phaseCounts = new Map<string, number>();
let record = false;
const timed = <T>(operation: string, id: string, phase: string, action: () => T): T => {
  const start = performance.now();
  const result = action();
  if (record) samples.push({ operation, milliseconds: performance.now() - start, fixture: id, phase });
  return result;
};
const phaseName = (battle: TurnProbe): string => {
  const state = battle.inspect();
  return state.resume ? `${state.phase}:${state.resume}` : state.phase;
};

function roundtrip(battle: TurnProbe, id: string): TurnProbe {
  const phase = phaseName(battle);
  const saved = timed('snapshot', id, phase, () => battle.snapshot());
  const json = timed('snapshot-json-encode', id, phase, () => JSON.stringify(saved));
  const parsed: unknown = timed('snapshot-json-decode', id, phase, () => JSON.parse(json));
  const restored = timed('restore', id, phase, () => TurnProbe.restore(module, parsed));
  assert.deepEqual(restored.inspect(), battle.inspect(), `${id} measured roundtrip ${phase}`);
  if (record) {
    snapshotSizes.push(Buffer.byteLength(json));
    phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
  }
  return restored;
}

function exercise(): void {
  for (const row of fixture.cases) {
    let battle = timed('create', row.id, 'choice', () => new TurnProbe(module, row.initial));
    battle = roundtrip(battle, row.id);
    for (const step of row.steps) {
      const phase = phaseName(battle);
      const result = timed(step.input.kind === 'turn' ? 'advance-turn' : 'advance-replacement', row.id, phase,
        () => battle.advance(step.input));
      // Independent expected observations keep the benchmark from measuring a
      // fast rejected/no-op path. Assertions are outside operation timing.
      assert.deepEqual(result.state, step.expected.state, `${row.id} measured state`);
      assert.deepEqual(result.events, step.expected.goldenEvents, `${row.id} measured events`);
      timed('inspect', row.id, phaseName(battle), () => battle.inspect());
      battle = roundtrip(battle, row.id);
    }
  }
}

function inspectContract(state: BattleSnapshot) {
  return TurnProbe.restore(module, JSON.parse(Buffer.from(state.privateEngineState.data, 'base64').toString('utf8'))).inspect();
}
function contractRoundtrip(state: BattleSnapshot, id: string, phase: string): BattleSnapshot {
  const saved = timed('contract-snapshot', id, phase, () => engine.snapshot(state));
  const json = timed('contract-json-encode', id, phase, () => JSON.stringify(saved));
  const parsed: BattleSnapshot = timed('contract-json-decode', id, phase, () => JSON.parse(json));
  const restored = timed('contract-restore', id, phase, () => engine.restore(parsed));
  assert.deepEqual(restored, state, `${id} contract roundtrip ${phase}`);
  if (record) envelopeSizes.push(Buffer.byteLength(json));
  return restored;
}
function contractStep(state: BattleSnapshot, step: Step, id: string, phase: string) {
  return timed(step.kind === 'turn' ? 'contract-turn-cycle' : 'contract-replacement-cycle', id, phase, () => {
    const accepted: AcceptedChoice<TurnChoice>[] = [];
    step.choices.forEach((choice, actor) => {
      if (choice === null) return;
      const validated = timed('contract-validate-choice', id, phase, () =>
        engine.validateChoice(state, state.config.participantIds[actor]!, choice));
      assert.ok(validated.accepted, `${id}: benchmark choice rejected`);
      accepted.push(validated.value);
    });
    const advanced = timed(step.kind === 'turn' ? 'contract-advance-turn' : 'contract-advance-replacement', id, phase,
      () => engine.advance(state, accepted));
    for (const viewer of state.config.participantIds)
      timed('contract-project', id, phase, () => engine.project(advanced.nextState, viewer));
    const saved = timed('contract-snapshot-for-commit', id, phase, () => engine.snapshot(advanced.nextState));
    timed('contract-json-for-commit', id, phase, () => JSON.stringify(saved));
    return advanced;
  });
}
function exerciseContract(): void {
  for (const row of fixture.cases) {
    const config = probeConfig(engine, `measurement-${row.id}`);
    let state = timed('contract-create', row.id, 'choice', () => engine.createBattle(config,
      { parties: row.initial.parties }, makeProbeRng(config.battleId, row.initial.seed)));
    state = contractRoundtrip(state, row.id, 'choice');
    for (const step of row.steps) {
      const before = inspectContract(state);
      const phase = before.resume ? `${before.phase}:${before.resume}` : before.phase;
      const result = contractStep(state, step.input, row.id, phase);
      assert.deepEqual(inspectContract(result.nextState), step.expected.state, `${row.id} contract golden state`);
      assert.deepEqual(result.orderedEvents.map(event => event.payload), step.expected.goldenEvents, `${row.id} contract golden events`);
      assert.deepEqual(result.domainEffects, [], 'Measured profile has no persistent effects');
      state = contractRoundtrip(result.nextState, row.id, phase);
    }
  }
}

const warmupRounds = 3, measuredRounds = 40, heldBattleCount = 20, churnCycles = 10;
for (let round = 0; round < warmupRounds; round++) { exercise(); exerciseContract(); }
await collect();
record = true;
const workloadStart = performance.now();
for (let round = 0; round < measuredRounds; round++) { exercise(); exerciseContract(); }
const workloadMilliseconds = performance.now() - workloadStart;
record = false;
const concurrentWaveMilliseconds: number[] = [];
const concurrentContractWaveMilliseconds: number[] = [];
const concurrentWaves = 20;
for (let wave = 0; wave < concurrentWaves; wave++) {
  const group = Array.from({ length: heldBattleCount }, (_, index) => {
    const row = fixture.cases[index % fixture.cases.length]!;
    return { row, battle: new TurnProbe(module, row.initial) };
  });
  const observed = [];
  const start = performance.now();
  const maxSteps = Math.max(...group.map(item => item.row.steps.length));
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    for (const { row, battle } of group) {
      const step = row.steps[stepIndex];
      if (step) observed.push({ result: battle.advance(step.input), expected: step.expected });
    }
  }
  concurrentWaveMilliseconds.push(performance.now() - start);
  for (const { result, expected } of observed) {
    assert.deepEqual(result.state, expected.state);
    assert.deepEqual(result.events, expected.goldenEvents);
  }
  const contractGroup = Array.from({ length: heldBattleCount }, (_, index) => {
    const row = fixture.cases[index % fixture.cases.length]!;
    const config = probeConfig(engine, `wave-${wave}-${index}`);
    return { row, state: engine.createBattle(config, { parties: row.initial.parties }, makeProbeRng(config.battleId, row.initial.seed)) };
  });
  const contractObserved = [];
  const contractStart = performance.now();
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    for (const item of contractGroup) {
      const step = item.row.steps[stepIndex];
      if (!step) continue;
      const result = contractStep(item.state, step.input, item.row.id, 'interleaved-wave');
      item.state = result.nextState;
      contractObserved.push({ result, expected: step.expected });
    }
  }
  concurrentContractWaveMilliseconds.push(performance.now() - contractStart);
  for (const { result, expected } of contractObserved) {
    assert.deepEqual(inspectContract(result.nextState), expected.state);
    assert.deepEqual(result.orderedEvents.map(event => event.payload), expected.goldenEvents);
  }
}
await collect();
const beforeHeld = memory();

function retainBattles(): TurnProbe[] {
  return Array.from({ length: heldBattleCount }, (_, index) => {
    const row = fixture.cases[index % fixture.cases.length]!;
    const battle = new TurnProbe(module, row.initial);
    battle.advance(row.steps[0]!.input);
    return battle;
  });
}
const held = retainBattles();
await collect();
const withHeld = memory();
assert.equal(held.length, heldBattleCount);
held.length = 0;
await collect();
const afterRelease = memory();
const contractStates = Array.from({ length: heldBattleCount }, (_, index) => {
  const row = fixture.cases[index % fixture.cases.length]!;
  const config = probeConfig(engine, `held-contract-${index}`);
  return engine.createBattle(config, { parties: row.initial.parties }, makeProbeRng(config.battleId, row.initial.seed));
});
await collect();
const withContractStates = memory();
assert.equal(contractStates.length, heldBattleCount);
contractStates.length = 0;
await collect();
const afterContractRelease = memory();
const churnMemory = [];
const churnStart = performance.now();
function churnBatch(): void {
  const batch = retainBattles();
  for (const battle of batch) TurnProbe.restore(module, JSON.parse(JSON.stringify(battle.snapshot())));
  batch.length = 0;
}
for (let cycle = 0; cycle < churnCycles; cycle++) {
  churnBatch();
  await collect();
  churnMemory.push({ cycle: cycle + 1, ...memory() });
}
const churnMilliseconds = performance.now() - churnStart;

function distribution(values: number[]) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
  return { count: sorted.length, min: sorted[0]!, median: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1)! };
}
const operationMilliseconds = Object.fromEntries([...new Set(samples.map(row => row.operation))].map(operation =>
  [operation, distribution(samples.filter(row => row.operation === operation).map(row => row.milliseconds))]));
const turnP95 = operationMilliseconds['advance-turn']!.p95;
const contractP95 = operationMilliseconds['contract-turn-cycle']!.p95;
const report = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'measured', batch: 3,
  scope: 'Private four-move source/host probe and six-method contract including logical checkpoint paths; no database, network, room or production load',
  environment: { node: process.versions.node, v8: process.versions.v8, platform: process.platform,
    release: os.release(), architecture: process.arch, cpuModel: os.cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: os.cpus().length, totalSystemMemoryBytes: os.totalmem(), explicitGc: true,
    databaseTopology: 'excluded', networkConditions: 'none; entirely local process' },
  sourceFingerprint: fixture.sourceFingerprint, wasmSha256: build.wasmSha256, wasmBytes: build.wasmBytes,
  implementation,
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  workload: { fixtureIds: fixture.cases.map(row => row.id), transitionsPerRound: fixture.cases.reduce((n, row) => n + row.steps.length, 0),
    warmupRounds, measuredRounds, heldBattleCount, churnCycles, workloadMilliseconds, concurrentWaves,
    transitionsPerConcurrentWave: Array.from({ length: heldBattleCount }, (_, index) => fixture.cases[index % fixture.cases.length]!.steps.length).reduce((a, b) => a + b, 0),
    restoredBoundaryCounts: Object.fromEntries(phaseCounts),
    timingBoundary: 'Operations exclude independent golden assertions and surrounding benchmark work. Probe advance includes host validation, logical checkpoint restoration into a candidate instance and source execution. Contract cycles include both choice validations, advance, both viewer projections, snapshot validation and JSON preparation for a commit, without a database. Restore receives parsed logical JSON.' },
  moduleLoadAndCompileMilliseconds, operationMilliseconds, snapshotJsonBytes: distribution(snapshotSizes),
  contractEnvelopeJsonBytes: distribution(envelopeSizes),
  interleavedTwentyBattleWaveMilliseconds: distribution(concurrentWaveMilliseconds),
  interleavedTwentyContractBattleWaveMilliseconds: distribution(concurrentContractWaveMilliseconds),
  outliers: [...samples].sort((a, b) => b.milliseconds - a.milliseconds).slice(0, 12),
  memory: { linearBytesPerInstance: build.fixedLinearMemoryBytes,
    linearBytesForHeldInstances: heldBattleCount * build.fixedLinearMemoryBytes,
    beforeHeld, withHeld, afterRelease, withContractStates, afterContractRelease,
    heldRssDeltaBytes: withHeld.rss - beforeHeld.rss,
    heldHeapDeltaBytes: withHeld.heapUsed - beforeHeld.heapUsed,
    contractStateHeapDeltaBytes: withContractStates.heapUsed - afterRelease.heapUsed,
    churnCycles, churnMilliseconds, churnMemory,
    interpretation: 'RSS/heap are process observations after explicit GC and may include allocator/JIT retention. Probe instances retain WASM memory; the contract adapter retains logical snapshot objects and recreates transient instances per call. Linear bytes do not include JS objects, validation or scratch copies. Short churn is not the 60-minute soak or a leak-proof capacity measurement.' },
  planTargets: { reference: 'docs/PROJECT_PLAN.md Sections7 and13', r2ConcurrentBattles: 10, r3ConcurrentBattles: 20,
    ordinaryTurnP95IncludingPersistenceMilliseconds: 100, soakMinutes: 60,
    separateSpikeMemoryOrLatencyCutoffSpecified: false },
  assessment: { ordinaryTurnEngineP95Milliseconds: turnP95,
    ordinaryTurnContractCycleP95Milliseconds: contractP95,
    engineP95Below100Milliseconds: turnP95 < 100,
    contractCycleP95Below100Milliseconds: contractP95 < 100,
    includingPersistenceTargetVerified: false, sixtyMinuteSoakVerified: false,
    statement: 'Engine-only headroom is an observation, not a pass of the later persistence-inclusive server latency or population gate. No production engine is selected by this script.' },
};
console.log(JSON.stringify(report));
