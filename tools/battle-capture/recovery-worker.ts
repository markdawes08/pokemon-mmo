/** Fresh OS process: replay each private capture boundary and pending choice. */
import assert from 'node:assert/strict';
import { instantiateRawCapture, loadCaptureCore } from './capture';
import { advanceBoth, assertRaw, assertView, importRaw, rawWords, type RecoveryJob } from './verify-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parentPid: number; jobs: RecoveryJob[] };
assert.notEqual(input.parentPid, process.pid);
const core = await loadCaptureCore(); let transitions = 0;
for (const job of input.jobs) {
  const session = core.restore(job.checkpoint), raw = instantiateRawCapture(core.module);
  assert.equal(importRaw(raw, job.checkpoint.words), 0); assert.deepEqual(rawWords(raw), job.checkpoint.words);
  assert.deepEqual(session.snapshot(), job.checkpoint);
  for (const [offset, expected] of job.expected.entries()) {
    if (offset) { advanceBoth(session, raw, expected.sequence, job.decision); transitions++; }
    assertView(session.view(), job.input, expected, job.id); assertRaw(raw, job.input, expected, job.id);
  }
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, boundaries: input.jobs.length, transitions }));
