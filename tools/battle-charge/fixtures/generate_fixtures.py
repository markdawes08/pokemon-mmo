"""Independent source-literal Skull Bash oracle over the prior test-only model.

No production C/TS/WASM generates expected data. Source charging script,
selection bypass, cancellation, PP and persistent volatile rules are transcribed
here; presentation/VBlank timing remains explicitly outside this oracle.
"""
from __future__ import annotations
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fixtures"))
from fixture_io import read_fixture_text, write_fixture_text

ROOT=Path(__file__).resolve().parents[3]
TARGET=Path(__file__).with_name("source-cases.json")
spec=importlib.util.spec_from_file_location("independent_tactics",ROOT/"tools/battle-tactics/fixtures/generate_fixtures.py")
tactics=importlib.util.module_from_spec(spec);spec.loader.exec_module(tactics)
family=tactics.family
creature=tactics.creature
MOVE,RUN,STRUGGLE,NEXT,ESCAPE=tactics.MOVE,tactics.RUN,tactics.STRUGGLE,tactics.NEXT,tactics.ESCAPE
switch,replace=tactics.switch,tactics.replace
CONTINUE={"kind":"continue-charge"}
MULTIPLE=1<<12
family.MOVES[130]=(100,100,0,0,0,"hit")

class Oracle(tactics.Oracle):
    def __init__(self,initial):
        self.locked=[0,0];self.charging=[0,0];self.targets=[0,0];self.remembered_slots=[0,0]
        super().__init__(initial)

    def summary(self):
        value=super().summary()
        value.update(lockedMoves=self.locked[:],chargingTurns=self.charging[:],chargeTargets=self.targets[:])
        return value

    def prepare(self):
        # Source TurnValuesCleanUp clears ProtectStruct, not status2/gLockedMoves.
        self.charging=[0,0]
        for mon in self.actors:mon["status2"] &= ~family.FLINCH
        self.draw("turn-selection")
        if self.actors[1]["status2"]&MULTIPLE:
            self.wild_slot=self.remembered_slots[1];return
        if not any(m["pp"] for m in self.actors[1]["moves"]):self.wild_slot=4;return
        while True:
            slot=self.draw("wild-slot-selection")&3;m=self.actors[1]["moves"][slot]
            if m["moveId"] and m["pp"]:self.wild_slot=slot;return

    def faint(self,actor):
        self.charging[actor]=0
        return super().faint(actor)

    def attack(self,actor,slot,action_index,action_order):
        self.no_valid[actor]=False
        a,t=self.actors[actor],self.actors[actor^1]
        move=165 if slot==4 else a["moves"][slot]["moveId"]
        if move!=130:return super().attack(actor,slot,action_index,action_order)
        if a["status2"]&family.FLINCH:
            # CANCELLER_FLINCH invokes CancelMultiTurnMoves before PP/accuracy.
            a["status2"] &= ~MULTIPLE
            super().attack(actor,slot,action_index,action_order)
        elif a["status2"]&MULTIPLE:
            a["status2"] &= ~MULTIPLE
            # The source release follows ordinary EffectHit, but sets
            # NO_PPDEDUCT after clearing charging. Reuse only test arithmetic;
            # temporarily restoring one local PP compensates its PP step.
            a["moves"][slot]["pp"]+=1
            super().attack(actor,slot,action_index,action_order)
            next(e for e in reversed(self.events) if e["kind"]=="move" and e["actor"]==actor)["ppSpent"]=False
        else:
            a["moves"][slot]["pp"]-=1;a["status2"]|=MULTIPLE
            self.locked[actor]=130;self.charging[actor]=1;self.targets[actor]=actor^1
            before=a["stages"][2];a["stages"][2]=min(12,before+1)
            self.events.append(dict(kind="move",actor=actor,slot=slot,moveId=130,flags=1 if before==12 else 0,
                baseDamage=0,afterCritical=0,afterType=0,damage=0,hpDealt=0,critical=1,recoil=0,recoilDealt=0,
                cancelled=False,targetHP=t["hp"],stat=2,stageBefore=before,stageAfter=a["stages"][2],abilityPrevented=False))
        # Host observation occurs immediately after the action, before faint
        # cleanup/outcome. Normal release cannot create another charge.
        insertion=next(i for i in range(len(self.events)-1,-1,-1) if self.events[i]["kind"]=="move" and self.events[i]["actor"]==actor)+1
        self.events.insert(insertion,dict(kind="charge",actor=actor,charging=bool(a["status2"]&MULTIPLE)))

    def advance(self,choice):
        assert not self.outcome
        if self.phase!="choice":return super().advance(choice)
        locked=bool(self.actors[0]["status2"]&MULTIPLE)
        assert (choice["kind"]=="continue-charge")==locked
        self.events=[];self.trace=[]
        self.no_valid=[choice["kind"]=="struggle",self.wild_slot==4]
        if choice["kind"]=="switch":
            self.chosen_slots=[None,self.wild_slot];self.remembered_slots[1]=0 if self.wild_slot==4 else self.wild_slot
            self.events.append(dict(kind="order",phase="actions",actors=[0,1]));self.load(choice["partyIndex"])
            self.attack(1,self.wild_slot,1,[0,1])
        elif choice["kind"]=="run":
            self.chosen_slots=[None,self.wild_slot];self.remembered_slots[1]=0 if self.wild_slot==4 else self.wild_slot
            self.events.append(dict(kind="order",phase="actions",actors=[0,1]))
            if not self.run():self.attack(1,self.wild_slot,1,[0,1])
        else:
            slot=self.remembered_slots[0] if locked else 4 if choice["kind"]=="struggle" else choice["slot"]
            if not locked:assert (slot==4)==(not any(m["pp"] for m in self.actors[0]["moves"]))
            self.chosen_slots=[slot,self.wild_slot]
            self.remembered_slots=[0 if slot==4 else slot,0 if self.wild_slot==4 else self.wild_slot]
            order=self.order("actions",self.chosen_slots)
            for index,actor in enumerate(order):
                self.attack(actor,slot if actor==0 else self.wild_slot,index,order)
                if self.outcome or not self.actors[0]["hp"]:break
        if not self.outcome:
            if not self.actors[0]["hp"]:self.prompt(1)
            else:self.residual()
        self.sequence+=1
        return dict(state=self.summary(),events=deepcopy(self.events),trace=deepcopy(self.trace))

def transcript(seed,player,opponent,choices):
    initial=dict(kind="diagnostic",seed=seed,player=player,opponent=opponent);o=Oracle(initial)
    row=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        # Tests express forced action explicitly. Optional dynamic continuation
        # is fixture construction only, never a production choice conversion.
        actual=CONTINUE if choice.get("kind")=="auto-fight" and o.actors[0]["status2"]&MULTIPLE else MOVE if choice.get("kind")=="auto-fight" else choice
        row["steps"].append(dict(choice=deepcopy(actual),expected=o.advance(actual)))
    return row

def moves(row):return [e for step in row["steps"] for e in step["expected"]["events"] if e["kind"]=="move"]

def fixtures():
    cases=[]
    def add(name,roster,wild,choices,seed=0,predicate=None,limit=20000):
        for candidate in range(seed,seed+limit if predicate else seed+1):
            row=transcript(candidate,roster,wild,choices)
            if predicate is None or predicate(row):cases.append(dict(id=name,**row));return row
        raise AssertionError("No independent source witness: "+name)
    controls=tactics.fixtures()
    for old in controls["cases"]:
        add(old["id"],old["input"]["player"],old["input"]["opponent"],[s["choice"] for s in old["steps"]],old["input"]["seed"])
    passive=creature(9,100,[110])
    auto={"kind":"auto-fight"}
    for species in [7,8,9]:
        for actor in [0,1]:
            charge=creature(species,60,[130]);other=creature(9,60,[110])
            add(f"charge-species-{species}-actor-{actor}",[charge if actor==0 else other],other if actor==0 else charge,
                [MOVE,CONTINUE,MOVE,CONTINUE] if actor==0 else [MOVE]*4)
    for slot in range(4):
        ids=[33,39,110,55];ids[slot]=130
        for actor in [0,1]:
            charge=creature(7,60,ids)
            add(f"charge-slot-{slot}-actor-{actor}",[charge if actor==0 else passive],passive if actor==0 else charge,
                [dict(kind="move",slot=slot),CONTINUE] if actor==0 else [MOVE]*3,
                predicate=None if actor==0 else lambda r,slot=slot:r["initial"]["state"]["wildSlot"]==slot)
    for ups in range(4):
        add(f"charge-PP-bonus-{ups}-single-spend",[creature(7,60,[130],ups=[ups,0,0,0])],passive,[MOVE,CONTINUE])
    add("charge-last-PP-release-before-Struggle",[creature(7,60,[130],pp=[1,0,0,0])],passive,[MOVE,CONTINUE,STRUGGLE])
    add("wild-charge-last-PP-release-before-Struggle",[passive],creature(7,60,[130],pp=[1,0,0,0]),[MOVE]*3)
    add("charge-withdraw-capped-defense-still-locks",[creature(7,60,[110,130])],passive,
        [MOVE]*6+[dict(kind="move",slot=1),CONTINUE])
    for status in [0,8,16]:
        add(f"charge-status-{status}-damage-and-residual",[creature(7,60,[130],status=status)],passive,[MOVE,CONTINUE])
    for nature in range(25):
        add(f"charge-nature-{nature}-source-damage",[creature(7,60,[130],personality=nature)],passive,[MOVE,CONTINUE])
    add("charge-defense-applies-before-slower-attack",[creature(9,100,[130])],creature(19,60,[33]),[MOVE,CONTINUE])
    add("charge-defense-applies-after-faster-attack",[creature(7,60,[130])],creature(20,60,[33]),[MOVE,CONTINUE])
    add("charge-release-miss-clears-lock-with-no-second-PP",[creature(7,60,[130])],creature(18,60,[28]),[MOVE,CONTINUE],
        predicate=lambda r:any(e["actor"]==0 and e["moveId"]==130 and e["flags"]==1 and e.get("ppSpent") is False for e in moves(r)))
    for phase in ["first","second"]:
        add(f"flinch-cancels-charge-{phase}-no-PP-or-accuracy",[creature(7,60,[130])],creature(20,60,[158]),[auto,auto,auto],
            predicate=lambda r,phase=phase:len(r["steps"])>=2 and any(e["actor"]==0 and e["cancelled"] for e in r["steps"][0 if phase=="first" else 1]["expected"]["events"] if e["kind"]=="move")
              and (phase=="first" or bool(r["steps"][0]["expected"]["state"]["actors"][0]["status2"]&MULTIPLE)))
    add("both-charge-same-turn-no-wild-reroll",[creature(7,60,[130])],creature(7,60,[130]),[MOVE,CONTINUE,MOVE,CONTINUE])
    add("wild-charge-hits-incoming-voluntary-switch",[creature(7,60,[110]),creature(7,60,[110])],creature(9,60,[130]),[MOVE,switch(1),MOVE])
    add("charge-release-then-switch-retains-inert-lockedMove",[creature(7,60,[130]),creature(19,60,[116])],passive,[MOVE,CONTINUE,switch(1),MOVE,switch(0),MOVE,CONTINUE])
    for status in [8,16]:
        add(f"player-charge-faints-from-residual-{status}",[creature(7,60,[130],hp=1,status=status),creature(7,60,[110])],passive,[MOVE,NEXT,replace(1),MOVE])
        add(f"wild-charge-retained-over-player-post-residual-faint-{status}",[creature(19,60,[116],hp=1,status=status),creature(7,60,[110])],
            creature(9,60,[130]),[MOVE,NEXT,replace(1),MOVE])
    add("wild-charge-retained-over-player-pre-residual-recoil-faint",[creature(19,40,[33],hp=1,pp=[0,0,0,0]),creature(7,40,[110])],
        creature(9,100,[130]),[STRUGGLE,NEXT,replace(1),MOVE])
    add("charge-terminal-opponent-residual-faint-retains-first-turn",[creature(7,60,[130])],creature(9,60,[110],hp=1,status=8),[MOVE])
    add("charge-Whirlwind-terminal-retains-lock",[creature(7,60,[130])],creature(16,100,[18]),[MOVE])
    add("charge-rain-ticks-both-turns",[creature(7,60,[240,130])],passive,[MOVE,dict(kind="move",slot=1),CONTINUE])
    add("charge-rain-expires-before-release",[creature(7,60,[240,110,130])],passive,
        [MOVE]+[dict(kind="move",slot=1)]*3+[dict(kind="move",slot=2),CONTINUE])
    records=deepcopy(controls["sourceRecords"])
    for record in records:
        if record["path"]=="data/battle_scripts_1.s":record["evidence"] += "; Skull Bash first-charge and shared second-turn scripts: PP once, defense raise, cancel-before-clear, no second PP"
        if record["path"]=="src/battle_main.c":record["evidence"] += "; MULTIPLETURNS skips actor/controller selection and retains locked move/slot; ProtectStruct cleanup clears chargingTurn only"
        if record["path"]=="src/battle_util.c":record["evidence"] += "; CancelMultiTurnMoves clears MULTIPLETURNS on flinch but leaves gLockedMoves stale"
    return dict(schemaVersion=1,sourceFingerprint=family.FINGERPRINT,
        independence="Independent test-only source arithmetic and charging/scheduling oracle; no production-generated expectations or original-ROM comparison",
        scope="Private 22-move family party diagnostics plus Struggle; Skull Bash lock/release only, no live/durable outcomes",
        schedulingAdaptation=controls["schedulingAdaptation"],allowedMoves=sorted(tactics.ALLOWED+[130]),unsupportedFamilyMoves=[119,182,228],sourceRecords=records,cases=cases)

def main():
    if "--check" in sys.argv: read_fixture_text(TARGET)
    data=json.dumps(fixtures(),indent=2)+"\n"
    if "--check" in sys.argv:
        assert read_fixture_text(TARGET)==data,"Independent charge literals changed; audit source before regeneration"
        print("Independent charge fixture reproduction passed.")
    else:
        write_fixture_text(TARGET, data);print(f"Wrote {len(json.loads(data)['cases'])} independent charge cases.")

if __name__=="__main__":main()
