/** Portable recovery gate; all mechanics and draw expectations predate checkpoint code. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadProbeModule } from './probe';
import { TurnProbe, stepSchema, turnInputSchema, type TurnSummary } from './turn-probe';
import { replayJob, verifyBoundary, type RecoveryJob, type RecoveryStep } from './recovery-worker';

const uint32 = z.number().int().min(0).max(0xFFFFFFFF);
const traceSchema = z.array(z.strictObject({ label: z.string(), before: uint32, value: z.number().int().min(0).max(65535), after: uint32 }));
const fixtureSchema = z.object({
  schemaVersion: z.literal(1), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ id: z.string(), initial: turnInputSchema,
    expectedInitial: z.object({ state: z.unknown(), rngDrawTrace: traceSchema }),
    steps: z.array(z.object({ input: stepSchema, expected: z.object({ state: z.unknown(), goldenEvents: z.array(z.unknown()), rngDrawTrace: traceSchema }) })),
  })),
});
const fixtureBytes = await readFile('tools/battle-spike/fixtures/batch-2.json');
const fixture = fixtureSchema.parse(JSON.parse(fixtureBytes.toString('utf8')));
// Preserve the established goldens, but renumber the defender's selected Tackle
// to slot 1. Slot 0 becomes unselected Quick Attack on both defender party rows.
// The selected move and every mechanic/RNG draw remain identical. If recovery
// loses slot 1, incoming Quick Attack wrongly takes residual-order priority.
const slotVariant = structuredClone(fixture.cases.find(row => row.id === 'attack-knockout-replacement-before-incoming-residual')!);
assert.ok(slotVariant, 'Required independent replacement reference exists');
slotVariant.id = 'recovery-nonzero-selected-slot-controls-incoming-residual-priority';
for (const mon of slotVariant.initial.parties[1]) mon.moves.unshift({ move: 98, pp: 30 });
for (const expected of [slotVariant.expectedInitial, ...slotVariant.steps.map(step => step.expected)]) {
  const state = expected.state as TurnSummary;
  for (const mon of state.parties[1]!) mon.pp.unshift(30);
}
const slotTurn = slotVariant.steps[0]!.input;
assert.equal(slotTurn.kind, 'turn');
assert.equal(slotTurn.choices[1]?.kind, 'move');
if (slotTurn.choices[1]?.kind === 'move') slotTurn.choices[1].slot = 1;
fixture.cases.push(slotVariant);
const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8')) as {
  status: string; wasmSha256: string; independentBuilds: number; extraction: { sourceFingerprint: string };
};
assert.equal(build.status, 'passed');
assert.equal(build.independentBuilds, 2);
assert.equal(fixture.sourceFingerprint, build.extraction.sourceFingerprint);
const module = await loadProbeModule();
const rebuildPath = '.local/battle-spike/rebuild/probe.wasm';
const rebuildBytes = await readFile(rebuildPath);
const rebuildHash = createHash('sha256').update(rebuildBytes).digest('hex');
assert.equal(rebuildHash, build.wasmSha256, 'Independent extraction/build must reproduce the module');
const rebuiltModule = new WebAssembly.Module(rebuildBytes);
assert.deepEqual(WebAssembly.Module.imports(rebuiltModule), []);

const jobs: RecoveryJob[] = [];
const observed: { id: string; phase: TurnSummary['phase']; resume: TurnSummary['resume']; outcome: TurnSummary['outcome'];
  draws: number; rngState: number; checkpointBytes: number }[] = [];
let checkedDraws = 0;
for (const row of fixture.cases) {
  let rngState = row.initial.seed;
  let draws = 0;
  let eventSequence = 0;
  const checkTrace = (trace: z.infer<typeof traceSchema>): number => {
    for (const draw of trace) {
      assert.equal(draw.before, rngState, `${row.id}: contiguous independent trace (${draw.label})`);
      const next = Number((BigInt(rngState) * 1103515245n + 24691n) & 0xFFFFFFFFn);
      assert.equal(draw.after, next, `${row.id}: source LCG arithmetic (${draw.label})`);
      assert.equal(draw.value, next >>> 16, `${row.id}: source upper-16 output (${draw.label})`);
      rngState = next;
      draws++;
      checkedDraws++;
    }
    return draws;
  };
  const initialDraws = checkTrace(row.expectedInitial.rngDrawTrace);
  const initialRng = rngState;
  const steps: RecoveryStep[] = row.steps.map(step => {
    eventSequence += step.expected.goldenEvents.length;
    return { input: step.input, expectedState: step.expected.state, expectedEvents: step.expected.goldenEvents,
      expectedDraws: checkTrace(step.expected.rngDrawTrace), expectedEventSequence: eventSequence };
  });
  const battle = new TurnProbe(module, row.initial);
  const capture = (boundary: number, expectedState: unknown, expectedDraws: number, expectedEventSequence: number): void => {
    const id = `${row.id}@${boundary}`;
    verifyBoundary(battle, { id, expectedState, expectedDraws, expectedEventSequence });
    const checkpoint = JSON.parse(JSON.stringify(battle.snapshot())) as RecoveryJob['checkpoint'];
    assert.equal(checkpoint.sourceFingerprint, fixture.sourceFingerprint);
    if (row.id === slotVariant.id && battle.inspect().resume === 'before-residual') {
      assert.deepEqual(checkpoint.core.words.slice(11, 13), [0, 1], 'Checkpoint retains exact selected move slots before incoming residual ordering');
    }
    const job = { id, checkpoint, expectedState, expectedDraws, expectedEventSequence, remaining: steps.slice(boundary) };
    jobs.push(job);
    observed.push({ id, phase: battle.inspect().phase, resume: battle.inspect().resume, outcome: battle.inspect().outcome,
      draws: expectedDraws, rngState: checkpoint.rng.state, checkpointBytes: Buffer.byteLength(JSON.stringify(checkpoint)) });
    replayJob(rebuiltModule, job);
  };
  assert.equal(battle.inspect().rngState, initialRng, `${row.id}: initial source trace state`);
  capture(0, row.expectedInitial.state, initialDraws, 0);
  for (const [index, step] of steps.entries()) {
    const result = battle.advance(step.input);
    assert.deepEqual(result.events, step.expectedEvents, `${row.id}: original literal events ${index}`);
    capture(index + 1, step.expectedState, step.expectedDraws, step.expectedEventSequence);
  }
  assert.equal(battle.inspect().rngState, rngState, `${row.id}: final independent trace state`);
}
assert.ok(jobs.length >= 34, 'All batch-two initial and transition boundaries must be retained');
assert.ok(observed.some(row => row.resume === 'before-residual'), 'Attack KO checkpoint resumes before residual');
assert.ok(observed.some(row => row.resume === 'after-residual'), 'Residual KO checkpoint resumes after residual');
assert.ok(observed.some(row => row.outcome === 'won') && observed.some(row => row.outcome === 'lost'), 'Both terminal outcomes survive restore');

// Restore every boundary into its own instance, then interleave the remaining
// source transcripts. Peers must not share memory, scratch state or RNG.
const interleaved = jobs.map((job, index) => TurnProbe.restore(index % 2 ? module : rebuiltModule, job.checkpoint));
let interleavedTransitions = 0;
for (let index = 0; index < Math.max(...jobs.map(job => job.remaining.length)); index++) {
  for (const [jobIndex, job] of jobs.entries()) {
    const step = job.remaining[index];
    if (!step) continue;
    const battle = interleaved[jobIndex]!;
    const before = interleaved.map(peer => peer.snapshot());
    assert.throws(() => battle.advance({ kind: 'turn', choices: [{ kind: 'move', slot: 99 }, { kind: 'move', slot: 0 }] }));
    assert.deepEqual(interleaved.map(peer => peer.snapshot()), before, `${job.id}: rejected action preserves all restored peers`);
    const result = battle.advance(step.input);
    assert.deepEqual(result.state, step.expectedState, `${job.id}: interleaved state ${index}`);
    assert.deepEqual(result.events, step.expectedEvents, `${job.id}: interleaved events ${index}`);
    verifyBoundary(battle, { id: job.id, expectedState: step.expectedState,
      expectedDraws: step.expectedDraws, expectedEventSequence: step.expectedEventSequence });
    interleavedTransitions++;
  }
}

const firstJob = jobs[0]!;
const original = TurnProbe.restore(module, firstJob.checkpoint);
const pristine = original.snapshot();
const leaked = original.snapshot();
leaked.host.parties[0][0]!.hp = 0;
leaked.host.parties[0][0]!.moves[0]!.pp = 0;
leaked.host.parties[0][0]!.stages[1] = 0;
leaked.host.active[0] = 99;
leaked.core.words[4] = 0;
leaked.rng.draws = 99;
assert.deepEqual(original.snapshot(), pristine, 'Returned checkpoint does not alias owned host, C or RNG state');
const incoming = structuredClone(pristine);
const restored = TurnProbe.restore(module, incoming);
incoming.host.parties[0][0]!.hp = 0;
incoming.host.parties[0][0]!.moves[0]!.pp = 0;
incoming.host.parties[0][0]!.stages[1] = 0;
incoming.core.words.fill(0);
incoming.rng.state = 0;
assert.deepEqual(restored.snapshot(), pristine, 'Restore owns detached copies of the supplied checkpoint');
const firstStep = firstJob.remaining[0]!;
assert.deepEqual(restored.advance(firstStep.input), { state: firstStep.expectedState, events: firstStep.expectedEvents });

type Checkpoint = RecoveryJob['checkpoint'];
const mutations: { id: string; mutate: (snapshot: Checkpoint) => unknown }[] = [
  { id: 'wrong-envelope-version', mutate: snapshot => ({ ...snapshot, schemaVersion: 2 }) },
  { id: 'wrong-profile', mutate: snapshot => ({ ...snapshot, profile: 'firered-production' }) },
  { id: 'wrong-source', mutate: snapshot => ({ ...snapshot, sourceFingerprint: '0'.repeat(64) }) },
  { id: 'extra-hidden-state', mutate: snapshot => ({ ...snapshot, hiddenState: { memory: [] } }) },
  { id: 'extra-host-field', mutate: snapshot => ({ ...snapshot, host: { ...snapshot.host, pendingEvents: [] } }) },
  { id: 'extra-core-field', mutate: snapshot => ({ ...snapshot, core: { ...snapshot.core, memory: 'AAAA' } }) },
  { id: 'wrong-core-version', mutate: snapshot => ({ ...snapshot, core: { ...snapshot.core, version: 2 } }) },
  { id: 'negative-word', mutate: snapshot => { snapshot.core.words[0] = -1; return snapshot; } },
  { id: 'fractional-word', mutate: snapshot => { snapshot.core.words[0] = 1.5; return snapshot; } },
  { id: 'word-overflow', mutate: snapshot => { snapshot.core.words[0] = 0x100000000; return snapshot; } },
  { id: 'truncated-core', mutate: snapshot => { snapshot.core.words.pop(); return snapshot; } },
  { id: 'trailing-core', mutate: snapshot => { snapshot.core.words.push(0); return snapshot; } },
  { id: 'bad-core-magic', mutate: snapshot => { snapshot.core.words[0] = 0; return snapshot; } },
  { id: 'bad-core-header-version', mutate: snapshot => { snapshot.core.words[1] = 2; return snapshot; } },
  { id: 'bad-core-header-count', mutate: snapshot => { snapshot.core.words[2]!--; return snapshot; } },
  { id: 'nonzero-reserved-header', mutate: snapshot => { snapshot.core.words[15] = 1; return snapshot; } },
  { id: 'core-host-boundary-mismatch', mutate: snapshot => { snapshot.core.boundary = 1; return snapshot; } },
  { id: 'invalid-active-slot', mutate: snapshot => { snapshot.host.active[0] = 99; return snapshot; } },
  { id: 'host-core-HP-mismatch', mutate: snapshot => { snapshot.host.parties[0][0]!.hp--; return snapshot; } },
  { id: 'host-core-PP-mismatch', mutate: snapshot => { snapshot.host.parties[0][0]!.moves[0]!.pp--; return snapshot; } },
  { id: 'host-core-stage-mismatch', mutate: snapshot => { snapshot.host.parties[0][0]!.stages[1] = 5; return snapshot; } },
  { id: 'host-core-status-mismatch', mutate: snapshot => { snapshot.host.parties[0][0]!.status1 = 8; return snapshot; } },
  { id: 'host-core-speed-mismatch', mutate: snapshot => { snapshot.host.parties[0][0]!.speed++; return snapshot; } },
  { id: 'phase-resume-mismatch', mutate: snapshot => { snapshot.host.resume = 'before-residual'; return snapshot; } },
  { id: 'phase-outcome-mismatch', mutate: snapshot => { snapshot.host.outcome = 'won'; return snapshot; } },
  { id: 'negative-sequence', mutate: snapshot => { snapshot.host.sequence = -1; return snapshot; } },
  { id: 'zero-turn', mutate: snapshot => { snapshot.host.turn = 0; return snapshot; } },
  { id: 'envelope-core-RNG-mismatch', mutate: snapshot => { snapshot.rng.state = (snapshot.rng.state ^ 1) >>> 0; return snapshot; } },
  { id: 'envelope-core-draw-mismatch', mutate: snapshot => { snapshot.rng.draws++; return snapshot; } },
  { id: 'unsafe-draw-count', mutate: snapshot => { snapshot.rng.draws = Number.MAX_SAFE_INTEGER + 1; return snapshot; } },
  { id: 'core-seed-RNG-proof-mismatch', mutate: snapshot => { snapshot.core.words[14] = (snapshot.core.words[14]! ^ 1) >>> 0; return snapshot; } },
  { id: 'joint-RNG-corruption', mutate: snapshot => { snapshot.rng.state = (snapshot.rng.state ^ 1) >>> 0; snapshot.core.words[4] = snapshot.rng.state; return snapshot; } },
  { id: 'joint-draw-corruption', mutate: snapshot => { snapshot.rng.draws++; snapshot.core.words[5] = snapshot.rng.draws; return snapshot; } },
];
for (const mutation of mutations) {
  const invalid = mutation.mutate(structuredClone(pristine));
  assert.throws(() => TurnProbe.restore(rebuiltModule, invalid), `${mutation.id}: reject malformed or inconsistent checkpoint`);
  assert.deepEqual(original.snapshot(), pristine, `${mutation.id}: existing battle unaffected`);
}
for (const invalid of [null, [], {}, JSON.stringify(pristine)]) assert.throws(() => TurnProbe.restore(module, invalid));

// Exhausted host counters are a valid restore boundary, but another transition
// must fail before publishing any candidate state or consuming owned RNG.
for (const field of ['sequence', 'eventSequence'] as const) {
  const exhausted = structuredClone(pristine);
  exhausted.host.sequence = field === 'sequence' ? Number.MAX_SAFE_INTEGER : 1;
  exhausted.host.eventSequence = Number.MAX_SAFE_INTEGER;
  const battle = TurnProbe.restore(module, exhausted);
  assert.throws(() => battle.advance(firstStep.input), /sequence exhausted/);
  assert.deepEqual(battle.snapshot(), exhausted, `${field} exhaustion leaves the original checkpoint untouched`);
}
// A forced replacement after residuals emits one event, then increments turn.
// Leave both sequence counters room for that event so only turn overflows.
const replacementJob = jobs.find(job => job.id === 'burn-residual-faint-and-forced-replacement@1')!;
assert.ok(replacementJob, 'The residual-faint replacement reference must exist');
const exhaustedTurn = structuredClone(replacementJob.checkpoint);
assert.equal(exhaustedTurn.core.boundary, 2);
assert.equal(exhaustedTurn.host.resume, 'after-residual');
exhaustedTurn.host.sequence = Number.MAX_SAFE_INTEGER - 1;
exhaustedTurn.host.eventSequence = Number.MAX_SAFE_INTEGER - 1;
exhaustedTurn.host.turn = Number.MAX_SAFE_INTEGER;
const replacement = replacementJob.remaining[0]!;
assert.equal(replacement.input.kind, 'replace');
assert.deepEqual(replacement.expectedEvents, [{ kind: 'switch', actor: 0, from: 0, to: 1, forced: true }]);
const turnLimitedBattle = TurnProbe.restore(module, exhaustedTurn);
assert.throws(() => turnLimitedBattle.advance(replacement.input), /sequence exhausted/, 'Turn overflow rejects before committing replacement or next-turn RNG');
assert.deepEqual(turnLimitedBattle.snapshot(), exhaustedTurn, 'Turn exhaustion preserves the complete original replacement checkpoint');

const workerPath = fileURLToPath(new URL('./recovery-worker.ts', import.meta.url));
const workerResult = await new Promise<{ status: string; pid: number; jobs: { id: string; transitions: number; draws: number }[] }>((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Fresh-process recovery exceeded 30 seconds')); }, 30_000);
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  child.on('error', error => { clearTimeout(timeout); reject(error); });
  child.on('close', code => {
    clearTimeout(timeout);
    if (code !== 0) { reject(new Error(`Recovery worker failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`)); return; }
    try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8'))); } catch (error) { reject(error); }
  });
  child.stdin.on('error', error => { child.kill(); clearTimeout(timeout); reject(error); });
  child.stdin.end(JSON.stringify({ wasmPath: rebuildPath, wasmSha256: rebuildHash, parentPid: process.pid, jobs }));
});
assert.equal(workerResult.status, 'passed');
assert.notEqual(workerResult.pid, process.pid);
assert.deepEqual(workerResult.jobs.map(row => row.id), jobs.map(row => row.id));

const report = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'P03 batch 3 private synthetic-profile recovery; no live battle persistence or cross-version migration',
  sourceFingerprint: fixture.sourceFingerprint, wasmSha256: rebuildHash,
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  expectations: 'Unmodified independently source-derived batch-two state/event goldens and literal RNG traces, checked against exact LCG arithmetic.',
  derivedCases: [{ id: slotVariant.id, basedOn: 'attack-knockout-replacement-before-incoming-residual',
    derivation: 'Move the defender selected Tackle to slot 1 and prepend unselected Quick Attack with 30 PP to both defender party rows. Only slot and PP-array positions change; original literal mechanics, events, RNG traces and residual order stay unchanged. Losing slot 1 would give incoming Quick Attack the wrong residual priority.' }],
  cases: fixture.cases.length, boundaries: jobs.length, checkedSourceDraws: checkedDraws,
  crossBuildReplayedTransitions: jobs.reduce((total, job) => total + job.remaining.length, 0),
  interleavedInstances: interleaved.length, interleavedTransitions,
  freshProcess: { pid: workerResult.pid, parentPid: process.pid, boundaries: workerResult.jobs.length,
    transitions: workerResult.jobs.reduce((total, job) => total + job.transitions, 0) },
  aliasChecks: ['snapshot output', 'restore input'], rejectedCheckpoints: mutations.map(row => row.id), rejectedNonObjects: 4,
  exhaustedCounterAtomicity: ['transition sequence', 'event sequence', 'turn at after-residual replacement'],
  boundaryObservations: observed,
};
await writeFile('reports/battle-spike-recovery.json', `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Battle recovery passed: ${jobs.length} boundaries, ${interleavedTransitions} interleaved transitions, ${mutations.length + 4} checkpoint rejections, fresh process ${workerResult.pid}.\n`);
