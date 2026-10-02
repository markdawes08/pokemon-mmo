"""Independent source-script Pursuit oracle; no production-generated expectations.

Ordinary EffectHit and ActionSwitch/PursuitDmgOnSwitchOut are distinct scripts.
The latter skips accuracy/canceller/secondary, multiplies AFTER base damage +2,
and returns to the already selected switch even if the outgoing mon faints.
"""
from __future__ import annotations
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
TARGET=Path(__file__).with_name("source-cases.json")
spec=importlib.util.spec_from_file_location("independent_protect",ROOT/"tools/battle-protect/fixtures/generate_fixtures.py")
protect=importlib.util.module_from_spec(spec);spec.loader.exec_module(protect)
family=protect.family;creature=protect.creature
MOVE,RUN,STRUGGLE,NEXT,ESCAPE,CONTINUE=protect.MOVE,protect.RUN,protect.STRUGGLE,protect.NEXT,protect.ESCAPE,protect.CONTINUE
switch,replace=protect.switch,protect.replace
family.MOVES[228]=(40,100,17,0,0,"hit")

class Oracle(protect.Oracle):
    def advance(self,choice):
        if (self.phase!="choice" or choice["kind"]!="switch" or self.wild_slot==4
                or self.actors[1]["moves"][self.wild_slot]["moveId"]!=228):
            return super().advance(choice)
        assert not self.outcome and not self.actors[0]["status2"]&protect.charge.MULTIPLE
        index=choice["partyIndex"]
        assert index!=self.active and self.party[index]["hp"]>0
        self.events=[];self.trace=[];self.no_valid=[False,False]
        self.chosen_slots=[None,self.wild_slot];self.remembered_slots[1]=self.wild_slot
        self.events.append(dict(kind="order",phase="actions",actors=[0,1]))
        self.events.append(dict(kind="pursuit-intercept",actor=1,fromIndex=self.active,toIndex=index))
        a,t=self.actors[1],self.actors[0]
        a["moves"][self.wild_slot]["pp"]-=1
        critical=2 if self.draw("actor1-critical")%(4 if a["status2"]&family.FOCUS else 16)==0 else 1
        # Gen3 Dark is special. No admitted species has Dark STAB/resistance.
        attack,defense=a["stats"]["spAttack"],t["stats"]["spDefense"]
        if not(critical==2 and a["stages"][4]<=6):
            n,d=family.RATIOS[a["stages"][4]];attack=attack*n//d
        if not(critical==2 and t["stages"][5]>=6):
            n,d=family.RATIOS[t["stages"][5]];defense=defense*n//d
        base=attack*40*(2*a["level"]//5+2)//defense//50+2
        after=base*critical*2
        damage=max(1,after*(100-self.draw("actor1-variance")%16)//100)
        dealt=min(damage,t["hp"]);t["hp"]-=dealt
        self.events.append(dict(kind="move",actor=1,slot=self.wild_slot,moveId=228,flags=0,
            baseDamage=base,afterCritical=after,afterType=after,damage=damage,hpDealt=dealt,
            critical=critical,recoil=0,recoilDealt=0,cancelled=False,targetHP=t["hp"],intercept=True))
        if t["hp"]==0:self.faint(0)
        # Limited move-end ends before UPDATE_LAST_MOVES. Keep wild history.
        self.load(index,False)
        self.residual();self.sequence+=1
        return dict(state=self.summary(),events=deepcopy(self.events),trace=deepcopy(self.trace))

def transcript(seed,player,opponent,choices):
    initial=dict(kind="diagnostic",seed=seed,player=[deepcopy(mon) for mon in player],opponent=deepcopy(opponent));o=Oracle(initial)
    row=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        row["steps"].append(dict(choice=deepcopy(choice),expected=o.advance(choice)))
    return row

def fixtures():
    cases=[]
    def add(name,player,wild,choices,seed=0,predicate=None,limit=20000):
        for candidate in range(seed,seed+limit if predicate else seed+1):
            row=transcript(candidate,player,wild,choices)
            if predicate is None or predicate(row):cases.append(dict(id=name,**row));return row
        raise AssertionError("No independent Pursuit witness: "+name)
    def moves(row):return [e for s in row["steps"] for e in s["expected"]["events"] if e["kind"]=="move"]
    controls=protect.fixtures()
    for old in controls["cases"]:
        add(old["id"],old["input"]["player"],old["input"]["opponent"],[s["choice"] for s in old["steps"]],old["input"]["seed"])
    passive=creature(9,100,[110])
    for species,level in [(19,27),(20,30)]:
        for actor in [0,1]:
            mon=creature(species,level,[228])
            add(f"pursuit-first-source-level-{species}-actor-{actor}",[mon if actor==0 else passive],passive if actor==0 else mon,[MOVE]*2)
        for slot in range(4):
            ids=[33,39,116,98];ids[slot]=228
            for ups in range(4):
                mon=creature(species,50,ids,ups=[ups]*4)
                add(f"intercept-{species}-slot-{slot}-PPups-{ups}",[passive,passive],mon,[switch(1)],
                    predicate=lambda r,slot=slot:r["initial"]["state"]["wildSlot"]==slot)
    for nature in range(25):
        add(f"intercept-special-nature-{nature}",[creature(7,70,[110],personality=nature),passive],creature(20,70,[228],personality=nature),[switch(1)])
    for species in [7,8,9,16,17,18,19,20]:
        add(f"intercept-outgoing-species-{species}",[creature(species,50,[33]),passive],creature(19,50,[228]),[switch(1)])
    for count in range(2,7):
        for index in range(1,count):
            add(f"intercept-selected-index-{count}-{index}",[passive]*count,creature(20,50,[228]),[switch(index)])
    for status in [0,8,16]:
        for ability in [0,1]:
            add(f"intercept-special-guts-{ability}-status-{status}",[passive,passive],creature(20,60,[228],ability=ability,status=status),[switch(1)])
        add(f"intercept-outgoing-bench-status-{status}",[creature(19,60,[116],status=status),passive],creature(19,40,[228]),[MOVE,switch(1)])
    for critical in [1,2]:
        add(f"intercept-critical-{critical}",[passive,passive],creature(20,60,[228]),[switch(1)],
            predicate=lambda r,critical=critical:moves(r)[0]["critical"]==critical)
    for gap in [29,30]:
        for friendship in [0,1,199,200,255]:
            out=creature(7,40,[110],hp=1);out["friendship"]=friendship
            add(f"intercept-KO-gap-{gap}-friendship-{friendship}",[out,passive],creature(20,40+gap,[228]),[switch(1)])
    for status in [8,16]:
        add(f"intercept-KO-then-incoming-residual-prompt-{status}",[creature(7,40,[110],hp=1),creature(7,100,[110],hp=1,status=status),passive],
            creature(20,60,[228]),[switch(1),NEXT,replace(2)])
        add(f"intercept-KO-then-final-incoming-residual-loss-{status}",[creature(7,40,[110],hp=1),creature(7,100,[110],hp=1,status=status)],
            creature(20,60,[228]),[switch(1)])
    add("intercept-last-PP-next-wild-Struggle",[passive,passive],creature(19,40,[228],pp=[1,0,0,0]),[switch(1),MOVE])
    add("depleted-Pursuit-not-selected",[passive,passive],creature(19,40,[228,39],pp=[0,30,0,0]),[switch(1)])
    add("known-Pursuit-other-slot-selected",[passive,passive],creature(19,40,[228,39]),[switch(1)],
        predicate=lambda r:r["initial"]["state"]["wildSlot"]==1)
    for prior in [116,39]:
        wild=creature(19,40,[prior,228],pp=[1,20,0,0])
        add(f"intercept-preserves-wild-history-{prior}",[passive,passive],wild,[MOVE,switch(1)],
            predicate=lambda r:r["initial"]["state"]["wildSlot"]==0 and r["steps"][0]["expected"]["state"]["wildSlot"]==1)
        add(f"ordinary-Pursuit-updates-wild-history-{prior}",[passive],wild,[MOVE,MOVE],
            predicate=lambda r:r["initial"]["state"]["wildSlot"]==0 and r["steps"][0]["expected"]["state"]["wildSlot"]==1)
    add("intercept-switch-clears-outgoing-Protect-history",[creature(7,100,[182]),passive],creature(19,40,[228]),[MOVE,switch(1)])
    add("ordinary-Pursuit-blocked-by-Protect",[creature(7,100,[182])],creature(19,40,[228]),[MOVE])
    add("ordinary-Pursuit-flinch-before-PP",[creature(20,60,[158])],creature(19,60,[228]),[MOVE],
        predicate=lambda r:any(e["actor"]==1 and e["cancelled"] for e in moves(r)))
    add("ordinary-Pursuit-accuracy-miss",[creature(16,100,[28])],creature(19,60,[228]),[MOVE]*3,
        predicate=lambda r:any(e["actor"]==1 and e["flags"]==1 for e in moves(r)))
    add("intercept-ignores-lowered-accuracy",[creature(16,100,[28]),passive],creature(19,40,[228]),[MOVE]*6+[switch(1)])
    add("intercept-ignores-raised-Defense",[creature(7,100,[110]),passive],creature(19,40,[228]),[MOVE]*3+[switch(1)])
    add("intercept-rain-expiry-before-incoming-residual",[creature(7,100,[240,110]),creature(9,100,[110],status=8)],
        creature(19,40,[228]),[MOVE]+[dict(kind="move",slot=1)]*3+[switch(1)])
    add("intercept-incoming-speed-tie-residual",[passive,creature(19,40,[116],status=8)],creature(19,40,[228],status=16),[switch(1)])
    add("failed-Run-ordinary-Pursuit-no-double",[creature(7,40,[110])],creature(19,40,[228]),[RUN],
        predicate=lambda r:r["steps"][0]["expected"]["state"]["outcome"] is None)
    add("successful-Run-no-Pursuit-PP",[passive],creature(19,27,[228]),[RUN])
    add("forced-replacement-no-Pursuit-intercept",[creature(7,40,[110],hp=1),passive],creature(19,60,[228]),[MOVE,NEXT,replace(1)])
    records=deepcopy(controls["sourceRecords"])
    for r in records:
        if r["path"]=="src/battle_script_commands.c":r["evidence"]+="; Cmd_jumpifnopursuitswitchdmg ordinary-wild eligibility and execution-action consumption; limited move-end excludes resulting history"
        if r["path"]=="data/battle_scripts_1.s":r["evidence"]+="; ActionSwitch/PursuitDmgOnSwitchOut PP, critical, post-base multiplier, variance and target faint; returns to selected switch after KO"
        if r["path"]=="src/battle_main.c":r["evidence"]+="; selected target and switch count; consumed wild execution action leaves chosen action for residual ordering"
    return dict(schemaVersion=1,sourceFingerprint=family.FINGERPRINT,independence=controls["independence"],
        scope="Private 24-move family party diagnostics plus Struggle; ordinary-wild Pursuit interception; no live or durable outcomes",
        schedulingAdaptation=controls["schedulingAdaptation"],allowedMoves=sorted(controls["allowedMoves"]+[228]),unsupportedFamilyMoves=[119],
        protectPolicy=controls["protectPolicy"],sourceRecords=records,cases=cases)

def main():
    data=json.dumps(fixtures(),indent=2)+"\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf8")==data,"Independent Pursuit literals changed; audit source before regeneration"
        print("Independent Pursuit fixture reproduction passed.")
    else:TARGET.write_text(data,encoding="utf8");print(f"Wrote {len(json.loads(data)['cases'])} independent Pursuit cases.")

if __name__=="__main__":main()
