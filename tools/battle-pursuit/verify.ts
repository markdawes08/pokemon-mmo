import { readFixtureBytes, readRetainedBytes } from '../fixtures/io';
/** Independent source literals, rejection, candidate isolation and recovery. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { loadPursuitResources,type PursuitInitial } from './admission';
import { PursuitDriver,instantiatePursuit,type PursuitCheckpoint } from './driver';
import { loadPursuitModule } from './engine';
import { advanceRaw,assertState,assertStep,checkTrace,exportRaw,importRaw,materialize,monWords,type Fixtures,type RecoveryJob } from './verify-support';
import { verifyPolicy } from './verify-policy';
async function child(command:string,args:string[],input='',timeout=120000):Promise<string> {
  return new Promise((resolve,reject) => {
    const owned=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',expired=false;
    const timer=setTimeout(() => {expired=true;owned.kill();},timeout);
    owned.stdout.on('data',d => {stdout+=String(d);});owned.stderr.on('data',d => {stderr+=String(d);});
    owned.once('error',error => {clearTimeout(timer);reject(error);});
    owned.once('exit',code => {clearTimeout(timer);if(code===0&&!expired)resolve(stdout);
      else reject(new Error(`Owned party verifier child ${expired?'timed out':`exited ${code}`}: ${stderr}`));});
    owned.stdin.on('error',error => {if(!expired)reject(error);});owned.stdin.end(input);
  });
}
const sha=(bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await child('.venv/Scripts/python.exe',['tools/battle-pursuit/fixtures/generate_fixtures.py','--check']);
const fixtureBytes=await readFixtureBytes('tools/battle-pursuit/fixtures/source-cases.json'),fixtures=JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
const [module,rebuildBytes,resources]=await Promise.all([loadPursuitModule(),readFile('.local/battle-pursuit/rebuild/pursuit.wasm'),loadPursuitResources()]);
const rebuild=new WebAssembly.Module(rebuildBytes),build=JSON.parse(await readFile('reports/battle-pursuit-build.json','utf8')) as {wasmSha256:string};
assert.equal(sha(rebuildBytes),build.wasmSha256);assert.equal(new Set(fixtures.cases.map(c => c.id)).size,fixtures.cases.length);
const retained={
  'tools/battle-protect/fixtures/source-cases.json':'579b466aca06a490c19c98e302b35d7cba3b69117391b5913606ea649dd16c1f',
  '.local/battle-protect/primary/protect.wasm':'c8300b709626eab94f4554dca867181127b4fcc9a888c2c8fa013e7b8d220d8f',
  'tools/battle-charge/fixtures/source-cases.json':'167b44266ca4b5d2bfffd9f9919d6d9b7ab60dc92688bb7ca7ca98e96e3cd54c',
  '.local/battle-charge/primary/charge.wasm':'c2d5ac7786979cf0288ab624f5c8a7b81516c7c34458ceddd54923de99541151',
  'tools/battle-route1/fixtures/source-cases.json':'6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json':'1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json':'23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  'tools/battle-loss/fixtures/source-cases.json':'dbfe309e1a8ce56fdf691710858785756f910c3502c926935112632c5d93cd1b',
  'tools/battle-capture/fixtures/source-cases.json':'47a4b1ebf06bfc055a25fd119834f76c4f4243afe6ceddb5ac49c968e37c8c3c',
  'tools/battle-evolution/fixtures/source-cases.json':'9e629febd8845dc6e281164f6ee93ff964dab6d11f186754832ac19002307c8f',
  'tools/battle-family/fixtures/source-cases.json':'e8aea6e37946e3201d86a181f36e4d1bc00e102dca4e8e7b8564698295f64ed3',
  'tools/battle-party/fixtures/source-cases.json':'4db4ff56299e5b8ef5a5a77035c0419095333a61d40060a5997b612946b22c32',
  'tools/battle-tactics/fixtures/source-cases.json':'03736f527ee900a22c061844046ea39672001788bc85f3a7bcd5d294e65a1653',
  '.local/battle-spike/primary/probe.wasm':'3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm':'8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-route1/primary/route1.wasm':'6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-progression/primary/progression.wasm':'33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  '.local/battle-loss/primary/loss.wasm':'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
  '.local/battle-capture/primary/capture.wasm':'1e6b16390cdaa4906c01b391c30984735a22e998f548e9ff7de44d890865a60b',
  '.local/battle-evolution/primary/evolution.wasm':'1585f15e7aef6a5ed952cbf3f17041d5382163e39f51c3b1ed3ac65f41495c5c',
  '.local/battle-family/primary/family.wasm':'810a16bcc7b714426edb80f933deaf8afefb65240c95464980d03e4f92a28e65',
  '.local/battle-party/primary/party.wasm':'4b6935d92251703975303d65a726078f3e9bd0a1c08a61f42acc4b72d83405c9',
  '.local/battle-tactics/primary/tactics.wasm':'662633e05265663a20a02141939c4fdc78ef0be27d53df99507596280a216f5c',
};
for(const [path,hash]of Object.entries(retained))assert.equal(sha(await readRetainedBytes(path)),hash,`Retained ${path}`);
const policyFixture=fixtures.cases.find(c => c.id==='protect-policy-base-two-priority-speed')!;
const policyTemplate=new PursuitDriver(module,resources,policyFixture.input).snapshot();
const policyChecks=verifyPolicy(module,policyTemplate,fixtures.protectPolicy);
assert.deepEqual(verifyPolicy(rebuild,policyTemplate,fixtures.protectPolicy),policyChecks);
const jobs:RecoveryJob[]=[],observations=[];let transitions=0,checkedDraws=0,replayedTransitions=0,replayedRawTransitions=0;
for(const fixture of fixtures.cases) {
  const initial=structuredClone(fixture.input);
  let driver:PursuitDriver;
  try {driver=new PursuitDriver(module,resources,initial);} catch(error) {throw new Error(`${fixture.id}: source admission failed`,{cause:error});}
  assertState(driver.snapshot(),fixture.initial.state,fixture.input,`${fixture.id}:initial`);
  checkTrace(fixture.initial.trace,fixture.input.seed,0);checkedDraws+=fixture.initial.trace.length;
  for(let index=0;index<=fixture.steps.length;index++) {
    const checkpoint=driver.snapshot(),expected=index===0?fixture.initial.state:fixture.steps[index-1]!.expected.state;
    assertState(checkpoint,expected,initial,`${fixture.id}:boundary${index}`);
    const recovered=PursuitDriver.restore(rebuild,resources,checkpoint);assert.deepEqual(recovered.snapshot(),checkpoint);
    const raw=instantiatePursuit(rebuild);assert.equal(importRaw(raw,checkpoint.core.words),0);
    assert.deepEqual(exportRaw(raw,checkpoint.core.boundary),checkpoint.core.words);let rawCheckpoint=structuredClone(checkpoint);
    jobs.push({id:`${fixture.id}:${index}`,checkpoint:structuredClone(checkpoint),expected,initial,remaining:fixture.steps.slice(index)});
    for(const [i,step]of fixture.steps.slice(index).entries()) {
      const events=recovered.advanceChoices([{actor:0,choice:materialize(step.choice,recovered.snapshot())}]);
      assertStep(events,recovered.snapshot(),step.expected,initial,`${fixture.id}:cross${index}+${i}`);replayedTransitions++;
      const next=advanceRaw(raw,rawCheckpoint,step.choice);rawCheckpoint=next.checkpoint;
      assertStep(next.events,rawCheckpoint,step.expected,initial,`${fixture.id}:raw${index}+${i}`);
      assert.deepEqual(rawCheckpoint,recovered.snapshot(),`${fixture.id}: all raw future words`);replayedRawTransitions++;
    }
    const detached=driver.snapshot();detached.core.words[17]=65535;detached.host.wildSlot=9;assert.deepEqual(driver.snapshot(),checkpoint);
    assert.throws(() => driver.project(1));const view=driver.project(0);assert.equal(view.liveAdmission,false);
    assert.deepEqual(view.weather,{kind:expected.weather?'rain':'clear',turnsRemaining:expected.weatherDuration});
    assert.equal(view.self.charging,(expected.actors[0]!.status2&4096)!==0);
    assert.equal(view.opponent.charging,(expected.actors[1]!.status2&4096)!==0);
    assert.equal(view.self.protected,Boolean(expected.protected[0]));assert.equal(view.opponent.protected,Boolean(expected.protected[1]));
    for(const key of ['admission','context','rng','words','origin','protectPolicy','protectCounters','resultingMoves'])assert(!Object.hasOwn(view,key));
    for(const key of ['ivs','evs','stats','personality','otId','moves','wildSlot','abilityId','protectUses','protectCounter','lastResultingMove'])assert(!Object.hasOwn(view.opponent,key));
    if(index===fixture.steps.length)break;
    const step=fixture.steps[index]!;checkTrace(step.expected.trace,checkpoint.rng.state,checkpoint.rng.draws);checkedDraws+=step.expected.trace.length;
    const events=driver.advanceChoices([{actor:0,choice:materialize(step.choice,checkpoint)}]);
    assertStep(events,driver.snapshot(),step.expected,initial,`${fixture.id}:transition${index}`);transitions++;
  }
  assert.deepEqual(initial,fixture.input);observations.push({id:fixture.id,status:'passed',transitions:fixture.steps.length,
    outcome:driver.snapshot().host.outcome,draws:driver.snapshot().rng.draws});
}
const first=fixtures.cases.find(c => c.id==='party-2-switch-index-1')!,baseline=new PursuitDriver(module,resources,first.input),before=baseline.snapshot();
const negatives:string[]=[],rawNegatives:string[]=[];
function badInput(name:string,edit:(input:Extract<PursuitInitial,{kind:'diagnostic'}>) => void):void {
  const input=structuredClone(first.input);edit(input);assert.throws(() => new PursuitDriver(module,resources,input),name);
  assert.deepEqual(baseline.snapshot(),before);negatives.push(`input:${name}`);
}
const owners:Record<number,number>={119:16};
for(const [id,species]of Object.entries(owners))badInput(`unsupported bench whole moveset ${id}`,x => {
  x.player[1]=structuredClone(fixtures.cases.find(c => c.id===`single-control-level-boundary-${species}-100`)!.input.player[0]!);
  x.player[1]!.moves[1]={moveId:Number(id),pp:0,ppUps:0};
});
badInput('empty party',x => {x.player=[];});badInput('seven members',x => {x.player=Array.from({length:7},() => structuredClone(x.player[0]!));});
badInput('all fainted',x => {x.player.forEach(m => {m.hp=0;m.status=0;});});
badInput('fainted status uncleared',x => {x.player[1]!.hp=0;x.player[1]!.status=8;});
badInput('dead wild',x => {x.opponent.hp=0;});badInput('foreign bench species',x => {Object.assign(x.player[1]!,{speciesId:1});});
badInput('wrong bench cached stats',x => {x.player[1]!.stats.attack++;});badInput('wrong ability',x => {x.player[1]!.abilityId=51;});
badInput('bench PP cap',x => {x.player[1]!.moves[0]!.pp=255;});badInput('empty bonus',x => {x.player[1]!.moves[3]!.ppUps=1;});
badInput('bonus cap',x => {x.player[1]!.moves[0]!.ppUps=4;});badInput('IV cap',x => {x.player[1]!.ivs.hp=32;});
badInput('EV cap',x => {x.player[1]!.evs.hp=256;});badInput('basis beyond EV',x => {x.player[1]!.calculatedEvs.hp=1;});
badInput('held item',x => {Object.assign(x.player[1]!,{heldItemId:195});});badInput('weather',x => Object.assign(x,{weather:1}));
for(const status of [1,4,24,32,64,128,0xFFFFFFFF])badInput(`unavailable bench status ${status}`,x => Object.assign(x.player[1]!,{status}));
for(const choice of [{kind:'switch',partyIndex:0},{kind:'switch',partyIndex:2},{kind:'switch',partyIndex:-1},{kind:'switch',partyIndex:6},
  {kind:'switch',partyIndex:1,seed:1},{kind:'replace',partyIndex:1,decisionId:'0'.repeat(64)},{kind:'attempt-run',decisionId:'0'.repeat(64)},
  {kind:'item',itemId:13},{kind:'item',itemId:4},{kind:'move',slot:4},{kind:'struggle'}]) {
  assert.throws(() => baseline.validateChoice(0,choice));assert.deepEqual(baseline.snapshot(),before);negatives.push(`choice:${JSON.stringify(choice)}`);
}
assert.throws(() => baseline.validateChoice(1,{kind:'switch',partyIndex:1}));assert.throws(() => baseline.advanceChoices([]));
assert.throws(() => baseline.advanceChoices([{actor:0,choice:{kind:'switch',partyIndex:1}},{actor:0,choice:{kind:'run'}}]));
assert.deepEqual(baseline.snapshot(),before);negatives.push('duplicate/foreign/empty actors');
function badCheckpoint(name:string,edit:(copy:PursuitCheckpoint) => void,source=before):void {
  const copy=structuredClone(source);edit(copy);assert.throws(() => PursuitDriver.restore(module,resources,copy),name);negatives.push(`checkpoint:${name}`);
}
for(const [key,value]of Object.entries({id:'clamped-policy',romSha256:'0'.repeat(64),tableSha256:'0'.repeat(64),tableOffset:0,tableEntries:4,extra:true}))
  badCheckpoint(`ROM policy ${key}`,x => {Object.assign(x.protectPolicy,{[key]:value});});
for(const key of Object.keys(before.protectPolicy)) {
  badCheckpoint(`ROM policy missing ${key}`,x => {delete (x.protectPolicy as unknown as Record<string,unknown>)[key];});
  badCheckpoint(`ROM policy wrong type ${key}`,x => {Object.assign(x.protectPolicy,{[key]:null});});
}
const originalPolicyBytes=Buffer.alloc(512);fixtures.protectPolicy.rates.forEach((rate,i) => originalPolicyBytes.writeUInt16LE(rate,i*2));
const policyOffset=rebuildBytes.indexOf(originalPolicyBytes);assert(policyOffset>=0,'Compiled full table is present');
const alteredModule=Buffer.from(rebuildBytes);alteredModule[policyOffset+8]^=1;
assert.throws(() => instantiatePursuit(new WebAssembly.Module(alteredModule)),/Compiled Protect lookup differs/);
negatives.push('compiled ROM lookup byte differs without altering ABI');
for(const [name,index,value]of [['version',1,4],['reserved',15,1],['missing intro',149,0],['capture marker',150,4],['wide run counter',148,256],
  ['party size',154,7],['active outside party',155,2],['sent outside party',156,64],['switch counter overflow',157,256],['unearned pending',158,1],
  ['unearned decision',159,1],['faint mask',482,1],['tail reserved',483,1],['bench immutable XP',209,0],['bench cached stats',214,1],
  ['phantom roster',252,7],['bench party HP projection',116,1],['hidden enemy bench',133,7],['unavailable flinch',27,8],
  ['unsupported volatile',27,1],['unlearned focus',27,0x100000],['bench PP refill',235,255]] as const)
  badCheckpoint(name,x => {x.core.words[index]=value;});
badCheckpoint('RNG state',x => {x.rng.state^=1;x.core.words[4]=x.rng.state;});
badCheckpoint('RNG count',x => {x.rng.draws++;x.core.words[5]++;});badCheckpoint('wild choice',x => {x.host.wildSlot=4;});
badCheckpoint('sequence relation',x => {x.host.sequence++;});badCheckpoint('turn relation',x => {x.host.turn++;});
badCheckpoint('live provenance',x => Object.assign(x.context,{liveAdmission:true}));
badCheckpoint('bag injection',x => {x.context.inventory={potion:5,pokeBall:5};});
badCheckpoint('friendship before faint',x => {x.core.words[165]!--;});
badCheckpoint('unused bench HP decreases without participation',x => {
  x.host.sequence=x.host.turnActions=1;x.host.turn=2;x.host.eventSequence=2;x.core.words[212]!--;x.core.words[116]=x.core.words[212]!;
});
badCheckpoint('unused bench PP decreases without participation',x => {
  x.host.sequence=x.host.turnActions=1;x.host.turn=2;x.host.eventSequence=2;x.core.words[235]!--;
});
const rainJob=jobs.find(j => j.id==='rain-five-turns-repeat-and-recast:1')!;
for(const [name,weather,duration]of [['clear with timer',0,1],['rain without timer',1,0],['permanent rain',2,4],
  ['downpour',4,4],['duration overflow',1,6],['unticked choice rain',1,5]] as const)
  badCheckpoint(name,x => {x.core.words[483]=weather;x.core.words[484]=duration;},rainJob.checkpoint);
badCheckpoint('weather without source move',x => {x.host.sequence=x.host.turnActions=1;x.host.turn=2;x.host.eventSequence=2;x.core.words[483]=1;x.core.words[484]=4;});
const forceJob=jobs.find(j => j.id==='whirlwind-actor-0-levels-60-60-success-True:1')!;
badCheckpoint('forced escape wrong source move',x => {x.core.words[13]=33;},forceJob.checkpoint);
badCheckpoint('forced escape PP never spent',x => {
  x.core.words[42]++;x.core.words[189]++;
},forceJob.checkpoint);
badCheckpoint('forced escape outcome alias',x => {x.host.outcome='ran';},forceJob.checkpoint);
for(const key of ['hazards','wrap','leechSeed','protect','charging','lastTakenMove','weatherDuration'])
  badInput(`unsupported state ${key}`,x => Object.assign(x,{[key]:1}));
const raw=instantiatePursuit(module);assert.equal(importRaw(raw,before.core.words),0);const rawBefore=exportRaw(raw);
for(const [name,index,value]of [['version',1,4],['reserved',15,1],['flinch',27,8],['bad status',26,4],['foreign ability',47,255],
  ['foreign species',46,1],['unknown move',38,355],['PP cap',42,255],['bonus cap',152,256],['invalid stage',30,13],
  ['capture marker',150,4],['roster count',154,0],['roster count overflow',154,7],['active missing',155,2],['sent missing active',156,2],
  ['sent unknown',156,64],['switch counter',157,256],['pending wrong boundary',158,1],['decision without prompt',159,1],
  ['phantom bench',252,7],['full bench stat mismatch',214,1],['active roster HP mismatch',166,1],['bench HP projection mismatch',116,1],
  ['hidden wild bench',133,7],['faint mask',482,1],['tail reserved',511,1]] as const) {
  const copy=rawBefore.slice();copy[index]=value;assert.notEqual(importRaw(raw,copy),0,name);assert.deepEqual(exportRaw(raw),rawBefore);rawNegatives.push(name);
}
const weatherRaw=instantiatePursuit(module);assert.equal(importRaw(weatherRaw,rainJob.checkpoint.core.words),0);
const acceptedRain=exportRaw(weatherRaw);
for(const [name,weather,duration]of [['clear timer',0,1],['zero rain timer',1,0],['permanent rain',2,4],['downpour',4,4],
  ['overflow rain timer',1,6],['unsettled cast timer',1,5]] as const) {
  const copy=acceptedRain.slice();copy[483]=weather;copy[484]=duration;
  assert.notEqual(importRaw(weatherRaw,copy),0,name);assert.deepEqual(exportRaw(weatherRaw),acceptedRain);rawNegatives.push(name);
}
const forcedRaw=instantiatePursuit(module);assert.equal(importRaw(forcedRaw,forceJob.checkpoint.core.words),0);
const acceptedForce=exportRaw(forcedRaw,3);
assert.notEqual(forcedRaw.tactics_field_end_turn(),0);assert.deepEqual(exportRaw(forcedRaw,3),acceptedForce);
rawNegatives.push('forced end cannot tick field again');
const forceBad=acceptedForce.slice();forceBad[13]=33;assert.notEqual(importRaw(forcedRaw,forceBad),0);
assert.deepEqual(exportRaw(forcedRaw,3),acceptedForce);rawNegatives.push('forced outcome requires Whirlwind');
const forceUnspent=acceptedForce.slice();forceUnspent[42]=forceUnspent[189]=20;
assert.notEqual(importRaw(forcedRaw,forceUnspent),0);assert.deepEqual(exportRaw(forcedRaw,3),acceptedForce);
rawNegatives.push('forced selected Whirlwind source PP never spent');
const alternateForce=jobs.find(j => j.id==='whirlwind-negative-priority-even-agility:2')!.checkpoint;
const alternateRaw=instantiatePursuit(module);assert.equal(importRaw(alternateRaw,alternateForce.core.words),0);
const alternateBefore=exportRaw(alternateRaw,3),alternateBad=alternateBefore.slice();alternateBad[11]=0;
assert.notEqual(importRaw(alternateRaw,alternateBad),0);assert.deepEqual(exportRaw(alternateRaw,3),alternateBefore);
rawNegatives.push('forced outcome selected valid different move');
const protectJob=jobs.find(j => j.id==='protect-family-7-actor-0:1')!;
const protectRaw=instantiatePursuit(module);assert.equal(importRaw(protectRaw,protectJob.checkpoint.core.words),0);
const acceptedProtection=exportRaw(protectRaw);
for(const [name,index,value]of [['counter outside u8',491,256],['protected outside bool',493,2],['protected at choice',493,1],
  ['unsupported resulting move',59,355],['foreign supported resulting move',59,55],['reserved Protect tail',495,1]] as const) {
  const changed=acceptedProtection.slice();changed[index]=value;
  assert.notEqual(importRaw(protectRaw,changed),0,name);assert.deepEqual(exportRaw(protectRaw),acceptedProtection);rawNegatives.push(name);
  badCheckpoint(name,x => {x.core.words[index]=value;},protectJob.checkpoint);
}
badCheckpoint('Protect count exceeds source PP spent',x => {x.core.words[491]=2;},protectJob.checkpoint);
badCheckpoint('Protect counter before first action',x => {x.core.words[491]=1;},policyTemplate);
badCheckpoint('Protect history before first action',x => {x.core.words[59]=182;},policyTemplate);
badCheckpoint('Protect PP refill with retained count',x => {x.core.words[42]++;x.core.words[189]++;},protectJob.checkpoint);
const deadProtectJob=jobs.find(j => j.id==='protect-then-recoil-faint-records-Struggle-after-cleanup:2')!;
for(const [name,index,value]of [['fainted actor counter',491,1],['fainted actor protected',493,1]] as const) {
  const api=instantiatePursuit(module),w=deadProtectJob.checkpoint.core.words;assert.equal(importRaw(api,w),0);
  const changed=w.slice();changed[index]=value;assert.notEqual(importRaw(api,changed),0);
  assert.deepEqual(exportRaw(api,1),w);rawNegatives.push(name);
  badCheckpoint(name,x => {x.core.words[index]=value;},deadProtectJob.checkpoint);
}
const postProtectJob=jobs.find(j => j.id==='protect-residual-faint-clears-before-prompt-8:1')!;
badCheckpoint('post-residual protection cannot survive cleanup',x => {x.core.words[494]=1;},postProtectJob.checkpoint);
// The source move-end boundary is explicit. Rejected operations preserve its
// pending actor and accepted source state, then the rightful hook completes.
const hookRaw=instantiatePursuit(module);assert.equal(importRaw(hookRaw,policyTemplate.core.words),0);
assert.notEqual(hookRaw.protect_move_end(0),0);assert.deepEqual(exportRaw(hookRaw),policyTemplate.core.words);
rawNegatives.push('move-end without an action');assert.equal(hookRaw.party_order(0,0,0),0);
assert.equal(hookRaw.spike2_attack(0,0),0);
const hookView=() => [hookRaw.spike_get_rng()>>>0,hookRaw.spike3_get_rng_draws(0),hookRaw.spike3_get_rng_draws(1),
  ...[0,1].flatMap(actor => [hookRaw.spike2_get_move(actor,0,1),hookRaw.protect_get(actor,0),hookRaw.protect_get(actor,1),hookRaw.protect_get(actor,2)])];
const pendingHook=hookView();assert.notEqual(hookRaw.spike3_checkpoint_export(0),0);assert.deepEqual(hookView(),pendingHook);
assert.notEqual(hookRaw.protect_move_end(1),0);assert.deepEqual(hookView(),pendingHook);
assert.notEqual(hookRaw.spike2_attack(1,0),0);assert.deepEqual(hookView(),pendingHook);
assert.equal(hookRaw.protect_move_end(0),0);const doneHook=hookView();assert.notEqual(hookRaw.protect_move_end(0),0);
assert.deepEqual(hookView(),doneHook);assert.equal(hookRaw.spike2_attack(1,0),0);assert.equal(hookRaw.protect_move_end(1),0);
assert.equal(hookRaw.party_sync(),0);
assert.equal(hookRaw.party_residual_order(),0);assert.equal(hookRaw.protect_get(0,0),0);assert.equal(hookRaw.protect_get(1,0),0);
assert.equal(hookRaw.tactics_field_end_turn(),0);assert.equal(hookRaw.spike2_begin_turn(),0);assert.equal(hookRaw.family_choose_wild(),0);
const hookExpected=new PursuitDriver(module,resources,policyFixture.input);hookExpected.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]);
assert.deepEqual(exportRaw(hookRaw),hookExpected.snapshot().core.words,'Rejected pending-hook operations do not change future continuation');
rawNegatives.push('pending move-end cannot export','wrong-actor move-end','second attack before move-end','duplicate move-end');
const chargeJob=jobs.find(j => j.id==='charge-last-PP-release-before-Struggle:1')!;
const rawProtect=instantiatePursuit(module);assert.equal(importRaw(rawProtect,chargeJob.checkpoint.core.words),0);
const acceptedProtect=exportRaw(rawProtect);
for(const [name,index,value]of [['missing active lock value',485,0],['foreign locked move',485,55],['wrong retained slot',11,1],
  ['source target self',489,0],['transient charging flag at choice',487,1],['charging flag outside bool',487,2],['reserved charge tail',495,1],
  ['charge marked Struggle fallback',63,1],['unsupported combined volatile',27,4097]] as const) {
  const copy=acceptedProtect.slice();copy[index]=value;
  assert.notEqual(importRaw(rawProtect,copy),0,name);assert.deepEqual(exportRaw(rawProtect),acceptedProtect);rawNegatives.push(name);
  badCheckpoint(name,x => {x.core.words[index]=value;},chargeJob.checkpoint);
}
badCheckpoint('charge restored without admission PP spent',x => {x.core.words[42]=x.core.words[189]=1;},chargeJob.checkpoint);
for(const [id,actor]of [['wild-charge-retained-over-player-pre-residual-recoil-faint:1',1],['charge-Whirlwind-terminal-retains-lock:1',0]] as const) {
  const job=jobs.find(j => j.id===id)!,api=instantiatePursuit(module),w=job.checkpoint.core.words;
  assert((w[27+actor*48]!&4096)!==0);assert.equal(importRaw(api,w),0);const saved=exportRaw(api,job.checkpoint.core.boundary);
  for(const action of [2,3]) {
    const copy=saved.slice();copy[9+actor]=action;
    assert.notEqual(importRaw(api,copy),0,'Locked source actor cannot retain Run/Switch');
    assert.deepEqual(exportRaw(api,job.checkpoint.core.boundary),saved);rawNegatives.push(`charge ${id} cannot retain action ${action}`);
    badCheckpoint(`charge ${id} cannot retain action ${action}`,x => {x.core.words[9+actor]=action;},job.checkpoint);
  }
}
for(const action of [1,2]) {
  assert(rawProtect.party_order(0,chargeJob.checkpoint.host.wildSlot,action)<0,'Raw locked actor cannot choose Run/Switch');
  assert.deepEqual(exportRaw(rawProtect),acceptedProtect);rawNegatives.push(`locked raw order action ${action}`);
}
const locked=PursuitDriver.restore(module,resources,chargeJob.checkpoint),lockedBefore=locked.snapshot(),lockedView=locked.project(0);
assert.deepEqual(lockedView.availableChoices,[materialize({kind:'continue-charge'},lockedBefore)]);
const chargeAcknowledgement=materialize({kind:'continue-charge'},lockedBefore);assert('decisionId' in chargeAcknowledgement);
assert.deepEqual(lockedView.pendingCharge,{decisionId:chargeAcknowledgement.decisionId,moveId:130,slot:0});
for(const choice of [{kind:'move',slot:0},{kind:'struggle'},{kind:'run'},{kind:'switch',partyIndex:1},
  {kind:'continue-charge',decisionId:'0'.repeat(64)},{kind:'continue-charge',decisionId:lockedView.pendingCharge!.decisionId,slot:0}]) {
  assert.throws(() => locked.validateChoice(0,choice));assert.deepEqual(locked.snapshot(),lockedBefore);negatives.push(`locked choice:${JSON.stringify(choice)}`);
}
const continueChoice=materialize({kind:'continue-charge'},lockedBefore);
locked.advanceChoices([{actor:0,choice:continueChoice}]);const released=locked.snapshot();
assert.throws(() => locked.advanceChoices([{actor:0,choice:continueChoice}]));assert.deepEqual(locked.snapshot(),released);
assert.deepEqual(locked.project(0).pendingCharge,null);negatives.push('released acknowledgement cannot replay');
const twice=fixtures.cases.find(c => c.id==='charge-species-7-actor-0')!,twiceDriver=new PursuitDriver(module,resources,twice.input);
twiceDriver.advanceChoices([{actor:0,choice:materialize(twice.steps[0]!.choice,twiceDriver.snapshot())}]);
const oldContinue=materialize({kind:'continue-charge'},twiceDriver.snapshot());
twiceDriver.advanceChoices([{actor:0,choice:oldContinue}]);
twiceDriver.advanceChoices([{actor:0,choice:materialize(twice.steps[2]!.choice,twiceDriver.snapshot())}]);
const secondProtect=twiceDriver.snapshot();assert.throws(() => twiceDriver.advanceChoices([{actor:0,choice:oldContinue}]));
assert.deepEqual(twiceDriver.snapshot(),secondProtect);negatives.push('old charge acknowledgement cannot release later lock');
for(const kind of ['duplicate','out-of-range','incomplete'] as const) {
  assert.equal(raw.spike3_import_begin(9,0,512),0);rawBefore.slice(0,kind==='incomplete'?511:512).forEach((w,i) => assert.equal(raw.spike3_import_set(i,w),0));
  if(kind!=='incomplete')assert.notEqual(raw.spike3_import_set(kind==='duplicate'?0:512,1),0);
  assert.notEqual(raw.spike3_import_commit(),0);assert.deepEqual(exportRaw(raw),rawBefore);rawNegatives.push(`import staging:${kind}`);
}
for(const [index,forced]of [[0,0],[2,0],[6,0],[1,1],[1,2]] as const) {
  assert.notEqual(raw.party_switch(index,forced),0);assert.deepEqual(exportRaw(raw),rawBefore);rawNegatives.push(`invalid switch ${index}/${forced}`);
}
for(const [name,index,value]of [['species',0,1],['stat u16',7,65536],['status',36,128],['unsupported move',25,119],['XP',3,0],
  ['cached stat',8,1],['ability slot',39,1],['IV',13,32],['EV',19,256],['PP',29,255],['PP bonuses',33,256],['held',37,195],['Pokerus',38,1],['basis',40,1]] as const) {
  const api=instantiatePursuit(module);assert.equal(api.spike_reset(1),0);const w=monWords(first.input.player[0]!);w[index]=value;
  assert.equal(api.party_input_begin(0),0);w.forEach((v,i) => assert.equal(api.party_input_set(0,i,v),0));
  assert.notEqual(api.party_input_commit(0),0,name);assert.equal(api.party_start(1),3);rawNegatives.push(`mon:${name}`);
}
for(const kind of ['duplicate','out-of-range','incomplete'] as const) {
  const api=instantiatePursuit(module);assert.equal(api.spike_reset(1),0);const w=monWords(first.input.player[0]!);assert.equal(api.party_input_begin(0),0);
  w.slice(0,kind==='incomplete'?45:46).forEach((v,i) => assert.equal(api.party_input_set(0,i,v),0));
  if(kind!=='incomplete')assert.notEqual(api.party_input_set(0,kind==='duplicate'?0:46,1),0);
  assert.notEqual(api.party_input_commit(0),0);rawNegatives.push(`mon staging:${kind}`);
}
const pendingJob=jobs.find(j => j.id==='faint-speed-escape-false:1')!,failedJob=jobs.find(j => j.id==='faint-speed-escape-false:2')!;
const rawFailed=instantiatePursuit(module);assert.equal(importRaw(rawFailed,failedJob.checkpoint.core.words),0);
const rawFailedBefore=exportRaw(rawFailed,failedJob.checkpoint.core.boundary);
assert(rawFailed.party_replacement_decide(1)<0);assert.deepEqual(exportRaw(rawFailed,failedJob.checkpoint.core.boundary),rawFailedBefore);
assert.notEqual(rawFailed.party_faint_cleanup(0),0);assert.deepEqual(exportRaw(rawFailed,failedJob.checkpoint.core.boundary),rawFailedBefore);
rawNegatives.push('raw failed escape cannot reroll','raw faint friendship cannot apply twice');
const counterRaw=instantiatePursuit(module),counterWords=rawBefore.slice();counterWords[157]=255;
assert.equal(importRaw(counterRaw,counterWords),0);assert.equal(counterRaw.party_order(4,before.host.wildSlot,2),0);
assert.equal(counterRaw.pursuit_switch_prepare(1),0);assert.equal(counterRaw.pursuit_switch_complete(1),0);assert.equal(counterRaw.party_get(3),255);
// Partial switches are intentionally not checkpoint boundaries. Rejected raw
// calls must preserve observations AND the exact eventual rightful future.
for(const id of ['party-2-switch-index-1','intercept-critical-1','intercept-KO-gap-30-friendship-200']) {
  const fixture=fixtures.cases.find(c => c.id===id)!,prior=new PursuitDriver(module,resources,fixture.input).snapshot();
  const api=instantiatePursuit(module),control=instantiatePursuit(module);
  assert.equal(importRaw(api,prior.core.words),0);assert.equal(importRaw(control,prior.core.words),0);
  const future=advanceRaw(control,prior,{kind:'switch',partyIndex:1}).checkpoint;
  const observe=() => ({rng:api.spike_get_rng(),draws:[api.spike3_get_rng_draws(0),api.spike3_get_rng_draws(1)],
    actors:[0,1].map(a => ({hp:api.spike_get_battler(a,0),pp:Array.from({length:4},(_,s) => api.spike2_get_move(a,s,1)),
      protect:[0,1,2].map(f => api.protect_get(a,f)),charge:[0,1,2,3,4].map(f => api.charge_get(a,f))})),
    roster:Array.from({length:8},(_,f) => api.party_get(f))});
  assert.equal(api.party_order(4,prior.host.wildSlot,2),0);
  for(const index of [0,6,0xffffffff]) {
    const saved=observe();assert(api.pursuit_switch_prepare(index)<0);assert.deepEqual(observe(),saved);rawNegatives.push(`${id}: invalid switch before PP/RNG ${index}`);
  }
  assert.equal(api.pursuit_switch_prepare(1),id.startsWith('intercept')?1:0);
  const pendingState=observe();
  for(const [label,operation]of [
    ['partial checkpoint',() => api.spike3_checkpoint_export(0)],
    ['second prepare',() => api.pursuit_switch_prepare(1)],
    ['wrong destination',() => api.pursuit_switch_complete(0)],
    ['direct voluntary bypass',() => api.party_switch(1,0)],
    ['ordinary attack during switch',() => api.spike2_attack(1,prior.host.wildSlot)],
    ['full Protect move-end on limited interception',() => api.protect_move_end(1)],
  ] as const) {assert.notEqual(operation(),0,label);assert.deepEqual(observe(),pendingState);rawNegatives.push(`${id}: ${label}`);}
  if(api.spike_get_battler(0,0)===0) {
    assert.notEqual(api.pursuit_switch_complete(1),0);assert.deepEqual(observe(),pendingState);
    rawNegatives.push(`${id}: selected switch cannot skip outgoing faint cleanup`);
    assert.equal(api.party_faint_cleanup(0),0);const cleaned=observe();
    assert.notEqual(api.party_faint_cleanup(0),0);assert.deepEqual(observe(),cleaned);
    rawNegatives.push(`${id}: outgoing faint friendship cannot apply twice`);
  }
  assert.equal(api.pursuit_switch_complete(1),0);const completed=observe();
  assert.notEqual(api.pursuit_switch_complete(1),0);assert.deepEqual(observe(),completed);rawNegatives.push(`${id}: duplicate completion`);
  if(id.startsWith('intercept')) {
    assert.notEqual(api.spike2_attack(1,prior.host.wildSlot),0);assert.deepEqual(observe(),completed);
    assert.notEqual(api.spike3_checkpoint_export(0),0);rawNegatives.push(`${id}: consumed action cannot attack or export before field entry`);
  } else {assert.equal(api.spike2_attack(1,prior.host.wildSlot),0);assert.equal(api.protect_move_end(1),0);}
  const residual=api.party_residual_order();assert([0,1,2].includes(residual));assert.equal(api.tactics_field_end_turn(),0);
  for(const actor of residual===0?[0,1]:[1,0])if(api.spike_get_battler(actor,3)) {
    assert.equal(api.spike2_residual(actor),0);assert(api.spike_get_battler(actor,0)>0);
  }
  assert.equal(api.party_sync(),0);assert.equal(api.spike2_begin_turn(),0);assert.equal(api.family_choose_wild(),future.host.wildSlot);
  assert.deepEqual(exportRaw(api),future.core.words,`${id}: rightful continuation after every rejected operation`);
}
const promptCounter=instantiatePursuit(module),promptWords=pendingJob.checkpoint.core.words.slice();promptWords[157]=255;
assert.equal(importRaw(promptCounter,promptWords),0);assert.equal(promptCounter.party_replacement_decide(0),0);assert.equal(promptCounter.party_get(3),255);
for(const job of [pendingJob,failedJob]) {
  const driver=PursuitDriver.restore(module,resources,job.checkpoint),saved=driver.snapshot();
  for(const choice of [{kind:'move',slot:0},{kind:'run'},{kind:'switch',partyIndex:1},{kind:'replace',partyIndex:0,decisionId:'0'.repeat(64)},
    {kind:'replace',partyIndex:1,decisionId:'0'.repeat(64)}])assert.throws(() => driver.validateChoice(0,choice));
  assert.deepEqual(driver.snapshot(),saved);negatives.push(`pending action fences:${job.id}`);
}
const failed=PursuitDriver.restore(module,resources,failedJob.checkpoint),failedBefore=failed.snapshot();
assert.throws(() => failed.advanceChoices([{actor:0,choice:materialize({kind:'attempt-run'},failedBefore)}]));
assert.throws(() => failed.advanceChoices([{actor:0,choice:materialize({kind:'use-next'},failedBefore)}]));
assert.deepEqual(failed.snapshot(),failedBefore);negatives.push('failed faint escape cannot reroll');
const pending=PursuitDriver.restore(module,resources,pendingJob.checkpoint),stale=materialize({kind:'use-next'},pending.snapshot());
pending.advanceChoices([{actor:0,choice:stale}]);const afterNext=pending.snapshot();
assert.throws(() => pending.advanceChoices([{actor:0,choice:stale}]));assert.deepEqual(pending.snapshot(),afterNext);
const replaceChoice=materialize({kind:'replace',partyIndex:1},afterNext);pending.advanceChoices([{actor:0,choice:replaceChoice}]);const afterReplace=pending.snapshot();
assert.throws(() => pending.advanceChoices([{actor:0,choice:replaceChoice}]));assert.deepEqual(pending.snapshot(),afterReplace);negatives.push('duplicate pending decisions cannot apply twice');
const eventLimit=structuredClone(before);eventLimit.host.eventSequence=Number.MAX_SAFE_INTEGER;eventLimit.host.sequence=1;eventLimit.host.turnActions=1;eventLimit.host.turn=2;
const eventDriver=PursuitDriver.restore(module,resources,eventLimit),eventBefore=eventDriver.snapshot();
assert.throws(() => eventDriver.advanceChoices([{actor:0,choice:{kind:'switch',partyIndex:1}}]));assert.deepEqual(eventDriver.snapshot(),eventBefore);
const originalSnapshot=PursuitDriver.prototype.snapshot;
try {
  PursuitDriver.prototype.snapshot=function() {const c=originalSnapshot.call(this);if(this!==baseline&&c.host.sequence===1)throw new Error('induced candidate-publication failure');return c;};
  assert.throws(() => baseline.advanceChoices([{actor:0,choice:{kind:'switch',partyIndex:1}}]),/induced candidate-publication failure/);
} finally {PursuitDriver.prototype.snapshot=originalSnapshot;}
assert.deepEqual(baseline.snapshot(),before);assertStep(baseline.advanceChoices([{actor:0,choice:{kind:'switch',partyIndex:1}}]),baseline.snapshot(),first.steps[0]!.expected,first.input,'retry after rollback');
const candidateFailureChecks=['event counter overflow after source execution','switch candidate publication failure'];
for(const [id,index]of [['rain-five-turns-repeat-and-recast',0],['rain-five-turns-repeat-and-recast',4],
  ['whirlwind-actor-0-levels-60-60-success-True',0],['charge-last-PP-release-before-Struggle',0],
  ['charge-last-PP-release-before-Struggle',1],['flinch-cancels-charge-second-no-PP-or-accuracy',1],
  ['wild-charge-retained-over-player-pre-residual-recoil-faint',2],['protect-family-7-actor-0',0],
  ['protect-source-four-success-then-ROM-fifth-failure',4],['protect-blocks-PP0-SkullBash-release',1],
  ['protect-then-recoil-faint-records-Struggle-after-cleanup',1],['intercept-critical-1',0],
  ['intercept-KO-gap-30-friendship-200',0],['intercept-KO-then-incoming-residual-prompt-8',0],
  ['intercept-preserves-wild-history-116',1],['intercept-last-PP-next-wild-Struggle',0],
  ['ordinary-Pursuit-blocked-by-Protect',0]] as const) {
  const fixture=fixtures.cases.find(c => c.id===id)!,job=jobs.find(j => j.id===`${id}:${index}`)!;
  const driver=PursuitDriver.restore(module,resources,job.checkpoint),saved=driver.snapshot(),step=fixture.steps[index]!;
  try {
    PursuitDriver.prototype.snapshot=function() {const c=originalSnapshot.call(this);
      if(this!==driver&&c.host.sequence===saved.host.sequence+1)throw new Error('induced charge publication failure');return c;};
    assert.throws(() => driver.advanceChoices([{actor:0,choice:materialize(step.choice,saved)}]),/induced charge publication failure/);
  } finally {PursuitDriver.prototype.snapshot=originalSnapshot;}
  assert.deepEqual(driver.snapshot(),saved,'No charge, weather, PP, forced outcome or RNG publishes after failure');
  assertStep(driver.advanceChoices([{actor:0,choice:materialize(step.choice,saved)}]),driver.snapshot(),step.expected,fixture.input,'retry after charge rollback');
  candidateFailureChecks.push(`${id}:${index} publication failure`);
}
const interleaved=fixtures.cases.filter(c => c.id==='protect-source-four-success-then-ROM-fifth-failure'||c.id==='player-protect-blocks-wild-PP0-release'),peers=interleaved.map(c => new PursuitDriver(module,resources,c.input));
let interleavedTransitions=0;
for(let index=0;index<Math.max(...interleaved.map(c => c.steps.length));index++)for(const [i,fixture]of interleaved.entries()) {
  const step=fixture.steps[index];if(!step)continue;const other=peers[i^1]!.snapshot(),driver=peers[i]!;
  assertStep(driver.advanceChoices([{actor:0,choice:materialize(step.choice,driver.snapshot())}]),driver.snapshot(),step.expected,fixture.input,'interleaved instance');
  assert.deepEqual(peers[i^1]!.snapshot(),other);interleavedTransitions++;
}
const exhaustionInitial=fixtures.cases.find(c => c.id==='single-control-wild-empty-and-zero-pp-retry')!.input;
const exhaustion=JSON.parse(await child(process.execPath,['--import','tsx','tools/battle-pursuit/exhaustion-worker.ts'],JSON.stringify({parentPid:process.pid,
  initial:exhaustionInitial,pending:pendingJob.checkpoint,replacement:failedJob.checkpoint,
  force:fixtures.cases.find(c => c.id==='whirlwind-actor-0-levels-20-100-success-True')!.input,
  rain:fixtures.cases.find(c => c.id==='rain-water-55-species-8-torrent-False')!.input,
  charge:chargeJob.checkpoint,skullInitial:chargeJob.initial,
  wildProtect:jobs.find(j => j.id==='wild-charge-last-PP-release-before-Struggle:1')!.checkpoint,
  protectInitial:policyFixture.input,protectLast:fixtures.cases.find(c => c.id==='protect-last-action-after-voluntary-switch')!.input,
  blocked:fixtures.cases.find(c => c.id==='protect-against-every-move-33')!.input,
  pursuit:fixtures.cases.find(c => c.id==='intercept-critical-1')!.input,
  pursuitKO:fixtures.cases.find(c => c.id==='intercept-KO-gap-30-friendship-200')!.input}),15000)) as {status:string;pid:number;checks:string[]};
assert.equal(exhaustion.status,'passed');assert.notEqual(exhaustion.pid,process.pid);
candidateFailureChecks.push(...exhaustion.checks.filter(c => c.includes('rollback')));
const worker=JSON.parse(await child(process.execPath,['--import','tsx','tools/battle-pursuit/recovery-worker.ts'],JSON.stringify({parentPid:process.pid,jobs,policyTemplate,policy:fixtures.protectPolicy}))) as {
  status:string;pid:number;hostBoundaries:number;rawBoundaries:number;transitions:number;rawTransitions:number;policyChecks:typeof policyChecks};
assert.equal(worker.status,'passed');assert.notEqual(worker.pid,process.pid);assert.equal(worker.hostBoundaries,jobs.length);assert.equal(worker.rawBoundaries,jobs.length);
assert.equal(worker.transitions,replayedTransitions);assert.equal(worker.rawTransitions,replayedRawTransitions);
assert.deepEqual(worker.policyChecks,policyChecks);
const protectPolicyVerification={status:'passed',uniqueThresholdWitnesses:fixtures.protectPolicy.witnesses.length,actionPositions:2,
  resetProbesPerModule:policyChecks.resetCommands,thresholdProbesPerModule:policyChecks.edgeCommands,
  lookupEntriesPerModule:policyChecks.rates,moduleExecutions:3,distinctBuildArtifacts:2,
  contexts:['primary current process','independent rebuild current process','independent rebuild fresh OS process'],
  totalSourceCommandExecutions:(policyChecks.edgeCommands+policyChecks.resetCommands)*3,
  wrapWitnessesPerModule:policyChecks.wrapWitnesses,tableSha256:fixtures.protectPolicy.tableSha256,scope:policyChecks.scope};
for(const [path,hash]of Object.entries(retained))assert.equal(sha(await readRetainedBytes(path)),hash);
const report={checkedAt:new Date().toISOString(),status:'passed',profile:'firered-family-pursuit-v1',wasmSha256:build.wasmSha256,
  fixtureSha256:sha(fixtureBytes),sourceFingerprint:fixtures.sourceFingerprint,independence:fixtures.independence,
  sourceCases:fixtures.cases.length,transitions,checkedDraws,hostBoundaries:jobs.length,rawBoundaries:jobs.length,replayedTransitions,replayedRawTransitions,
  hostRejectionChecks:negatives.length,rawRejectionChecks:rawNegatives.length,candidateFailures:candidateFailureChecks.length,candidateFailureChecks,exhaustion,interleavedTransitions,
  saturationChecks:2,protectPolicy:{...fixtures.protectPolicy,witnesses:undefined,rates:undefined},protectPolicyVerification,policyChecks,negatives,rawNegatives,retained,cases:observations,
  scope:'Private source party diagnostics plus explicitly pinned original-ROM lookup data; no original-ROM execution, authenticated saves, durable ownership or complete 25-move gameplay.'};
await writeFile('reports/battle-pursuit-verification.json',JSON.stringify(report,null,2)+'\n');
await writeFile('reports/battle-pursuit-recovery.json',JSON.stringify({checkedAt:report.checkedAt,status:'passed',wasmSha256:build.wasmSha256,
  crossBuildHostBoundaries:jobs.length,crossBuildRawBoundaries:jobs.length,replayedTransitions,replayedRawTransitions,
  freshProcess:{parentPid:process.pid,...worker},candidateFailures:candidateFailureChecks.length,candidateFailureChecks,exhaustion,
  scope:'Logical recovery and candidate isolation only; no authentication, DB acknowledgement or durable receipt claim.'},null,2)+'\n');
console.log(`Pursuit literals passed: ${fixtures.cases.length} cases, ${transitions} transitions, ${jobs.length} boundaries.`);
