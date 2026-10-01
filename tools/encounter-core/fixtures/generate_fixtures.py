"""Independent test oracle for the admitted Route 1 encounter boundary.

This file neither imports the production extractor/wrapper nor executes its WASM.
Its constants and arithmetic were transcribed from the pinned source references
listed below. JSON expectations are committed literals; normal verification only
reads them. --check regenerates in memory and compares without writing anything.
The oracle is intentionally not a second production encounter or battle engine.
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
MULTIPLIER = 1103515245
MASK = 0xFFFFFFFF
TRAINER_ID = 0x12345678
# src/data/wild_encounters.h:6-18,2459-2475 (FireRed branch).
WEIGHTS = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1]
LEVELS = [3, 3, 3, 3, 2, 2, 3, 3, 4, 4, 5, 4]
STAT_KEYS = ["hp", "attack", "defense", "speed", "spAttack", "spDefense"]
BASE = {16: [40, 45, 40, 56, 35, 35], 19: [30, 56, 35, 72, 25, 35]}
SOURCES = {
    "include/random.h": "Random32 low-half first portability adaptation; both LCG addends",
    "src/random.c": "Random: u32 multiply/add wrap and high-half return",
    "src/wild_encounter.c": "ChooseWildMonIndex_Land 71; ChooseWildMonLevel 155; GenerateWildMon 226; rate/cooldown/step 302-439,661-784",
    "src/data/wild_encounters.h": "FireRed Route1 rate21 and all twelve slots; cumulative weight endpoints",
    "src/pokemon.c": "CreateMon/CreateBoxMon/CreateMonWithNature 1755-1875; stat calculation 2093-2170; initial moves 2265; nature 5404; held item 6032",
    "src/data/pokemon/species_info.h": "Pidgey/Rattata base stats, growth, friendship70, abilities, zero held items",
    "src/data/pokemon/level_up_learnsets.h": "Pidgey Tackle1/SandAttack5; Rattata Tackle1/TailWhip1",
    "src/data/pokemon/experience_tables.h": "MediumFast n^3; MediumSlow floor(6n^3/5)-15n^2+100n-140",
    "src/data/battle_moves.h": "Tackle PP35; SandAttack PP15; TailWhip PP30",
}


class Rng:
    def __init__(self, seed, addend, stream):
        self.initial = self.state = seed
        self.draws = 0
        self.addend, self.stream = addend, stream
        self.trace = []

    def draw(self, role):
        before = self.state
        self.state = (before * MULTIPLIER + self.addend) & MASK
        self.draws += 1
        result = self.state >> 16
        self.trace.append(dict(stream=self.stream, draw=self.draws, role=role,
                               before=before, value=result, after=self.state))
        return result

    def snapshot(self):
        return dict(initialSeed=self.initial, state=self.state, draws=self.draws)


class Oracle:
    def __init__(self, main_seed, wild_seed, trainer_id=TRAINER_ID):
        self.main = Rng(main_seed, 24691, "main")
        self.wild = Rng(wild_seed, 12345, "wild")
        self.trainer_id = trainer_id
        self.previous_behavior = self.buff = self.steps = 0
        self.serial = 0

    def snapshot(self):
        return dict(main=self.main.snapshot(), wild=self.wild.snapshot(),
                    previousBehavior=self.previous_behavior,
                    encounterRateBuff=self.buff, stepsSinceLastEncounter=self.steps,
                    serial=self.serial)

    def generate(self):
        roll = self.main.draw("land-slot") % 100
        endpoint = 0
        for slot, weight in enumerate(WEIGHTS):
            endpoint += weight
            if roll < endpoint:
                break
        species = 16 if slot % 2 == 0 else 19
        level = LEVELS[slot]
        self.main.draw("level-even-when-min-equals-max")
        nature = self.main.draw("nature") % 25
        attempts = 0
        while True:
            attempts += 1
            low = self.main.draw("personality-low")
            high = self.main.draw("personality-high")
            personality = low | high << 16
            if personality % 25 == nature:
                break
        first_ivs = self.main.draw("ivs-hp-attack-defense")
        second_ivs = self.main.draw("ivs-speed-spAttack-spDefense")
        ivs = [first_ivs >> shift & 31 for shift in (0, 5, 10)]
        ivs += [second_ivs >> shift & 31 for shift in (0, 5, 10)]
        ability_num = personality & 1 if species == 19 else 0
        ability = 51 if species == 16 else [50, 62][ability_num]
        stats = []
        # Source table is the five-by-five attack/defense/speed/spAtk/spDef
        # increased/decreased ordering, with the diagonal neutral.
        raised, lowered = divmod(nature, 5)
        for index, (base, iv) in enumerate(zip(BASE[species], ivs)):
            stat = (2 * base + iv) * level // 100 + (level + 10 if index == 0 else 5)
            if index and raised != lowered:
                if index - 1 == raised:
                    stat = (stat * 110 & 0xFFFF) // 100
                elif index - 1 == lowered:
                    stat = (stat * 90 & 0xFFFF) // 100
            stats.append(stat)
        moves = [dict(moveId=33, pp=35, ppUps=0)]
        if species == 19:
            moves.append(dict(moveId=39, pp=30, ppUps=0))
        elif level == 5:
            moves.append(dict(moveId=28, pp=15, ppUps=0))
        experience = level ** 3 if species == 19 else 6 * level ** 3 // 5 - 15 * level ** 2 + 100 * level - 140
        # SetWildMonHeldItem draws BEFORE discovering common==rare==NONE.
        self.main.draw("held-item-even-when-both-none")
        self.buff = self.steps = 0
        self.serial += 1
        return dict(slot=slot, slotRoll=roll, speciesId=species, level=level,
                    personality=personality, personalityAttempts=attempts, nature=nature,
                    abilityId=ability, abilityNum=ability_num, otId=self.trainer_id,
                    gender=254 if (personality & 255) < 127 else 0,
                    ivs=dict(zip(STAT_KEYS, ivs)), evs=dict.fromkeys(STAT_KEYS, 0),
                    stats=dict(zip(STAT_KEYS, stats)), hp=stats[0], experience=experience,
                    friendship=70, status=0, heldItemId=0, moves=moves)

    def step(self, terrain, behavior):
        before_main, before_wild = len(self.main.trace), len(self.wild.trace)
        creature = None
        reason = "no-encounter-terrain"
        if terrain == "land":
            passed = self.steps >= 6
            if not passed:
                self.steps += 1
                passed = self.main.draw("cooldown-five-percent-bypass") % 100 < 5
            if not passed:
                reason = "cooldown"
            elif self.previous_behavior != behavior and self.main.draw("changed-behavior-sixty-percent-gate") % 100 >= 60:
                reason = "changed-behavior-gate"
            elif self.wild.draw("encounter-rate") % 1600 >= min(1600, 336 + self.buff * 16 // 200):
                reason = "rate-miss"
                self.buff = (self.buff + 21) & 0xFFFF
            else:
                reason = "encounter"
                creature = self.generate()
                self.buff = self.steps = 0
        self.previous_behavior = behavior
        return dict(input=dict(terrain=terrain, behavior=behavior), reason=reason,
                    creature=creature, state=self.snapshot(),
                    mainTrace=deepcopy(self.main.trace[before_main:]),
                    wildTrace=deepcopy(self.wild.trace[before_wild:]))


def source_records():
    lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
    assert lock["fingerprint"]["value"] == FINGERPRINT
    manifest = json.loads((ROOT / "reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pinned = {record["path"]: record["sha256"] for record in manifest["records"]}
    reference = Path(lock["reference"]["localPath"])
    records = []
    for path, evidence in SOURCES.items():
        digest = hashlib.sha256((reference / path).read_bytes()).hexdigest()
        assert digest == pinned[path], f"Source changed: {path}"
        records.append(dict(path=path, sha256=digest, evidence=evidence))
    return records


def fixtures():
    factory_cases = []
    # Hit both inclusive/exclusive sides of every cumulative slot boundary.
    endpoints = [0, 19, 20, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 84,
                 85, 89, 90, 93, 94, 97, 98, 99]
    needed = set(endpoints)
    nature_seeds = {}
    ability_seeds = {}
    selected = {}
    for seed in range(100_000):
        oracle = Oracle(seed, 0x4321)
        result = oracle.generate()
        if result["slotRoll"] in needed:
            selected.setdefault(seed, []).append(f"slot-roll-{result['slotRoll']}")
            needed.remove(result["slotRoll"])
        if result["nature"] not in nature_seeds:
            nature_seeds[result["nature"]] = seed
            selected.setdefault(seed, []).append(f"nature-{result['nature']}")
        if result["speciesId"] == 19 and result["abilityNum"] not in ability_seeds:
            ability_seeds[result["abilityNum"]] = seed
            selected.setdefault(seed, []).append(f"rattata-ability-{result['abilityNum']}")
        if not needed and len(nature_seeds) == 25 and len(ability_seeds) == 2:
            break
    assert not needed and len(nature_seeds) == 25 and len(ability_seeds) == 2
    # u32 boundary seed and distinct OT values are additional concrete cases.
    selected[MASK] = ["u32-seed-upper-bound"]
    for seed, purposes in selected.items():
        oracle = Oracle(seed, 0x4321, TRAINER_ID if seed != MASK else MASK)
        initial = dict(mainSeed=seed, wildSeed=0x4321, trainerId=oracle.trainer_id)
        result = oracle.generate()
        factory_cases.append(dict(id=f"factory-{seed}", purposes=purposes, initial=initial,
                                  expected=result, state=oracle.snapshot(), trace=oracle.main.trace))
    reference = Oracle(0, 0x4321)
    ordinary = reference.generate()
    shiny = Oracle(0, 0x4321, ordinary["personality"])
    result = shiny.generate()
    assert shiny.main.trace == reference.main.trace
    assert result["personality"] == result["otId"]
    factory_cases.append(dict(id="shiny-player-ot-no-additional-draw",
                              purposes=["player-ot-allows-shiny", "no-random-ot-generation"],
                              initial=dict(mainSeed=0, wildSeed=0x4321, trainerId=shiny.trainer_id),
                              expected=result, state=shiny.snapshot(), trace=shiny.main.trace))
    # All scripts start from genuine fresh source state. No forged cooldown,
    # slot, creature, personality, rate buff or RNG state is injected.
    step_cases = []
    scripts = [
        ("continuous-grass", [("land", 2)] * 24),
        ("terrain-edges", [("none", 0)] * 3 + [("land", 2)] * 7 + [("none", 0), ("land", 2)] * 10),
        ("nonland-preserves-cooldown", [("land", 2)] * 3 + [("none", 0)] * 4 + [("land", 2)] * 12),
    ]
    for label, script in scripts:
        for seed in (0, 1, 7, 23, 101):
            oracle = Oracle(seed, 0x4321)
            steps = [oracle.step(*entry) for entry in script]
            step_cases.append(dict(id=f"{label}-{seed}", initial=dict(mainSeed=seed, wildSeed=0x4321,
                                   trainerId=TRAINER_ID), steps=steps))
    # An early bypass followed by a real successful rate roll resets step1.
    for seed in range(100_000):
        oracle = Oracle(seed, 0)
        step = oracle.step("land", 2)
        if step["creature"]:
            step_cases.append(dict(id="first-step-early-bypass-success", initial=dict(mainSeed=seed,
                                   wildSeed=0, trainerId=TRAINER_ID), steps=[step, oracle.step("none", 0)]))
            break
    else:
        raise AssertionError("Missing early encounter fixture")
    # The second rate roll is exactly336: base rate336 would reject it, but
    # the first genuine miss added21, making the next threshold337. This
    # distinguishes implemented rate growth from merely storing the buff.
    for wild_seed in range(65536):
        rng = Rng(wild_seed, 12345, "wild")
        if rng.draw("first") % 1600 >= 336 and rng.draw("second") % 1600 == 336:
            oracle = Oracle(1, wild_seed)
            steps = []
            while oracle.wild.draws < 2:
                steps.append(oracle.step("land", 2))
                assert len(steps) < 20
            assert steps[-1]["creature"] is not None
            assert steps[-2]["state"]["encounterRateBuff"] == 21
            step_cases.append(dict(id="rate-buff-changes-threshold", initial=dict(mainSeed=1,
                                   wildSeed=wild_seed, trainerId=TRAINER_ID), steps=steps))
            break
    else:
        raise AssertionError("Missing rate-buff threshold fixture")
    reasons = {step["reason"] for case in step_cases for step in case["steps"]}
    assert reasons == {"no-encounter-terrain", "cooldown", "changed-behavior-gate", "rate-miss", "encounter"}
    return dict(schemaVersion=1, sourceFingerprint=FINGERPRINT,
                scope="Private Route1 source factory through ordinary wild held-item assignment; no battle introduction, live map, database, or battle commands",
                independence="Literal source constants and separate Python integer oracle; production extractor, wrapper and WASM are never executed or imported",
                adaptation="Random32 is evaluated low-half first, then high-half, explicitly matching the chosen portable source adapter contract",
                sourceRecords=source_records(), factoryCases=factory_cases, stepCases=step_cases)


def main():
    data = json.dumps(fixtures(), indent=2) + "\n"
    if "--check" in sys.argv:
        assert TARGET.read_text(encoding="utf-8") == data, "Encounter literal fixtures differ; review source derivation before regeneration"
        print("Encounter source-literal fixture reproducibility passed (no files changed).")
    else:
        TARGET.write_text(data, encoding="utf-8")
        print(f"Wrote independently derived literal fixtures to {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
