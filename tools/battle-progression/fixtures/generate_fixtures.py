"""Independent source-literal progression oracle; no production module imports.

Diagnostic high levels/EVs and explicit XP overrides are arithmetic fixtures,
not claims that the bounded level-five combat profile can reach those states.
The player has fixed Squirtle identity, Hardy personality25, IV15, healthy/no
held item/no Pokerus. Friendship metadata is supplied explicitly.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
TARGET = Path(__file__).with_name("source-cases.json")
FINGERPRINT = "f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982"
KEYS = ("hp", "attack", "defense", "speed", "spAttack", "spDefense")
BASE = dict(zip(KEYS, (44, 48, 65, 43, 50, 64)))
LEARN = [(1, 33, 35), (4, 39, 30), (7, 145, 30), (10, 110, 40),
         (13, 55, 25), (18, 44, 25), (23, 229, 40), (28, 182, 10),
         (33, 240, 5), (40, 130, 15), (47, 56, 5)]
PPS = {move: pp for _, move, pp in LEARN}
SOURCE_EVIDENCE = {
    "src/battle_script_commands.c": "Cmd_getexp sole living recipient formula/EV before XP/level100 skip; level friendship and learned-move branch order",
    "src/battle_controller_player.c": "Task_GiveExpToMon and Task_GiveExpWithExpBar use >=, clamp at each next-level threshold and return leftover award",
    "src/battle_util.c": "HandleFaintedMonActions awards each defeated member once before terminal continuation",
    "src/pokemon.c": "MonGainEVs255/510 caps; CalculateMonStats cached HP delta; AdjustFriendship; MonTryLearningNewMove; GiveMoveToMon; SetMonMoveSlot",
    "src/battle_main.c": "Evolution is considered only after a WON outcome and a newly set level-up bit",
    "data/battle_scripts_1.s": "Each level learns moves before getexp resumes remaining award; replace/decline continuation",
    "src/data/pokemon/species_info.h": "Squirtle base stats; Pidgey exp55 and Rattata exp57; both Speed EV1",
    "src/data/pokemon/experience_tables.h": "Medium Slow table, including explicit level1=1 and integer division order",
    "src/data/pokemon/level_up_learnsets.h": "Complete Squirtle level-up move sequence through Hydro Pump47",
    "src/data/pokemon/evolution.h": "Squirtle EVO_LEVEL16 Wartortle8; no species mutation in this handoff",
    "src/data/battle_moves.h": "Source base PP for all eleven Squirtle learned moves",
    "include/constants/pokemon.h": "MAX_PER_STAT_EVS255, MAX_TOTAL_EVS510, MAX_LEVEL100, friendship255",
}


def experience(level):
    return 1 if level == 1 else 6*level**3//5 - 15*level**2 + 100*level - 140


def stats(level, evs):
    return {key: ((2*BASE[key] + 15 + evs[key]//4)*level)//100 + (level+10 if key == "hp" else 5) for key in KEYS}


def initial(level=5, xp=None, hp=None, evs=None, calculated_evs=None, friendship=70, moves=None, pp=None,
            defeated_species=16, defeated_level=2, same_met=False, luxury=False, override=None):
    evs = dict(evs) if evs else dict.fromkeys(KEYS, 0)
    basis = dict(calculated_evs) if calculated_evs else deepcopy(evs)
    attributes = stats(level, basis)
    selected = [move for at, move, _ in LEARN if at <= level][-4:] if moves is None else list(moves)
    move_rows = [dict(moveId=move, pp=PPS[move] if pp is None else pp[index], ppUps=0) for index, move in enumerate(selected)]
    while len(move_rows) < 4:
        move_rows.append(dict(moveId=0, pp=0, ppUps=0))
    result = dict(creature=dict(speciesId=7, abilityId=67, personality=25, otId=1,
                               level=level, experience=experience(level) if xp is None else xp,
                               friendship=friendship, hp=attributes["hp"] if hp is None else hp,
                               stats=attributes, ivs=dict.fromkeys(KEYS, 15), evs=evs, calculatedEvs=basis, moves=move_rows,
                               status=0, heldItemId=0),
                  defeated=dict(speciesId=defeated_species, level=defeated_level),
                  friendshipContext=dict(ballItemId=11 if luxury else 4, metLocation=101 if same_met else 88, currentRegion=101))
    if override is not None:
        result["experienceOverride"] = override
    return result


class Oracle:
    def __init__(self, admission):
        self.admission = deepcopy(admission)
        self.mon = deepcopy(admission["creature"])
        self.stat_basis_evs = deepcopy(self.mon["calculatedEvs"])
        self.source_award = (55 if admission["defeated"]["speciesId"] == 16 else 57)*admission["defeated"]["level"]//7
        self.award = admission.get("experienceOverride", self.source_award) if self.mon["level"] < 100 and self.mon["hp"] else 0
        self.remaining = self.award
        self.applied = 0
        self.leveled = False
        self.pending_move = 0
        self.evolution = 0
        self.phase = "running"
        self.events = []
        self.decisions = 0
        # Source EV gain occurs once, before the first XP chunk, and is skipped
        # entirely when Cmd_getexp skips a level100/fainted recipient.
        if self.award:
            evs = self.mon["evs"]
            gain = min(1, 510-sum(evs.values()), 255-evs["speed"])
            evs["speed"] += gain
        self.run()

    def snapshot(self):
        api_events = []
        for index, event in enumerate(self.events):
            kind = event["kind"]
            if kind == "experience":
                # The declared diagnostic event surface emits one level-up
                # event for a threshold chunk, not a second XP event.
                if index+1 < len(self.events) and self.events[index+1]["kind"] == "level":
                    continue
                api_events.append(dict(kind="experience", value=event["amount"], slot=0))
            elif kind == "level":
                api_events.append(dict(kind="level-up", value=event["level"], slot=0))
            elif kind in ("learn", "replace", "decline"):
                api_events.append(dict(kind={"learn": "learned-move", "replace": "replaced-move", "decline": "declined-move"}[kind],
                                       value=event["moveId"], slot=event.get("slot", 4)))
        if self.phase == "complete":
            api_events.append(dict(kind="complete", value=0, slot=0))
        elif self.phase == "pending-evolution":
            api_events.append(dict(kind="evolution", value=8, slot=0))
        return dict(phase=self.phase, creature=deepcopy(self.mon), remainingExperience=self.remaining,
                    sourceAward=self.source_award, awardExperience=self.award, appliedExperience=self.applied,
                    pendingMove=self.pending_move, evolutionSpecies=self.evolution,
                    statBasisEvs=deepcopy(self.stat_basis_evs), decisions=self.decisions,
                    events=deepcopy(self.events), apiEvents=api_events)

    def run(self):
        while self.remaining:
            mon = self.mon
            if mon["level"] == 100:
                self.remaining = 0
                break
            target = experience(mon["level"]+1)
            chunk = min(self.remaining, target-mon["experience"])
            mon["experience"] += chunk
            self.remaining -= chunk
            self.applied += chunk
            self.events.append(dict(kind="experience", amount=chunk, experience=mon["experience"]))
            if mon["experience"] < target:
                break
            previous_hp = mon["stats"]["hp"]
            mon["level"] += 1
            mon["stats"] = stats(mon["level"], mon["evs"])
            self.stat_basis_evs = deepcopy(mon["evs"])
            mon["calculatedEvs"] = deepcopy(mon["evs"])
            mon["hp"] += mon["stats"]["hp"] - previous_hp
            delta = 5 if mon["friendship"] < 100 else 3 if mon["friendship"] < 200 else 2
            context = self.admission["friendshipContext"]
            delta += context["ballItemId"] == 11
            delta += context["metLocation"] == context["currentRegion"]
            mon["friendship"] = min(255, mon["friendship"] + delta)
            self.leveled = True
            self.events.append(dict(kind="level", level=mon["level"], hp=mon["hp"], stats=deepcopy(mon["stats"]), friendship=mon["friendship"]))
            for at, move, pp in LEARN:
                if at != mon["level"]:
                    continue
                if any(row["moveId"] == move for row in mon["moves"]):
                    continue
                free = next((i for i, row in enumerate(mon["moves"]) if row["moveId"] == 0), None)
                if free is not None:
                    mon["moves"][free] = dict(moveId=move, pp=pp, ppUps=0)
                    self.events.append(dict(kind="learn", moveId=move, slot=free))
                else:
                    self.pending_move = move
                    self.phase = "move-choice"
                    return
        self.pending_move = 0
        if self.leveled and self.mon["level"] >= 16:
            self.evolution = 8
            self.phase = "pending-evolution"
        else:
            self.phase = "complete"

    def decide(self, slot):
        assert self.phase == "move-choice"
        move = self.pending_move
        if slot is None:
            self.events.append(dict(kind="decline", moveId=move))
        else:
            self.mon["moves"][slot] = dict(moveId=move, pp=PPS[move], ppUps=0)
            self.events.append(dict(kind="replace", moveId=move, slot=slot))
        self.pending_move = 0
        self.decisions += 1
        self.phase = "running"
        self.run()


def case(identifier, admission, decisions=None):
    oracle = Oracle(admission)
    row = dict(id=identifier, initial=admission, checkpoints=[oracle.snapshot()], decisions=[])
    planned = list(decisions or [])
    while oracle.phase == "move-choice":
        slot = planned.pop(0) if planned else None
        row["decisions"].append(dict(kind="decline-move") if slot is None else dict(kind="replace-move", slot=slot))
        oracle.decide(slot)
        row["checkpoints"].append(oracle.snapshot())
    return row


def fixtures():
    cases = []
    # Every source Route1 species/level award, no bonus or altered rounding.
    for species, levels in [(16, range(2, 6)), (19, range(2, 5))]:
        for level in levels:
            cases.append(case(f"natural-yield-{species}-{level}", initial(defeated_species=species, defeated_level=level, hp=1, pp=[0, 7])))
    # Full source range: every next-level threshold and level100 itself.
    for level in range(1, 100):
        cases.append(case(f"level-{level}-to-{level+1}-exact-threshold",
                          initial(level=level, xp=experience(level+1)-1, hp=1, override=1)))
    cases.append(case("level-100-no-xp-or-ev", initial(level=100, friendship=200, override=32767)))
    cases.append(case("fainted-recipient-no-xp-or-ev", initial(hp=0)))
    for delta in [-1, 0, 1]:
        cases.append(case(f"level6-threshold-offset-{delta}", initial(xp=179-39+delta, hp=1, defeated_level=5)))
    for speed, other in [(0, 0), (3, 0), (75, 0), (254, 0), (255, 0), (0, 509), (0, 510), (254, 255)]:
        evs = dict.fromkeys(KEYS, 0); evs["speed"] = speed
        evs["hp"], evs["attack"] = min(other, 255), max(0, other-255)
        cases.append(case(f"ev-speed-{speed}-other-{other}", initial(evs=evs)))
    cached = dict.fromkeys(KEYS, 0); cached["speed"] = 75
    current = dict.fromkeys(KEYS, 0); current["speed"] = 76
    cases.append(case("existing-delayed-stat-basis-no-level", initial(evs=current, calculated_evs=cached)))
    cases.append(case("existing-delayed-stat-basis-level-refresh", initial(xp=178, evs=current, calculated_evs=cached, hp=1, override=1)))
    for friendship in [0, 98, 99, 100, 198, 199, 200, 254, 255]:
        for same_met, luxury in [(False, False), (True, False), (True, True)]:
            cases.append(case(f"friendship-{friendship}-met{int(same_met)}-luxury{int(luxury)}",
                              initial(xp=178, friendship=friendship, same_met=same_met, luxury=luxury, override=1)))
    for slot in [0, 1, 2, 3, None]:
        cases.append(case(f"water-gun-{'decline' if slot is None else 'replace-'+str(slot)}",
                          initial(level=12, xp=1260, pp=[3, 0, 7, 1], override=1), [slot]))
    cases.append(case("multi-level-with-repeated-choice-and-remainder",
                      initial(hp=1, pp=[0, 2], friendship=98, same_met=True, luxury=True, override=32767), [0, None, 2, 3, 1]))
    cases.append(case("level100-clips-leftover-award", initial(level=99, xp=experience(100)-2, hp=1, override=32767)))
    cases.append(case("preexisting-level16-no-new-evolution", initial(level=16, override=1)))
    cases.append(case("level15-to16-pending-evolution", initial(level=15, xp=experience(16)-1, override=1)))
    cases.append(case("learn-bubble-first-empty-slot-preserves-old-pp", initial(level=6, xp=235, pp=[0, 3], override=1)))
    cases.append(case("learn-withdraw-first-empty-slot-preserves-old-pp", initial(level=9, xp=559, pp=[2, 0, 1], override=1)))
    lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
    manifest = json.loads((ROOT / "reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pins = {r["path"]: r["sha256"] for r in manifest["records"]}
    records = []
    for path, evidence in SOURCE_EVIDENCE.items():
        digest = hashlib.sha256((Path(lock["reference"]["localPath"]) / path).read_bytes()).hexdigest()
        assert digest == pins[path]
        records.append(dict(path=path, sha256=digest, evidence=evidence))
    return dict(schemaVersion=1, sourceFingerprint=FINGERPRINT,
                scope="Private post-battle source progression; high-level and override cases are explicitly diagnostic, not newly admitted combat or persisted owned rewards",
                independence="Source-literal Python formulas/tables only; does not read generated C/WASM or production host code",
                sourceRecords=records, growthTable=[experience(level) for level in range(1, 101)],
                learnset=[dict(level=at, moveId=move, pp=pp) for at, move, pp in LEARN], cases=cases)


def main():
    data = json.dumps(fixtures(), indent=2) + "\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8") == data, "Progression literal fixtures differ; review source derivation"
        print("Progression source-literal reproducibility passed without writes.")
    else:
        TARGET.write_text(data, encoding="utf-8")
        print(f"Wrote independent progression literals: {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
