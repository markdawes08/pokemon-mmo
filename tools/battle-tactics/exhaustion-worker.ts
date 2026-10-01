/** Parent enforces a wall timeout, including regressions in source retry loops. */
import assert from 'node:assert/strict';
import { jump } from '../encounter-core/verify-support';
import { loadTacticsResources,type TacticsInitial } from './admission';
import { TacticsDriver,instantiateTactics,type TacticsCheckpoint } from './driver';
import { loadTacticsModule } from './engine';
import { importRaw,materialize } from './verify-support';
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {parentPid:number;initial:TacticsInitial;pending:TacticsCheckpoint;replacement:TacticsCheckpoint;force:TacticsInitial;rain:TacticsInitial};
assert.notEqual(process.pid,input.parentPid);
const module=await loadTacticsModule(),resources=await loadTacticsResources(),baseline=new TacticsDriver(module,resources,input.initial).snapshot();
const max=Number.MAX_SAFE_INTEGER,checks:string[]=[];
function at(source:TacticsCheckpoint,count:number):TacticsCheckpoint {
  const c=structuredClone(source);c.rng.draws=count;c.core.words[5]=count>>>0;c.core.words[6]=Math.floor(count/0x100000000);
  c.rng.state=c.core.words[4]=jump(c.core.words[14]!,count,24691);return c;
}
for(const empty of [false,true]) {
  const c=at(baseline,max-1),raw=instantiateTactics(module);let seed=6;
  if(empty){seed=0;while(((jump(seed,max,24691)>>>16)&3)<2)seed++;}
  c.core.words[14]=seed;c.core.words[4]=jump(seed,max-1,24691);
  assert.equal(c.core.words[90],0);assert.equal(c.core.words[87],39);assert(c.core.words[91]!>0);
  assert.equal(importRaw(raw,c.core.words),0);assert.throws(() => raw.family_choose_wild(),WebAssembly.RuntimeError);
  assert.equal((raw.spike3_get_rng_draws(0)>>>0)+(raw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
  checks.push(empty?'raw-empty-slot-loop-traps':'raw-depleted-slot-loop-traps');
}
for(const count of [max,max-2]) {
  const driver=TacticsDriver.restore(module,resources,at(baseline,count)),before=driver.snapshot();
  assert.throws(() => driver.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
  assert.deepEqual(driver.snapshot(),before);checks.push(count===max?'first-draw-candidate-rollback':'next-ai-candidate-rollback');
}
const pending=TacticsDriver.restore(module,resources,at(input.pending,max)),p=pending.snapshot();
assert.throws(() => pending.advanceChoices([{actor:0,choice:materialize({kind:'attempt-run'},p)}]),WebAssembly.RuntimeError);
assert.deepEqual(pending.snapshot(),p);checks.push('faint-escape-candidate-rollback');
const replacement=TacticsDriver.restore(module,resources,at(input.replacement,max)),r=replacement.snapshot();
assert.throws(() => replacement.advanceChoices([{actor:0,choice:materialize({kind:'replace',partyIndex:1},r)}]),WebAssembly.RuntimeError);
assert.deepEqual(replacement.snapshot(),r);checks.push('replacement-next-turn-candidate-rollback');
const forceCheckpoint=at(new TacticsDriver(module,resources,input.force).snapshot(),max-1);
const forceRaw=instantiateTactics(module);assert.equal(importRaw(forceRaw,forceCheckpoint.core.words),0);
assert.equal(forceRaw.party_order(0,forceCheckpoint.host.wildSlot,0),1);
assert.equal(forceRaw.spike2_attack(1,forceCheckpoint.host.wildSlot),0);
assert.throws(() => forceRaw.spike2_attack(0,0),WebAssembly.RuntimeError);
assert.equal((forceRaw.spike3_get_rng_draws(0)>>>0)+(forceRaw.spike3_get_rng_draws(1)>>>0)*0x100000000,max);
checks.push('raw-lower-level-force-gate-traps-after-last-accuracy-draw');
const force=TacticsDriver.restore(module,resources,forceCheckpoint),forceBefore=force.snapshot();
assert.throws(() => force.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(force.snapshot(),forceBefore);checks.push('force-gate-after-PP-candidate-rollback');
const rain=TacticsDriver.restore(module,resources,at(new TacticsDriver(module,resources,input.rain).snapshot(),max)),rainBefore=rain.snapshot();
assert.throws(() => rain.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),WebAssembly.RuntimeError);
assert.deepEqual(rain.snapshot(),rainBefore);assert.equal(rainBefore.core.words[483],0);
checks.push('rain-cast-and-field-tick-next-ai-candidate-rollback');
process.stdout.write(JSON.stringify({status:'passed',pid:process.pid,checks}));
