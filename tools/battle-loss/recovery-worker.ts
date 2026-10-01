/** Separate OS process: each host/source stage resumes without repeating loss. */
import assert from 'node:assert/strict';
import { instantiateRawLoss, loadLossCore } from './loss';
import { assertRaw, assertView, importRaw, rawWords, type RecoveryJob } from './verify-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parentPid: number; jobs: RecoveryJob[] };
assert.notEqual(input.parentPid, process.pid);
const core = await loadLossCore(); let transitions = 0;
for (const job of input.jobs) {
  const session = core.restore(job.checkpoint), raw = instantiateRawLoss(core.module);
  assert.equal(importRaw(raw, job.checkpoint.words), 0); assert.deepEqual(rawWords(raw), job.checkpoint.words);
  assert.deepEqual(session.snapshot(), job.checkpoint);
  for (const [offset, expected] of job.expected.entries()) {
    if (offset) { session.advance({ expectedSequence: expected.sequence-1 }); assert.equal(raw.loss_advance(), 0); transitions++; }
    assertView(session.view(), job.input, expected, job.id); assertRaw(raw, job.input, expected, job.id);
  }
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, boundaries: input.jobs.length, transitions }));
