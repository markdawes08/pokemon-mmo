/** Separate OS process: restore already committed private fixture boundaries. */
import assert from 'node:assert/strict';
import { loadEncounterCore } from './encounter';
import { assertOracleCreature, assertOracleWords, stepInput, type RecoveryJob } from './verify-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  parentPid: number; wasmPath: string; jobs: RecoveryJob[];
};
assert.notEqual(process.pid, input.parentPid);
const core = await loadEncounterCore({ wasmPath: input.wasmPath });
const results = [];
for (const job of input.jobs) {
  const factory = core.restore(job.snapshot);
  assert.deepEqual(factory.snapshot(), job.snapshot, `${job.id}: fresh-process exact restore`);
  assertOracleWords(factory.snapshot().words, job.expected, job.trainerId, job.creature, job.id);
  let transitions = 0;
  for (const step of job.remaining) {
    if (factory.view().phase === 'pending-encounter') factory.continueAfterEncounter();
    const result = factory.step(stepInput(step));
    assert.equal(result.kind, step.creature ? 'encounter' : 'none', job.id);
    if (step.creature) {
      assert.equal(result.kind, 'encounter');
      if (result.kind === 'encounter') assertOracleCreature(result.creature, step.creature, job.id);
    }
    assertOracleWords(factory.snapshot().words, step.state, job.trainerId, step.creature, job.id);
    transitions++;
  }
  results.push({ id: job.id, transitions });
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, results }));
