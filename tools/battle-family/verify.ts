/** Independent source literals, rejection/isolation and portable continuation. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { loadFamilyResources,type FamilyInitial } from './admission';
import { FamilyDriver,instantiateFamily,type FamilyCheckpoint } from './driver';
import { loadFamilyModule } from './engine';
import { advanceRaw,assertState,assertStep,checkTrace,exportRaw,importRaw,monWords,type Fixtures,type RecoveryJob } from './verify-support';
async function child(command:string,args:string[],input='',timeout=120000):Promise<string> {
  return new Promise((resolve,reject) => {
    const owned=spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',expired=false;
    const timer=setTimeout(() => {expired=true;owned.kill();},timeout);
    owned.stdout.on('data',data => {stdout+=String(data);});owned.stderr.on('data',data => {stderr+=String(data);});
    owned.once('error',error => {clearTimeout(timer);reject(error);});
    owned.once('exit',code => {clearTimeout(timer);if(code===0&&!expired)resolve(stdout);
      else reject(new Error(`Owned family verifier child ${expired?'timed out':`exited ${code}`}: ${stderr}`));});
    owned.stdin.on('error',error => {if(!expired)reject(error);});owned.stdin.end(input);
  });
}
const sha=(bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await child('.venv/Scripts/python.exe',['tools/battle-family/fixtures/generate_fixtures.py','--check']);
const fixtureBytes=await readFile('tools/battle-family/fixtures/source-cases.json'),fixtures=JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
const [module,rebuildBytes,resources]=await Promise.all([loadFamilyModule(),readFile('.local/battle-family/rebuild/family.wasm'),loadFamilyResources()]);
const rebuild=new WebAssembly.Module(rebuildBytes),build=JSON.parse(await readFile('reports/battle-family-build.json','utf8')) as {wasmSha256:string};
assert.equal(sha(rebuildBytes),build.wasmSha256);assert.equal(new Set(fixtures.cases.map(c => c.id)).size,fixtures.cases.length);
const retained={
  'tools/battle-route1/fixtures/source-cases.json':'6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json':'1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json':'23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  'tools/battle-loss/fixtures/source-cases.json':'dbfe309e1a8ce56fdf691710858785756f910c3502c926935112632c5d93cd1b',
  'tools/battle-capture/fixtures/source-cases.json':'47a4b1ebf06bfc055a25fd119834f76c4f4243afe6ceddb5ac49c968e37c8c3c',
  'tools/battle-evolution/fixtures/source-cases.json':'9e629febd8845dc6e281164f6ee93ff964dab6d11f186754832ac19002307c8f',
  '.local/battle-spike/primary/probe.wasm':'3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm':'8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-route1/primary/route1.wasm':'6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-progression/primary/progression.wasm':'33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  '.local/battle-loss/primary/loss.wasm':'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
  '.local/battle-capture/primary/capture.wasm':'1e6b16390cdaa4906c01b391c30984735a22e998f548e9ff7de44d890865a60b',
  '.local/battle-evolution/primary/evolution.wasm':'1585f15e7aef6a5ed952cbf3f17041d5382163e39f51c3b1ed3ac65f41495c5c',
};
for(const [path,hash]of Object.entries(retained))assert.equal(sha(await readFile(path)),hash,`Retained ${path}`);
const jobs:RecoveryJob[]=[],observations=[];
let turns=0,checkedDraws=0,replayedTransitions=0,replayedRawTransitions=0;
for(const fixture of fixtures.cases) {
  const initial=structuredClone(fixture.input),driver=new FamilyDriver(module,resources,initial);
  assertState(driver.snapshot(),fixture.initial.state,`${fixture.id}:initial`);
  checkTrace(fixture.initial.trace,fixture.input.seed,0);checkedDraws+=fixture.initial.trace.length;
  for(let index=0;index<=fixture.steps.length;index++) {
    const checkpoint=driver.snapshot(),expected=index===0?fixture.initial.state:fixture.steps[index-1]!.expected.state;
    assertState(checkpoint,expected,`${fixture.id}:boundary${index}`);
    const recovered=FamilyDriver.restore(rebuild,resources,checkpoint);assert.deepEqual(recovered.snapshot(),checkpoint);
    const raw=instantiateFamily(rebuild);assert.equal(importRaw(raw,checkpoint.core.words),0);
    assert.deepEqual(exportRaw(raw,checkpoint.core.boundary),checkpoint.core.words);
    let rawCheckpoint=structuredClone(checkpoint);
    jobs.push({id:`${fixture.id}:${index}`,checkpoint:structuredClone(checkpoint),expected,remaining:fixture.steps.slice(index)});
    for(const [i,step]of fixture.steps.slice(index).entries()) {
      const events=recovered.advanceChoices([{actor:0,choice:step.choice}]);
      assertStep(events,recovered.snapshot(),step.expected,`${fixture.id}:cross-build${index}+${i}`);replayedTransitions++;
      const rawNext=advanceRaw(raw,rawCheckpoint,step.choice);rawCheckpoint=rawNext.checkpoint;
      assertStep(rawNext.events,rawCheckpoint,step.expected,`${fixture.id}:raw-cross-build${index}+${i}`);
      assert.deepEqual(rawCheckpoint,recovered.snapshot(),`${fixture.id}: raw future state has every required field`);replayedRawTransitions++;
    }
    const detached=driver.snapshot();detached.core.words[17]=65535;detached.host.wildSlot=9;
    assert.deepEqual(driver.snapshot(),checkpoint);assert.throws(() => driver.project(1));
    const projected=driver.project(0);assert.equal(projected.liveAdmission,false);assert.equal(projected.inventory,null);
    for(const key of ['admission','context','rng','words','origin'])assert(!Object.hasOwn(projected,key));
    for(const key of ['ivs','evs','stats','personality','otId','moves','wildSlot','abilityId'])assert(!Object.hasOwn(projected.opponent,key));
    if(index===fixture.steps.length)break;
    const step=fixture.steps[index]!;checkTrace(step.expected.trace,checkpoint.rng.state,checkpoint.rng.draws);checkedDraws+=step.expected.trace.length;
    const events=driver.advanceChoices([{actor:0,choice:step.choice}]);
    assertStep(events,driver.snapshot(),step.expected,`${fixture.id}:turn${index}`);turns++;
  }
  assert.deepEqual(initial,fixture.input);
  if(driver.snapshot().host.phase==='ended') {
    const before=driver.snapshot();assert.throws(() => driver.advanceChoices([{actor:0,choice:{kind:'run'}}]));assert.deepEqual(driver.snapshot(),before);
  }
  observations.push({id:fixture.id,status:'passed',turns:fixture.steps.length,outcome:driver.snapshot().host.outcome,draws:driver.snapshot().rng.draws});
}
const first=fixtures.cases.find(c => c.id==='move-33-source')!,baseline=new FamilyDriver(module,resources,first.input),before=baseline.snapshot();
const negatives:string[]=[],rawNegatives:string[]=[];
const pair=fixtures.cases.slice(0,2),peers=pair.map(row => new FamilyDriver(module,resources,row.input));let interleavedTransitions=0;
for(let i=0;i<Math.max(...pair.map(row => row.steps.length));i++)for(const [actor,row]of pair.entries()) {
  const step=row.steps[i];if(!step)continue;const other=peers[actor^1]!.snapshot();
  assertStep(peers[actor]!.advanceChoices([{actor:0,choice:step.choice}]),peers[actor]!.snapshot(),step.expected,`${row.id}:interleaved`);
  assert.deepEqual(peers[actor^1]!.snapshot(),other);interleavedTransitions++;
}
function badInput(name:string,edit:(input:Extract<FamilyInitial,{kind:'diagnostic'}>) => void):void {
  const input=structuredClone(first.input);edit(input);assert.throws(() => new FamilyDriver(module,resources,input),name);
  assert.deepEqual(baseline.snapshot(),before);negatives.push(`input:${name}`);
}
const unsupportedOwners:Record<number,number>={18:16,119:16,130:7,162:19,182:7,228:19,229:7,240:7,283:19};
for(const move of fixtures.unsupportedFamilyMoves)badInput(`whole unsupported moveset ${move}`,input => {
  const source=fixtures.cases.find(c => c.id===`level-boundary-${unsupportedOwners[move]}-100`)!;
  input.player=structuredClone(source.input.player);input.player.moves[1]={moveId:move,pp:1,ppUps:0};
});
for(const value of [1,2,4,24,32,64,128,0xFFFFFFFF])badInput(`unsupported major status ${value}`,x => {x.player.status=value as 0;});
badInput('foreign species',x => {x.player.speciesId=1 as 7;});
badInput('wrong ability',x => {x.player.abilityId=51 as 67;});
badInput('wrong cached stat',x => {x.player.stats.attack++;});
badInput('wide HP',x => {x.player.hp=65536;});badInput('fainted admission',x => {x.player.hp=0;});
badInput('level zero',x => {x.player.level=0;});badInput('level 101',x => {x.player.level=101;});
badInput('XP level mismatch',x => {x.player.experience=0;});badInput('foreign level-up move',x => {x.player.moves[1]={moveId:97,pp:1,ppUps:0};});
badInput('PP overflow',x => {x.player.moves[0]!.pp=255;});badInput('PP Ups overflow',x => {x.player.moves[0]!.ppUps=4;});
badInput('empty PP bonus',x => {x.player.moves[3]!.ppUps=1;});badInput('empty PP',x => {x.player.moves[3]!.pp=1;});
badInput('duplicate move',x => {x.player.moves[1]=structuredClone(x.player.moves[0]!);});
badInput('IV cap',x => {x.player.ivs.hp=32;});badInput('EV cap',x => {x.player.evs.hp=256;});
badInput('EV total',x => {x.player.evs.hp=255;x.player.evs.attack=255;x.player.evs.speed=1;});
badInput('stat basis exceeds EV',x => {x.player.calculatedEvs.hp=1;});
badInput('held item',x => {x.player.heldItemId=195 as 0;});
badInput('weather injection',x => Object.assign(x,{weather:1}));badInput('hidden bench injection',x => Object.assign(x,{party:[x.player]}));
for(const choice of [{kind:'move',slot:1},{kind:'move',slot:4},{kind:'move',slot:-1},{kind:'struggle'},
  {kind:'move',slot:0,seed:1},{kind:'item',itemId:13},{kind:'item',itemId:4},{kind:'switch',slot:1}]) {
  assert.throws(() => baseline.validateChoice(0,choice));assert.deepEqual(baseline.snapshot(),before);negatives.push(`choice:${JSON.stringify(choice)}`);
}
assert.throws(() => baseline.validateChoice(1,{kind:'move',slot:0}));assert.throws(() => baseline.advanceChoices([]));
assert.throws(() => baseline.advanceChoices([{actor:1,choice:{kind:'run'}}]));assert.deepEqual(baseline.snapshot(),before);
negatives.push('foreign/empty actor actions');
function badCheckpoint(name:string,edit:(copy:FamilyCheckpoint) => void):void {
  const copy=structuredClone(before);edit(copy);assert.throws(() => FamilyDriver.restore(module,resources,copy),name);
  assert.deepEqual(baseline.snapshot(),before);negatives.push(`checkpoint:${name}`);
}
for(const [name,index,value]of [['version',1,3],['reserved',15,1],['missing intro',149,0],['capture outcome',150,4],['run byte',148,256],
  ['species',46,19],['ability',47,51],['unsupported flinch at choice',27,8],['unsupported volatile',27,1],['unlearned focus',27,0x100000],
  ['status replacement',26,8],['speed stage OOB',33,13],['unsupported special stage',34,7],['PP replenishment',42,36],
  ['PP bonus mismatch',152,1],['hidden bench species',115,7],['party HP mismatch',113,1],['source HP widened',17,65536]] as const)
  badCheckpoint(name,x => {x.core.words[index]=value;});
badCheckpoint('RNG state',x => {x.rng.state^=1;x.core.words[4]=x.rng.state;});
badCheckpoint('RNG count',x => {x.rng.draws++;x.core.words[5]++;});
badCheckpoint('source fingerprint',x => {Object.assign(x,{sourceFingerprint:'0'.repeat(64)});});
badCheckpoint('pending AI invalid',x => {x.host.wildSlot=4;});badCheckpoint('host turn',x => {x.host.turn++;});
badCheckpoint('spent initial PP',x => {x.core.words[42]!--;});badCheckpoint('changed retained bag',x => {x.context.inventory={potion:5,pokeBall:5};});
badCheckpoint('live provenance',x => Object.assign(x.context,{liveAdmission:true}));

const raw=instantiateFamily(module);assert.equal(importRaw(raw,before.core.words),0);const rawBefore=exportRaw(raw);
for(const [name,index,value]of [['version',1,3],['reserved',15,1],['flinch at boundary',27,8],['unavailable status',26,4],
  ['invalid ability',47,255],['foreign species',46,1],['unknown move',38,355],['PP maximum',42,255],['PP bonus byte',152,256],
  ['source stage',30,13],['capture marker',150,4],['unsupported stage',34,7],['active party species',112,19],
  ['active party HP',113,1],['hidden party member',115,7],['hidden party HP',116,1],['hidden opponent member',133,7]] as const) {
  const words=rawBefore.slice();words[index]=value;assert.notEqual(importRaw(raw,words),0,name);
  assert.deepEqual(exportRaw(raw),rawBefore,`${name}: atomic raw import`);rawNegatives.push(name);
}
for(const kind of ['duplicate','out-of-range','incomplete'] as const) {
  assert.equal(raw.spike3_import_begin(4,0,154),0);
  rawBefore.slice(0,kind==='incomplete'?153:154).forEach((w,i) => assert.equal(raw.spike3_import_set(i,w),0));
  if(kind!=='incomplete')assert.notEqual(raw.spike3_import_set(kind==='duplicate'?0:154,1),0);
  assert.notEqual(raw.spike3_import_commit(),0);assert.deepEqual(exportRaw(raw),rawBefore);rawNegatives.push(`import staging:${kind}`);
}
for(const [name,index,value]of [['foreign species',0,1],['wide stat',7,65536],['illegal status',36,128],['unsupported move',25,229],
  ['bad XP',3,0],['wrong cached stat',8,1],['bad source ability',39,1],['IV cap',13,32],['EV cap',19,256],['PP cap',29,255],
  ['PP bonus cap',33,256],['held item',37,195],['Pokerus',38,1],['invalid basis',40,1]] as const) {
  const candidate=instantiateFamily(module);assert.equal(candidate.spike_reset(1),0);const words=monWords(first.input.player);words[index]=value;
  assert.equal(candidate.family_input_begin(0),0);words.forEach((w,i) => assert.equal(candidate.family_input_set(0,i,w),0));
  assert.notEqual(candidate.family_input_commit(0),0,name);assert.equal(candidate.spike_get_battler(0,0),0);rawNegatives.push(`creature:${name}`);
}
for(const kind of ['duplicate','out-of-range','incomplete'] as const) {
  const candidate=instantiateFamily(module);assert.equal(candidate.spike_reset(1),0);const words=monWords(first.input.player);
  assert.equal(candidate.family_input_begin(0),0);words.slice(0,kind==='incomplete'?45:46).forEach((w,i) => assert.equal(candidate.family_input_set(0,i,w),0));
  if(kind!=='incomplete')assert.notEqual(candidate.family_input_set(0,kind==='duplicate'?0:46,1),0);
  assert.notEqual(candidate.family_input_commit(0),0);assert.equal(candidate.spike_get_battler(0,0),0);rawNegatives.push(`creature staging:${kind}`);
}
const eventLimit=structuredClone(before);eventLimit.host.eventSequence=Number.MAX_SAFE_INTEGER;eventLimit.host.sequence=1;eventLimit.host.turn=2;
const eventDriver=FamilyDriver.restore(module,resources,eventLimit),eventBefore=eventDriver.snapshot();
assert.throws(() => eventDriver.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]));assert.deepEqual(eventDriver.snapshot(),eventBefore);
const originalSnapshot=FamilyDriver.prototype.snapshot;
try {
  FamilyDriver.prototype.snapshot=function() {
    const checkpoint=originalSnapshot.call(this);
    if(this!==baseline&&checkpoint.host.sequence===before.host.sequence+1)throw new Error('induced candidate-publication failure');
    return checkpoint;
  };
  assert.throws(() => baseline.advanceChoices([{actor:0,choice:{kind:'move',slot:0}}]),/induced candidate-publication failure/);
} finally {FamilyDriver.prototype.snapshot=originalSnapshot;}
assert.deepEqual(baseline.snapshot(),before);
assertStep(baseline.advanceChoices([{actor:0,choice:first.steps[0]!.choice}]),baseline.snapshot(),first.steps[0]!.expected,'retry after candidate failure');
const exhaustionFixture=fixtures.cases.find(c => c.id==='wild-empty-and-zero-pp-retry')!;
const exhaustion=JSON.parse(await child(process.execPath,['--import','tsx','tools/battle-family/exhaustion-worker.ts'],
  JSON.stringify({parentPid:process.pid,initial:exhaustionFixture.input}),15000)) as {status:string;pid:number;checks:string[]};
assert.equal(exhaustion.status,'passed');assert.notEqual(exhaustion.pid,process.pid);
const worker=JSON.parse(await child(process.execPath,['--import','tsx','tools/battle-family/recovery-worker.ts'],JSON.stringify({parentPid:process.pid,jobs}))) as {
  status:string;pid:number;hostBoundaries:number;rawBoundaries:number;transitions:number;rawTransitions:number};
assert.equal(worker.status,'passed');assert.notEqual(worker.pid,process.pid);assert.equal(worker.hostBoundaries,jobs.length);
assert.equal(worker.rawBoundaries,jobs.length);assert.equal(worker.transitions,replayedTransitions);
assert.equal(worker.rawTransitions,replayedRawTransitions);
for(const [path,hash]of Object.entries(retained))assert.equal(sha(await readFile(path)),hash);
const report={checkedAt:new Date().toISOString(),status:'passed',profile:'firered-family-singles-v1',wasmSha256:build.wasmSha256,
  fixtureSha256:sha(fixtureBytes),sourceFingerprint:fixtures.sourceFingerprint,independence:fixtures.independence,
  sourceCases:fixtures.cases.length,turns,checkedDraws,hostBoundaries:jobs.length,rawBoundaries:jobs.length,replayedTransitions,replayedRawTransitions,interleavedTransitions,
  hostRejectionChecks:negatives.length,rawRejectionChecks:rawNegatives.length,candidateFailures:3,exhaustion,retained,negatives,rawNegatives,cases:observations,
  scope:'Private sixteen-move diagnostics only. No complete family closure, live admission, owned application, original-ROM timing, items or switching.'};
await writeFile('reports/battle-family-verification.json',JSON.stringify(report,null,2)+'\n');
await writeFile('reports/battle-family-recovery.json',JSON.stringify({checkedAt:report.checkedAt,status:'passed',wasmSha256:build.wasmSha256,
  crossBuildHostBoundaries:jobs.length,crossBuildRawBoundaries:jobs.length,replayedTransitions,replayedRawTransitions,freshProcess:{parentPid:process.pid,...worker},
  candidateFailures:3,exhaustion,scope:'Logical source state is not authentication or a durable receipt. Counter-exhaustion diagnostics do not assert reachable history.'},null,2)+'\n');
console.log(`Family verification passed: ${fixtures.cases.length} cases, ${turns} turns, ${checkedDraws} draws, ${jobs.length} recovered boundaries.`);
