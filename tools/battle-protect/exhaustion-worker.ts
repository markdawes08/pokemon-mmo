/** Parent enforces a wall timeout, including regressions in source retry loops. */
import assert from 'node:assert/strict';
import { jump } from '../encounter-core/verify-support';
import { loadProtectResources,type ProtectInitial } from './admission';
import { ProtectDriver,instantiateProtect,type ProtectCheckpoint } from './driver';
import { loadProtectModule } from './engine';
import { exportRaw,importRaw,materialize } from './verify-support';
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {parentPid:number;initial:ProtectInitial;pending:ProtectCheckpoint;replacement:ProtectCheckpoint;
  force:ProtectInitial;rain:ProtectInitial;charge:ProtectCheckpoint;skullInitial:ProtectInitial;wildProtect:ProtectCheckpoint;
  protectInitial:ProtectInitial;protectLast:ProtectInitial;blocked:ProtectInitial};
assert.notEqual(process.pid,input.parentPid);
const module=await loadProtectModule(),resources=await loadProtectResources(),baseline=new ProtectDriver(module,resources,input.initial).snapshot();
const max=Number.MAX_SAFE_INTEGER,checks:string[]=[];
function at(source:ProtectCheckpoint,count:number):ProtectCheckpoint {
  const c=structuredClone(source);c.rng.draws=count;c.core.words[5]=count>>>0;c.core.words[6]=Math.floor(count/0x100000000);
  c.rng.state=c.core.words[4]=jump(c.core.words[14]!,count,24691);return c;
}
for(const empty of [false,true]) {
  const c=at(baseline,max-1),raw=instantiateProtect(module);let seed=6;
  if(empty){seed=0;while(((jump(seed,max,24691)>>>16)&3)<2)seed++;}
  c.core.words[14]=seed;c.core.words[4]=jump(seed,max-1,24691);
  assert.equal(c.core.words[90],0);assert.equal(c.core.words[87],39);assert(c.core.words[91]!>0);
  assert.equal(importRaw(raw,c.core.words),0);assert.throws(() => raw.family_choose_wild(),WebAssembly.RuntimeError);
  assert.equal((raw.spike3_get_rng_draws(0)>>>0)+(raw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
  checks.push(empty?'raw-empty-slot-loop-traps':'raw-depleted-slot-loop-traps');
}
for(const count of [max,max-2]) {
  const driver=ProtectDriver.restore(module,resources,at(baseline,count)),before=driver.snapshot();
  assert.throws(() => driver.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
  assert.deepEqual(driver.snapshot(),before);checks.push(count===max?'first-draw-candidate-rollback':'next-ai-candidate-rollback');
}
const pending=ProtectDriver.restore(module,resources,at(input.pending,max)),p=pending.snapshot();
assert.throws(() => pending.advanceChoices([{actor:0,choice:materialize({kind:'attempt-run'},p)}]),WebAssembly.RuntimeError);
assert.deepEqual(pending.snapshot(),p);checks.push('faint-escape-candidate-rollback');
const replacement=ProtectDriver.restore(module,resources,at(input.replacement,max)),r=replacement.snapshot();
assert.throws(() => replacement.advanceChoices([{actor:0,choice:materialize({kind:'replace',partyIndex:1},r)}]),WebAssembly.RuntimeError);
assert.deepEqual(replacement.snapshot(),r);checks.push('replacement-next-turn-candidate-rollback');
const forceCheckpoint=at(new ProtectDriver(module,resources,input.force).snapshot(),max-1);
const forceRaw=instantiateProtect(module);assert.equal(importRaw(forceRaw,forceCheckpoint.core.words),0);
assert.equal(forceRaw.party_order(0,forceCheckpoint.host.wildSlot,0),1);
assert.equal(forceRaw.spike2_attack(1,forceCheckpoint.host.wildSlot),0);
assert.equal(forceRaw.protect_move_end(1),0);
assert.throws(() => forceRaw.spike2_attack(0,0),WebAssembly.RuntimeError);
assert.equal((forceRaw.spike3_get_rng_draws(0)>>>0)+(forceRaw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
checks.push('raw-lower-level-force-gate-traps-after-last-accuracy-draw');
const force=ProtectDriver.restore(module,resources,forceCheckpoint),forceBefore=force.snapshot();
assert.throws(() => force.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(force.snapshot(),forceBefore);checks.push('force-gate-after-PP-candidate-rollback');
const rain=ProtectDriver.restore(module,resources,at(new ProtectDriver(module,resources,input.rain).snapshot(),max)),rainBefore=rain.snapshot();
assert.throws(() => rain.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(rain.snapshot(),rainBefore);assert.equal(rainBefore.core.words[483],0);
checks.push('rain-cast-and-field-tick-next-ai-candidate-rollback');
const chargeFirst=ProtectDriver.restore(module,resources,at(new ProtectDriver(module,resources,input.skullInitial).snapshot(),max)),firstBefore=chargeFirst.snapshot();
assert.throws(() => chargeFirst.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(chargeFirst.snapshot(),firstBefore);checks.push('first-charge-PP-defense-lock-next-ai-candidate-rollback');
const release=ProtectDriver.restore(module,resources,at(input.charge,max-1)),releaseBefore=release.snapshot();
assert.throws(() => release.advanceChoices([{actor:0,choice:materialize({kind:'continue-charge'},releaseBefore)}]),WebAssembly.RuntimeError);
assert.deepEqual(release.snapshot(),releaseBefore);assert.equal(releaseBefore.core.words[42],0);
checks.push('release-cleared-lock-before-critical-candidate-rollback');
const releaseRaw=instantiateProtect(module);assert.equal(importRaw(releaseRaw,releaseBefore.core.words),0);
assert.equal(releaseRaw.party_order(releaseRaw.charge_get(0,1),releaseBefore.host.wildSlot,0),1);
assert.equal(releaseRaw.spike2_attack(1,releaseBefore.host.wildSlot),0);
assert.equal(releaseRaw.protect_move_end(1),0);
assert.throws(() => releaseRaw.spike2_attack(0,releaseRaw.charge_get(0,1)),WebAssembly.RuntimeError);
checks.push('raw-PP0-release-traps-at-next-draw-without-retry-loop');
const wildMax=at(input.wildProtect,max),wildRaw=instantiateProtect(module);assert.equal(importRaw(wildRaw,wildMax.core.words),0);
const wildRawBefore=exportRaw(wildRaw);
assert.equal(wildRaw.family_choose_wild(),wildMax.host.wildSlot);assert.deepEqual(exportRaw(wildRaw),wildRawBefore);
checks.push('raw-locked-wild-chooser-needs-no-draw-even-at-limit');
const wild=ProtectDriver.restore(module,resources,wildMax),wildBefore=wild.snapshot();
assert.throws(() => wild.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(wild.snapshot(),wildBefore);checks.push('wild-release-candidate-rollback');
for(const count of [max,max-1]) {
  const driver=ProtectDriver.restore(module,resources,at(new ProtectDriver(module,resources,input.protectInitial).snapshot(),count)),saved=driver.snapshot();
  assert.throws(() => driver.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
  assert.deepEqual(driver.snapshot(),saved);checks.push(count===max?'Protect-after-PP-first-RNG-candidate-rollback':'Protect-counter-before-opponent-RNG-candidate-rollback');
}
const last=ProtectDriver.restore(module,resources,at(new ProtectDriver(module,resources,input.protectLast).snapshot(),max)),lastBefore=last.snapshot();
assert.throws(() => last.advanceChoices([{actor:0,choice:{kind:'switch',partyIndex:1}}]),WebAssembly.RuntimeError);
assert.deepEqual(last.snapshot(),lastBefore);checks.push('last-action-Protect-still-draws-switch-candidate-rollback');
const directLast=instantiateProtect(module),directWords=at(new ProtectDriver(module,resources,input.protectInitial).snapshot(),max).core.words;
assert.equal(importRaw(directLast,directWords),0);assert.equal(directLast.party_order(0,0,0),0);
assert.throws(() => directLast.spike2_attack(1,0),WebAssembly.RuntimeError);checks.push('raw-last-action-Protect-traps-before-last-action-test');
const blocked=instantiateProtect(module),blockedWords=at(new ProtectDriver(module,resources,input.blocked).snapshot(),max-1).core.words;
assert.equal(importRaw(blocked,blockedWords),0);assert.equal(blocked.party_order(0,0,0),1);
assert.equal(blocked.spike2_attack(1,0),0);assert.equal(blocked.protect_get(1,0),1);assert.equal(blocked.protect_move_end(1),0);
const hp=blocked.spike_get_battler(1,0),pp=blocked.spike2_get_move(0,0,1);
assert.equal(blocked.spike2_attack(0,0),0);assert.equal(blocked.spike_get_result(5),1);assert.equal(blocked.spike_get_battler(1,0),hp);
assert.equal(blocked.spike2_get_move(0,0,1),pp-1);assert.equal(blocked.protect_move_end(0),0);
assert.equal((blocked.spike3_get_rng_draws(0)>>>0)+(blocked.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
checks.push('raw-protected-attack-needs-no-accuracy-critical-variance-or-secondary-draw-at-limit');
process.stdout.write(JSON.stringify({status:'passed',pid:process.pid,checks}));
