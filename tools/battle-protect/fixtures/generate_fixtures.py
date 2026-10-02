"""Independent source/ROM-policy Protect oracle, never production generated.

The source has a four-entry out-of-bounds table. This explicitly versioned test
policy reads the separately pinned original ROM's full byte-counter lookup.
No ROM execution or reachability of every diagnostic counter is claimed.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fixtures"))
from fixture_io import read_fixture_text, write_fixture_text

ROOT=Path(__file__).resolve().parents[3]
TARGET=Path(__file__).with_name("source-cases.json")
REFERENCE=Path("C:/Users/mrkda/Projects/pokefirered-master")
ROM_SHA="3d0c79f1627022e18765766f6cb5ea067f6b5bf7dca115552189ad65a5c3a8ac"
TABLE_SHA="977c6928a398eab83f1b9d0ff8b5a2d4ee4c88d1beae6872da7fe5265a87bce1"
rom=(REFERENCE/"pokefirered.gba").read_bytes()
assert hashlib.sha256(rom).hexdigest()==ROM_SHA
table=rom[0x2507e0:0x2509e0]
assert hashlib.sha256(table).hexdigest()==TABLE_SHA
RATES=list(struct.unpack("<256H",table));assert RATES[:4]==[65535,32767,16383,8191]
spec=importlib.util.spec_from_file_location("independent_charge",ROOT/"tools/battle-charge/fixtures/generate_fixtures.py")
charge=importlib.util.module_from_spec(spec);spec.loader.exec_module(charge)
family=charge.family;creature=charge.creature
MOVE,RUN,STRUGGLE,NEXT,ESCAPE,CONTINUE=charge.MOVE,charge.RUN,charge.STRUGGLE,charge.NEXT,charge.ESCAPE,charge.CONTINUE
switch,replace=charge.switch,charge.replace
family.MOVES[182]=(0,0,0,3,0,"protect")
EXEMPT={97,110,116,182,240}

class Oracle(charge.Oracle):
    def __init__(self,initial):
        self.counters=[0,0];self.protected=[0,0];self.resulting=[0,0]
        super().__init__(initial)

    def summary(self):
        value=super().summary()
        value.update(protectCounters=self.counters[:],protected=self.protected[:],resultingMoves=self.resulting[:])
        return value

    def prepare(self):
        self.protected=[0,0]
        return super().prepare()

    def residual(self):
        # BattleTurnPassed: TurnValuesCleanUp(TRUE) precedes field order/rain.
        self.protected=[0,0]
        return super().residual()

    def faint(self,actor):
        self.counters[actor]=self.protected[actor]=self.resulting[actor]=0
        return super().faint(actor)

    def load(self,index,forced=False):
        self.counters[0]=self.protected[0]=self.resulting[0]=0
        return super().load(index,forced)

    def attack(self,actor,slot,action_index,action_order):
        a,t=self.actors[actor],self.actors[actor^1]
        move=165 if slot==4 else a["moves"][slot]["moveId"]
        flinch=bool(a["status2"]&family.FLINCH)
        release=move==130 and bool(a["status2"]&charge.MULTIPLE)
        blocked=self.protected[actor^1] and move not in EXEMPT and (move!=130 or release)
        self.no_valid[actor]=False
        if move==182 and not flinch:
            a["moves"][slot]["pp"]-=1
            if self.resulting[actor] not in (182,197,203):self.counters[actor]=0
            counter=self.counters[actor];roll=self.draw(f"actor{actor}-protect")
            success=RATES[counter]>=roll and action_index!=1
            if success:self.counters[actor]=(counter+1)&255;self.protected[actor]=1
            else:self.counters[actor]=0
            self.events.append(dict(kind="move",actor=actor,slot=slot,moveId=182,flags=0 if success else 1,
                baseDamage=0,afterCritical=0,afterType=0,damage=0,hpDealt=0,critical=1,recoil=0,recoilDealt=0,
                cancelled=False,targetHP=a["hp"],protectRoll=roll,protectThreshold=RATES[counter],protectCounterBefore=counter))
            self.events.append(dict(kind="protect",actor=actor,protected=bool(self.protected[actor])))
        elif blocked and not flinch:
            # Source attackcanceler marks MISSED and cancels charging. The
            # script still reaches its ordinary PP/miss branch, without RNG.
            a["status2"] &= ~charge.MULTIPLE
            e=dict(kind="move",actor=actor,slot=slot,moveId=move,flags=1,baseDamage=0,afterCritical=0,afterType=0,
                damage=0,hpDealt=0,critical=1,recoil=0,recoilDealt=0,cancelled=False,targetHP=t["hp"],blocked=True)
            if slot!=4 and not release:a["moves"][slot]["pp"]-=1
            if release:e["ppSpent"]=False
            if move==283:
                if t["hp"]<=a["hp"]:e["flags"]|=32
                else:e["damage"]=e["hpDealt"]=t["hp"]-a["hp"]
            # Whirlwind's first protect-only accuracy jump targets ButItFailed.
            if move==18:e["flags"]|=32
            self.events.append(e)
            if move==130:self.events.append(dict(kind="charge",actor=actor,charging=False))
        else:
            super().attack(actor,slot,action_index,action_order)
            if move==182:self.events.append(dict(kind="protect",actor=actor,protected=bool(self.protected[actor])))
        # Source MoveEnd runs after faint scripts, including recoil self-faint.
        # Wild Whirlwind success uses finishaction and skips this history phase.
        if self.outcome!="forced-escape":self.resulting[actor]=65535 if flinch else move

def transcript(seed,player,opponent,choices):
    initial=dict(kind="diagnostic",seed=seed,player=[deepcopy(mon) for mon in player],opponent=deepcopy(opponent));o=Oracle(initial)
    row=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        actual=CONTINUE if choice.get("kind")=="auto-fight" and o.actors[0]["status2"]&charge.MULTIPLE else MOVE if choice.get("kind")=="auto-fight" else choice
        row["steps"].append(dict(choice=deepcopy(actual),expected=o.advance(actual)))
    return row

def fixtures():
    cases=[]
    def add(name,player,wild,choices,seed=0,predicate=None,limit=20000):
        for candidate in range(seed,seed+limit if predicate else seed+1):
            row=transcript(candidate,player,wild,choices)
            if predicate is None or predicate(row):cases.append(dict(id=name,**row));return row
        raise AssertionError("No independent Protect witness: "+name)
    controls=charge.fixtures()
    for old in controls["cases"]:
        add(old["id"],old["input"]["player"],old["input"]["opponent"],[s["choice"] for s in old["steps"]],old["input"]["seed"])
    passive=creature(9,100,[110]);protect=creature(7,100,[182])
    for species in [7,8,9]:
        for actor in [0,1]:
            mon=creature(species,100,[182])
            add(f"protect-family-{species}-actor-{actor}",[mon if actor==0 else passive],passive if actor==0 else mon,[MOVE]*3)
    for slot in range(4):
        ids=[33,39,55,110];ids[slot]=182
        for actor in [0,1]:
            mon=creature(7,100,ids)
            add(f"protect-slot-{slot}-actor-{actor}",[mon if actor==0 else passive],passive if actor==0 else mon,
                [dict(kind="move",slot=slot)]*2 if actor==0 else [MOVE]*2,
                predicate=None if actor==0 else lambda r,slot=slot:r["initial"]["state"]["wildSlot"]==slot)
    for ups in range(4):
        add(f"protect-PP-bonus-{ups}",[creature(7,100,[182],ups=[ups,0,0,0])],passive,[MOVE]*3)
    add("protect-last-PP-then-Struggle",[creature(7,100,[182],pp=[1,0,0,0])],passive,[MOVE,STRUGGLE])
    add("protect-source-four-success-then-ROM-fifth-failure",[protect],passive,[MOVE]*6,
        predicate=lambda r:[s["expected"]["state"]["protectCounters"][0] for s in r["steps"][:5]]==[1,2,3,4,0])
    add("protect-policy-base-two-priority-speed",[creature(9,100,[182])],protect,[MOVE]*2)
    for seed in range(3):add(f"protect-both-priority-speed-tie-{seed}",[protect],protect,[MOVE]*3,seed=seed)
    add("protect-last-action-after-voluntary-switch",[passive,passive],protect,[switch(1),MOVE])
    owners={33:7,39:7,28:16,55:7,56:7,17:16,16:16,98:16,110:7,97:16,297:16,184:20,145:7,44:7,158:19,
            116:19,162:19,283:19,229:7,240:7,18:16,130:7}
    for move,species in owners.items():
        mon=creature(species,100,[move])
        choices=[MOVE,CONTINUE] if move==130 else [MOVE]
        add(f"protect-against-every-move-{move}",[mon],protect,choices)
    add("protect-against-Struggle-no-recoil",[creature(19,100,[33],pp=[0,0,0,0])],protect,[STRUGGLE])
    add("protect-blocks-PP0-SkullBash-release",[creature(7,100,[130],pp=[1,0,0,0])],protect,[MOVE,CONTINUE,STRUGGLE],
        predicate=lambda r:any(e.get("blocked") and e.get("moveId")==130 for s in r["steps"] for e in s["expected"]["events"]))
    add("player-protect-blocks-wild-PP0-release",[protect],creature(7,100,[130],pp=[1,0,0,0]),[MOVE]*3,
        predicate=lambda r:any(e.get("blocked") and e.get("moveId")==130 for s in r["steps"] for e in s["expected"]["events"]))
    add("protect-blocked-Endeavor-keeps-difference-diagnostic",[creature(19,100,[283],hp=1)],protect,[MOVE])
    add("protect-blocked-Endeavor-HP-failure-before-accuracy",[creature(20,100,[283])],creature(7,100,[182],hp=1),[MOVE])
    for move in [33,39,110,130,240]:
        add(f"protect-history-reset-after-move-{move}",[creature(7,100,[182,move])],passive,
            [MOVE,dict(kind="move",slot=1)]+([CONTINUE] if move==130 else [])+[MOVE])
    add("protect-failed-Run-keeps-counter-history",[protect],creature(18,100,[97]),[MOVE,RUN,MOVE],
        predicate=lambda r:len(r["steps"])==3 and r["steps"][1]["expected"]["state"]["protectCounters"][0]==1)
    add("protect-successful-Run-preserves-inert-counter",[creature(9,100,[182])],creature(7,50,[110]),[MOVE,RUN])
    add("protect-switch-return-resets-counter-history",[protect,passive],passive,[MOVE,switch(1),switch(0),MOVE])
    add("protect-flinched-other-move-breaks-chain",[creature(7,60,[182,33])],creature(20,60,[158]),[MOVE,dict(kind="move",slot=1),MOVE],
        predicate=lambda r:len(r["steps"])==3 and r["steps"][1]["expected"]["state"]["resultingMoves"][0]==65535)
    for status in [8,16]:
        add(f"protect-residual-faint-clears-before-prompt-{status}",[creature(7,60,[182],hp=1,status=status),passive],passive,[MOVE,NEXT,replace(1),MOVE])
    add("protect-then-recoil-faint-records-Struggle-after-cleanup",[creature(7,60,[182],hp=1,pp=[1,0,0,0]),passive],passive,[MOVE,STRUGGLE,NEXT,replace(1),MOVE])
    add("protect-rain-still-ticks",[creature(7,100,[240,182])],passive,[MOVE]+[dict(kind="move",slot=1)]*5)
    add("protect-opponent-residual-terminal-clears-flag",[protect],creature(9,100,[110],hp=1,status=8),[MOVE])
    records=deepcopy(controls["sourceRecords"])
    for record in records:
        if record["path"]=="src/battle_script_commands.c":record["evidence"] += "; setprotectlike inclusive RNG-before-last-action and byte counter; protection guards; UPDATE_LAST_MOVES resulting move"
        if record["path"]=="src/battle_main.c":record["evidence"] += "; TurnValuesCleanUp(TRUE) clears protection before field/residual; switch/faint counter/history resets"
        if record["path"]=="data/battle_scripts_1.s":record["evidence"] += "; Protect PP first; protected miss scripts; recoil faint before move-end; wild Whirlwind skips move-end"
    witnesses=[]
    for counter,rate in enumerate(RATES):
        for roll in sorted(set([0,rate,min(65535,rate+1),65535])):
            witnesses.append(dict(counter=counter,roll=roll,threshold=rate,firstSuccess=roll<=rate,
                firstCounter=(counter+1)&255 if roll<=rate else 0,lastSuccess=False,lastCounter=0))
    return dict(schemaVersion=1,sourceFingerprint=family.FINGERPRINT,
        independence="Independent test-only source arithmetic/script oracle plus separately pinned ROM data policy; no production-generated expectations or original-ROM execution",
        scope="Private 23-move family party diagnostics plus Struggle, no live or durable outcomes",
        schedulingAdaptation=controls["schedulingAdaptation"],allowedMoves=sorted(controls["allowedMoves"]+[182]),unsupportedFamilyMoves=[119,228],
        protectPolicy=dict(id="firered-protect-rom-v1",romSha256=ROM_SHA,tableSha256=TABLE_SHA,offset=0x2507e0,entries=256,
            rates=RATES,sourceEntries=RATES[:4],diagnosticLimit="Raw command-domain counters and roll edges; not a claim all counters are naturally reachable",witnesses=witnesses),
        sourceRecords=records,cases=cases)

def main():
    if "--check" in sys.argv: read_fixture_text(TARGET)
    data=json.dumps(fixtures(),indent=2)+"\n"
    if "--check" in sys.argv:
        assert read_fixture_text(TARGET)==data,"Independent Protect literals changed; audit source before regeneration"
        print("Independent Protect fixture reproduction passed.")
    else:write_fixture_text(TARGET, data);print(f"Wrote {len(json.loads(data)['cases'])} independent Protect cases.")

if __name__=="__main__":main()
