/** Parent enforces a wall timeout, including regressions in source retry loops. */
import assert from 'node:assert/strict';
import { jump } from '../encounter-core/verify-support';
import { loadChargeResources,type ChargeInitial } from './admission';
import { ChargeDriver,instantiateCharge,type ChargeCheckpoint } from './driver';
import { loadChargeModule } from './engine';
import { exportRaw,importRaw,materialize } from './verify-support';
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {parentPid:number;initial:ChargeInitial;pending:ChargeCheckpoint;replacement:ChargeCheckpoint;
  force:ChargeInitial;rain:ChargeInitial;charge:ChargeCheckpoint;chargeInitial:ChargeInitial;wildCharge:ChargeCheckpoint};
assert.notEqual(process.pid,input.parentPid);
const module=await loadChargeModule(),resources=await loadChargeResources(),baseline=new ChargeDriver(module,resources,input.initial).snapshot();
const max=Number.MAX_SAFE_INTEGER,checks:string[]=[];
function at(source:ChargeCheckpoint,count:number):ChargeCheckpoint {
  const c=structuredClone(source);c.rng.draws=count;c.core.words[5]=count>>>0;c.core.words[6]=Math.floor(count/0x100000000);
  c.rng.state=c.core.words[4]=jump(c.core.words[14]!,count,24691);return c;
}
for(const empty of [false,true]) {
  const c=at(baseline,max-1),raw=instantiateCharge(module);let seed=6;
  if(empty){seed=0;while(((jump(seed,max,24691)>>>16)&3)<2)seed++;}
  c.core.words[14]=seed;c.core.words[4]=jump(seed,max-1,24691);
  assert.equal(c.core.words[90],0);assert.equal(c.core.words[87],39);assert(c.core.words[91]!>0);
  assert.equal(importRaw(raw,c.core.words),0);assert.throws(() => raw.family_choose_wild(),WebAssembly.RuntimeError);
  assert.equal((raw.spike3_get_rng_draws(0)>>>0)+(raw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
  checks.push(empty?'raw-empty-slot-loop-traps':'raw-depleted-slot-loop-traps');
}
for(const count of [max,max-2]) {
  const driver=ChargeDriver.restore(module,resources,at(baseline,count)),before=driver.snapshot();
  assert.throws(() => driver.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
  assert.deepEqual(driver.snapshot(),before);checks.push(count===max?'first-draw-candidate-rollback':'next-ai-candidate-rollback');
}
const pending=ChargeDriver.restore(module,resources,at(input.pending,max)),p=pending.snapshot();
assert.throws(() => pending.advanceChoices([{actor:0,choice:materialize({kind:'attempt-run'},p)}]),WebAssembly.RuntimeError);
assert.deepEqual(pending.snapshot(),p);checks.push('faint-escape-candidate-rollback');
const replacement=ChargeDriver.restore(module,resources,at(input.replacement,max)),r=replacement.snapshot();
assert.throws(() => replacement.advanceChoices([{actor:0,choice:materialize({kind:'replace',partyIndex:1},r)}]),WebAssembly.RuntimeError);
assert.deepEqual(replacement.snapshot(),r);checks.push('replacement-next-turn-candidate-rollback');
const forceCheckpoint=at(new ChargeDriver(module,resources,input.force).snapshot(),max-1);
const forceRaw=instantiateCharge(module);assert.equal(importRaw(forceRaw,forceCheckpoint.core.words),0);
assert.equal(forceRaw.party_order(0,forceCheckpoint.host.wildSlot,0),1);
assert.equal(forceRaw.spike2_attack(1,forceCheckpoint.host.wildSlot),0);
assert.throws(() => forceRaw.spike2_attack(0,0),WebAssembly.RuntimeError);
assert.equal((forceRaw.spike3_get_rng_draws(0)>>>0)+(forceRaw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
checks.push('raw-lower-level-force-gate-traps-after-last-accuracy-draw');
const force=ChargeDriver.restore(module,resources,forceCheckpoint),forceBefore=force.snapshot();
assert.throws(() => force.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(force.snapshot(),forceBefore);checks.push('force-gate-after-PP-candidate-rollback');
const rain=ChargeDriver.restore(module,resources,at(new ChargeDriver(module,resources,input.rain).snapshot(),max)),rainBefore=rain.snapshot();
assert.throws(() => rain.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(rain.snapshot(),rainBefore);assert.equal(rainBefore.core.words[483],0);
checks.push('rain-cast-and-field-tick-next-ai-candidate-rollback');
const chargeFirst=ChargeDriver.restore(module,resources,at(new ChargeDriver(module,resources,input.chargeInitial).snapshot(),max)),firstBefore=chargeFirst.snapshot();
assert.throws(() => chargeFirst.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(chargeFirst.snapshot(),firstBefore);checks.push('first-charge-PP-defense-lock-next-ai-candidate-rollback');
const release=ChargeDriver.restore(module,resources,at(input.charge,max-1)),releaseBefore=release.snapshot();
assert.throws(() => release.advanceChoices([{actor:0,choice:materialize({kind:'continue-charge'},releaseBefore)}]),WebAssembly.RuntimeError);
assert.deepEqual(release.snapshot(),releaseBefore);assert.equal(releaseBefore.core.words[42],0);
checks.push('release-cleared-lock-before-critical-candidate-rollback');
const releaseRaw=instantiateCharge(module);assert.equal(importRaw(releaseRaw,releaseBefore.core.words),0);
assert.equal(releaseRaw.party_order(releaseRaw.charge_get(0,1),releaseBefore.host.wildSlot,0),1);
assert.equal(releaseRaw.spike2_attack(1,releaseBefore.host.wildSlot),0);
assert.throws(() => releaseRaw.spike2_attack(0,releaseRaw.charge_get(0,1)),WebAssembly.RuntimeError);
checks.push('raw-PP0-release-traps-at-next-draw-without-retry-loop');
const wildMax=at(input.wildCharge,max),wildRaw=instantiateCharge(module);assert.equal(importRaw(wildRaw,wildMax.core.words),0);
const wildRawBefore=exportRaw(wildRaw);
assert.equal(wildRaw.family_choose_wild(),wildMax.host.wildSlot);assert.deepEqual(exportRaw(wildRaw),wildRawBefore);
checks.push('raw-locked-wild-chooser-needs-no-draw-even-at-limit');
const wild=ChargeDriver.restore(module,resources,wildMax),wildBefore=wild.snapshot();
assert.throws(() => wild.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(wild.snapshot(),wildBefore);checks.push('wild-release-candidate-rollback');
process.stdout.write(JSON.stringify({status:'passed',pid:process.pid,checks}));
