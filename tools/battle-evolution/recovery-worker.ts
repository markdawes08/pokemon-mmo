/** Fresh process recovery of every settled host and intermediate source boundary. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instantiateRawEvolution, loadEvolutionCore } from './evolution';
import { assertRaw, assertView, hostDecision, importRaw, operateRaw, rawWords, type Fixtures, type HostJob, type RawJob } from './verify-support';
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parentPid: number; host: HostJob[]; raw: RawJob[] };
assert.notEqual(input.parentPid, process.pid);
const fixtures = JSON.parse(await readFile('tools/battle-evolution/fixtures/source-cases.json', 'utf8')) as Fixtures;
const core = await loadEvolutionCore(); let hostTransitions = 0, rawTransitions = 0;
for (const job of input.host) {
  const fixture = fixtures.cases[job.caseIndex]!, session = core.restore(job.checkpoint);
  assert.deepEqual(session.snapshot(), job.checkpoint);
  for (const [offset, expected] of fixture.settled.slice(job.settledIndex).entries()) {
    if (offset) { hostDecision(session, fixture, expected.sequence); hostTransitions++; }
    assertView(session.view(), fixture.input, expected, fixture.id);
  }
}
for (const job of input.raw) {
  const fixture = fixtures.cases[job.caseIndex]!, raw = instantiateRawEvolution(core.module);
  assert.equal(importRaw(raw, job.words), 0); assert.deepEqual(rawWords(raw), job.words);
  for (const [offset, expected] of fixture.raw.slice(job.rawIndex).entries()) {
    if (offset) { assert(expected.operation); operateRaw(raw, expected.operation); rawTransitions++; }
    assertRaw(raw, fixture.input, expected.expected, fixture.id);
  }
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, hostBoundaries: input.host.length,
  rawBoundaries: input.raw.length, hostTransitions, rawTransitions }));
