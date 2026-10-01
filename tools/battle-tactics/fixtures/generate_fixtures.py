"""Independent source-literal tactics oracle; never imports production mechanics.

The earlier test-only party scheduler supplies unchanged switching semantics.
New arithmetic/order below is separately transcribed from the pinned source,
not emitted C or a WASM run. This is not an original-ROM RNG comparison.
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
spec = importlib.util.spec_from_file_location("independent_party", ROOT/"tools/battle-party/fixtures/generate_fixtures.py")
party = importlib.util.module_from_spec(spec)
spec.loader.exec_module(party)
family = party.family
creature = party.creature
MOVE, RUN, STRUGGLE, NEXT, ESCAPE = party.MOVE, party.RUN, party.STRUGGLE, party.NEXT, party.ESCAPE
switch, replace = party.switch, party.replace
NEW_MOVES = {162:(1,90,0,0,0,"half"),283:(1,100,0,0,0,"difference"),
             229:(20,100,0,0,0,"spin"),240:(0,0,11,0,0,"rain"),18:(0,100,0,-6,0,"force")}
family.MOVES.update(NEW_MOVES)
ALLOWED = sorted(family.ALLOWED + list(NEW_MOVES))
UNSUPPORTED = [119,130,182,228]

class Oracle(party.Oracle):
    def __init__(self, initial):
        self.weather = 0
        self.duration = 0
        super().__init__(initial)

    def summary(self):
        value = super().summary()
        value.update(weather=self.weather,weatherDuration=self.duration)
        return value

    def weather_event(self, phase):
        self.events.append(dict(kind="weather",phase=phase,weather="rain" if self.weather else "clear",turnsRemaining=self.duration))

    def damage(self, actor, move, critical):
        # Source CalculateBaseDamage: Water rain multiplier is before +2,
        # critical, STAB/type and variance, unlike a final damage multiplier.
        a,t=self.actors[actor],self.actors[actor^1]
        power,_,typ,_,_,_=family.MOVES[move];physical=typ<9
        atk_key,def_key,atk_stage,def_stage=("attack","defense",1,2) if physical else ("spAttack","spDefense",4,5)
        attack,defense=a["stats"][atk_key],t["stats"][def_key]
        if physical and a["abilityId"]==62 and a["status"]:attack=attack*150//100
        if typ==11 and a["abilityId"]==67 and a["hp"]<=a["stats"]["hp"]//3:power=power*150//100
        if not(critical==2 and a["stages"][atk_stage]<=6):
            n,d=family.RATIOS[a["stages"][atk_stage]];attack=attack*n//d
        if not(critical==2 and t["stages"][def_stage]>=6):
            n,d=family.RATIOS[t["stages"][def_stage]];defense=defense*n//d
        assert defense>0
        base=attack*power*(2*a["level"]//5+2)//defense//50
        if physical:
            if a["status"]==16 and a["abilityId"]!=62:base//=2
            base=max(1,base)
        elif self.weather and typ==11:base=15*base//10
        base+=2
        after_critical=base*critical;after_type=after_critical;flags=0
        if move!=165:
            if typ in a["types"]:after_type=after_type*15//10
            if typ==11 and 11 in t["types"]:after_type=max(1,after_type*5//10);flags=4
        rolled=max(1,after_type*(100-self.draw(f"actor{actor}-variance")%16)//100)
        dealt=min(rolled,t["hp"]);t["hp"]-=dealt
        return dict(baseDamage=base,afterCritical=after_critical,afterType=after_type,damage=rolled,hpDealt=dealt,critical=critical,flags=flags)

    def attack(self, actor, slot, action_index, action_order):
        self.no_valid[actor]=False
        a,t=self.actors[actor],self.actors[actor^1]
        move=165 if slot==4 else a["moves"][slot]["moveId"]
        if move not in NEW_MOVES:return super().attack(actor,slot,action_index,action_order)
        _,accuracy,_,_,_,effect=family.MOVES[move]
        e=dict(kind="move",actor=actor,slot=slot,moveId=move,flags=0,baseDamage=0,afterCritical=0,afterType=0,
               damage=0,hpDealt=0,critical=1,recoil=0,recoilDealt=0,cancelled=False)
        if a["status2"]&family.FLINCH:
            a["status2"] &= ~family.FLINCH;e["cancelled"]=True;e["targetHP"]=t["hp"];self.events.append(e);return
        # Endeavor/Whirlwind/Rain Dance spend PP before their special guards.
        pp_first=effect in ("difference","force","rain")
        if pp_first:a["moves"][slot]["pp"]-=1
        if effect=="difference":
            if t["hp"]<=a["hp"]:e["flags"]=32
            else:e.update(damage=t["hp"]-a["hp"],hpDealt=t["hp"]-a["hp"])
        if accuracy and not e["flags"]:
            roll=self.draw(f"actor{actor}-accuracy")%100+1
            stage=max(0,min(12,a["stages"][6]+6-t["stages"][7]));n,d=family.ACCURACY[stage]
            if roll>accuracy*n//d:e["flags"]=1
        if not pp_first:a["moves"][slot]["pp"]-=1
        if e["flags"]:pass
        elif effect=="rain":
            if self.weather:e["flags"]=1
            else:self.weather=1;self.duration=5
        elif effect=="force":
            success=True
            if a["level"]<t["level"]:
                rand=self.draw(f"actor{actor}-force-out")&255
                total=((rand*(a["level"]+t["level"]))>>8)+1
                success=total>t["level"]//4
                e.update(forceRoll=rand,forceValue=total,forceThreshold=t["level"]//4)
            if success:self.outcome="forced-escape";self.phase="ended"
            else:e["flags"]=32
        elif effect in ("half","difference"):
            damage=max(1,t["hp"]//2) if effect=="half" else t["hp"]-a["hp"]
            dealt=min(damage,t["hp"]);t["hp"]-=dealt;e.update(damage=damage,hpDealt=dealt)
            e["secondaryRoll"]=self.draw(f"actor{actor}-secondary")%100
        else:
            critical=2 if self.draw(f"actor{actor}-critical")%(4 if a["status2"]&family.FOCUS else 16)==0 else 1
            e.update(self.damage(actor,move,critical))
            # Certain Rapid Spin effect never calls Random for effect chance.
        e["targetHP"]=t["hp"];self.events.append(e)
        if effect=="rain":self.weather_event("move")
        if self.outcome=="forced-escape":self.events.append(dict(kind="outcome",outcome=self.outcome));return
        if not a["hp"]:self.faint(actor)
        if not t["hp"]:self.faint(actor^1)
        self.finish_if_fainted()

    def residual(self):
        slots=[]
        for actor,slot in enumerate(self.chosen_slots):
            if self.no_valid[actor]:slots.append(4)
            elif slot is None:slots.append(None)
            else:
                actual=0 if slot==4 else slot
                slots.append(actual if self.actors[actor]["moves"][actual]["moveId"] else None)
        order=self.order("residual",slots)
        # Source DoFieldEndTurnEffects orders actors before ENDTURN_RAIN.
        if self.weather:
            self.duration-=1
            if not self.duration:self.weather=0
            self.weather_event("end-turn")
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

def transcript(seed,player,opponent,choices):
    initial=dict(kind="diagnostic",seed=seed,player=player,opponent=opponent);o=Oracle(initial)
    row=dict(input=deepcopy(initial),initial=dict(state=o.summary(),events=deepcopy(o.events),trace=deepcopy(o.trace)),steps=[])
    for choice in choices:
        if o.outcome:break
        row["steps"].append(dict(choice=deepcopy(choice),expected=o.advance(choice)))
    return row

def moves(row):return [e for step in row["steps"] for e in step["expected"]["events"] if e["kind"]=="move"]

def fixtures():
    cases=[]
    def add(name,roster,wild,choices,seed=0,predicate=None,limit=20000):
        for candidate in range(seed,seed+limit if predicate else seed+1):
            row=transcript(candidate,roster,wild,choices)
            if predicate is None or predicate(row):cases.append(dict(id=name,**row));return row
        raise AssertionError("No independent source witness: "+name)
    # Re-evaluate the prior test oracle's inputs, never copy WASM expectations.
    controls=party.fixtures()
    for old in controls["cases"]:
        add(old["id"],old["input"]["player"],old["input"]["opponent"],
            [s["choice"] for s in old["steps"]],old["input"]["seed"])
    passive=creature(7,100,[110])
    for hp in [1,2,3,4,7,99,100,passive["stats"]["hp"]]:
        target=deepcopy(passive);target["hp"]=hp
        add(f"fang-target-hp-{hp}",[creature(19,100,[162])],target,[MOVE])
    for status in [0,8,16]:
        for ability in [0,1]:
            add(f"fang-status-{status}-ability-{ability}",[creature(19,60,[116,162],status=status,ability=ability)],
                creature(7,60,[110]),[MOVE,dict(kind="move",slot=1)])
    add("fang-miss-spends-pp-no-critical-or-variance",[creature(19,100,[162])],passive,[MOVE],
        predicate=lambda r:any(e["actor"]==0 and e["flags"]==1 for e in moves(r)))
    for difference in [-1,0,1,70]:
        a=creature(19,60,[283],hp=50);t=creature(7,60,[110],hp=50+difference)
        add(f"endeavor-hp-difference-{difference}",[a],t,[MOVE])
    add("endeavor-faster-hit-changes-difference",[creature(19,60,[283])],creature(20,70,[33]),[MOVE])
    add("endeavor-accuracy-miss-after-pp",[creature(19,60,[283],hp=1)],creature(18,100,[28]),[MOVE]*2,
        predicate=lambda r:any(e["actor"]==0 and e["flags"]==1 for e in moves(r)))
    for status in [0,8,16]:
        add(f"endeavor-fixed-not-scaled-status-{status}",[creature(19,60,[283],hp=30,status=status,ability=1)],
            creature(7,60,[110]),[MOVE])
    for sid in [7,8,9]:
        add(f"spin-species-{sid}-no-secondary-draw",[creature(sid,60,[229])],creature(19,60,[116]),[MOVE]*2)
    add("spin-knockout-still-certain-effect",[creature(9,60,[229])],creature(19,60,[116],hp=1),[MOVE])
    add("spin-accuracy-miss-no-certain-effect",[creature(7,60,[229])],creature(18,100,[28]),[MOVE]*2,
        predicate=lambda r:any(e["actor"]==0 and e["flags"]==1 for e in moves(r)))
    for move,sid in [(162,19),(283,19),(229,7),(240,7),(18,16)]:
        add(f"new-move-{move}-source-PP-bonus-3",[creature(sid,100,[move],ups=[3,0,0,0])],passive,[MOVE])
        add(f"flinch-cancels-new-move-{move}",[creature(sid,60,[move])],creature(20,60,[158]),[MOVE],
            predicate=lambda r:any(e["actor"]==0 and e["cancelled"] for e in moves(r)))
    # Rain casting turn ticks immediately; failed repeats cannot refresh.
    add("rain-five-turns-repeat-and-recast",[creature(7,60,[240,110])],creature(7,60,[110]),
        [MOVE,MOVE]+[dict(kind="move",slot=1)]*3+[MOVE,dict(kind="move",slot=1)])
    add("wild-rain-no-accuracy-or-damage-rng",[creature(7,60,[110])],creature(9,60,[240]),[MOVE]*6)
    for water in [55,56,145]:
        for sid in [7,8,9]:
            for torrent in [False,True]:
                a=creature(sid,60,[240,water]);a["hp"]=a["stats"]["hp"]//3 if torrent else a["hp"]
                add(f"rain-water-{water}-species-{sid}-torrent-{torrent}",[a],creature(9,60,[110]),
                    [MOVE,dict(kind="move",slot=1)])
        add(f"rain-wild-water-{water}",[creature(9,60,[240,110])],creature(7,60,[water]),[MOVE,dict(kind="move",slot=1)])
    for nature in range(25):
        add(f"rain-rounded-base-nature-{nature}",[creature(7,60,[240,55],personality=nature)],
            creature(7,60,[110]),[MOVE,dict(kind="move",slot=1)])
    for status in [8,16]:
        add(f"rain-guts-status-{status}-switch-preserves-weather",[creature(7,60,[240]),creature(19,60,[33],status=status,ability=1)],
            creature(7,60,[110]),[MOVE,switch(1),MOVE])
        add(f"rain-post-residual-faint-{status}",[creature(7,60,[240],hp=1,status=status),creature(7,60,[110],status=status)],
            creature(7,60,[110],status=status),[MOVE,NEXT,replace(1),MOVE])
        add(f"rain-pre-residual-faint-{status}",[creature(7,60,[240]),creature(7,60,[110],hp=1,status=status),creature(7,60,[110])],
            creature(19,60,[33]),[MOVE,switch(1),NEXT,replace(2),MOVE])
    add("rain-fifth-turn-water-still-boosted",[creature(7,60,[240,110,55])],creature(9,60,[110]),
        [MOVE]+[dict(kind="move",slot=1)]*3+[dict(kind="move",slot=2)]*2)
    add("rain-new-cast-paused-at-five-before-residual",[creature(19,40,[33],hp=1,pp=[0,0,0,0]),creature(7,40,[110])],
        creature(9,100,[240]),[STRUGGLE,NEXT,replace(1),MOVE])
    expiry=creature(7,60,[240,110],status=8);expiry["hp"]=5*(expiry["stats"]["hp"]//8)
    add("rain-expiry-before-post-residual-faint",[expiry,creature(7,60,[110])],creature(7,60,[39]),
        [MOVE]+[dict(kind="move",slot=1)]*4+[NEXT,replace(1),MOVE])
    for actor in [0,1]:
        for alevel,tlevel in [(60,60),(100,60),(20,100),(60,100)]:
            force=creature(16,alevel,[18]);target=creature(7,tlevel,[110])
            roster,wild=([force],target) if actor==0 else ([target],force)
            for success in ([True,False] if alevel<tlevel else [True]):
                add(f"whirlwind-actor-{actor}-levels-{alevel}-{tlevel}-success-{success}",roster,wild,[MOVE],
                    predicate=lambda r,success=success:(r["steps"][-1]["expected"]["state"]["outcome"]=="forced-escape")==success)
    # Literal gate witnesses closest to each side of the lower-level cutoff.
    for roll in [52,53,54,55,255]:
        add(f"whirlwind-lower-boundary-roll-{roll}",[creature(16,20,[18])],creature(7,100,[110]),[MOVE],
            predicate=lambda r,roll=roll:any(e.get("forceRoll")==roll for e in moves(r)))
    for size in range(1,7):
        add(f"wild-whirlwind-party-{size}-ends-not-shuffles",[creature(7,60,[110]) for _ in range(size)],
            creature(16,100,[18]),[MOVE])
    add("wild-whirlwind-targets-incoming-switch",[creature(7,60,[110]),creature(7,100,[110])],
        creature(16,60,[18]),[switch(1)])
    add("whirlwind-negative-priority-even-agility",[creature(16,100,[97,18])],creature(19,40,[98]),[MOVE,dict(kind="move",slot=1)])
    add("rain-forced-end-no-timer-tick",[creature(7,60,[240]),creature(16,100,[18])],creature(7,60,[110]),
        [MOVE,switch(1),MOVE])
    add("rain-run-no-timer-tick",[creature(7,60,[240]),creature(19,60,[116],ability=0)],creature(7,60,[110]),
        [MOVE,switch(1),RUN])
    # The admitted Whirlwind family has Keen Eye, so Sand Attack cannot create
    # an accuracy miss; do not invent a source-unreachable lower-stage input.
    add("whirlwind-keen-eye-accuracy-retained",[creature(16,40,[18])],creature(16,100,[28]),[MOVE])
    records=deepcopy(controls["sourceRecords"])
    additions={
      "src/battle_script_commands.c":"Super Fang half-HP, Endeavor pre-accuracy HP guard/cache, source certain Rapid Spin, Rain Dance and lower-level forced-out gate",
      "src/pokemon.c":"Rain Water damage multiplier after integer base division and before +2, critical/STAB/type/variance; retain Torrent/Guts order",
      "src/battle_util.c":"Source actor end-turn ordering precedes temporary rain countdown, which precedes poison/burn residuals",
      "data/battle_scripts_1.s":"Fixed damage scripts, certain-effect Rapid Spin path, Rain Dance failure and wild PLAYER_TELEPORTED termination",
      "src/data/battle_moves.h":"Five added source move records, accuracy, PP, target and Whirlwind priority -6"}
    for record in records:
        if record["path"] in additions:record["evidence"] += "; " + additions[record["path"]]
    return dict(schemaVersion=1,sourceFingerprint=family.FINGERPRINT,
        independence="Independent test-only Python source formulas and scheduling; no production-generated expectations or original-ROM comparison",
        scope="Private player party versus one wild; twenty-one source moves, generated temporary rain, forced wild battle end; no live/durable outcomes",
        schedulingAdaptation=controls["schedulingAdaptation"],allowedMoves=ALLOWED,unsupportedFamilyMoves=UNSUPPORTED,
        sourceRecords=records,cases=cases)

def main():
    data=json.dumps(fixtures(),indent=2)+"\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8")==data,"Independent tactics literals changed; audit source before regeneration"
        print("Independent tactics fixture reproduction passed.")
    else:
        TARGET.write_text(data,encoding="utf-8");print(f"Wrote {len(json.loads(data)['cases'])} independent tactics cases.")

if __name__=="__main__":main()
