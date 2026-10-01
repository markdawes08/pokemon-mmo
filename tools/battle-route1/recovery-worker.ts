/** Separate process rehydrates logical state without replaying prior turns. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { Route1Driver } from './driver';
import { assertState, assertStep, type RecoveryJob } from './verify-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parentPid: number; jobs: RecoveryJob[] };
assert.notEqual(process.pid, input.parentPid);
const module = new WebAssembly.Module(await readFile('.local/battle-route1/rebuild/route1.wasm'));
const resources = { profile: await loadDevelopmentProfile(), encounters: await loadEncounterCore() };
const results = [];
for (const job of input.jobs) {
  const driver = Route1Driver.restore(module, resources, job.checkpoint);
  assert.deepEqual(driver.snapshot(), job.checkpoint, `${job.id}: exact fresh-process recovery`);
  assertState(driver.snapshot(), job.expected, job.id);
  for (const [index, step] of job.remaining.entries()) {
    const events = driver.advanceChoices([{ actor: 0, choice: step.choice }]);
    assertStep(events, driver.snapshot(), step.expected, `${job.id} fresh turn ${index}`);
  }
  results.push({ id: job.id, transitions: job.remaining.length });
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, results }));
