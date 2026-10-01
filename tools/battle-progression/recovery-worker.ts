/** Fresh OS process validates both host replay and pointer-free raw C recovery. */
import assert from 'node:assert/strict';
import { loadProgressionCore, instantiateRawProgression } from './progression';
import { assertView, decide, importRaw, rawWords, rawEvent, type RecoveryJob, type RawJob } from './verify-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parentPid: number; jobs: RecoveryJob[]; raw: RawJob[] };
assert.notEqual(input.parentPid, process.pid);
const core = await loadProgressionCore(), results = [];
for (const job of input.jobs) {
  const session = core.restore(job.checkpoint);
  assert.deepEqual(session.snapshot(), job.checkpoint, `${job.id}: exact separate-process checkpoint`);
  assertView(session.view(), job.expected[0]!, job.initialExperience, job.id);
  for (const [index, choice] of job.remaining.entries()) {
    assertView(decide(session, choice), job.expected[index + 1]!, job.initialExperience, `${job.id} decision ${index}`);
  }
  results.push({ id: job.id, decisions: job.remaining.length });
}
for (const job of input.raw) {
  const raw = instantiateRawProgression(core.module); assert.equal(importRaw(raw, job.words), 0);
  assert.deepEqual(rawWords(raw), job.words, `${job.id}: raw fresh import`);
  assert.equal(job.action === 'next' ? raw.progression_next() : raw.progression_decide(job.action), 0);
  assert.deepEqual(rawWords(raw), job.after); assert.deepEqual(rawEvent(raw), job.event);
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, results, rawContinuations: input.raw.length }));
