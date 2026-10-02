/** Full byte-counter command-domain diagnostics, not whole-game reachability. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { instantiatePursuit,type PursuitCheckpoint } from './driver';
import { importRaw,type Fixtures } from './verify-support';
type Policy=Fixtures['protectPolicy'];
const previous=(state:number):number => Math.imul((state-24691)>>>0,0xeeb9eb65)>>>0;
export function verifyPolicy(module:WebAssembly.Module,template:PursuitCheckpoint,policy:Policy):{
  rates:number;edgeCommands:number;resetCommands:number;wrapWitnesses:number;scope:string;
} {
  const reader=instantiatePursuit(module),bytes=Buffer.alloc(512);
  for(let i=0;i<256;i++){const rate=reader.protect_rate(i);assert.equal(rate,policy.rates[i]);bytes.writeUInt16LE(rate,i*2);}
  assert.equal(createHash('sha256').update(bytes).digest('hex'),policy.tableSha256);
  assert.equal(reader.protect_rate(256),-1);assert.equal(reader.protect_rate(0xffffffff),-1);
  let edgeCommands=0,resetCommands=0,wrapWitnesses=0;
  function attempt(counter:number,roll:number,actor:0|1,prior:number,expectedSuccess:boolean,expectedCounter:number):void {
    const raw=instantiatePursuit(module),w=template.core.words.slice(),offset=16+actor*48;
    w[491]=w[492]=0;w[493]=w[494]=0;w[59]=w[107]=0;
    w[491+actor]=counter;w[offset+43]=prior;
    // Raw command-domain state intentionally need not prove 255 prior successes.
    // Four past draws are algebraically valid; next source Random is exact roll.
    const desired=(roll*0x10000)>>>0,at=previous(desired);let seed=at;
    for(let i=0;i<4;i++)seed=previous(seed);
    w[4]=at;w[5]=4;w[6]=0;w[14]=seed;
    assert.equal(importRaw(raw,w),0,`raw policy counter ${counter}, roll ${roll}, actor ${actor}`);
    assert.equal(raw.party_order(0,0,0),0,'Blastoise Protect precedes slower Squirtle Protect without a tie draw');
    const beforePP=raw.spike2_get_move(actor,0,1);
    assert.equal(raw.spike2_attack(actor,0),0);
    assert.equal(raw.spike_get_rng()>>>0,desired);assert.equal(raw.spike3_get_rng_draws(0),5);
    assert.equal(raw.protect_get(actor,0),Number(expectedSuccess));assert.equal(raw.protect_get(actor,1),expectedCounter);
    assert.equal(raw.spike2_get_move(actor,0,1),beforePP-1);
    assert.equal(raw.spike_get_result(5),expectedSuccess?0:1,'Source Protect failure flag is MISSED');
    assert.equal(raw.protect_move_end(actor),0);assert.equal(raw.protect_get(actor,2),182);
    if(counter===255&&prior===182&&expectedSuccess){assert.equal(expectedCounter,0);wrapWitnesses++;}
  }
  for(const witness of policy.witnesses) {
    attempt(witness.counter,witness.roll,0,182,witness.firstSuccess,witness.firstCounter);
    attempt(witness.counter,witness.roll,1,182,witness.lastSuccess,witness.lastCounter);
    edgeCommands+=2;
  }
  for(let counter=0;counter<256;counter++) {
    // Reset is evaluated before indexing, while last-action failure still draws.
    attempt(counter,65535,0,0,true,1);attempt(counter,65535,1,65535,false,0);resetCommands+=2;
  }
  return {rates:256,edgeCommands,resetCommands,wrapWitnesses,
    scope:'Direct raw command-domain threshold, last-action, reset and byte-wrap evidence; not naturally reachable full-battle histories or original-ROM execution.'};
}
