/** Recovery and failure atomicity in a bounded child with no parent WASM instances. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { jump } from '../encounter-core/verify-support';
import { Route1Driver, type Route1Checkpoint } from './driver';
import { assertItemState, assertItemStep, type ItemRecoveryJob } from './items-support';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  parentPid: number; jobs: ItemRecoveryJob[]; potion: Route1Checkpoint; ball: Route1Checkpoint;
};
assert.notEqual(process.pid, input.parentPid);
const module = new WebAssembly.Module(await readFile('.local/battle-route1/rebuild/route1.wasm'));
const resources = { profile: await loadDevelopmentProfile(), encounters: await loadEncounterCore() };
const results = [];
for (const job of input.jobs) {
  const driver = Route1Driver.restore(module, resources, job.checkpoint);
  assert.deepEqual(driver.snapshot(), job.checkpoint, `${job.id}: exact fresh-process recovery`);
  assertItemState(driver.snapshot(), job.expected, job.id);
  for (const [index, step] of job.remaining.entries()) {
    const events = driver.advanceChoices([{ actor: 0, choice: step.choice }]);
    assertItemStep(events, driver.snapshot(), step.expected, `${job.id} fresh turn ${index}`);
  }
  results.push({ id: job.id, transitions: job.remaining.length });
}
const exhaustion = [];
for (const itemId of [13, 4] as const) {
  const checkpoint = structuredClone(itemId === 13 ? input.potion : input.ball);
  const count = Number.MAX_SAFE_INTEGER - (itemId === 4 ? 1 : 0), words = checkpoint.core.words;
  checkpoint.rng.draws = count; words[5] = count >>> 0; words[6] = Math.floor(count / 0x100000000);
  checkpoint.rng.state = words[4] = jump(words[14]!, count, 24691);
  if (itemId === 4) {
    words[65] = words[131] = 1;
    // Healthy catch-rate255 at 1 HP has threshold65535. The last legal draw
    // succeeds, then the following shake must trap before publication.
    assert(jump(words[14]!, count + 1, 24691) >>> 16 < 65535);
  }
  const driver = Route1Driver.restore(module, resources, checkpoint), before = driver.snapshot();
  assert.throws(() => driver.advanceChoices([{ actor: 0, choice: { kind: 'item', itemId } }]), WebAssembly.RuntimeError);
  assert.deepEqual(driver.snapshot(), before, 'Failed candidate preserves inventory, HP, RNG, pending choice and capture');
  exhaustion.push(itemId === 13 ? 'heal-then-wild-rng-trap-rolls-back-potion-and-hp' : 'partial-shake-rng-trap-rolls-back-ball-and-capture');
}
process.stdout.write(JSON.stringify({ status: 'passed', pid: process.pid, results, exhaustion }));
