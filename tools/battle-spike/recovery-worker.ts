/** Fresh-process recovery checks. Expectations are the independent batch-two goldens. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { createProbeEngine } from './engine';
import { TurnProbe, type Step, type TurnInput, type TurnSummary } from './turn-probe';

export interface RecoveryStep {
  input: Step;
  expectedState: unknown;
  expectedEvents: unknown;
  expectedDraws: number;
  expectedEventSequence: number;
}
export interface RecoveryJob {
  id: string;
  checkpoint: ReturnType<TurnProbe['snapshot']>;
  expectedState: unknown;
  expectedDraws: number;
  expectedEventSequence: number;
  remaining: RecoveryStep[];
}

export function verifyBoundary(battle: TurnProbe, job: Pick<RecoveryJob, 'id' | 'expectedState' | 'expectedDraws' | 'expectedEventSequence'>): void {
  assert.deepEqual(battle.inspect(), job.expectedState, `${job.id}: literal boundary state`);
  const checkpoint = battle.snapshot();
  assert.equal(checkpoint.rng.draws, job.expectedDraws, `${job.id}: independent RNG draw count`);
  assert.equal(checkpoint.rng.state, battle.inspect().rngState, `${job.id}: checkpoint RNG state`);
  assert.equal(checkpoint.host.eventSequence, job.expectedEventSequence, `${job.id}: literal event transcript sequence`);
}

export function replayJob(module: WebAssembly.Module, job: RecoveryJob): { id: string; transitions: number; draws: number } {
  const battle = TurnProbe.restore(module, job.checkpoint);
  verifyBoundary(battle, job);
  // Portable export is canonical at every supported boundary, not a memory dump.
  assert.deepEqual(battle.snapshot(), job.checkpoint, `${job.id}: canonical restore/export`);
  for (const [index, step] of job.remaining.entries()) {
    const result = battle.advance(step.input);
    assert.deepEqual(result.state, step.expectedState, `${job.id}: replay state ${index}`);
    assert.deepEqual(result.events, step.expectedEvents, `${job.id}: replay events ${index}`);
    verifyBoundary(battle, { id: `${job.id}/${index}`, expectedState: step.expectedState,
      expectedDraws: step.expectedDraws, expectedEventSequence: step.expectedEventSequence });
  }
  if (battle.inspect().phase === 'ended') {
    const before = battle.snapshot();
    assert.throws(() => battle.advance({ kind: 'turn', choices: [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }] }));
    assert.deepEqual(battle.snapshot(), before, `${job.id}: rejected terminal action preserves checkpoint`);
  }
  return { id: job.id, transitions: job.remaining.length, draws: battle.snapshot().rng.draws };
}

export interface EngineRecoveryJob extends Omit<RecoveryJob, 'checkpoint'> {
  snapshot: BattleSnapshot;
  initial: TurnInput;
}
type Engine = ReturnType<typeof createProbeEngine>;

export function verifyEngineBoundary(module: WebAssembly.Module, engine: Engine, snapshot: BattleSnapshot,
  job: Pick<EngineRecoveryJob, 'id' | 'initial' | 'expectedState' | 'expectedDraws' | 'expectedEventSequence'>): void {
  const checkpoint = JSON.parse(Buffer.from(snapshot.privateEngineState.data, 'base64').toString('utf8'));
  verifyBoundary(TurnProbe.restore(module, checkpoint), job);
  const expected = job.expectedState as TurnSummary;
  assert.equal(snapshot.transitionSequence, expected.sequence, `${job.id}: outer transition sequence`);
  assert.equal(snapshot.eventSequence, job.expectedEventSequence, `${job.id}: outer event sequence`);
  assert.equal(snapshot.rng.draws, job.expectedDraws, `${job.id}: outer RNG draws`);
  const bytes = Buffer.from(snapshot.rng.privateState.data, 'base64');
  assert.equal(bytes.length, 4);
  assert.equal(bytes.readUInt32LE(), expected.rngState, `${job.id}: outer source RNG state`);
  assert.deepEqual(engine.snapshot(snapshot), snapshot, `${job.id}: canonical adapter snapshot`);
  for (const actor of [0, 1] as const) {
    const other = actor === 0 ? 1 : 0;
    const viewerId = snapshot.config.participantIds[actor]!;
    const active = expected.parties[actor]![expected.active[actor]]!;
    const opponent = expected.parties[other]![expected.active[other]]!;
    const opponentInitial = job.initial.parties[other][expected.active[other]]!;
    const needsChoice = expected.phase === 'choice' || (expected.phase === 'replacement' && active.hp === 0);
    const availableChoices = [];
    if (needsChoice) {
      if (expected.phase === 'choice') for (const [slot, pp] of active.pp.entries()) {
        if (pp > 0) availableChoices.push({ kind: 'move', slot });
      }
      for (const [partyIndex, mon] of expected.parties[actor]!.entries()) {
        if (partyIndex !== expected.active[actor] && mon.hp > 0) availableChoices.push({ kind: 'switch', partyIndex });
      }
    }
    const outcome = actor === 0 || expected.outcome === null || expected.outcome === 'draw'
      ? expected.outcome : expected.outcome === 'won' ? 'lost' : 'won';
    const presentation = { turn: expected.turn, phase: expected.phase, needsChoice, outcome,
      self: { active: expected.active[actor], party: expected.parties[actor]!.map((mon, index) => ({
        level: job.initial.parties[actor][index]!.level, hp: mon.hp, maxHP: job.initial.parties[actor][index]!.maxHP,
        status: mon.status1, moves: mon.pp.map((pp, slot) => ({ slot, move: job.initial.parties[actor][index]!.moves[slot]!.move, pp })),
      })) },
      opponent: { level: opponentInitial.level, hpPercent: Math.ceil(opponent.hp * 100 / opponentInitial.maxHP), status: opponent.status1 },
      availableChoices };
    assert.deepEqual(engine.project(snapshot, viewerId), { battleId: snapshot.config.battleId,
      transitionSequence: expected.sequence, eventSequence: job.expectedEventSequence, viewerId, presentation }, `${job.id}: exact viewer whitelist ${actor}`);
  }
  assert.throws(() => engine.project(snapshot, 'spectator'), `${job.id}: unregistered viewer rejected`);
}

export function advanceEngineStep(engine: Engine, snapshot: BattleSnapshot, step: RecoveryStep, id: string): BattleSnapshot {
  const accepted = step.input.choices.flatMap((choice, actor) => {
    if (choice === null) return [];
    const before = structuredClone(choice);
    const result = engine.validateChoice(snapshot, snapshot.config.participantIds[actor]!, choice);
    assert.deepEqual(choice, before, `${id}: validation does not mutate the submitted choice`);
    assert.ok(result.accepted, `${id}: required choice accepted`);
    return [result.value];
  });
  // The contract identifies actors explicitly; input array order is immaterial.
  const before = structuredClone(snapshot);
  accepted.reverse();
  const choicesBefore = structuredClone(accepted);
  const result = engine.advance(snapshot, accepted);
  assert.deepEqual(snapshot, before, `${id}: advance does not mutate input snapshot`);
  assert.deepEqual(accepted, choicesBefore, `${id}: advance does not mutate accepted choices`);
  assert.deepEqual(result.domainEffects, [], `${id}: private experiment creates no persistent effects`);
  assert.ok(Array.isArray(step.expectedEvents));
  assert.deepEqual(result.orderedEvents, step.expectedEvents.map((payload, index) => ({ battleId: snapshot.config.battleId,
    transitionSequence: (step.expectedState as TurnSummary).sequence, sequence: snapshot.eventSequence + index + 1, payload })), `${id}: literal ordered event envelopes`);
  return result.nextState;
}

export function replayEngineJob(module: WebAssembly.Module, job: EngineRecoveryJob): { id: string; transitions: number } {
  const engine = createProbeEngine(module);
  let snapshot = engine.restore(job.snapshot);
  verifyEngineBoundary(module, engine, snapshot, job);
  for (const [index, step] of job.remaining.entries()) {
    snapshot = advanceEngineStep(engine, snapshot, step, `${job.id}/${index}`);
    verifyEngineBoundary(module, engine, snapshot, { ...job, expectedState: step.expectedState,
      expectedDraws: step.expectedDraws, expectedEventSequence: step.expectedEventSequence });
  }
  return { id: job.id, transitions: job.remaining.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    wasmPath: string; wasmSha256: string; parentPid: number; jobs: RecoveryJob[]; engineJobs?: EngineRecoveryJob[];
  };
  assert.notEqual(process.pid, request.parentPid, 'Recovery executes in a fresh OS process');
  const bytes = await readFile(request.wasmPath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), request.wasmSha256, 'Worker uses the independently rebuilt artifact');
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'Worker module has no imported memory or host state');
  const jobs = request.jobs.map(job => replayJob(module, job));
  const engineJobs = request.engineJobs?.map(job => replayEngineJob(module, job)) ?? [];
  process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, jobs, engineJobs }));
}
