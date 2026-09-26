/** Independent literal fixtures exercise compiled source, not a second game engine. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { initializeProbe, instantiateProbe, loadProbeModule, probeInputSchema, readProbeResult, resultSchema, runProbe, statusOk, type ProbeExports } from './probe';

const integer = z.number().int().nonnegative();
const callArities = { spike_set_capabilities: 8, spike_set_battler: 12, spike_set_stage: 3, spike_damage: 2 } as const;
const callSchema = z.strictObject({ name: z.enum(['spike_set_capabilities', 'spike_set_battler', 'spike_set_stage', 'spike_damage']), args: z.array(z.number().int()) })
  .refine(call => call.args.length === callArities[call.name], 'Incorrect source probe call arity');
const fixtureSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal('batch-1-damage-and-hp-kernel'), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.string().min(1), rngStateSemantics: z.string().min(1),
  cases: z.array(z.strictObject({ id: z.string().min(1), input: probeInputSchema, expected: resultSchema, derivation: z.string().min(1) })).nonempty(),
  rngCases: z.array(z.strictObject({ id: z.string().min(1), initialState: integer.max(0xFFFFFFFF),
    draws: z.array(z.strictObject({ value: integer.max(65535), state: integer.max(0xFFFFFFFF) })).nonempty() })).nonempty(),
  rejections: z.array(z.object({ id: z.string().min(1), setupCase: z.string().min(1), before: z.array(callSchema),
    call: callSchema, expectedStatus: integer.min(1), unchanged: z.array(z.enum(['rngState', 'battlerHP', 'controllerEvents'])).length(3)
      .refine(values => new Set(values).size === 3, 'All three unchanged observations are required') })).nonempty(),
});
const fixtureBytes = await readFile('tools/battle-spike/fixtures/batch-1.json');
const fixture = fixtureSchema.parse(JSON.parse(fixtureBytes.toString('utf8')));
const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8'));
assert.equal(fixture.sourceFingerprint, build.extraction.sourceFingerprint);
assert.equal(new Set(fixture.cases.map(row => row.id)).size, fixture.cases.length, 'Duplicate fixture identifiers');
const started = performance.now();
const module = await loadProbeModule();
const loadAndCompileMilliseconds = performance.now() - started;
const api = instantiateProbe(module);
assert.equal(api.spike_set_capabilities(0, 0, 0, 0, 0, 0, 0, 0), 3, 'Fresh instance must require initialization');
assert.equal(api.spike_set_stage(0, 1, 6), 3, 'Stages cannot configure an uninitialized instance');
assert.equal(api.spike_set_battler(0, 5, 30, 30, 12, 10, 13, 10, 10, 10, 0, 0), 3, 'Battlers cannot bypass initialization');
assert.equal(api.spike_damage(33, 1), 3, 'Uninitialized damage must fail without a trap');
const observations = [];
for (const row of fixture.cases) {
  const first = runProbe(api, row.input);
  assert.deepEqual(first, row.expected, row.id);
  assert.deepEqual(runProbe(api, row.input), first, `${row.id}: repeated same-state execution`);
  observations.push({ id: row.id, status: 'passed', observed: first });
}
for (const row of fixture.rngCases) {
  statusOk(api.spike_reset(row.initialState), 'RNG state');
  for (const [index, expected] of row.draws.entries()) {
    assert.equal(api.spike_rng_next(), expected.value, `${row.id} draw ${index}`);
    assert.equal(api.spike_get_rng() >>> 0, expected.state, `${row.id} state ${index}`);
  }
}

const allowedRejections: Record<string, (...args: number[]) => number> = {
  spike_set_capabilities: (...args) => api.spike_set_capabilities(...args as [number, number, number, number, number, number, number, number]),
  spike_set_battler: (...args) => api.spike_set_battler(...args as [number, number, number, number, number, number, number, number, number, number, number, number]),
  spike_set_stage: (...args) => api.spike_set_stage(...args as [number, number, number]),
  spike_damage: (...args) => api.spike_damage(...args as [number, number]),
};
const observe = (instance: ProbeExports) => ({ rngState: instance.spike_get_rng() >>> 0,
  battlerHP: [0, 1].map(index => instance.spike_get_battler(index, 0)),
  controllerEvents: Array.from({ length: instance.spike_get_result(11) }, (_, index) => [0, 1, 2].map(field => instance.spike_get_event(index, field))) });
for (const row of fixture.rejections) {
  const setup = fixture.cases.find(value => value.id === row.setupCase);
  assert.ok(setup, `${row.id}: missing setup fixture`);
  initializeProbe(api, setup.input);
  for (const call of row.before) {
    assert.ok(Object.hasOwn(allowedRejections, call.name), `Unregistered setup call ${call.name}`);
    statusOk(allowedRejections[call.name]!(...call.args), `${row.id}: setup`);
  }
  const before = observe(api);
  assert.ok(Object.hasOwn(allowedRejections, row.call.name), `Unregistered rejection call ${row.call.name}`);
  const status = allowedRejections[row.call.name]!(...row.call.args);
  assert.equal(status, row.expectedStatus, row.id);
  const after = observe(api);
  for (const key of row.unchanged) assert.deepEqual(after[key], before[key], `${row.id}: ${key} must not change`);
}

// Reject unsupported host inputs before touching the instance; no broad public action API exists.
const valid = fixture.cases[0]!.input;
const beforeHostReject = new Uint8Array(api.memory.buffer).slice();
assert.throws(() => initializeProbe(api, { ...valid, ability: 65 }));
assert.throws(() => initializeProbe(api, { ...valid, move: 52 }));
assert.throws(() => initializeProbe(api, { ...valid, seed: -1 }));
const mystery = structuredClone(valid); mystery.battlers[0].type1 = 9;
const extraStage = structuredClone(valid); extraStage.battlers[0].stages[3] = 7;
const oversizedStat = structuredClone(valid); oversizedStat.battlers[0].attack = 1000;
for (const unsupported of [mystery, extraStage, oversizedStat]) assert.throws(() => initializeProbe(api, unsupported));
assert.deepEqual(new Uint8Array(api.memory.buffer), beforeHostReject);
const faintingCase = fixture.cases.find(row => row.expected.targetHP === 0)!;
assert.ok(faintingCase, 'Missing source HP-to-zero fixture');
runProbe(api, faintingCase.input);
const beforeFainted = observe(api);
assert.equal(api.spike_damage(faintingCase.input.move, faintingCase.input.crit), 3, 'No damage may proceed after HP reaches zero');
assert.deepEqual(observe(api), beforeFainted, 'Rejected post-faint command must preserve HP, RNG and events');

// This checks only retained damage-kernel globals, not full-battle isolation.
const isolatedA = instantiateProbe(module), isolatedB = instantiateProbe(module);
const interleavedA = instantiateProbe(module), interleavedB = instantiateProbe(module);
const inputA = structuredClone(fixture.cases[0]!.input), inputB = structuredClone(fixture.cases[1]!.input);
inputA.battlers[1].hp = inputA.battlers[1].maxHP = 65535;
inputB.battlers[1].hp = inputB.battlers[1].maxHP = 65535;
initializeProbe(isolatedA, inputA); initializeProbe(interleavedA, inputA);
initializeProbe(isolatedB, inputB); initializeProbe(interleavedB, inputB);
const advance = (instance: ProbeExports, input: typeof inputA) => {
  statusOk(instance.spike_damage(input.move, input.crit), 'successive damage');
  return readProbeResult(instance);
};
const expectedA = Array.from({ length: 8 }, () => advance(isolatedA, inputA));
const expectedB = Array.from({ length: 8 }, () => advance(isolatedB, inputB));
for (let index = 0; index < 8; index++) {
  assert.deepEqual(advance(interleavedA, inputA), expectedA[index], `Interleaved A ${index}`);
  assert.deepEqual(advance(interleavedB, inputB), expectedB[index], `Interleaved B ${index}`);
}
assert.notEqual(interleavedA.memory.buffer, interleavedB.memory.buffer);
assert.throws(() => api.memory.grow(1), RangeError, 'Fixed memory must not silently grow');

// Preliminary local costs only; full battle memory/latency belongs to P03 batch 3.
const initializationSamples = [];
for (let index = 0; index < 25; index++) {
  const start = performance.now(); instantiateProbe(module); initializationSamples.push(performance.now() - start);
}
const executionSamples = [];
for (let index = 0; index < 500; index++) {
  initializeProbe(api, valid);
  const start = performance.now();
  statusOk(api.spike_damage(valid.move, valid.crit), 'timed source commands');
  executionSamples.push(performance.now() - start);
}
const quantile = (samples: number[], fraction: number) => [...samples].sort((a, b) => a - b)[Math.floor((samples.length - 1) * fraction)]!;
const report = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed', batch: 1,
  scope: 'Post-accuracy Tackle/Water Gun damage and HP-command kernel; not a complete attack, turn or production engine',
  sourceFingerprint: fixture.sourceFingerprint, wasmSha256: build.wasmSha256,
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  damageFixtures: observations, rngSequences: fixture.rngCases.length,
  rngDrawAssertions: fixture.rngCases.reduce((sum, row) => sum + row.draws.length, 0),
  rejectionFixtures: fixture.rejections.map(row => ({ id: row.id, status: 'passed' })),
  checks: ['independent-literal-source-fixtures', 'same-state-repeatability', 'source-controller-events', 'unsupported-input-rejection',
    'initialization-and-zero-HP-guards', 'two-instance-kernel-interleaving', 'no-WASM-host-imports', 'fixed-private-linear-memory', 'independent-identical-builds'],
  preliminaryMeasurements: { node: process.versions.node, platform: process.platform, architecture: process.arch,
    loadAndCompileMilliseconds, wasmBytes: build.wasmBytes, linearMemoryBytesPerInstance: api.memory.buffer.byteLength,
    sourceBattlePokemonStructBytes: api.spike_battle_mon_size(), instanceSamples: initializationSamples.length,
    instanceMedianMilliseconds: quantile(initializationSamples, 0.5), instanceP95Milliseconds: quantile(initializationSamples, 0.95),
    executionSamples: executionSamples.length, sourceCommandMedianMilliseconds: quantile(executionSamples, 0.5), sourceCommandP95Milliseconds: quantile(executionSamples, 0.95),
    scope: 'Local exploratory kernel costs; excludes full battle state, process overhead, persistence, networking and production workload' },
  remaining: build.extraction.unsupported,
};
await writeFile('reports/battle-spike-batch-1.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, damageFixtures: observations.length, rngSequences: report.rngSequences,
  rejectionFixtures: fixture.rejections.length, wasmBytes: report.preliminaryMeasurements.wasmBytes, checks: report.checks }));
