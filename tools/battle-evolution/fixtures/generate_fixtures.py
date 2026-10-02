"""Test-only evolution oracle transcribed independently from the pinned source.

No production extractor, C, WASM or TypeScript is imported or executed. Private
diagnostic states are not claimed reachable through the level-five combat profile.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fixtures"))
from fixture_io import read_fixture_text, write_fixture_text

ROOT = Path(__file__).resolve().parents[3]
TARGET = Path(__file__).with_name("source-cases.json")
FINGERPRINT = "f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982"
KEYS = ("hp", "attack", "defense", "speed", "spAttack", "spDefense")
NAMES = {7: "SQUIRTLE", 8: "WARTORTLE", 9: "BLASTOISE", 16: "PIDGEY", 17: "PIDGEOTTO", 18: "PIDGEOT", 19: "RATTATA", 20: "RATICATE"}
BASE = {7: (44, 48, 65, 43, 50, 64), 8: (59, 63, 80, 58, 65, 80), 9: (79, 83, 100, 78, 85, 105),
        16: (40, 45, 40, 56, 35, 35), 17: (63, 60, 55, 71, 50, 50), 18: (83, 80, 75, 91, 70, 70),
        19: (30, 56, 35, 72, 25, 35), 20: (55, 81, 60, 97, 50, 70)}
EVOLUTIONS = {7: (16, 8), 8: (36, 9), 16: (18, 17), 17: (36, 18), 19: (20, 20)}
LEARN = {
    7: [(1, 33), (4, 39), (7, 145), (10, 110), (13, 55), (18, 44), (23, 229), (28, 182), (33, 240), (40, 130), (47, 56)],
    8: [(1, 33), (1, 39), (1, 145), (4, 39), (7, 145), (10, 110), (13, 55), (19, 44), (25, 229), (31, 182), (37, 240), (45, 130), (53, 56)],
    9: [(1, 33), (1, 39), (1, 145), (1, 110), (4, 39), (7, 145), (10, 110), (13, 55), (19, 44), (25, 229), (31, 182), (42, 240), (55, 130), (68, 56)],
    16: [(1, 33), (5, 28), (9, 16), (13, 98), (19, 18), (25, 17), (31, 297), (39, 97), (47, 119)],
    17: [(1, 33), (1, 28), (1, 16), (5, 28), (9, 16), (13, 98), (20, 18), (27, 17), (34, 297), (43, 97), (52, 119)],
    18: [(1, 33), (1, 28), (1, 16), (1, 98), (5, 28), (9, 16), (13, 98), (20, 18), (27, 17), (34, 297), (48, 97), (62, 119)],
    19: [(1, 33), (1, 39), (7, 98), (13, 158), (20, 116), (27, 228), (34, 162), (41, 283)],
    20: [(1, 33), (1, 39), (1, 98), (7, 98), (13, 158), (20, 184), (30, 228), (40, 162), (50, 283)],
}
PP = {0: 0, 16: 35, 17: 35, 18: 20, 28: 15, 33: 35, 39: 30, 44: 25, 55: 25, 56: 5, 97: 30,
      98: 30, 110: 40, 116: 30, 119: 20, 130: 15, 145: 30, 158: 15, 162: 10, 182: 10, 184: 10,
      228: 20, 229: 40, 240: 5, 283: 5, 297: 15}
GLYPHS = {" ": 0, **{chr(65+i): 0xBB+i for i in range(26)}, **{chr(97+i): 0xD5+i for i in range(26)},
          **{str(i): 0xA1+i for i in range(10)}, "!": 0xAB, "?": 0xAC, ".": 0xAD, "-": 0xAE,
          "…": 0xB0, "“": 0xB1, "”": 0xB2, "‘": 0xB3, "'": 0xB4, "♂": 0xB5, "♀": 0xB6, ",": 0xB8, "/": 0xBA}
SOURCES = {
    "src/evolution_scene.c": "Cancellation still executes one old-species MonTryLearningNewMove call; accepted source species/stat/name/dex/statistic order; current-level move decisions and HM guard",
    "src/pokemon.c": "GetEvolutionTargetSpecies/Everstone; CalculateMonStats HP delta and cached EVs; EvolutionRenameMon exact same-language species-name test; ability slot retention; move insertion/PP bonus replacement",
    "src/battle_main.c": "TryEvolvePokemon clears each levelup bit before its one evolution scene; no same-event evolution chain",
    "src/data/pokemon/evolution.h": "Five literal ordinary level thresholds in the eight-species closure",
    "src/data/pokemon/species_info.h": "All eight base stats, growth rates, gender and ability slots",
    "src/data/pokemon/level_up_learnsets.h": "All eight exact current-level learnsets, including Raticate20 ScaryFace versus cancelled Rattata20 FocusEnergy",
    "src/data/pokemon/experience_tables.h": "Source level experience thresholds",
    "src/data/battle_moves.h": "Twenty-five source level-up move PP constants",
    "src/data/items.h": "Everstone195 holds source prevent-evolve effect38",
    "src/pokedex_screen.c": "Accepted evolution sets target seen mirrors and caught bit",
    "src/overworld.c": "Evolution game statistic saturates at0xFFFFFF",
    "include/constants/global.h": "Explicit source language enum and name lengths",
    "charmap.txt": "Source encoded nickname bytes",
}


def experience(species, level):
    if species in (19, 20): return level**3
    return 1 if level == 1 else 6*level**3//5-15*level**2+100*level-140


def stats(species, level, personality, ivs, evs):
    raised, lowered = divmod(personality % 25, 5)
    result = {}
    for i, (key, base) in enumerate(zip(KEYS, BASE[species])):
        value = (2*base+ivs[key]+evs[key]//4)*level//100+(level+10 if i == 0 else 5)
        if i and raised != lowered:
            if i-1 == raised: value = value*110//100
            elif i-1 == lowered: value = value*90//100
        result[key] = value
    return result


def name_bytes(text):
    assert len(text) <= 10
    return [GLYPHS[c] for c in text]+[255]*(11-len(text))


def admission(species=7, level=16, personality=25, iv=None, ev=None, basis=None, hp=1, moves=None,
              pp_ups=None, nickname=None, seen=False, caught=False, count=0, can_cancel=True,
              status=0, held=0, ability_num=None, friendship=70):
    ivs = dict.fromkeys(KEYS, 15) if iv is None else dict(iv)
    evs = dict.fromkeys(KEYS, 0) if ev is None else dict(ev)
    calculated = deepcopy(evs if basis is None else basis)
    cached = stats(species, level, personality, ivs, calculated)
    selected = list(dict.fromkeys(move for at, move in LEARN[species] if at <= level))[:4] if moves is None else moves[:]
    selected += [0]*(4-len(selected))
    ups = pp_ups or [0]*4
    ability_num = (personality & 1 if species in (19, 20) else 0) if ability_num is None else ability_num
    return dict(creature=dict(speciesId=species, personality=personality, otId=1, level=level,
                              experience=experience(species, level), friendship=friendship,
                              hp=cached["hp"] if hp == "full" else hp, stats=cached, ivs=ivs, evs=evs, calculatedEvs=calculated,
                              nature=personality % 25, abilityNum=ability_num,
                              abilityId=([50, 62][ability_num] if species in (19, 20) else 67 if species in (7, 8, 9) else 51),
                              gender=254 if personality & 255 < (31 if species in (7, 8, 9) else 127) else 0,
                              status=status, heldItemId=held, ballItemId=4, metLocation=101,
                              moves=[dict(moveId=m, pp=max(0, PP[m]+PP[m]*20*ups[i]//100-1) if m else 0,
                                          ppUps=ups[i] if m else 0) for i, m in enumerate(selected)]),
                context=dict(nickname=NAMES[species] if nickname is None else nickname, language=2,
                             targetSeen=seen, targetCaught=caught, evolutionStat=count, canCancel=can_cancel))


def target(initial):
    c = initial["creature"]
    if c["heldItemId"] == 195: return 0
    edge = EVOLUTIONS.get(c["speciesId"])
    return edge[1] if edge and c["level"] >= edge[0] else 0


class Oracle:
    def __init__(self, initial):
        c, context = deepcopy(initial["creature"]), initial["context"]
        self.state = dict(phase=1, preSpecies=c["speciesId"], target=target(initial), choice=0, stopped=False,
                          learnFirst=True, cursor=0, moveToLearn=0, seen=context["targetSeen"], caught=context["targetCaught"],
                          count=context["evolutionStat"], renamed=False, lastReturn=0,
                          event=dict(kind=0, value=0, slot=0), lastDecisionSlot=0xFFFFFFFF,
                          nickname=context["nickname"], nicknameBytes=name_bytes(context["nickname"]), creature=c)
        assert self.state["target"]
        self.events = []

    def event(self, kind, value=0, slot=0):
        self.state["event"] = dict(kind=kind, value=value, slot=slot)
        if kind: self.events.append(deepcopy(self.state["event"]))

    def learn(self):
        s, c = self.state, self.state["creature"]
        table = LEARN[c["speciesId"]]
        if s["learnFirst"]:
            s["cursor"] = next((i for i, (level, _) in enumerate(table) if level == c["level"]), len(table))
        if s["cursor"] == len(table) or table[s["cursor"]][0] != c["level"]:
            result = 0
        else:
            move = table[s["cursor"]][1]
            s["moveToLearn"] = move; s["cursor"] += 1
            result = 0xFFFF
            for slot, existing in enumerate(c["moves"]):
                if existing["moveId"] == 0:
                    c["moves"][slot] = dict(moveId=move, pp=PP[move], ppUps=existing["ppUps"])
                    result = move; break
                if existing["moveId"] == move:
                    result = 0xFFFE; break
        s["lastReturn"] = result
        return result

    def choose(self, accept):
        s, c = self.state, self.state["creature"]
        s["choice"] = 1 if accept else 2
        if not accept:
            self.learn(); s["stopped"] = True; s["phase"] = 4
            self.event(2, s["preSpecies"]); return
        old_max = c["stats"]["hp"]
        c["speciesId"] = s["target"]
        c["stats"] = stats(c["speciesId"], c["level"], c["personality"], c["ivs"], c["evs"])
        c["calculatedEvs"] = deepcopy(c["evs"])
        if c["hp"]: c["hp"] += c["stats"]["hp"]-old_max
        # Stored ability slot and personality remain unchanged. All admitted
        # evolutionary edges have the same source ability table entries.
        if s["nickname"] == NAMES[s["preSpecies"]]:
            s["nickname"] = NAMES[s["target"]]; s["nicknameBytes"] = name_bytes(s["nickname"]); s["renamed"] = True
        s["seen"] = s["caught"] = True; s["count"] = min(0xFFFFFF, s["count"]+1)
        s["phase"] = 2; self.event(1, s["target"])

    def step(self):
        s, c = self.state, self.state["creature"]
        learned = self.learn()
        # The source scene updates tLearnsFirstMove only inside its non-NONE,
        # non-cancelled branch; a no-move first probe keeps the initialized flag.
        if learned: s["learnFirst"] = False
        if learned == 0:
            s["phase"] = 4; self.event(6, c["speciesId"])
        elif learned == 0xFFFF:
            s["phase"] = 3; self.event(0)
        elif learned == 0xFFFE:
            self.event(0)
        else:
            slot = next(i for i, m in enumerate(c["moves"]) if m["moveId"] == learned)
            self.event(3, learned, slot)

    def decide(self, slot):
        s, c = self.state, self.state["creature"]
        move = s["moveToLearn"]
        if slot < 4:
            c["moves"][slot] = dict(moveId=move, pp=PP[move], ppUps=0); self.event(4, move, slot)
        else: self.event(5, move, 4)
        s["lastDecisionSlot"] = slot; s["phase"] = 2


def case(identifier, initial, accept=True, decisions=None):
    oracle = Oracle(initial); raw = [dict(operation=None, expected=deepcopy(oracle.state))]
    settled = [dict(sequence=0, expected=deepcopy(oracle.state), events=[])]
    oracle.choose(accept); raw.append(dict(operation=dict(kind="choose", accept=accept), expected=deepcopy(oracle.state)))
    sequence, accepted = 1, []
    while True:
        while oracle.state["phase"] == 2:
            oracle.step(); raw.append(dict(operation=dict(kind="next"), expected=deepcopy(oracle.state)))
        settled.append(dict(sequence=sequence, expected=deepcopy(oracle.state), events=deepcopy(oracle.events)))
        if oracle.state["phase"] == 4: break
        slot = (decisions or [4])[len(accepted)]
        accepted.append(slot); oracle.decide(slot)
        raw.append(dict(operation=dict(kind="decide", slot=slot), expected=deepcopy(oracle.state))); sequence += 1
    return dict(id=identifier, input=initial, accept=accept, decisions=accepted, raw=raw, settled=settled)


def source_records():
    lock = json.loads((ROOT/"source-lock.json").read_text(encoding="utf-8-sig"))
    manifest = json.loads((ROOT/"reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pins = {row["path"]: row["sha256"] for row in manifest["records"]}
    result = []
    for path, evidence in SOURCES.items():
        digest = hashlib.sha256((Path(lock["reference"]["localPath"])/path).read_bytes()).hexdigest()
        assert digest == pins[path]
        result.append(dict(path=path, sha256=digest, evidence=evidence))
    return result


def fixtures():
    cases, eligibility = [], []
    for species in NAMES:
        for level in range(1, 101):
            initial = admission(species, level)
            eligibility.append(dict(id=f"eligibility-{species}-{level}", input=initial, target=target(initial)))
            if target(initial): cases.append(case(f"level-{species}-{level}", initial))
    for species, (level, _) in EVOLUTIONS.items():
        for held in [0, 195]:
            initial = admission(species, level, held=held)
            eligibility.append(dict(id=f"held-{species}-{held}", input=initial, target=target(initial)))
        for accept in [True, False]:
            cases.append(case(f"edge-{species}-{level}-{'accept' if accept else 'cancel'}", admission(species, level), accept))
        for nature in range(25):
            cases.append(case(f"nature-{species}-{nature}", admission(species, level, personality=25+nature)))
        for hp in [0, 1, "full"]:
            for status in [0, 1, 0xFFFFFFFF]:
                cases.append(case(f"HP-status-{species}-{hp}-{status}", admission(species, level, hp=hp, status=status)))
        for seen, caught in [(False, False), (True, False), (True, True)]:
            for count in [0, 0xFFFFFE, 0xFFFFFF]:
                cases.append(case(f"dex-count-{species}-{int(seen)}-{int(caught)}-{count}",
                                  admission(species, level, seen=seen, caught=caught, count=count)))
        for name in [NAMES[species], NAMES[species].lower(), NAMES[species]+" ", "CUSTOM", "0123456789"]:
            cases.append(case(f"nickname-{species}-{len(cases)}", admission(species, level, nickname=name)))
        cases.append(case(f"cannot-cancel-accept-{species}", admission(species, level, can_cancel=False)))
        maximum = dict.fromkeys(KEYS, 0); maximum["hp"] = maximum["speed"] = 255
        old = dict.fromkeys(KEYS, 0)
        cases.append(case(f"EV-cache-accepted-{species}", admission(species, level, ev=maximum, basis=old)))
        cases.append(case(f"EV-cache-cancelled-{species}", admission(species, level, ev=maximum, basis=old), False))
        for iv in [0, 31]:
            cases.append(case(f"IV-extreme-{species}-{iv}", admission(species, level, iv=dict.fromkeys(KEYS, iv))))
        for friendship in [0, 255]:
            cases.append(case(f"friendship-preserved-{species}-{friendship}", admission(species, level, friendship=friendship)))
    # Every relevant target move level is tested separately with an empty slot,
    # a full move set and all replacement choices. No relearn/backfill occurs.
    for species, (threshold, evolved) in EVOLUTIONS.items():
        for level, new_move in LEARN[evolved]:
            if level < threshold: continue
            legal = list(dict.fromkeys(m for at, m in LEARN[species] if at <= level))
            available = [m for m in legal if m != new_move]
            for slot in range(5):
                cases.append(case(f"target-move-{species}-{level}-choice{slot}",
                                  admission(species, level, moves=available[:4], pp_ups=[3, 2, 1, 3]), decisions=[slot]))
            cases.append(case(f"target-move-{species}-{level}-empty", admission(species, level, moves=available[:2])))
            if new_move in legal:
                cases.append(case(f"target-move-{species}-{level}-already-known",
                                  admission(species, level, moves=[new_move]+available[:3])))
        for level, old_move in LEARN[species]:
            if level < threshold: continue
            available = list(dict.fromkeys(m for at, m in LEARN[species] if at <= level and m != old_move))
            for mode, moves in [("empty", available[:2]), ("full", available[:4]), ("known", [old_move]+available[:3])]:
                cases.append(case(f"cancel-old-move-{species}-{level}-{mode}", admission(species, level, moves=moves), False))
    # Source abilityNum is an existing stored identity bit. Evolution does not
    # recalculate it from personality even when that parity differs diagnostically.
    for bit in [0, 1]:
        for personality in [24, 25]:
            cases.append(case(f"ability-slot-{bit}-personality{personality}", admission(19, 20, ability_num=bit, personality=personality)))
    for ball, location in [(None, None), (11, 88), (4, 0), (4, 255)]:
        initial = admission(); initial["creature"]["ballItemId"] = ball; initial["creature"]["metLocation"] = location
        cases.append(case(f"preserve-acquisition-metadata-{ball}-{location}", initial))
    return dict(schemaVersion=1, sourceFingerprint=FINGERPRINT,
                independence="Independent source-literal Python arithmetic/tables; no production C/WASM/host-generated expectations; no ROM or emulator comparison",
                scope="Private one-event evolution candidate and move choices; no durable mutation, live battle reachability or resulting-team combat admission",
                sourceRecords=source_records(), evolutionEdges=EVOLUTIONS, eligibility=eligibility, cases=cases)


def main():
    if "--check" in sys.argv: read_fixture_text(TARGET)
    data = json.dumps(fixtures(), indent=2, ensure_ascii=False)+"\n"
    if "--check" in sys.argv:
        assert read_fixture_text(TARGET) == data, "Evolution source literals differ; audit before regeneration"
        print("Evolution independent source-literal reproducibility passed without writes.")
    else:
        write_fixture_text(TARGET, data)
        print(f"Wrote independent evolution fixtures: {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
