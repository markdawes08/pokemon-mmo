"""Independent test-only source arithmetic for the private family battle profile.

Never imports production C, WASM, extraction or TypeScript. Creature arithmetic
uses the preceding independently transcribed evolution oracle. This is a bounded
headless source contract, not an original-game presentation/RNG comparison.
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
spec = importlib.util.spec_from_file_location("independent_evolution", ROOT/"tools/battle-evolution/fixtures/generate_fixtures.py")
species = importlib.util.module_from_spec(spec)
spec.loader.exec_module(species)
FINGERPRINT = species.FINGERPRINT
RATIOS = [(10,40),(10,35),(10,30),(10,25),(10,20),(10,15),(10,10),(15,10),(20,10),(25,10),(30,10),(35,10),(40,10)]
ACCURACY = [(33,100),(36,100),(43,100),(50,100),(60,100),(75,100),(1,1),(133,100),(166,100),(2,1),(233,100),(133,50),(3,1)]
# id: (power, accuracy, type, priority, secondary percent, effect)
MOVES = {33:(35,95,0,0,0,"hit"),39:(0,100,0,0,0,"def-down"),28:(0,100,4,0,0,"acc-down"),
  55:(40,100,11,0,0,"hit"),56:(120,80,11,0,0,"hit"),17:(60,100,2,0,0,"hit"),
  16:(40,100,2,0,0,"hit"),98:(40,100,0,1,0,"hit"),110:(0,0,11,0,0,"def-up"),
  97:(0,0,14,0,0,"speed-up2"),297:(0,100,2,0,0,"atk-down2"),184:(0,90,0,0,0,"speed-down2"),
  145:(20,100,11,0,10,"speed-hit"),44:(60,100,17,0,30,"flinch"),158:(80,90,0,0,10,"flinch"),
  116:(0,0,0,0,0,"focus"),165:(50,100,0,0,0,"recoil")}
ALLOWED = sorted(set(MOVES)-{165})
UNSUPPORTED = sorted(set(species.PP)-{0}-set(ALLOWED))
FOCUS, FLINCH = 1<<20, 1<<3
MOVE = {"kind":"move","slot":0}
RUN = {"kind":"run"}
STRUGGLE = {"kind":"struggle"}
SOURCES = {
 "src/pokemon.c":"CalculateBaseDamage exact integer order; Guts attack multiplier/burn exception and Torrent move-power multiplier; real source statistics",
 "src/battle_main.c":"Mechanical intro; GetWhoStrikesFirst priority/speed; selection cleanup; TryRunFromBattle; FaintClearSetData",
 "src/battle_util.c":"Wild move rejection, flinch attack canceller, source poison/burn residual cases",
 "src/battle_controller_opponent.c":"Random&3 empty-slot loop with downstream zero-PP retry",
 "src/battle_script_commands.c":"accuracy/PP/critical/type/variance/HP; inclusive secondary threshold; turn-order flinch; stat changes; focus energy",
 "data/battle_scripts_1.s":"Self stat/focus scripts omit accuracy; targeted stat scripts do accuracy before PP; source faint and passive-damage order",
 "src/data/battle_moves.h":"Sixteen literal move records and automatic Struggle",
 "src/data/pokemon/species_info.h":"Eight species base stats, types and abilities",
 "src/data/pokemon/level_up_learnsets.h":"Whole-moveset source-level legality including ancestors",
 "include/constants/battle.h":"Poison8, burn16, flinch8 and FocusEnergy1048576 source masks",
}

def creature(s=7, level=40, moves=None, *, hp="full", pp=None, ups=None, status=0, ability=None,
             personality=25, iv=None, ev=None, basis=None):
    c = species.admission(s,level,personality=personality,moves=moves or [33],hp=hp,pp_ups=ups,
                          status=status,ability_num=ability,iv=iv,ev=ev,basis=basis)["creature"]
    c.pop("nature"); c.pop("gender")
    for i,m in enumerate(c["moves"]):
        m["pp"] = pp[i] if pp is not None else species.PP[m["moveId"]]*(5+m["ppUps"])//5
    return c

class Oracle:
    def __init__(self, initial):
        self.initial = deepcopy(initial)
        self.actors = [deepcopy(initial["player"]),deepcopy(initial["opponent"])]
        for mon in self.actors:
            mon["stages"]=[6]*8; mon["status2"]=0
            mon["types"] = [11,11] if mon["speciesId"]<10 else [0,2] if mon["speciesId"]<19 else [0,0]
        self.rng=initial["seed"]; self.draws=self.sequence=self.run_tries=0
        self.turn=1; self.outcome=None; self.wild_slot=None; self.trace=[]; self.events=[]
        self.order("intro"); self.prepare()

    def draw(self, role):
        before=self.rng; self.rng=(before*1103515245+24691)&0xFFFFFFFF; self.draws+=1
        value=self.rng>>16
        self.trace.append(dict(draw=self.draws,role=role,before=before,value=value,after=self.rng))
        return value

    def summary(self):
        return dict(sequence=self.sequence,turn=self.turn,phase="ended" if self.outcome else "choice",outcome=self.outcome,
                    runTries=self.run_tries,wildSlot=self.wild_slot,rngState=self.rng,rngDraws=self.draws,
                    actors=[dict(hp=m["hp"],pp=[x["pp"] for x in m["moves"]],stages=m["stages"][:],
                                 status=m["status"],status2=m["status2"]) for m in self.actors])

    def order(self, phase, slots=None):
        speed=[m["stats"]["speed"]*RATIOS[m["stages"][3]][0]//RATIOS[m["stages"][3]][1] for m in self.actors]
        priority=[0,0] if slots is None else [0 if slot is None else MOVES[165 if slot==4 else self.actors[i]["moves"][slot]["moveId"]][3] for i,slot in enumerate(slots)]
        if priority[0]!=priority[1]: result=[0,1] if priority[0]>priority[1] else [1,0]
        elif speed[0]!=speed[1]: result=[0,1] if speed[0]>speed[1] else [1,0]
        else: result=[1,0] if self.draw(phase+"-speed-tie")&1 else [0,1]
        self.events.append(dict(kind="order",phase=phase,actors=result)); return result

    def prepare(self):
        for mon in self.actors: mon["status2"] &= ~FLINCH
        self.draw("turn-selection")
        if not any(m["pp"] for m in self.actors[1]["moves"]): self.wild_slot=4; return
        while True:
            slot=self.draw("wild-slot-selection")&3
            m=self.actors[1]["moves"][slot]
            if m["moveId"] and m["pp"]: self.wild_slot=slot; return

    def damage(self, actor, move, critical):
        a,t=self.actors[actor],self.actors[actor^1]
        power,_,typ,_,_,_=MOVES[move]; physical=typ<9
        atk_key,def_key,atk_stage,def_stage=("attack","defense",1,2) if physical else ("spAttack","spDefense",4,5)
        attack,defense=a["stats"][atk_key],t["stats"][def_key]
        if physical and a["abilityId"]==62 and a["status"]: attack=attack*150//100
        if typ==11 and a["abilityId"]==67 and a["hp"]<=a["stats"]["hp"]//3: power=power*150//100
        if not(critical==2 and a["stages"][atk_stage]<=6):
            n,d=RATIOS[a["stages"][atk_stage]]; attack=attack*n//d
        if not(critical==2 and t["stages"][def_stage]>=6):
            n,d=RATIOS[t["stages"][def_stage]]; defense=defense*n//d
        assert defense>0
        base=attack*power*(2*a["level"]//5+2)//defense//50
        if physical:
            if a["status"]==16 and a["abilityId"]!=62: base//=2
            base=max(1,base)
        base+=2
        after_critical=base*critical; after_type=after_critical; flags=0
        if move!=165:
            if typ in a["types"]: after_type=after_type*15//10
            if typ==11 and 11 in t["types"]: after_type=max(1,after_type*5//10); flags=4
        rolled=max(1,after_type*(100-self.draw(f"actor{actor}-variance")%16)//100)
        dealt=min(rolled,t["hp"]);t["hp"]-=dealt
        return dict(baseDamage=base,afterCritical=after_critical,afterType=after_type,damage=rolled,hpDealt=dealt,critical=critical,flags=flags)

    def faint(self, actor):
        m=self.actors[actor];m["status"]=m["status2"]=0;m["stages"]=[6]*8
        self.events.append(dict(kind="faint",actor=actor))

    def finish_if_fainted(self):
        hp=[m["hp"] for m in self.actors]
        if not all(hp):
            self.outcome="draw" if hp==[0,0] else "won" if hp[0] else "lost"
            self.events.append(dict(kind="outcome",outcome=self.outcome))

    def attack(self, actor, slot, action_index, action_order):
        a,t=self.actors[actor],self.actors[actor^1]; move=165 if slot==4 else a["moves"][slot]["moveId"]
        power,accuracy,_,_,chance,effect=MOVES[move]
        e=dict(kind="move",actor=actor,slot=slot,moveId=move,flags=0,baseDamage=0,afterCritical=0,afterType=0,
               damage=0,hpDealt=0,critical=1,recoil=0,recoilDealt=0,cancelled=False)
        if a["status2"]&FLINCH:
            a["status2"] &= ~FLINCH; e["cancelled"]=True
            e["targetHP"]=t["hp"];self.events.append(e);return
        if accuracy:
            roll=self.draw(f"actor{actor}-accuracy")%100+1
            stage=max(0,min(12,a["stages"][6]+6-t["stages"][7]));n,d=ACCURACY[stage]
            if roll>accuracy*n//d:e["flags"]=1
        if slot!=4:a["moves"][slot]["pp"]-=1
        if e["flags"]==1: pass
        elif effect=="focus":
            if a["status2"]&FOCUS:e["flags"]=32
            else:a["status2"]|=FOCUS
        elif power==0:
            stat,delta,self_target={"def-down":(2,-1,False),"acc-down":(6,-1,False),"def-up":(2,1,True),
                "speed-up2":(3,2,True),"atk-down2":(1,-2,False),"speed-down2":(3,-2,False)}[effect]
            target=a if self_target else t;before=target["stages"][stat]
            prevented=stat==6 and target["abilityId"]==51
            after=before if prevented else max(0,min(12,before+delta));target["stages"][stat]=after
            e.update(stat=stat,stageBefore=before,stageAfter=after,abilityPrevented=prevented)
            if not prevented and before==after:e["flags"]=1
        else:
            critical=2 if self.draw(f"actor{actor}-critical")%(4 if a["status2"]&FOCUS else 16)==0 else 1
            e.update(self.damage(actor,move,critical))
            if move==165:
                e["recoil"]=max(1,e["hpDealt"]//4);e["recoilDealt"]=min(a["hp"],e["recoil"]);a["hp"]-=e["recoilDealt"]
            else:
                residue=self.draw(f"actor{actor}-secondary")%100;e["secondaryRoll"]=residue
                if effect in ("speed-hit","flinch"):
                    e["secondaryTriggered"]=residue<=chance and t["hp"]>0
                    if e["secondaryTriggered"]:
                        if effect=="speed-hit":t["stages"][3]=max(0,t["stages"][3]-1)
                        elif action_order.index(actor^1)>action_index:t["status2"]|=FLINCH
        e["targetHP"]=t["hp"];self.events.append(e)
        if not a["hp"]:self.faint(actor)
        if not t["hp"]:self.faint(actor^1)
        self.finish_if_fainted()

    def advance(self, choice):
        assert not self.outcome
        self.events=[];self.trace=[]
        if choice["kind"]=="run":
            chosen_slots=[None,self.wild_slot]
            self.events.append(dict(kind="order",phase="actions",actors=[0,1]));a,t=self.actors
            if a["abilityId"]==50:success=True
            else:
                threshold=(a["stats"]["speed"]*128//t["stats"]["speed"]+self.run_tries*30)&255
                success=a["stats"]["speed"]>=t["stats"]["speed"] or threshold>(self.draw("run-escape")&255)
                self.run_tries=(self.run_tries+1)&255
            self.events.append(dict(kind="run",success=success,runTries=self.run_tries))
            if success:self.outcome="ran";self.events.append(dict(kind="outcome",outcome="ran"))
            else:self.attack(1,self.wild_slot,1,[0,1])
        else:
            player_slot=4 if choice["kind"]=="struggle" else choice["slot"]
            chosen_slots=[player_slot,self.wild_slot]
            assert (player_slot==4)==(not any(m["pp"] for m in self.actors[0]["moves"]))
            assert player_slot==4 or self.actors[0]["moves"][player_slot]["pp"]>0
            order=self.order("actions",[player_slot,self.wild_slot])
            for index,actor in enumerate(order):
                self.attack(actor,player_slot if actor==0 else self.wild_slot,index,order)
                if self.outcome:break
        if not self.outcome:
            # DoFieldEndTurnEffects retains FALSE (not intro's TRUE): selected
            # move priorities remain relevant during its source order pass.
            order=self.order("residual",chosen_slots)
            for actor in order:
                m=self.actors[actor]
                if m["status"]:
                    damage=max(1,m["stats"]["hp"]//8);dealt=min(damage,m["hp"]);m["hp"]-=dealt
                    self.events.append(dict(kind="residual",actor=actor,status=m["status"],damage=damage,hpDealt=dealt,hp=m["hp"]))
                    if not m["hp"]:self.faint(actor)
                    self.finish_if_fainted()
                    if self.outcome:break
            if not self.outcome:self.turn+=1;self.prepare()
        self.sequence+=1
        return dict(state=self.summary(),events=deepcopy(self.events),trace=deepcopy(self.trace))

def transcript(seed,player,opponent,choices):
    initial=dict(kind="diagnostic",seed=seed,player=player,opponent=opponent);o=Oracle(initial)
    result=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        result["steps"].append(dict(choice=deepcopy(choice),expected=o.advance(choice)))
    return result

def move_events(row):return [e for step in row["steps"] for e in step["expected"]["events"] if e["kind"]=="move"]

def fixtures():
    cases=[]
    def add(name,player,opponent,choices,predicate=lambda r:True,limit=20000):
        for seed in range(limit):
            row=transcript(seed,player,opponent,choices)
            if predicate(row):cases.append(dict(id=name,**row));return row
        raise AssertionError("No independent case: "+name)
    passive=creature(7,100,[110])
    owners={33:7,39:7,28:16,55:7,56:7,17:16,16:16,98:19,110:7,97:16,297:16,184:20,145:7,44:7,158:19,116:19}
    for move in ALLOWED:
        add(f"move-{move}-source",creature(owners[move],100,[move]),passive,[MOVE]*2)
    for s in species.NAMES:
        add(f"species-{s}-both-sides",creature(s,40,[33]),creature(s,40,[33]),[MOVE]*3)
    for nature in range(25):
        add(f"nature-{nature}-water",creature(7,40,[55],personality=nature),creature(20,40,[39]),[MOVE])
    for s in (7,8,9):
        for offset in (-1,0,1):
            c=creature(s,55,[55]);c["hp"]=c["stats"]["hp"]//3+offset
            add(f"torrent-{s}-threshold{offset}",c,creature(9,55,[110]),[MOVE])
    for s in (19,20):
        for ability in (0,1):
            for status in (0,8,16):
                add(f"guts-{s}-ability{ability}-status{status}",creature(s,40,[33],ability=ability,status=status),creature(7,40,[110]),[MOVE]*2)
    add("burn-special-unaffected",creature(7,40,[55],status=16),creature(7,40,[110]),[MOVE]*2)
    add("keen-eye-accuracy-only",creature(16,40,[28,297]),creature(17,40,[97]),[MOVE,{"kind":"move","slot":1}])
    for move,s,other in [(110,7,creature(16,100,[97])),(97,16,passive),(297,16,passive),(184,20,passive),
                         (39,7,creature(16,100,[97])),(28,16,passive)]:
        add(f"stage-limit-{move}",creature(s,100,[move]),other,[MOVE]*9)
    add("focus-energy-repeat-and-critical",creature(19,40,[116,33]),creature(7,40,[110]),
        [MOVE,MOVE,{"kind":"move","slot":1}],lambda r:any(e["actor"]==0 and e["critical"]==2 for e in move_events(r)))
    add("priority-over-faster-opponent",creature(19,7,[98]),creature(18,50,[97]),[MOVE])
    add("equal-priority-speed-tie",creature(19,40,[98]),creature(19,40,[98]),[MOVE]*2)
    add("agility-changes-later-order",creature(16,40,[97,33]),creature(20,40,[39]),[MOVE,{"kind":"move","slot":1}])
    for move,s,chance in [(145,7,10),(44,7,30),(158,19,10)]:
        for residue in (0,chance,chance+1,99):
            add(f"secondary-{move}-residue{residue}",creature(s,60,[move]),creature(7,60,[110]),[MOVE],
                lambda r,residue=residue:any(e["actor"]==0 and e.get("secondaryRoll")==residue for e in move_events(r)))
    add("flinch-fast-prevents-pp-and-rng",creature(19,60,[158]),creature(7,60,[55]),[MOVE]*2,
        lambda r:any(e["actor"]==1 and e["cancelled"] for e in move_events(r)))
    add("flinch-slow-cannot-delay-next-turn",creature(7,40,[44]),creature(20,40,[116]),[MOVE]*2,
        lambda r:any(e["actor"]==0 and e.get("secondaryTriggered") for e in move_events(r)))
    add("flinch-can-cancel-focus-energy",creature(20,40,[158]),creature(19,40,[116]),[MOVE],
        lambda r:any(e["actor"]==1 and e["cancelled"] for e in move_events(r)))
    add("flinch-can-cancel-automatic-struggle",creature(20,40,[158]),creature(7,40,[33],pp=[0]*4),[MOVE],
        lambda r:any(e["actor"]==1 and e["cancelled"] for e in move_events(r)))
    for status in (8,16):
        add(f"residual-{status}-three-turns",creature(7,40,[110],status=status),creature(16,40,[97],status=status),[MOVE]*3)
        add(f"residual-{status}-first-faint-stops-other",creature(7,40,[110],status=status,hp=1),creature(16,40,[97],status=status,hp=1),[MOVE])
    add("run-away-slower-no-run-draw",creature(19,1,[33],ability=0),creature(18,100,[97]),[RUN])
    add("run-guts-slower-fail-then-success",creature(19,30,[33],ability=1),creature(18,60,[97]),[RUN]*12,
        lambda r:len(r["steps"])>1 and r["steps"][-1]["expected"]["state"]["outcome"]=="ran")
    add("run-ignores-agility-stages",creature(16,40,[97]),creature(18,40,[97]),[MOVE,RUN])
    add("wild-empty-and-zero-pp-retry",creature(7,40,[110]),creature(19,40,[33,39],pp=[0,30,0,0]),[MOVE],
        lambda r:len([d for d in r["initial"]["trace"] if d["role"]=="wild-slot-selection"])>=4)
    add("last-pp-then-struggle",creature(7,40,[33],pp=[1,0,0,0]),creature(7,40,[110]),[MOVE,STRUGGLE,STRUGGLE])
    add("both-struggle-no-ai-draw",creature(7,40,[33],pp=[0]*4),creature(7,40,[33],pp=[0]*4),[STRUGGLE]*3)
    add("struggle-double-faint",creature(20,40,[33],pp=[0]*4,hp=1),creature(7,40,[33],pp=[0]*4,hp=1),[STRUGGLE],
        lambda r:r["steps"][-1]["expected"]["state"]["outcome"]=="draw")
    add("focus-faint-clears-status2",creature(19,20,[116],hp=1,status=8),creature(7,20,[110]),[MOVE])
    add("normal-critical-ignores-negative-attack",creature(19,60,[33]),creature(16,60,[297]),[MOVE]*4,
        lambda r:any(e["actor"]==0 and e["critical"]==2 for e in move_events(r)[2:]))
    for move,s in [(33,7),(56,7),(158,19),(184,20)]:
        add(f"miss-{move}",creature(s,100,[move]),passive,[MOVE],lambda r:any(e["actor"]==0 and e["flags"]==1 for e in move_events(r)))
    for s in species.NAMES:
        for level in (1,100):
            add(f"level-boundary-{s}-{level}",creature(s,level,[33],ups=[3,0,0,0]),creature(s,level,[33]),[MOVE])
    for value in (0,31):
        add(f"iv-boundary-{value}",creature(7,40,[55],iv=dict.fromkeys(species.KEYS,value)),creature(7,40,[110]),[MOVE])
    ev=dict.fromkeys(species.KEYS,0);ev.update(hp=255,attack=255)
    add("cached-ev-provenance-no-battle-recalculation",creature(19,40,[33],ev=ev,basis=dict.fromkeys(species.KEYS,0)),creature(7,40,[110]),[MOVE])
    records=[];lock=json.loads((ROOT/"source-lock.json").read_text(encoding="utf-8-sig"))
    pins={r["path"]:r["sha256"] for r in json.loads((ROOT/"reports/source-manifest.json").read_text(encoding="utf-8-sig"))["records"]}
    for path,evidence in SOURCES.items():
        digest=hashlib.sha256((Path(lock["reference"]["localPath"])/path).read_bytes()).hexdigest();assert digest==pins[path]
        records.append(dict(path=path,sha256=digest,evidence=evidence))
    return dict(schemaVersion=1,sourceFingerprint=FINGERPRINT,
        independence="Separate literal Python source formulas plus earlier independent species oracle; no production-generated expectations or original-ROM comparison",
        scope="Private one-active singles diagnostics, sixteen family moves plus automatic Struggle, poison/burn; no live, durable, item or party-switch effects",
        schedulingAdaptation="Explicit seed before mechanical intro; omit presentation/VBlank RNG, retain source intro/action/residual ordering and wild preselection",
        allowedMoves=ALLOWED,unsupportedFamilyMoves=UNSUPPORTED,sourceRecords=records,cases=cases)

def main():
    data=json.dumps(fixtures(),indent=2)+"\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8")==data,"Independent family literals changed; audit source before regeneration"
        print("Independent family fixture reproduction passed.")
    else:
        TARGET.write_text(data,encoding="utf-8");print(f"Wrote {len(json.loads(data)['cases'])} independent family cases.")

if __name__=="__main__":main()
