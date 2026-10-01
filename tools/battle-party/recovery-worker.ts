/** A fresh OS process performs both host and raw source-only continuation. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPartyResources } from './admission';
import { PartyDriver,instantiateParty } from './driver';
import { advanceRaw,assertState,assertStep,exportRaw,importRaw,materialize,type RecoveryJob } from './verify-support';
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {parentPid:number;jobs:RecoveryJob[]};
assert.notEqual(process.pid,input.parentPid);
const module=new WebAssembly.Module(await readFile('.local/battle-party/rebuild/party.wasm')),resources=await loadPartyResources();
let transitions=0,rawTransitions=0;
for(const job of input.jobs) {
  const driver=PartyDriver.restore(module,resources,job.checkpoint);assert.deepEqual(driver.snapshot(),job.checkpoint);
  assertState(driver.snapshot(),job.expected,job.initial,job.id);
  const raw=instantiateParty(module);assert.equal(importRaw(raw,job.checkpoint.core.words),0);
  assert.deepEqual(exportRaw(raw,job.checkpoint.core.boundary),job.checkpoint.core.words);let prior=structuredClone(job.checkpoint);
  for(const [i,step]of job.remaining.entries()) {
    const events=driver.advanceChoices([{actor:0,choice:materialize(step.choice,driver.snapshot())}]);
    assertStep(events,driver.snapshot(),step.expected,job.initial,`${job.id}:fresh${i}`);transitions++;
    const rawNext=advanceRaw(raw,prior,step.choice);prior=rawNext.checkpoint;
    assertStep(rawNext.events,prior,step.expected,job.initial,`${job.id}:raw-fresh${i}`);
    assert.deepEqual(prior,driver.snapshot(),'Full raw continuation equals source host scheduling');rawTransitions++;
  }
}
process.stdout.write(JSON.stringify({status:'passed',pid:process.pid,hostBoundaries:input.jobs.length,rawBoundaries:input.jobs.length,transitions,rawTransitions}));
