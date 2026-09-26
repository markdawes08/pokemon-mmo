/** Real private factory contract/recovery gate, using only source-derived goldens. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BattleSnapshot, AcceptedChoice } from '@pokewaterblue/battle-core';
import { createProbeEngine, makeProbeRng, probeConfig } from './engine';
import { loadProbeModule } from './probe';
import { stepSchema, turnInputSchema, type TurnChoice, type TurnSummary } from './turn-probe';
import { advanceEngineStep, replayEngineJob, verifyEngineBoundary, type EngineRecoveryJob, type RecoveryStep } from './recovery-worker';

const fixtureBytes = await readFile('tools/battle-spike/fixtures/batch-2.json');
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as { sourceFingerprint: string; cases: {
  id: string; initial: unknown; expectedInitial: { state: TurnSummary; rngDrawTrace: unknown[] };
  steps: { input: unknown; expected: { state: TurnSummary; goldenEvents: unknown[]; rngDrawTrace: unknown[] } }[];
}[] };
const module = await loadProbeModule();
const engine = createProbeEngine(module);
const rebuildPath = '.local/battle-spike/rebuild/probe.wasm';
const rebuildBytes = await readFile(rebuildPath);
const rebuildHash = createHash('sha256').update(rebuildBytes).digest('hex');
const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8'));
assert.equal(rebuildHash, build.wasmSha256);
assert.equal(fixture.sourceFingerprint, engine.compatibility.contentFingerprint);
const rebuiltModule = new WebAssembly.Module(rebuildBytes);
const rebuiltEngine = createProbeEngine(rebuiltModule);
const jobs: EngineRecoveryJob[] = [];
let transitions = 0;
for (const [caseIndex, row] of fixture.cases.entries()) {
  const initial = turnInputSchema.parse(row.initial);
  const config = probeConfig(engine, `recovery:${row.id}`, caseIndex % 2 ? 'pvp-copy' : 'pve');
  const initialInput = { parties: initial.parties };
  const rng = makeProbeRng(config.battleId, initial.seed);
  const inputs = structuredClone({ config, initialInput, rng });
  let snapshot = engine.createBattle(config, initialInput, rng);
  assert.deepEqual({ config, initialInput, rng }, inputs, `${row.id}: creation inputs unchanged`);
  let draws = row.expectedInitial.rngDrawTrace.length;
  let eventSequence = 0;
  const steps: RecoveryStep[] = row.steps.map(step => {
    draws += step.expected.rngDrawTrace.length;
    eventSequence += step.expected.goldenEvents.length;
    return { input: stepSchema.parse(step.input), expectedState: step.expected.state, expectedEvents: step.expected.goldenEvents,
      expectedDraws: draws, expectedEventSequence: eventSequence };
  });
  const capture = (boundary: number, expectedState: TurnSummary, expectedDraws: number, expectedEventSequence: number) => {
    const job: EngineRecoveryJob = { id: `${row.id}@${boundary}`, initial, snapshot: JSON.parse(JSON.stringify(snapshot)),
      expectedState, expectedDraws, expectedEventSequence, remaining: steps.slice(boundary) };
    verifyEngineBoundary(module, engine, snapshot, job);
    assert.deepEqual(rebuiltEngine.restore(job.snapshot), snapshot, `${job.id}: cross-build envelope restore`);
    replayEngineJob(rebuiltModule, job);
    jobs.push(job);
  };
  capture(0, row.expectedInitial.state, row.expectedInitial.rngDrawTrace.length, 0);
  for (const [index, step] of steps.entries()) {
    snapshot = advanceEngineStep(engine, snapshot, step, `${row.id}/${index}`);
    capture(index + 1, step.expectedState as TurnSummary, step.expectedDraws, step.expectedEventSequence);
    transitions++;
  }
}

const first = jobs[0]!;
const state = engine.restore(first.snapshot);
const pristine = structuredClone(state);
const valid = state.config.participantIds.map(actor => {
  const result = engine.validateChoice(state, actor, { kind: 'move', slot: 0 });
  assert.ok(result.accepted);
  return result.value;
});
const badAccepted: { id: string; value: AcceptedChoice<TurnChoice>[] }[] = [
  { id: 'missing-actor', value: valid.slice(0, 1) },
  { id: 'duplicate-actor', value: [valid[0]!, valid[0]!] },
  { id: 'unknown-actor', value: [{ ...valid[0]!, actorId: 'intruder' }, valid[1]!] },
  { id: 'wrong-battle', value: [{ ...valid[0]!, battleId: 'other' }, valid[1]!] },
  { id: 'stale-sequence', value: [{ ...valid[0]!, transitionSequence: 1 }, valid[1]!] },
  { id: 'forged-unavailable-slot', value: [{ ...valid[0]!, choice: { kind: 'move', slot: 3 } }, valid[1]!] },
  { id: 'forged-current-active-switch', value: [{ ...valid[0]!, choice: { kind: 'switch', partyIndex: 0 } }, valid[1]!] },
];
for (const row of badAccepted) {
  assert.throws(() => engine.advance(state, row.value), row.id);
  assert.deepEqual(state, pristine, `${row.id}: rejected advance leaves input untouched`);
}
for (const choice of [{ kind: 'move', slot: 99 }, { kind: 'move', slot: 0, seed: 7 }, { kind: 'item', item: 13 }]) {
  const result = engine.validateChoice(state, 'player', choice as TurnChoice);
  assert.equal(result.accepted, false, 'Unsupported shape cannot become an accepted choice');
}
assert.equal(engine.validateChoice(state, 'intruder', { kind: 'move', slot: 0 }).accepted, false);
for (const job of jobs.filter(row => (row.expectedState as TurnSummary).phase !== 'choice')) {
  const phaseState = engine.restore(job.snapshot);
  const expected = job.expectedState as TurnSummary;
  const living = expected.parties.findIndex((party, actor) => party[expected.active[actor]]!.hp > 0);
  if (expected.phase === 'replacement' && living >= 0) {
    assert.equal(engine.validateChoice(phaseState, phaseState.config.participantIds[living]!, { kind: 'move', slot: 0 }).accepted, false);
  }
  if (expected.phase === 'ended') {
    for (const actorId of phaseState.config.participantIds) assert.equal(engine.validateChoice(phaseState, actorId, { kind: 'move', slot: 0 }).accepted, false);
    assert.throws(() => engine.advance(phaseState, []), 'Terminal envelope cannot advance');
  }
}

const checkpointMutation = (snapshot: BattleSnapshot, mutate: (value: Record<string, unknown>) => void): BattleSnapshot => {
  const checkpoint = JSON.parse(Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8'));
  mutate(checkpoint);
  snapshot.privateEngineState.data = Buffer.from(JSON.stringify(checkpoint)).toString('base64');
  return snapshot;
};
const mutations: { id: string; mutate: (snapshot: BattleSnapshot) => unknown }[] = [
  { id: 'extra-envelope-hidden-state', mutate: snapshot => ({ ...snapshot, core: {} }) },
  { id: 'wrong-engine', mutate: snapshot => { snapshot.config.compatibility.engineId = 'other'; return snapshot; } },
  { id: 'wrong-engine-version', mutate: snapshot => { snapshot.config.compatibility.engineVersion = 'future'; return snapshot; } },
  { id: 'wrong-rules-version', mutate: snapshot => { snapshot.config.compatibility.rulesVersion = 'future'; return snapshot; } },
  { id: 'wrong-content', mutate: snapshot => { snapshot.config.compatibility.contentFingerprint = '0'.repeat(64); return snapshot; } },
  { id: 'wrong-engine-state-version', mutate: snapshot => { snapshot.config.compatibility.engineStateVersion = 2; return snapshot; } },
  { id: 'wrong-snapshot-version', mutate: snapshot => ({ ...snapshot, config: { ...snapshot.config,
    compatibility: { ...snapshot.config.compatibility, snapshotVersion: 2 } } }) },
  { id: 'wrong-RNG-battle', mutate: snapshot => { snapshot.rng.battleId = 'other'; return snapshot; } },
  { id: 'wrong-RNG-version', mutate: snapshot => { snapshot.rng.version = 2; return snapshot; } },
  { id: 'counter-inner-outer-mismatch', mutate: snapshot => { snapshot.transitionSequence++; return snapshot; } },
  { id: 'event-inner-outer-mismatch', mutate: snapshot => { snapshot.eventSequence++; return snapshot; } },
  { id: 'draw-inner-outer-mismatch', mutate: snapshot => { snapshot.rng.draws++; return snapshot; } },
  { id: 'RNG-inner-outer-mismatch', mutate: snapshot => { snapshot.rng.privateState.data = Buffer.alloc(4).toString('base64'); return snapshot; } },
  { id: 'noncanonical-base64', mutate: snapshot => { snapshot.privateEngineState.data += '\n'; return snapshot; } },
  { id: 'truncated-payload', mutate: snapshot => { snapshot.privateEngineState.data = 'e30='; return snapshot; } },
  { id: 'malformed-JSON', mutate: snapshot => { snapshot.privateEngineState.data = Buffer.from('{').toString('base64'); return snapshot; } },
  { id: 'invalid-UTF8', mutate: snapshot => { snapshot.privateEngineState.data = Buffer.from([0xC0, 0xAF]).toString('base64'); return snapshot; } },
  { id: 'noncanonical-JSON-whitespace', mutate: snapshot => { snapshot.privateEngineState.data = Buffer.from(` ${Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8')}`).toString('base64'); return snapshot; } },
  { id: 'inner-hidden-state', mutate: snapshot => checkpointMutation(snapshot, checkpoint => { checkpoint.extraState = {}; }) },
  { id: 'inner-wrong-profile', mutate: snapshot => checkpointMutation(snapshot, checkpoint => { checkpoint.profile = 'production'; }) },
  { id: 'unsupported-domain-effect', mutate: snapshot => { snapshot.config.policy = { mode: 'pve', allowedDomainEffects: [{ kind: 'currency', version: 1 }] }; return snapshot; } },
  { id: 'extra-participant', mutate: snapshot => { snapshot.config.participantIds.push('third'); return snapshot; } },
];
for (const row of mutations) {
  const invalid = row.mutate(structuredClone(pristine));
  assert.throws(() => engine.restore(invalid as BattleSnapshot), `${row.id}: malformed adapter snapshot rejected`);
  assert.deepEqual(state, pristine, `${row.id}: detached trusted snapshot preserved`);
}
assert.throws(() => createProbeEngine(rebuiltModule, 'different-build').restore(pristine), 'Snapshots cannot cross engine builds');

const config = probeConfig(engine, 'creation-guards');
const initial = { parties: first.initial.parties };
const rng = makeProbeRng(config.battleId, first.initial.seed);
for (const bad of [{ ...rng, draws: 1 }, { ...rng, battleId: 'other' }, { ...rng, privateState: { encoding: 'base64' as const, data: 'AA==' } }]) {
  assert.throws(() => engine.createBattle(config, initial, bad), 'Initial RNG must be fresh, correctly identified and exactly four bytes');
}
assert.throws(() => engine.createBattle({ ...config, policy: { mode: 'pve', allowedDomainEffects: [{ kind: 'currency', version: 1 }] } }, initial, rng));
assert.throws(() => engine.createBattle(config, { ...initial, seed: 123 } as typeof initial, rng), 'Client-like initial seed field is forbidden');

const aliasedSnapshot = engine.snapshot(state);
aliasedSnapshot.config.participantIds[0] = 'changed';
aliasedSnapshot.rng.draws = 123;
aliasedSnapshot.privateEngineState.data = 'e30=';
const projection = engine.project(state, 'player');
projection.presentation.self.party[0]!.hp = 0;
projection.presentation.self.party[0]!.moves[0]!.pp = 0;
projection.presentation.opponent.hpPercent = 0;
assert.deepEqual(engine.snapshot(state), pristine, 'Returned snapshots and projections cannot mutate owned input');
const restoreInput = structuredClone(pristine);
const restored = engine.restore(restoreInput);
restoreInput.config.participantIds[0] = 'changed';
restoreInput.privateEngineState.data = 'e30=';
assert.deepEqual(restored, pristine, 'Adapter restore does not alias its input');

const workerPath = fileURLToPath(new URL('./recovery-worker.ts', import.meta.url));
const worker = await new Promise<{ status: string; pid: number; engineJobs: { id: string; transitions: number }[] }>((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const output: Buffer[] = [], errors: Buffer[] = [];
  const timer = setTimeout(() => { child.kill(); reject(new Error('Adapter recovery worker exceeded 30 seconds')); }, 30_000);
  child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => {
    clearTimeout(timer);
    if (code !== 0) { reject(new Error(`Adapter recovery child failed (${code}): ${Buffer.concat(errors).toString('utf8')}`)); return; }
    try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); } catch (error) { reject(error); }
  });
  child.stdin.on('error', error => { child.kill(); clearTimeout(timer); reject(error); });
  child.stdin.end(JSON.stringify({ wasmPath: rebuildPath, wasmSha256: rebuildHash, parentPid: process.pid, jobs: [], engineJobs: jobs }));
});
assert.equal(worker.status, 'passed');
assert.notEqual(worker.pid, process.pid);
assert.deepEqual(worker.engineJobs.map(job => job.id), jobs.map(job => job.id));

await writeFile('reports/battle-spike-engine.json', `${JSON.stringify({
  schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Real six-method private WASM adapter against source goldens; no live room or database integration',
  sourceFingerprint: fixture.sourceFingerprint, wasmSha256: rebuildHash, fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  cases: fixture.cases.length, transitions, goldenBoundaries: jobs.length,
  crossBuildReplayedTransitions: jobs.reduce((total, job) => total + job.remaining.length, 0),
  freshProcess: { pid: worker.pid, parentPid: process.pid, boundaries: worker.engineJobs.length,
    transitions: worker.engineJobs.reduce((total, job) => total + job.transitions, 0) },
  rejectedAcceptedChoices: badAccepted.map(row => row.id), rejectedSnapshots: mutations.map(row => row.id),
  projection: 'Exact whitelist checked for both participants at every golden boundary, including perspective-correct outcome, legal replacement choice, opponent HP percentage and no opponent reserve/moves/stats or RNG/continuation/core state.',
  immutableInputs: ['create config/party/RNG', 'submitted choice', 'accepted choices', 'advance snapshot', 'snapshot output', 'restore input', 'projection output'],
  policies: ['pve with zero effects', 'pvp-copy with zero effects'], domainEffects: 0,
}, null, 2)}\n`);
process.stdout.write(`Battle engine passed: ${jobs.length} golden boundaries, ${transitions} transitions, ${badAccepted.length} forged-choice and ${mutations.length} snapshot rejections; fresh process ${worker.pid}.\n`);
