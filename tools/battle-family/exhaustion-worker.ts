/** Timeout-bounded by the parent: regressions must not hang the verifier. */
import assert from 'node:assert/strict';
import { jump } from '../encounter-core/verify-support';
import { loadFamilyResources,type FamilyInitial } from './admission';
import { FamilyDriver,instantiateFamily } from './driver';
import { loadFamilyModule } from './engine';
import { importRaw } from './verify-support';
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {parentPid:number;initial:FamilyInitial};
assert.notEqual(process.pid,input.parentPid);
const module=await loadFamilyModule(),resources=await loadFamilyResources(),driver=new FamilyDriver(module,resources,input.initial);
const baseline=driver.snapshot(),max=Number.MAX_SAFE_INTEGER,checks:string[]=[];
function at(count:number) {
  const checkpoint=structuredClone(baseline);checkpoint.rng.draws=count;checkpoint.core.words[5]=count>>>0;
  checkpoint.core.words[6]=Math.floor(count/0x100000000);
  checkpoint.rng.state=checkpoint.core.words[4]=jump(checkpoint.core.words[14]!,count,24691);return checkpoint;
}
for(const empty of [false,true]) {
  const checkpoint=at(max-1),raw=instantiateFamily(module);
  // Keep the contiguous admitted Tackle/Tail Whip set. Select a naturally
  // empty trailing slot for the inner loop, never forge a hole in the set.
  let seed=6;
  if(empty) {seed=0;while(((jump(seed,max,24691)>>>16)&3)<2)seed++;}
  checkpoint.core.words[14]=seed;checkpoint.core.words[4]=jump(seed,max-1,24691);
  assert.equal(checkpoint.core.words[90],0);assert.equal(checkpoint.core.words[87],39);assert(checkpoint.core.words[91]!>0);
  assert.equal(importRaw(raw,checkpoint.core.words),0);
  assert.throws(() => raw.family_choose_wild(),WebAssembly.RuntimeError);
  assert.equal((raw.spike3_get_rng_draws(0)>>>0)+(raw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
  checks.push(empty?'inner-empty-slot-retry-traps':'outer-depleted-slot-retry-traps');
}
// Opponent Tail Whip spends one accuracy draw, player Withdraw none. Selection
// spends one draw, then the retained source wild chooser reaches exhaustion.
const prepared=at(max-2),candidate=FamilyDriver.restore(module,resources,prepared),before=candidate.snapshot();
assert.throws(() => candidate.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(candidate.snapshot(),before,'Attacks, PP, stages and RNG remain unpublished after next-AI trap');
checks.push('next-turn-ai-exhaustion-discards-candidate');
const exhausted=FamilyDriver.restore(module,resources,at(max)),atMax=exhausted.snapshot();
assert.throws(() => exhausted.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(exhausted.snapshot(),atMax);checks.push('first-rng-exhaustion-discards-candidate');
process.stdout.write(JSON.stringify({status:'passed',pid:process.pid,checks}));
