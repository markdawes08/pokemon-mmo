"""Test-only source arithmetic for the bounded real-team battle profile.

Never imports or executes the production C/WASM/TypeScript battle implementation.
Encounter identity comes from the separate pass13 Python source oracle. Expected
JSON is literal, replayable evidence, not a second production engine. The raw
diagnostic cases explicitly use valid private mechanical boundary states rather
than claiming that their depleted enemy HP/PP/stages arose in normal play.
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
spec = importlib.util.spec_from_file_location("encounter_test_oracle", ROOT / "tools/encounter-core/fixtures/generate_fixtures.py")
encounter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(encounter)
FINGERPRINT = encounter.FINGERPRINT
RATIOS = [(10, 40), (10, 35), (10, 30), (10, 25), (10, 20), (10, 15),
          (10, 10), (15, 10), (20, 10), (25, 10), (30, 10), (35, 10), (40, 10)]
ACCURACY = [(33, 100), (36, 100), (43, 100), (50, 100), (60, 100), (75, 100),
            (1, 1), (133, 100), (166, 100), (2, 1), (233, 100), (133, 50), (3, 1)]
MOVES = {33: (35, 95), 39: (0, 100), 28: (0, 100), 165: (50, 100)}
MOVE = {"kind": "move", "slot": 0}
TAIL = {"kind": "move", "slot": 1}
RUN = {"kind": "run"}
STRUGGLE = {"kind": "struggle"}
SOURCE_EVIDENCE = {
    "src/battle_main.c": "TryDoEventsBeforeFirstTurn; HandleTurnActionSelectionState; GetWhoStrikesFirst; SetActionsAndBattlersTurnOrder; HandleAction_UseMove; TryRunFromBattle; BattleTurnPassed; VBlankCB_Battle",
    "src/battle_controller_opponent.c": "OpponentHandleChooseMove: Random&3 retries empty slots; downstream selection retries zero PP",
    "src/battle_util.c": "TrySetCantSelectMoveBattleScript; AreAllMovesUnusable; DoFieldEndTurnEffects comparison even with no residuals",
    "src/battle_script_commands.c": "Cmd_accuracycheck/critcalc/typecalc/datahpupdate; SetMoveEffect RECOIL25; Cmd_seteffectwithchance CERTAIN; ChangeStatBuffs; Cmd_checkteamslost",
    "src/pokemon.c": "CalculateBaseDamage GenIII physical arithmetic; Guts/Torrent branches dormant in admitted healthy/no-water profile",
    "data/battle_scripts_1.s": "EffectHit,EffectStatDown,EffectRecoil,MoveEffectRecoil,FaintAttacker,FaintTarget source command ordering",
    "src/data/battle_moves.h": "Tackle35power/95accuracy; TailWhip/SandAttack status; Struggle50power/100accuracy/CERTAIN recoil",
}


class Oracle:
    def __init__(self, seed, player=None, overrides=None):
        self.encounter = encounter.Oracle(seed, 0x4321, 1)
        wild = self.encounter.generate()
        self.encounter_state = self.encounter.snapshot()
        self.wild = deepcopy(wild)
        player = player or {"hp": 20, "pp": [35, 30]}
        self.actors = [
            dict(speciesId=7, abilityId=67, level=5, hp=player["hp"], maxHP=20,
                 attack=10, defense=12, speed=10, spAttack=10, spDefense=12,
                 types=[11, 11], moves=[33, 39, 0, 0], pp=player["pp"] + [0, 0], stages=[6]*8),
            dict(speciesId=wild["speciesId"], abilityId=wild["abilityId"], level=wild["level"],
                 hp=wild["hp"], maxHP=wild["stats"]["hp"],
                 **{key: value for key, value in wild["stats"].items() if key != "hp"},
                 types=[0, 2] if wild["speciesId"] == 16 else [0, 0],
                 moves=[move["moveId"] for move in wild["moves"]] + [0]*(4-len(wild["moves"])),
                 pp=[move["pp"] for move in wild["moves"]] + [0]*(4-len(wild["moves"])), stages=[6]*8),
        ]
        self.rng = self.encounter_state["main"]["state"]
        self.seed = self.rng
        self.draws = self.sequence = self.run_tries = 0
        self.turn = 1
        self.outcome = None
        self.wild_slot = None
        self.trace, self.events = [], []
        overrides = overrides or {}
        if "wildHp" in overrides:
            self.actors[1]["hp"] = overrides["wildHp"]
        if "wildPp" in overrides:
            self.actors[1]["pp"] = deepcopy(overrides["wildPp"])
            if any(pp > (wild["moves"][slot]["pp"] if slot < len(wild["moves"]) else 0)
                   for slot, pp in enumerate(overrides["wildPp"])):
                raise ValueError("Raw diagnostic PP cannot exceed an actual source move")
        if "stages" in overrides:
            self.actors[0]["stages"], self.actors[1]["stages"] = deepcopy(overrides["stages"])
        self.run_tries = overrides.get("runTries", 0)
        self.order("intro")
        self.prepare()

    def draw(self, role):
        before = self.rng
        self.rng = (before * 1103515245 + 24691) & 0xFFFFFFFF
        self.draws += 1
        value = self.rng >> 16
        self.trace.append(dict(draw=self.draws, role=role, before=before, value=value, after=self.rng))
        return value

    def summary(self):
        return dict(sequence=self.sequence, turn=self.turn, phase="ended" if self.outcome else "choice",
                    outcome=self.outcome, runTries=self.run_tries, wildSlot=self.wild_slot,
                    rngState=self.rng, rngDraws=self.draws,
                    actors=[{key: deepcopy(actor[key]) for key in ("hp", "pp", "stages")} for actor in self.actors])

    def order(self, phase):
        speeds = [actor["speed"] * RATIOS[actor["stages"][3]][0] // RATIOS[actor["stages"][3]][1] for actor in self.actors]
        if speeds[0] == speeds[1]:
            result = [1, 0] if self.draw(f"{phase}-speed-tie") & 1 else [0, 1]
        else:
            result = [0, 1] if speeds[0] > speeds[1] else [1, 0]
        self.events.append(dict(kind="order", phase=phase, actors=result))
        return result

    def prepare(self):
        self.draw("turn-selection")
        wild = self.actors[1]
        if not any(wild["pp"]):
            self.wild_slot = 4
            return
        while True:
            slot = self.draw("wild-slot-selection") & 3
            if wild["moves"][slot] and wild["pp"][slot]:
                self.wild_slot = slot
                return

    def damage(self, actor, move, critical):
        attacker, target = self.actors[actor], self.actors[1-actor]
        attack, defense = attacker["attack"], target["defense"]
        if not (critical == 2 and attacker["stages"][1] <= 6):
            n, d = RATIOS[attacker["stages"][1]]
            attack = attack * n // d
        if not (critical == 2 and target["stages"][2] >= 6):
            n, d = RATIOS[target["stages"][2]]
            defense = defense * n // d
        assert defense > 0
        base = max(1, attack * MOVES[move][0] * (2 * attacker["level"] // 5 + 2) // defense // 50) + 2
        after_critical = base * critical
        after_type = after_critical
        if move != 165 and 0 in attacker["types"]:
            after_type = after_type * 15 // 10
        rolled = max(1, after_type * (100 - self.draw(f"actor{actor}-variance") % 16) // 100)
        hp_dealt = min(rolled, target["hp"])
        target["hp"] -= hp_dealt
        return dict(baseDamage=base, afterCritical=after_critical, afterType=after_type,
                    damage=rolled, hpDealt=hp_dealt, critical=critical)

    def faint(self, actor):
        self.actors[actor]["stages"] = [6]*8
        self.events.append(dict(kind="faint", actor=actor, commands=[dict(type=4, battler=actor, value=0)]))

    def attack(self, actor, slot):
        attacker, target = self.actors[actor], self.actors[1-actor]
        move = 165 if slot == 4 else attacker["moves"][slot]
        accuracy = self.draw(f"actor{actor}-accuracy") % 100 + 1
        stage = min(12, max(0, attacker["stages"][6] + 6 - target["stages"][7]))
        numerator, denominator = ACCURACY[stage]
        threshold = MOVES[move][1] * numerator // denominator
        if slot != 4:
            attacker["pp"][slot] -= 1
        result = dict(kind="move", actor=actor, slot=slot, moveId=move, flags=0,
                      baseDamage=0, afterCritical=0, afterType=0, damage=0, hpDealt=0, critical=1,
                      recoil=0, recoilDealt=0, ppAfter=attacker["pp"][slot] if slot != 4 else None)
        result["commands"] = [] if slot == 4 else [dict(type=3, battler=actor, value=attacker["pp"][slot])]
        if accuracy > threshold:
            result["flags"] = 1
        elif move in (28, 39):
            stat = 6 if move == 28 else 2
            before = target["stages"][stat]
            after = max(0, before-1)
            target["stages"][stat] = after
            result.update(stat=stat, stageBefore=before, stageAfter=after)
            if before == 0:
                result["flags"] = 1
            else:
                result["commands"].append(dict(type=6, battler=1-actor, value=stat*16+after))
        else:
            critical = 2 if self.draw(f"actor{actor}-critical") % 16 == 0 else 1
            result.update(self.damage(actor, move, critical))
            result["commands"].extend([dict(type=1, battler=1-actor, value=min(10000, result["damage"])),
                                       dict(type=2, battler=1-actor, value=target["hp"])])
            if move == 165:
                result["recoil"] = max(1, result["hpDealt"] // 4)
                result["recoilDealt"] = min(attacker["hp"], result["recoil"])
                attacker["hp"] -= result["recoilDealt"]
                result["commands"].extend([dict(type=1, battler=actor, value=result["recoil"]),
                                           dict(type=2, battler=actor, value=attacker["hp"])])
            else:
                self.draw(f"actor{actor}-zero-effect-secondary")
        result["targetHP"] = target["hp"]
        self.events.append(result)
        # CERTAIN recoil subscript tries attacker faint before EffectHit's
        # target faint; both occur before deciding the one-member team outcome.
        if attacker["hp"] == 0:
            self.faint(actor)
        if target["hp"] == 0:
            self.faint(1-actor)
        if not attacker["hp"] or not target["hp"]:
            hp = [mon["hp"] for mon in self.actors]
            self.outcome = "draw" if hp == [0, 0] else "won" if hp[0] else "lost"
            self.events.append(dict(kind="outcome", outcome=self.outcome))

    def advance(self, choice):
        assert not self.outcome
        self.trace, self.events = [], []
        if choice["kind"] == "run":
            self.events.append(dict(kind="order", phase="actions", actors=[0, 1]))
            player, wild = self.actors
            if player["speed"] >= wild["speed"]:
                success, threshold = True, None
            else:
                threshold = (player["speed"] * 128 // wild["speed"] + self.run_tries * 30) & 255
                success = threshold > (self.draw("run-escape") & 255)
            self.run_tries = (self.run_tries + 1) & 255
            self.events.append(dict(kind="run", success=success, threshold=threshold, runTries=self.run_tries))
            if success:
                self.outcome = "ran"
                self.events.append(dict(kind="outcome", outcome="ran"))
            else:
                self.attack(1, self.wild_slot)
        else:
            player_slot = 4 if choice["kind"] == "struggle" else choice["slot"]
            assert (player_slot == 4) == (not any(self.actors[0]["pp"]))
            assert player_slot == 4 or self.actors[0]["pp"][player_slot] > 0
            for actor in self.order("actions"):
                self.attack(actor, player_slot if actor == 0 else self.wild_slot)
                if self.outcome:
                    break
        if not self.outcome:
            self.order("residual")
            self.turn += 1
            self.prepare()
        self.sequence += 1
        return dict(state=self.summary(), events=deepcopy(self.events), trace=deepcopy(self.trace))


def transcript(seed, choices, player=None, overrides=None):
    oracle = Oracle(seed, player, overrides)
    row = dict(encounterSeeds=dict(mainSeed=seed, wildSeed=0x4321, trainerId=1),
               player=player or dict(hp=20, pp=[35, 30]),
               encounterExpected=oracle.wild, encounterState=oracle.encounter_state,
               initial=dict(state=oracle.summary(), events=deepcopy(oracle.events), trace=deepcopy(oracle.trace)), steps=[])
    if overrides:
        row["rawBoundaryOverrides"] = overrides
    for choice in choices:
        if oracle.outcome:
            break
        row["steps"].append(dict(choice=choice, expected=oracle.advance(choice)))
    return row


def move_events(row):
    return [event for step in row["steps"] for event in step["expected"]["events"] if event["kind"] == "move"]


def find_case(identifier, choices, predicate, player=None, overrides=None, limit=20000):
    for seed in range(limit):
        try:
            row = transcript(seed, choices, player, overrides)
        except ValueError:
            continue
        if predicate(row):
            return dict(id=identifier, **row)
    raise AssertionError(f"No independently derived source fixture for {identifier}")


def fixtures():
    cases = []
    add = lambda *args, **kwargs: cases.append(find_case(*args, **kwargs))
    add("pidgey-real-team-victory", [MOVE]*12, lambda r: r["encounterExpected"]["speciesId"] == 16 and r["steps"][-1]["expected"]["state"]["outcome"] == "won")
    add("rattata-real-team-victory", [MOVE]*12, lambda r: r["encounterExpected"]["speciesId"] == 19 and r["steps"][-1]["expected"]["state"]["outcome"] == "won")
    add("tackle-miss", [MOVE], lambda r: any(e["actor"] == 0 and e["flags"] == 1 for e in move_events(r)))
    add("tackle-critical", [MOVE], lambda r: any(e["actor"] == 0 and e["critical"] == 2 for e in move_events(r)))
    add("tail-whip-changes-next-damage", [TAIL, MOVE, MOVE], lambda r: len(r["steps"]) == 3 and any(e["actor"] == 0 and e.get("stageAfter") == 5 for e in move_events(r)))
    add("tail-whip-stage-floor", [TAIL]*8, lambda r: any(e["actor"] == 0 and e.get("stageBefore") == 0 for e in move_events(r)))
    add("sand-attack-causes-miss", [TAIL, MOVE, MOVE, MOVE, MOVE, MOVE], lambda r: any(e["moveId"] == 28 and e.get("stageAfter", 6) < 6 for e in move_events(r)) and any(e["actor"] == 0 and e["flags"] == 1 for e in move_events(r)))
    add("initial-and-end-turn-speed-ties", [TAIL, MOVE], lambda r: any(d["role"] == "intro-speed-tie" for d in r["initial"]["trace"]) and len(r["steps"]) == 2)
    add("run-faster-without-roll", [RUN], lambda r: r["encounterExpected"]["stats"]["speed"] < 10)
    add("run-equal-with-intro-tie-no-escape-roll", [RUN], lambda r: r["encounterExpected"]["stats"]["speed"] == 10)
    add("run-slower-fails-then-succeeds", [RUN]*6, lambda r: r["encounterExpected"]["stats"]["speed"] > 10 and len(r["steps"]) >= 2 and r["steps"][-1]["expected"]["state"]["outcome"] == "ran")
    add("last-player-pp-then-struggle", [MOVE, STRUGGLE, STRUGGLE], lambda r: len(r["steps"]) >= 2, player=dict(hp=20, pp=[1, 0]))
    add("player-struggle-real-team", [STRUGGLE]*8, lambda r: r["steps"][-1]["expected"]["state"]["outcome"] is not None, player=dict(hp=20, pp=[0, 0]))
    add("low-hp-player-loss", [MOVE], lambda r: r["steps"][-1]["expected"]["state"]["outcome"] == "lost", player=dict(hp=1, pp=[35, 30]))
    stages = [[6]*8, [6]*8]
    stages[0][6] = 0
    add("raw-struggle-accuracy-miss", [STRUGGLE], lambda r: any(e["actor"] == 0 and e["flags"] == 1 for e in move_events(r)), player=dict(hp=20, pp=[0, 0]), overrides=dict(stages=stages))
    add("raw-wild-exhausted-slot-rerolls", [MOVE], lambda r: r["encounterExpected"]["speciesId"] == 19 and len([d for d in r["initial"]["trace"] if d["role"] == "wild-slot-selection"]) >= 3, overrides=dict(wildPp=[0, 30, 0, 0]))
    add("raw-both-struggle-no-wild-choice-draw", [STRUGGLE], lambda r: r["encounterExpected"]["speciesId"] == 19 and len(move_events(r)) == 2, player=dict(hp=20, pp=[0, 0]), overrides=dict(wildPp=[0, 0, 0, 0]))
    add("raw-struggle-recoil-self-ko", [STRUGGLE], lambda r: any(e["actor"] == 0 and e["recoilDealt"] == 1 for e in move_events(r)) and r["steps"][-1]["expected"]["state"]["outcome"] == "lost", player=dict(hp=1, pp=[0, 0]))
    add("raw-struggle-double-faint-order", [STRUGGLE], lambda r: r["steps"][-1]["expected"]["state"]["outcome"] == "draw", player=dict(hp=1, pp=[0, 0]), overrides=dict(wildHp=1))
    stages = [[6]*8, [6]*8]; stages[1][2] = 0
    add("raw-struggle-overkill-recoil-uses-actual-hp", [STRUGGLE], lambda r: any(e["actor"] == 0 and e["damage"] >= 8 and e["hpDealt"] == 2 and e["recoil"] == 1 for e in move_events(r)), player=dict(hp=20, pp=[0, 0]), overrides=dict(wildHp=2, stages=stages))
    add("raw-run-byte-overflow", [RUN], lambda r: r["encounterExpected"]["stats"]["speed"] > 10, overrides=dict(runTries=255))
    lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
    manifest = json.loads((ROOT / "reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pins = {r["path"]: r["sha256"] for r in manifest["records"]}
    records = []
    for path, purpose in SOURCE_EVIDENCE.items():
        digest = hashlib.sha256((Path(lock["reference"]["localPath"]) / path).read_bytes()).hexdigest()
        assert digest == pins[path]
        records.append(dict(path=path, sha256=digest, purpose=purpose))
    return dict(schemaVersion=1, sourceFingerprint=FINGERPRINT,
                scope="Private exact Squirtle5 versus Route1 Pidgey/Rattata combat; no rewards, experience, capture, database or live transport",
                independence="Separate source-literal Python arithmetic and pass13 independent encounter oracle; never obtains expectations from production WASM/driver",
                schedulingAdaptation="Continue encounter general RNG after held-item draw; omit VBlank/presentation-frame RNG; retain mechanical intro comparison, selection, wild AI and end-turn draws",
                rawBoundaryPolicy="rawBoundaryOverrides are explicit test-only mechanical states preserving real identity/stats; not claims of natural battle histories or admitted initial live state",
                sourceRecords=records, cases=cases)


def main():
    data = json.dumps(fixtures(), indent=2) + "\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8") == data, "Source battle literals differ; review derivation before regenerating"
        print("Route1 source-literal reproducibility passed without file writes.")
    else:
        TARGET.write_text(data, encoding="utf-8")
        print(f"Wrote source-derived Route1 battle fixtures to {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
