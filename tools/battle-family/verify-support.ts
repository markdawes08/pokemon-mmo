/** Independent literal mapping; no production mechanics supply expectations. */
import assert from 'node:assert/strict';
import type { FamilyCreature, FamilyInitial } from './admission';
import type { FamilyCheckpoint, FamilyChoice, FamilyEvent, FamilyExports } from './driver';
export interface Trace { draw: number; role: string; before: number; value: number; after: number }
export interface State { sequence: number; turn: number; phase: string; outcome: string | null; runTries: number;
  wildSlot: number; rngState: number; rngDraws: number;
  actors: { hp: number; pp: number[]; stages: number[]; status: number; status2: number }[] }
export interface OracleEvent { kind: string; actor?: number; slot?: number; moveId?: number; flags?: number;
  baseDamage?: number; afterCritical?: number; afterType?: number; damage?: number; hpDealt?: number; critical?: number;
  targetHP?: number; cancelled?: boolean; recoil?: number; recoilDealt?: number; phase?: string; actors?: number[];
  success?: boolean; runTries?: number; status?: number; hp?: number; outcome?: string;
  stat?: number; stageBefore?: number; stageAfter?: number; abilityPrevented?: boolean }
export interface Expected { state: State; events: OracleEvent[]; trace: Trace[] }
export interface Step { choice: FamilyChoice; expected: Expected }
export interface Fixture { id: string; input: Extract<FamilyInitial, { kind: 'diagnostic' }>; initial: Expected; steps: Step[] }
export interface Fixtures { sourceFingerprint: string; independence: string; allowedMoves: number[]; unsupportedFamilyMoves: number[]; cases: Fixture[] }
export interface RecoveryJob { id: string; checkpoint: FamilyCheckpoint; expected: State; remaining: Step[] }
export const statKeys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
export function monWords(mon: FamilyCreature): number[] {
  return [mon.speciesId,mon.personality,mon.otId,mon.experience,mon.level,mon.friendship,mon.hp,
    ...statKeys.map(k => mon.stats[k]),...statKeys.map(k => mon.ivs[k]),...statKeys.map(k => mon.evs[k]),
    ...mon.moves.map(m => m.moveId),...mon.moves.map(m => m.pp),mon.moves.reduce((b,m,i) => b | m.ppUps << (i*2),0),
    mon.ballItemId ?? 0xFFFFFFFF,mon.metLocation ?? 0xFFFFFFFF,mon.status,0,0,mon.abilityNum,...statKeys.map(k => mon.calculatedEvs[k])];
}
export function assertState(checkpoint: FamilyCheckpoint, expected: State, label: string): void {
  const { host,core,rng } = checkpoint;
  assert.deepEqual({ sequence:host.sequence,turn:host.turn,phase:host.phase,outcome:host.outcome,wildSlot:host.wildSlot },
    { sequence:expected.sequence,turn:expected.turn,phase:expected.phase,outcome:expected.outcome,wildSlot:expected.wildSlot },label);
  assert.deepEqual(rng,{state:expected.rngState,draws:expected.rngDraws},`${label}: complete source RNG state/count`);
  assert.equal(core.words[148],expected.runTries);
  for(const [actor,e] of expected.actors.entries()) {
    const offset=16+actor*48;
    assert.deepEqual({hp:core.words[offset+1],pp:core.words.slice(offset+26,offset+30),stages:core.words.slice(offset+14,offset+22),
      status:core.words[offset+10],status2:core.words[offset+11]},e,`${label}: actor${actor}`);
  }
}
export function checkTrace(trace: Trace[], initialState: number, initialCount: number): void {
  let state=initialState,count=initialCount;
  for(const draw of trace) {
    assert.equal(draw.before,state);assert.equal(draw.draw,++count);
    state=(Math.imul(state,1103515245)+24691)>>>0;
    assert.equal(draw.after,state);assert.equal(draw.value,state>>>16);
  }
}
export function assertStep(events: FamilyEvent[], checkpoint: FamilyCheckpoint, expected: Expected, label: string): void {
  assertState(checkpoint,expected.state,label);
  assert.equal(events.length,expected.events.length,`${label}: complete logical event count`);
  for(const [i,e] of expected.events.entries()) {
    const actual=events[i]!;
    if(e.kind==='order') { assert.deepEqual(actual,{kind:'order',phase:e.phase,actors:e.actors});continue; }
    if(e.kind==='outcome') { assert.deepEqual(actual,{kind:'outcome',outcome:e.outcome});continue; }
    if(e.kind==='run') { assert.deepEqual(actual,{kind:'run',escaped:e.success,attempts:e.runTries});continue; }
    if(e.kind==='faint') { assert.equal(actual.kind,'faint');if(actual.kind==='faint')assert.equal(actual.actor,e.actor);continue; }
    if(e.kind==='residual') {
      assert.equal(actual.kind,'residual');
      if(actual.kind==='residual') {
        assert.equal(actual.actor,e.actor);
        assert(actual.commands.some(c => c.type===1 && c.battler===e.actor && c.value===e.damage));
        assert(actual.commands.some(c => c.type===2 && c.battler===e.actor && c.value===e.hp));
      }
      continue;
    }
    assert.equal(actual.kind,'attack');if(actual.kind!=='attack')throw new Error(`${label}: absent attack`);
    assert.equal(actual.actor,e.actor);assert.equal(actual.slot,e.slot);assert.equal(actual.moveId,e.moveId);
    for(const key of ['flags','baseDamage','afterCritical','afterType','damage','hpDealt','critical'] as const)
      assert.equal(actual.result[key],e[key],`${label}: actor${e.actor} ${key}`);
    if(e.damage)assert.equal(actual.result.targetHP,e.targetHP);
    if(e.cancelled) {
      assert(actual.commands.some(c => c.type===9 && c.battler===e.actor && c.value===1));
      assert(!actual.commands.some(c => c.type===3),'Flinched action spends no PP');
    } else if(e.slot!==4) assert.equal(actual.commands.filter(c => c.type===3 && c.battler===e.actor).length,1);
    if(e.recoil)assert(actual.commands.some(c => c.type===1 && c.battler===e.actor && c.value===e.recoil));
  }
}
export function exportRaw(raw: FamilyExports, boundary=0): number[] {
  assert.equal(raw.spike3_checkpoint_export(boundary),0);
  return Array.from({length:154},(_,i) => raw.spike3_checkpoint_get(i)>>>0);
}
export function importRaw(raw: FamilyExports, words: number[]): number {
  assert.equal(raw.spike3_import_begin(4,words[3]!,154),0);
  words.forEach((w,i) => assert.equal(raw.spike3_import_set(i,w),0));
  return raw.spike3_import_commit();
}
/** Test scheduler only: every mechanic/RNG/state change is a source export.
 * Crucially this starts after raw import without reconfiguring admitted mons. */
export function advanceRaw(api: FamilyExports, prior: FamilyCheckpoint, choice: FamilyChoice): {checkpoint:FamilyCheckpoint;events:FamilyEvent[]} {
  const checkpoint=structuredClone(prior),events:FamilyEvent[]=[];
  const ok=(value:number) => assert.equal(value,0,'raw source command succeeds');
  const order=(value:number): (0|1)[] => {assert([0,1,2].includes(value));return value===0?[0,1]:[1,0];};
  const commands=(): Extract<FamilyEvent,{kind:'attack'}>['commands'] => {
    ok(api.spike_get_result(0));
    return Array.from({length:api.spike_get_result(11)},(_,i) => ({type:api.spike_get_event(i,0),battler:api.spike_get_event(i,1),
      value:api.spike_get_event(i,2)>>>0})) as Extract<FamilyEvent,{kind:'attack'}>['commands'];
  };
  const finish=(outcome:'won'|'lost'|'draw'|'ran') => {checkpoint.host.phase='ended';checkpoint.host.outcome=outcome;events.push({kind:'outcome',outcome});};
  const faint=(actor:0|1) => {ok(api.spike2_faint_cleanup(actor));events.push({kind:'faint',actor,commands:commands()});};
  const checkOutcome=():boolean => {
    for(const actor of [0,1] as const)for(let slot=0;slot<6;slot++)
      ok(api.spike2_set_party(actor,slot,slot===0?api.spike_get_battler(actor,8):0,slot===0?api.spike_get_battler(actor,0):0,0));
    ok(api.spike2_check_teams_lost());const outcome=api.spike2_get_outcome();
    if(outcome){assert(outcome>=1&&outcome<=3);finish(({1:'won',2:'lost',3:'draw'} as const)[outcome as 1|2|3]);return true;}return false;
  };
  const playerSlot=choice.kind==='move'?choice.slot:4;
  const actionOrder=order(api.family_order(playerSlot,checkpoint.host.wildSlot,choice.kind==='run'?1:0));
  events.push({kind:'order',phase:'actions',actors:actionOrder});
  for(const actor of actionOrder) {
    if(actor===0&&choice.kind==='run') {
      const escaped=api.family_run(0);assert(escaped===0||escaped===1);
      events.push({kind:'run',escaped:escaped===1,attempts:api.family_get(0)});
      if(escaped){finish('ran');break;}continue;
    }
    const slot=actor===0?playerSlot:checkpoint.host.wildSlot,moveId=slot===4?165:api.spike2_get_move(actor,slot,0);
    ok(api.spike2_attack(actor,slot));events.push({kind:'attack',actor,slot,moveId,result:{baseDamage:api.spike_get_result(1),
      afterCritical:api.spike_get_result(2),afterType:api.spike_get_result(3),damage:api.spike_get_result(4),flags:api.spike_get_result(5),
      hpDealt:api.spike_get_result(6),targetHP:api.spike_get_result(7),critical:api.spike_get_result(12) as 1|2},commands:commands()});
    for(const who of [actor,actor===0?1:0] as (0|1)[])if(api.spike_get_battler(who,0)===0)faint(who);
    if(checkOutcome())break;
  }
  if(checkpoint.host.phase==='choice') {
    const residualOrder=order(api.spike2_residual_order());events.push({kind:'order',phase:'residual',actors:residualOrder});
    for(const actor of residualOrder) {
      const status=api.spike_get_battler(actor,3);if(!status)continue;assert(status===8||status===16);
      ok(api.spike2_residual(actor));events.push({kind:'residual',actor,status,commands:commands()});
      if(api.spike_get_battler(actor,0)===0)faint(actor);
      if(checkOutcome())break;
    }
    if(checkpoint.host.phase==='choice') {
      checkpoint.host.turn++;ok(api.spike2_begin_turn());const wild=api.family_choose_wild();assert(wild>=0&&wild<=4);checkpoint.host.wildSlot=wild;
    }
  }
  checkpoint.host.sequence++;checkpoint.host.eventSequence+=events.length;
  checkpoint.core.boundary=checkpoint.host.phase==='choice'?0:3;checkpoint.core.words=exportRaw(api,checkpoint.core.boundary);
  checkpoint.rng={state:api.spike_get_rng()>>>0,draws:(api.spike3_get_rng_draws(0)>>>0)+(api.spike3_get_rng_draws(1)>>>0)*0x100000000};
  return {checkpoint,events};
}
