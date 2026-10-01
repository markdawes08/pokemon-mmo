/** Independent literal transport; no production mechanics create expectations. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TacticsCreature,TacticsInitial } from './admission';
import type { TacticsCheckpoint,TacticsChoice,TacticsEvent,TacticsExports } from './driver';
import { checkTrace,monWords as familyMonWords,assertStep as assertFamilyStep,type Trace,type OracleEvent } from '../battle-family/verify-support';
import type { FamilyCheckpoint,FamilyEvent } from '../battle-family/driver';
export { checkTrace };
export const monWords=(mon:TacticsCreature):number[] => familyMonWords(mon);
export interface State {sequence:number;turn:number;phase:string;outcome:string|null;runTries:number;wildSlot:number;
  weather:number;weatherDuration:number;
  rngState:number;rngDraws:number;activeIndex:number;sentMask:number;switchCounter:number;replacementPhase:number;escapeFailed:boolean;
  actors:{hp:number;pp:number[];stages:number[];status:number;status2:number}[];
  party:{hp:number;pp:number[];status:number;friendship:number}[];faints:{partyIndex:number;opponentLevel:number}[]}
export type LiteralChoice={kind:'move';slot:number}|{kind:'struggle'|'run'|'use-next'|'attempt-run'}|{kind:'switch'|'replace';partyIndex:number};
export interface TacticsOracleEvent extends OracleEvent {fromIndex?:number;toIndex?:number;forced?:boolean;partyIndex?:number;resume?:number;escapeFailed?:boolean;weather?:string;turnsRemaining?:number}
export interface Expected {state:State;events:TacticsOracleEvent[];trace:Trace[]}
export interface Step {choice:LiteralChoice;expected:Expected}
export interface Fixture {id:string;input:Extract<TacticsInitial,{kind:'diagnostic'}>;initial:Expected;steps:Step[]}
export interface Fixtures {sourceFingerprint:string;independence:string;cases:Fixture[]}
export interface RecoveryJob {id:string;checkpoint:TacticsCheckpoint;expected:State;initial:Fixture['input'];remaining:Step[]}
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function materialize(choice:LiteralChoice,checkpoint:TacticsCheckpoint):TacticsChoice {
  if(choice.kind==='use-next'||choice.kind==='attempt-run'||choice.kind==='replace') {
    assert(['post-faint','replacement'].includes(checkpoint.host.phase));
    return {...choice,decisionId:createHash('sha256').update(canonical(checkpoint)).digest('hex')} as TacticsChoice;
  }
  return choice as TacticsChoice;
}
export function assertState(checkpoint:TacticsCheckpoint,expected:State,initial:Fixture['input'],label:string):void {
  const {host,core,rng}=checkpoint,w=core.words;
  assert.deepEqual({sequence:host.sequence,turn:host.turn,phase:host.phase,outcome:host.outcome,wildSlot:host.wildSlot},
    {sequence:expected.sequence,turn:expected.turn,phase:expected.phase,outcome:expected.outcome,wildSlot:expected.wildSlot},label);
  assert.deepEqual(rng,{state:expected.rngState,draws:expected.rngDraws},`${label}: source RNG and draw count`);
  assert.equal(w[148],expected.runTries);assert.equal(w[154],initial.player.length);assert.equal(w[155],expected.activeIndex);
  assert.equal(w[156],expected.sentMask);assert.equal(w[157],expected.switchCounter);assert.equal(w[158],expected.replacementPhase);
  assert.equal(w[159],expected.phase==='replacement'?(expected.escapeFailed?2:1):0);
  assert.equal(w[483],expected.weather,`${label}: source weather`);assert.equal(w[484],expected.weatherDuration,`${label}: source weather countdown`);
  for(const [actor,e]of expected.actors.entries()) {
    const at=16+48*actor;
    assert.deepEqual({hp:w[at+1],pp:w.slice(at+26,at+30),stages:w.slice(at+14,at+22),status:w[at+10],status2:w[at+11]},e,`${label}: actor ${actor}`);
  }
  for(let index=0;index<7;index++) {
    if(index>=initial.player.length&&index<6){assert.deepEqual(w.slice(160+index*46,206+index*46),Array(46).fill(0));continue;}
    const mon=structuredClone(index===6?initial.opponent:initial.player[index]!);
    const state=index===6?{...expected.actors[1]!,friendship:initial.opponent.friendship}:expected.party[index]!;
    mon.hp=state.hp;mon.status=state.status as 0;mon.friendship=state.friendship;
    mon.moves.forEach((move,i) => {move.pp=state.pp[i]!;});
    assert.deepEqual(w.slice(160+index*46,206+index*46),monWords(mon),`${label}: every persistent roster word ${index}`);
  }
}
export function assertStep(events:TacticsEvent[],checkpoint:TacticsCheckpoint,expected:Expected,initial:Fixture['input'],label:string):void {
  assertState(checkpoint,expected.state,initial,label);
  assert.equal(events.length,expected.events.length,`${label}: complete event count`);
  for(const [index,e]of expected.events.entries()) {
    const actual=events[index]!;
    if(e.kind==='weather'){assert.deepEqual(actual,{kind:'weather',phase:e.phase,weather:e.weather,turnsRemaining:e.turnsRemaining});continue;}
    if(e.kind==='switch') {assert.deepEqual(actual,{kind:'switch',from:e.fromIndex,to:e.toIndex,forced:e.forced});continue;}
    if(e.kind==='faint-choice') {assert.deepEqual(actual,{kind:'pending-replacement',resume:e.resume===1?'before-residual':'after-residual'});continue;}
    if(e.kind==='replacement-choice') {
      assert.deepEqual(actual,{kind:'replacement-decision',decision:e.escapeFailed?'attempt-run':'use-next',escaped:false});continue;
    }
    if(e.kind==='run'&&e.forced) {
      assert.deepEqual(actual,{kind:'replacement-decision',decision:'attempt-run',escaped:e.success});continue;
    }
    const familyState={...expected.state,phase:expected.state.outcome?'ended':'choice'};
    const familyCheckpoint={...checkpoint,host:{...checkpoint.host,phase:familyState.phase}} as unknown as FamilyCheckpoint;
    assertFamilyStep([actual as FamilyEvent],familyCheckpoint,{state:familyState,events:[e],trace:[]},`${label}: event ${index}`);
  }
}
export function exportRaw(raw:TacticsExports,boundary=0):number[] {
  assert.equal(raw.spike3_checkpoint_export(boundary),0);
  return Array.from({length:512},(_,i) => raw.spike3_checkpoint_get(i)>>>0);
}
export function importRaw(raw:TacticsExports,words:number[]):number {
  assert.equal(raw.spike3_import_begin(6,words[3]!,512),0);
  words.forEach((word,index) => assert.equal(raw.spike3_import_set(index,word),0));return raw.spike3_import_commit();
}
/** Test scheduler starts from raw words only, without admission configuration. */
export function advanceRaw(api:TacticsExports,prior:TacticsCheckpoint,literal:LiteralChoice):{checkpoint:TacticsCheckpoint;events:TacticsEvent[]} {
  const checkpoint=structuredClone(prior),events:TacticsEvent[]=[];
  const ok=(n:number) => assert.equal(n,0,'raw source command succeeds');
  const order=(n:number):(0|1)[] => {assert([0,1,2].includes(n));return n===0?[0,1]:[1,0];};
  const commands=():Extract<TacticsEvent,{kind:'attack'}>['commands'] => {
    ok(api.spike_get_result(0));return Array.from({length:api.spike_get_result(11)},(_,i) => ({type:api.spike_get_event(i,0),
      battler:api.spike_get_event(i,1),value:api.spike_get_event(i,2)>>>0})) as Extract<TacticsEvent,{kind:'attack'}>['commands'];
  };
  const finish=(outcome:'won'|'lost'|'draw'|'ran'|'forced-escape') => {checkpoint.host.phase='ended';checkpoint.host.outcome=outcome;events.push({kind:'outcome',outcome});};
  const faint=(actor:0|1) => {ok(api.party_faint_cleanup(actor));events.push({kind:'faint',actor,commands:commands()});};
  const check=():boolean => {ok(api.party_sync());ok(api.spike2_check_teams_lost());const outcome=api.spike2_get_outcome();
    if(!outcome)return false;assert(outcome>=1&&outcome<=3);finish(({1:'won',2:'lost',3:'draw'} as const)[outcome as 1|2|3]);return true;};
  const pending=(phase:1|2) => {ok(api.party_replacement_begin(phase));checkpoint.host.phase='post-faint';
    events.push({kind:'pending-replacement',resume:phase===1?'before-residual':'after-residual'});};
  const swap=(partyIndex:number,forced:boolean) => {const from=api.party_get(1);ok(api.party_switch(partyIndex,forced?1:0));
    events.push({kind:'switch',from,to:partyIndex,forced});};
  const next=() => {checkpoint.host.turn++;checkpoint.host.phase='choice';ok(api.spike2_begin_turn());
    const slot=api.family_choose_wild();assert(slot>=0&&slot<=4);checkpoint.host.wildSlot=slot;};
  const residual=() => {
    const actors=order(api.party_residual_order());events.push({kind:'order',phase:'residual',actors});
    const hadRain=api.tactics_get(0)!==0;ok(api.tactics_field_end_turn());
    if(hadRain)events.push({kind:'weather',phase:'end-turn',weather:api.tactics_get(0)?'rain':'clear',turnsRemaining:api.tactics_get(1)});
    for(const actor of actors) {
      const status=api.spike_get_battler(actor,3);if(!status||api.spike_get_battler(actor,0)===0)continue;assert(status===8||status===16);
      ok(api.spike2_residual(actor));events.push({kind:'residual',actor,status,commands:commands()});
      if(api.spike_get_battler(actor,0)===0)faint(actor);if(check())return;
    }
    if(api.spike_get_battler(0,0)===0)pending(2);else next();
  };
  if(literal.kind==='use-next'||literal.kind==='attempt-run') {
    checkpoint.host.decisionCount++;const escaped=api.party_replacement_decide(literal.kind==='attempt-run'?1:0);assert(escaped===0||escaped===1);
    events.push({kind:'replacement-decision',decision:literal.kind,escaped:escaped===1});
    if(escaped)finish('ran');else checkpoint.host.phase='replacement';
  } else if(literal.kind==='replace') {
    checkpoint.host.decisionCount++;const resume=api.party_get(4);swap(literal.partyIndex,true);
    if(resume===1)residual();else {assert.equal(resume,2);next();}
  } else {
    checkpoint.host.turnActions++;const slot=literal.kind==='move'?literal.slot:4;
    const actors=order(api.party_order(slot,checkpoint.host.wildSlot,literal.kind==='run'?1:literal.kind==='switch'?2:0));
    events.push({kind:'order',phase:'actions',actors});
    let paused=false;
    for(const actor of actors) {
      if(actor===0&&literal.kind==='switch'){swap(literal.partyIndex,false);continue;}
      if(actor===0&&literal.kind==='run') {
        const escaped=api.family_run(0);assert(escaped===0||escaped===1);events.push({kind:'run',escaped:escaped===1,attempts:api.party_get(6)});
        if(escaped){ok(api.party_sync());finish('ran');paused=true;break;}continue;
      }
      const chosen=actor===0?slot:checkpoint.host.wildSlot,moveId=chosen===4?165:api.spike2_get_move(actor,chosen,0);
      ok(api.spike2_attack(actor,chosen));events.push({kind:'attack',actor,slot:chosen,moveId,result:{baseDamage:api.spike_get_result(1),
        afterCritical:api.spike_get_result(2),afterType:api.spike_get_result(3),damage:api.spike_get_result(4),flags:api.spike_get_result(5),
        hpDealt:api.spike_get_result(6),targetHP:api.spike_get_result(7),critical:api.spike_get_result(12) as 1|2},commands:commands()});
      const attackEvent=events.at(-1)!;assert.equal(attackEvent.kind,'attack');
      if(moveId===240&&attackEvent.kind==='attack'&&!attackEvent.commands.some(c => c.type===9))events.push({kind:'weather',phase:'move',weather:api.tactics_get(0)?'rain':'clear',turnsRemaining:api.tactics_get(1)});
      if(api.spike2_get_outcome()===5){ok(api.party_sync());finish('forced-escape');paused=true;break;}
      for(const who of [actor,actor===0?1:0] as (0|1)[])if(api.spike_get_battler(who,0)===0)faint(who);
      if(check()){paused=true;break;}if(api.spike_get_battler(0,0)===0){pending(1);paused=true;break;}
    }
    if(!paused)residual();
  }
  checkpoint.host.sequence++;checkpoint.host.eventSequence+=events.length;
  checkpoint.core.boundary=checkpoint.host.phase==='choice'?0:checkpoint.host.phase==='ended'?3:api.party_get(4) as 1|2;
  checkpoint.core.words=exportRaw(api,checkpoint.core.boundary);
  checkpoint.rng={state:api.spike_get_rng()>>>0,draws:(api.spike3_get_rng_draws(0)>>>0)+(api.spike3_get_rng_draws(1)>>>0)*0x100000000};
  return {checkpoint,events};
}
