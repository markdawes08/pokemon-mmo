"""Independent source-literal party scheduling oracle.

Imports only the earlier test-only arithmetic oracle. No production generator,
module or emitted C supplies expectations. Presentation frame timing is omitted.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
TARGET = Path(__file__).with_name("source-cases.json")
spec = importlib.util.spec_from_file_location("independent_family", ROOT/"tools/battle-family/fixtures/generate_fixtures.py")
family = importlib.util.module_from_spec(spec)
spec.loader.exec_module(family)
creature = family.creature
MOVE, RUN, STRUGGLE = family.MOVE, family.RUN, family.STRUGGLE
NEXT = {"kind":"use-next"}
ESCAPE = {"kind":"attempt-run"}

def switch(index): return dict(kind="switch",partyIndex=index)
def replace(index): return dict(kind="replace",partyIndex=index)

class Oracle(family.Oracle):
    def __init__(self, initial):
        self.party=deepcopy(initial["player"])
        self.active=next(i for i,m in enumerate(self.party) if m["hp"])
        self.sent=1<<self.active;self.switches=0;self.resume=0;self.escape_failed=False
        self.phase="choice";self.chosen_slots=[0,0];self.faints=[];self.no_valid=[False,False]
        super().__init__(dict(seed=initial["seed"],player=self.party[self.active],opponent=initial["opponent"]))
        self.initial=deepcopy(initial)

    def sync(self):
        for key in ("hp","status","friendship","moves"):
            self.party[self.active][key]=deepcopy(self.actors[0][key])

    def summary(self):
        self.sync()
        value=super().summary()
        value.update(phase=self.phase,activeIndex=self.active,sentMask=self.sent,switchCounter=self.switches,
            replacementPhase=self.resume,escapeFailed=self.escape_failed,
            party=[dict(hp=m["hp"],status=m["status"],friendship=m["friendship"],
                        pp=[x["pp"] for x in m["moves"]]) for m in self.party],faints=deepcopy(self.faints))
        return value

    def faint(self,actor):
        self.no_valid[actor]=False
        if actor==0:
            mon=self.actors[0]
            penalty=(10 if mon["friendship"]>=200 else 5) if self.actors[1]["level"]-mon["level"]>29 else 1
            mon["friendship"]=max(0,mon["friendship"]-penalty)
        super().faint(actor)
        if actor==0:
            self.faints.append(dict(partyIndex=self.active,opponentLevel=self.actors[1]["level"]))
        self.sync()

    def attack(self,actor,slot,action_index,action_order):
        # HandleAction_UseMove consumes noValidMoves before executing Struggle.
        self.no_valid[actor]=False
        return super().attack(actor,slot,action_index,action_order)

    def finish_if_fainted(self):
        self.sync()
        player_alive=any(m["hp"] for m in self.party)
        wild_alive=self.actors[1]["hp"]>0
        if not player_alive or not wild_alive:
            self.outcome="draw" if not player_alive and not wild_alive else "won" if player_alive else "lost"
            self.phase="ended";self.events.append(dict(kind="outcome",outcome=self.outcome))

    def prompt(self,phase):
        self.resume=phase;self.phase="post-faint";self.escape_failed=False
        self.events.append(dict(kind="faint-choice",partyIndex=self.active,resume=phase))

    def load(self,index,forced=False):
        assert index!=self.active and self.party[index]["hp"]>0
        self.sync();old=self.active;self.active=index
        mon=deepcopy(self.party[index]);mon["stages"]=[6]*8;mon["status2"]=0
        mon["types"]=[11,11] if mon["speciesId"]<10 else [0,2] if mon["speciesId"]<19 else [0,0]
        self.actors[0]=mon;self.sent|=1<<index;self.no_valid[0]=False
        if not forced:self.switches=min(255,self.switches+1)
        self.events.append(dict(kind="switch",fromIndex=old,toIndex=index,forced=forced))

    def run(self,forced=False):
        a,t=self.actors
        if a["abilityId"]==50:success=True
        else:
            threshold=(a["stats"]["speed"]*128//t["stats"]["speed"]+self.run_tries*30)&255
            success=a["stats"]["speed"]>=t["stats"]["speed"] or threshold>(self.draw("faint-escape" if forced else "run-escape")&255)
            self.run_tries=(self.run_tries+1)&255
        self.events.append(dict(kind="run",success=success,runTries=self.run_tries,forced=forced))
        if success:
            self.outcome="ran";self.phase="ended";self.resume=0;self.escape_failed=False;self.events.append(dict(kind="outcome",outcome="ran"))
        return success

    def next_turn(self):
        self.resume=0;self.escape_failed=False;self.phase="choice";self.turn+=1;self.prepare()

    def residual(self):
        # Source GetWhoStrikesFirst(FALSE) indexes the incoming mon's original
        # selected slot. Faint cleanup removes noValidMoves (Struggle -> slot0).
        slots=[]
        for actor,slot in enumerate(self.chosen_slots):
            if self.no_valid[actor]:slots.append(4)
            elif slot is None:slots.append(None)
            else:
                actual=0 if slot==4 else slot
                slots.append(actual if self.actors[actor]["moves"][actual]["moveId"] else None)
        order=self.order("residual",slots)
        for actor in order:
            m=self.actors[actor]
            if m["status"] and m["hp"]:
                damage=max(1,m["stats"]["hp"]//8);dealt=min(damage,m["hp"]);m["hp"]-=dealt
                self.events.append(dict(kind="residual",actor=actor,status=m["status"],damage=damage,hpDealt=dealt,hp=m["hp"]))
                if not m["hp"]:self.faint(actor)
                self.finish_if_fainted()
                if self.outcome:return
        if not self.actors[0]["hp"]:self.prompt(2)
        else:self.next_turn()

    def advance(self,choice):
        assert not self.outcome
        self.events=[];self.trace=[]
        if self.phase=="post-faint":
            assert choice["kind"] in ("use-next","attempt-run")
            if choice["kind"]=="attempt-run" and self.run(True):pass
            else:
                self.escape_failed=choice["kind"]=="attempt-run";self.phase="replacement"
                self.switches=min(255,self.switches+1)
                if choice["kind"]=="use-next":self.events.append(dict(kind="replacement-choice",escapeFailed=False))
        elif self.phase=="replacement":
            assert choice["kind"]=="replace"
            phase=self.resume;self.load(choice["partyIndex"],True)
            self.resume=0;self.escape_failed=False;self.phase="choice"
            if phase==1:self.residual()
            else:self.next_turn()
        else:
            assert self.phase=="choice"
            self.no_valid=[choice["kind"]=="struggle",self.wild_slot==4]
            if choice["kind"]=="switch":
                self.chosen_slots=[None,self.wild_slot]
                self.events.append(dict(kind="order",phase="actions",actors=[0,1]));self.load(choice["partyIndex"])
                self.attack(1,self.wild_slot,1,[0,1])
            elif choice["kind"]=="run":
                self.chosen_slots=[None,self.wild_slot]
                self.events.append(dict(kind="order",phase="actions",actors=[0,1]))
                if not self.run():self.attack(1,self.wild_slot,1,[0,1])
            else:
                slot=4 if choice["kind"]=="struggle" else choice["slot"]
                assert (slot==4)==(not any(m["pp"] for m in self.actors[0]["moves"]))
                self.chosen_slots=[slot,self.wild_slot]
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
    result=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        result["steps"].append(dict(choice=deepcopy(choice),expected=o.advance(choice)))
    return result

def fixtures():
    cases=[]
    def add(name,party,wild,choices,seed=0):
        row=transcript(seed,party,wild,choices);row["id"]=name;cases.append(row);return row
    # Retain every old mechanics case as a one-member control without modifying
    # any of the preceding literal files.
    for old in family.fixtures()["cases"]:
        add("single-control-"+old["id"],[old["input"]["player"]],old["input"]["opponent"],
            [step["choice"] for step in old["steps"]],old["input"]["seed"])
    for size in range(2,7):
        for incoming in range(1,size):
            roster=[creature(7,40,[110]) for _ in range(size)]
            roster[incoming]=creature(19,40,[116,33],pp=[23,12,0,0],ups=[2,3,0,0],status=16)
            add(f"party-{size}-switch-index-{incoming}",roster,creature(7,40,[39]),[switch(incoming),MOVE,switch(0),switch(incoming)])
    for first in range(6):
        roster=[creature(7,40,[110],hp=0) for _ in range(6)]
        roster[first]=creature(19,40,[116])
        add(f"first-living-{first}",roster,creature(7,40,[39]),[MOVE])
    for status in [0,8,16]:
        add(f"outgoing-status-{status}-no-bench-residual",[creature(19,40,[116,33],status=status),creature(7,40,[110])],
            creature(7,40,[39]),[MOVE,switch(1),MOVE,switch(0),dict(kind="move",slot=1)])
    add("switch-before-quick-attack",[creature(7,40,[110]),creature(7,40,[110])],creature(19,40,[98]),[switch(1)])
    add("switch-action-tie-no-draw",[creature(7,40,[110]),creature(7,40,[110])],creature(7,40,[39]),[switch(1)])
    # A faster source wild attack knocks the old active out before its PP use.
    for incoming in range(1,6):
        roster=[creature(7,40,[110],hp=1)]+[creature(7,40,[110]) for _ in range(5)]
        add(f"forced-before-residual-index-{incoming}",roster,creature(19,40,[33]),[MOVE,NEXT,replace(incoming),MOVE])
    for status in [8,16]:
        add(f"double-prompt-new-replacement-{status}-residual",[creature(7,40,[110],hp=1),creature(7,40,[110],hp=1,status=status),creature(7,40,[110],status=status)],
            creature(19,40,[33]),[MOVE,NEXT,replace(1),NEXT,replace(2),MOVE])
        add(f"post-residual-replacement-{status}-not-damaged-twice",[creature(19,40,[116],hp=1,status=status),creature(7,40,[110],status=status)],
            creature(7,40,[39]),[MOVE,NEXT,replace(1),MOVE])
    add("forced-incoming-slot-priority-residual",[creature(7,40,[110],hp=1),creature(19,40,[98],status=8)],
        creature(20,40,[33],status=16),[MOVE,NEXT,replace(1)])
    add("forced-incoming-empty-slot-residual",[creature(7,40,[110,39],hp=1),creature(19,40,[98],status=8)],
        creature(20,40,[33],status=16),[dict(kind="move",slot=1),NEXT,replace(1)])
    add("fainted-runaway-no-draw",[creature(19,40,[33],hp=1,ability=0),creature(7,40,[110])],
        creature(20,40,[98]),[MOVE,ESCAPE])
    for wanted in [False,True]:
        for seed in range(500):
            row=transcript(seed,[creature(7,40,[110],hp=1),creature(7,40,[110])],creature(20,40,[33]),[MOVE])
            if row["steps"][-1]["expected"]["state"]["phase"]!="post-faint":continue
            trial=transcript(seed,row["input"]["player"],row["input"]["opponent"],[MOVE,ESCAPE])
            if (trial["steps"][-1]["expected"]["state"]["outcome"]=="ran")==wanted:
                add("faint-speed-escape-"+str(wanted).lower(),row["input"]["player"],row["input"]["opponent"],
                    [MOVE,ESCAPE] if wanted else [MOVE,ESCAPE,replace(1),MOVE],seed);break
        else:raise AssertionError("No independent source escape witness")
    add("struggle-double-ko-with-living-bench-wins",[creature(19,40,[33],hp=1,pp=[0,0,0,0]),creature(7,40,[110])],
        creature(7,40,[110],hp=1),[STRUGGLE])
    add("fainted-faster-escape-no-draw",[creature(19,100,[116],hp=1,ability=1),creature(7,40,[110])],
        creature(19,7,[98]),[MOVE,ESCAPE])
    for gap in [0,29,30]:
        for friendship in [0,1,4,5,99,100,199,200,255]:
            mon=creature(7,40,[110],hp=1,status=8);mon["friendship"]=friendship
            add(f"faint-friendship-gap-{gap}-band-{friendship}",[mon,creature(7,40,[110])],
                creature(19,40+gap,[33]),[MOVE,NEXT,replace(1)])
    for sid in [7,8,9,16,17,18,19,20]:
        for ability in ([0,1] if sid>=19 else [0]):
            incoming=creature(sid,40,[33],ability=ability,status=16)
            add(f"switch-source-species-{sid}-ability-{ability}",[creature(7,40,[110]),incoming],
                creature(7,40,[39]),[switch(1),MOVE,switch(0)])
    sequence=[MOVE]
    for index in range(1,6):sequence += [NEXT,replace(index),MOVE]
    add("six-party-total-exhaustion",[creature(7,40,[110],hp=1) for _ in range(6)],
        creature(19,40,[33]),sequence)
    add("struggle-clears-fallback-residual-reads-quick-slot",[creature(19,40,[98],pp=[0,0,0,0],status=8),creature(7,40,[110])],
        creature(20,40,[39],status=16),[STRUGGLE])
    add("wild-last-pp-retained-through-prompt",[creature(7,40,[110],hp=1),creature(7,40,[110])],
        creature(19,40,[33],pp=[1,0,0,0]),[MOVE,NEXT,replace(1),MOVE])
    add("both-residual-faint-with-bench-wins-no-prompt",[creature(19,40,[116],hp=1,status=8),creature(7,40,[110])],
        creature(7,40,[39],hp=1,status=16),[MOVE])
    add("incoming-exhausted-quick-struggle",[creature(7,40,[110]),creature(19,40,[98],pp=[0,0,0,0],status=8)],
        creature(7,40,[39]),[switch(1),STRUGGLE])
    add("switch-keen-eye-blocks-sand-attack",[creature(7,40,[110]),creature(16,40,[33])],
        creature(16,40,[28]),[switch(1),MOVE])
    torrent=creature(7,40,[55]);torrent["hp"]=torrent["stats"]["hp"]//3
    add("switch-torrent-current-hp",[creature(7,40,[110]),torrent],creature(19,40,[39]),[switch(1),MOVE])
    records=[];lock=json.loads((ROOT/"source-lock.json").read_text(encoding="utf-8-sig"))
    pins={r["path"]:r["sha256"] for r in json.loads((ROOT/"reports/source-manifest.json").read_text(encoding="utf-8-sig"))["records"]}
    sources=dict(family.SOURCES)
    sources.update({"src/battle_controller_player.c":"Persistent HP/PP/status data writes target the indexed party member; switch loads full source BattlePokemon",
        "src/battle_util2.c":"Each player faint invokes friendship adjustment, including when another party member remains"})
    for path,evidence in sources.items():
        digest=hashlib.sha256((Path(lock["reference"]["localPath"])/path).read_bytes()).hexdigest();assert digest==pins[path]
        records.append(dict(path=path,sha256=digest,evidence=evidence))
    return dict(schemaVersion=1,sourceFingerprint=family.FINGERPRINT,
        independence="Separate Python source scheduling and retained test-only arithmetic oracle; never production-generated expectations; no ROM comparison",
        scope="Private player party of one through six versus one wild; sixteen moves, automatic Struggle, source voluntary/forced switching and faint escape",
        schedulingAdaptation="Mechanical intro/action/residual ordering only; omit presentation/VBlank frame draws",
        sourceRecords=records,cases=cases)

def main():
    data=json.dumps(fixtures(),indent=2)+"\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8")==data,"Party literal fixtures changed; audit source before regeneration"
        print("Independent party fixture reproduction passed.")
    else:
        TARGET.write_text(data,encoding="utf-8");print(f"Wrote {len(json.loads(data)['cases'])} independent party cases.")

if __name__=="__main__":main()
