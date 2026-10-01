"""Independent source-literal item/capture extension; retained fight fixtures unchanged.

The test oracle imports only the separately audited Python source arithmetic,
never the generated C tables, WASM or production TypeScript. The integer square
root models the BIOS Sqrt contract; no ROM/emulator comparison is claimed.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import importlib.util
import json
from math import isqrt
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("battle_source_oracle", HERE / "generate_fixtures.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TARGET = HERE / "items-cases.json"
POTION = dict(kind="item", itemId=13)
BALL = dict(kind="item", itemId=4)
SOURCE_EVIDENCE = {
    "src/data/pokemon/item_effects.h": "Potion ITEM4_HEAL_HP with amount20",
    "src/party_menu.c": "ItemUseCB_MedicineStep applies effect before RemoveBagItem; no-effect remains selection",
    "src/pokemon.c": "PokemonUseItemEffects living/non-full HP clamps healing; source GiveMonToPlayer party copy preserves HP/PP but is outside this profile",
    "src/item_use.c": "BattleUseFunc_PokeBallEtc removes one accepted ball; full party+storage rejects before removal",
    "src/battle_main.c": "SetActionsAndBattlersTurnOrder partitions item before moves without action tie RNG; HandleAction_UseItem",
    "src/battle_script_commands.c": "Cmd_handleballthrow catchRate/HP integer odds, nested Sqrt, strict four-shake loop",
    "data/battle_scripts_2.s": "SuccessBallThrow terminal CAUGHT; failed ShakeBallThrow finishes action and opponent continues",
    "src/data/pokemon/species_info.h": "Both Pidgey and Rattata catchRate255",
    "include/battle_controllers.h": "BALL_3_SHAKES_SUCCESS enum value4 denotes four successful comparisons",
    "src/libagbsyscall.s": "Sqrt invokes BIOS SWI8; independent oracle uses integer square root",
}


def capture_math(max_hp, hp):
    assert 0 < hp <= max_hp
    odds = 255 * (3 * max_hp - 2 * hp) // (3 * max_hp)
    threshold = None if odds > 254 else 1048560 // isqrt(isqrt(16711680 // odds))
    return odds, threshold


class ItemOracle(base.Oracle):
    def __init__(self, seed, player=None, inventory=None, overrides=None):
        self.inventory = deepcopy(inventory or dict(potion=5, pokeBall=5))
        self.capture = None
        super().__init__(seed, player, overrides)

    def summary(self):
        result = super().summary()
        result["inventory"] = deepcopy(self.inventory)
        result["capture"] = deepcopy(self.capture)
        return result

    def advance(self, choice):
        if choice["kind"] != "item":
            return super().advance(choice)
        assert not self.outcome
        item = choice["itemId"]
        if item == 13:
            if self.inventory["potion"] == 0 or self.actors[0]["hp"] in (0, self.actors[0]["maxHP"]):
                raise ValueError("Potion has no effect or inventory is empty; no transition occurs")
        elif item == 4:
            if self.inventory["pokeBall"] == 0:
                raise ValueError("No Poké Ball remains; no transition occurs")
        else:
            raise ValueError("Only the audited two source items are supported")
        self.trace, self.events = [], [dict(kind="order", phase="actions", actors=[0, 1])]
        if item == 13:
            player = self.actors[0]
            before = player["hp"]
            player["hp"] = min(player["maxHP"], before + 20)
            self.inventory["potion"] -= 1
            self.events.append(dict(kind="potion", itemId=13, hpBefore=before, hpAfter=player["hp"],
                                    healed=player["hp"]-before, remaining=self.inventory["potion"]))
        else:
            self.inventory["pokeBall"] -= 1
            wild = self.actors[1]
            odds, threshold = capture_math(wild["maxHP"], wild["hp"])
            shakes = 0
            if odds > 254:
                shakes = 4
            else:
                while shakes < 4:
                    if self.draw(f"capture-shake-{shakes+1}") >= threshold:
                        break
                    shakes += 1
            self.events.append(dict(kind="capture-attempt", itemId=4, odds=odds, threshold=threshold,
                                    shakes=shakes, caught=shakes == 4, remaining=self.inventory["pokeBall"]))
            if shakes == 4:
                self.outcome = "captured"
                creature = deepcopy(self.wild)
                for key in ("slotRoll", "personalityAttempts"):
                    creature.pop(key)
                creature["hp"] = wild["hp"]
                for slot, move in enumerate(creature["moves"]):
                    move["pp"] = wild["pp"][slot]
                while len(creature["moves"]) < 4:
                    creature["moves"].append(dict(moveId=0, pp=0, ppUps=0))
                self.capture = dict(kind="pending-disposition", ballItemId=4, creature=creature)
                self.events.append(dict(kind="outcome", outcome="captured"))
        if not self.outcome:
            self.attack(1, self.wild_slot)
        if not self.outcome:
            self.order("residual")
            self.turn += 1
            self.prepare()
        self.sequence += 1
        return dict(state=self.summary(), events=deepcopy(self.events), trace=deepcopy(self.trace))


def transcript(seed, choices, player=None, inventory=None, overrides=None):
    oracle = ItemOracle(seed, player, inventory, overrides)
    row = dict(encounterSeeds=dict(mainSeed=seed, wildSeed=0x4321, trainerId=1),
               player=player or dict(hp=20, pp=[35, 30]), inventory=inventory or dict(potion=5, pokeBall=5),
               encounterExpected=oracle.wild, encounterState=oracle.encounter_state,
               initial=dict(state=oracle.summary(), events=deepcopy(oracle.events), trace=deepcopy(oracle.trace)), steps=[])
    if overrides:
        row["rawBoundaryOverrides"] = overrides
    for choice in choices:
        if oracle.outcome:
            break
        row["steps"].append(dict(choice=choice, expected=oracle.advance(choice)))
    return row


def captures(row):
    return [event for step in row["steps"] for event in step["expected"]["events"] if event["kind"] == "capture-attempt"]


def find(identifier, choices, predicate=lambda _: True, **kwargs):
    for seed in range(20000):
        try:
            row = transcript(seed, choices, **kwargs)
        except ValueError:
            continue
        if predicate(row):
            return dict(id=identifier, **row)
    raise AssertionError(f"No independent source fixture for {identifier}")


def fixtures():
    cases = [
        find("potion-low-hp-clamps-to-maximum", [POTION], player=dict(hp=1, pp=[35, 30])),
        find("potion-one-missing-hp", [POTION], player=dict(hp=19, pp=[35, 30])),
        find("potion-priority-over-faster-wild", [POTION], lambda r: r["encounterExpected"]["stats"]["speed"] > 10, player=dict(hp=1, pp=[35, 30])),
        find("potion-tied-speed-skips-action-tie-retains-residual-tie", [POTION], lambda r: r["encounterExpected"]["stats"]["speed"] == 10, player=dict(hp=1, pp=[35, 30])),
        find("potion-repeat-consumes-exactly-one-each", [POTION, POTION], lambda r: len(r["steps"]) == 2, player=dict(hp=1, pp=[35, 30]), inventory=dict(potion=2, pokeBall=0)),
        find("potion-last-stock-and-empty-move-pp", [POTION, base.STRUGGLE], lambda r: len(r["steps"]) == 2, player=dict(hp=1, pp=[0, 0]), inventory=dict(potion=1, pokeBall=0)),
        find("potion-retains-tail-whip-and-sand-attack-stages-and-spent-pp", [base.TAIL, POTION],
             lambda r: len(r["steps"]) == 2 and r["steps"][0]["expected"]["state"]["actors"][0]["stages"][6] == 5
             and r["steps"][0]["expected"]["state"]["actors"][1]["stages"][2] == 5, player=dict(hp=10, pp=[35, 30])),
    ]
    for shakes in range(5):
        cases.append(find(f"poke-ball-{shakes}-successful-shakes", [BALL], lambda r, target=shakes: captures(r)[0]["shakes"] == target))
    cases += [
        find("poke-ball-captures-rattata-real-identity", [BALL], lambda r: r["encounterExpected"]["speciesId"] == 19 and captures(r)[0]["caught"]),
        find("poke-ball-after-attack-retains-damaged-hp-and-spent-pp", [base.MOVE, BALL], lambda r: len(captures(r)) == 1 and captures(r)[0]["caught"] and r["steps"][0]["expected"]["state"]["actors"][1]["hp"] < r["encounterExpected"]["hp"]),
        find("poke-ball-failure-then-capture-keeps-spent-wild-pp", [BALL, BALL], lambda r: len(captures(r)) == 2 and not captures(r)[0]["caught"] and captures(r)[1]["caught"]),
        find("poke-ball-last-stock-fails-and-wild-acts", [BALL], lambda r: not captures(r)[0]["caught"], inventory=dict(potion=0, pokeBall=1)),
        find("poke-ball-failure-can-end-in-player-loss", [BALL], lambda r: r["steps"][-1]["expected"]["state"]["outcome"] == "lost", player=dict(hp=1, pp=[35, 30])),
        find("poke-ball-capture-allowed-with-no-player-move-pp", [BALL], lambda r: captures(r)[0]["caught"], player=dict(hp=20, pp=[0, 0])),
        find("potion-then-poke-ball-capture", [POTION, BALL], lambda r: len(captures(r)) == 1 and captures(r)[0]["caught"], player=dict(hp=1, pp=[35, 30])),
        find("raw-one-hp-capture-threshold", [BALL], lambda r: captures(r)[0]["caught"], overrides=dict(wildHp=1)),
    ]
    # Independent capture arithmetic grid over real source-created maximum HPs.
    maxima = {}
    for seed in range(512):
        maxima.setdefault(base.Oracle(seed).wild["stats"]["hp"], seed)
    arithmetic = [dict(mainSeed=seed, maxHP=max_hp, hp=hp, odds=capture_math(max_hp, hp)[0], threshold=capture_math(max_hp, hp)[1])
                  for max_hp, seed in sorted(maxima.items()) for hp in range(1, max_hp+1)]
    threshold_rows = {row["threshold"]: row for row in arithmetic}
    edges = []
    inverse = pow(1103515245, -1, 2**32)
    for threshold, row in sorted(threshold_rows.items()):
        for first_roll in sorted({threshold-1, threshold, min(65535, threshold+1)}):
            before = (((first_roll << 16) - 24691) * inverse) & 0xFFFFFFFF
            anchor = ((before - 24691) * inverse) & 0xFFFFFFFF
            state, shakes, values = before, 0, []
            while shakes < 4:
                state = (state * 1103515245 + 24691) & 0xFFFFFFFF
                values.append(state >> 16)
                if values[-1] >= threshold:
                    break
                shakes += 1
            edges.append(dict(**row, firstRoll=first_roll, rngAnchor=anchor, rngStateBefore=before,
                              rngDrawsBefore=1, values=values, shakes=shakes, caught=shakes == 4, rngStateAfter=state))
    sqrt_inputs = sorted({0, 1, 2, 3, 4, 5, 15, 16, 17, 0xFFFFFFFF,
                          *[value for n in [255, 256, 4095, 4096, 65535] for value in [n*n-1, n*n, n*n+1]]})
    lock = json.loads((base.ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
    manifest = json.loads((base.ROOT / "reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pins = {r["path"]: r["sha256"] for r in manifest["records"]}
    records = []
    for path, evidence in SOURCE_EVIDENCE.items():
        digest = hashlib.sha256((Path(lock["reference"]["localPath"]) / path).read_bytes()).hexdigest()
        assert digest == pins[path]
        records.append(dict(path=path, sha256=digest, evidence=evidence))
    return dict(schemaVersion=1, sourceFingerprint=base.FINGERPRINT,
                scope="Private Potion and Poke Ball source mechanics; capture stops pending disposition before ownership, dex, nickname, rewards or database effects",
                independence="Test-only Python source oracle and literal tables; no production generated tables, WASM or TypeScript used for expectations",
                sqrtBoundary="Independent integer square root models source BIOS SWI8; no BIOS instruction or ROM/emulator comparison is claimed",
                schedulingAdaptation="Existing deterministic headless clock retained; item actions precede wild moves without action-speed tie, residual tie and selection remain",
                sourceRecords=records, cases=cases, captureArithmetic=arithmetic, thresholdEdges=edges,
                sqrtCases=[dict(input=value, expected=isqrt(value)) for value in sqrt_inputs])


def main():
    data = json.dumps(fixtures(), indent=2) + "\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8") == data, "Item literal fixtures differ; review source derivation before regenerating"
        print("Independent item/capture literal reproducibility passed without writes.")
    else:
        TARGET.write_text(data, encoding="utf-8")
        print(f"Wrote independent item literals: {TARGET.relative_to(base.ROOT)}")


if __name__ == "__main__":
    main()
