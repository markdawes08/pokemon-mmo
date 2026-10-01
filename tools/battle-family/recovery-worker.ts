/** Fresh OS process restores logical choices; no prior linear memory is reused. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFamilyResources } from './admission';
import { FamilyDriver, instantiateFamily } from './driver';
import { advanceRaw, assertState, assertStep, exportRaw, importRaw, type RecoveryJob } from './verify-support';
const chunks: Buffer[]=[];
for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {parentPid:number;jobs:RecoveryJob[]};
assert.notEqual(process.pid,input.parentPid);
const module=new WebAssembly.Module(await readFile('.local/battle-family/rebuild/family.wasm')),resources=await loadFamilyResources();
let transitions=0,rawTransitions=0;
for(const job of input.jobs) {
  const driver=FamilyDriver.restore(module,resources,job.checkpoint);
  assert.deepEqual(driver.snapshot(),job.checkpoint);assertState(driver.snapshot(),job.expected,job.id);
  const raw=instantiateFamily(module);assert.equal(importRaw(raw,job.checkpoint.core.words),0);
  assert.deepEqual(exportRaw(raw,job.checkpoint.core.boundary),job.checkpoint.core.words);
  let rawCheckpoint=structuredClone(job.checkpoint);
  for(const [i,step] of job.remaining.entries()) {
    const events=driver.advanceChoices([{actor:0,choice:step.choice}]);
    assertStep(events,driver.snapshot(),step.expected,`${job.id}:fresh${i}`);transitions++;
    const rawNext=advanceRaw(raw,rawCheckpoint,step.choice);rawCheckpoint=rawNext.checkpoint;
    assertStep(rawNext.events,rawCheckpoint,step.expected,`${job.id}:raw-fresh${i}`);
    assert.deepEqual(rawCheckpoint,driver.snapshot(),`${job.id}: every raw continuation word matches the settled driver`);rawTransitions++;
  }
}
process.stdout.write(JSON.stringify({status:'passed',pid:process.pid,hostBoundaries:input.jobs.length,rawBoundaries:input.jobs.length,transitions,rawTransitions}));
