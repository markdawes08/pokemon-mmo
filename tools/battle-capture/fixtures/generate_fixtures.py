"""Independent, source-literal capture disposition oracle; never runs production code.

Fixtures describe private candidate effects, not an owned creature or database grant.
The source naming keyboard is represented by explicit byte literals. Source display
callbacks are omitted; their storage bookkeeping is retained at its decision boundary.
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
BASE = {16: (40, 45, 40, 56, 35, 35), 19: (30, 56, 35, 72, 25, 35)}
PP = {0: 0, 33: 35, 39: 30, 28: 15}
FULL = (1 << 30)-1
GLYPHS = {" ": 0, **{chr(65+i): 0xBB+i for i in range(26)},
          **{chr(97+i): 0xD5+i for i in range(26)}, **{str(i): 0xA1+i for i in range(10)},
          "!": 0xAB, "?": 0xAC, ".": 0xAD, "-": 0xAE, "…": 0xB0, "“": 0xB1,
          "”": 0xB2, "‘": 0xB3, "'": 0xB4, "♂": 0xB5, "♀": 0xB6, ",": 0xB8, "/": 0xBA}
SOURCES = {
    "src/pokemon.c": "CreateBoxMon metadata; GiveMonToPlayer exact OT overwrite/first party hole; SendMonToPC starts current box and wraps; MonRestorePP; BoxPokemon excludes current HP/status/stat cache",
    "src/battle_script_commands.c": "Caught dex update, nickname choice and GiveMonToPlayer message ordering",
    "data/battle_scripts_2.s": "Capture stat then dex then nickname then placement, before final caught outcome",
    "src/naming_screen.c": "Literal keyboard; SaveInputText blank preservation/full-buffer copy; accepted-name PC preflight before Give",
    "charmap.txt": "Source keyboard byte encoding; apostrophe byte B4 and EOS FF",
    "src/field_specials.c": "IsDestinationBoxFull/ShouldShowBoxWasFullMessage history, scratch and message flag changes",
    "src/item_use.c": "Full party+PC rejects before consuming the ball or capture attempt",
    "src/pokemon_storage_system.c": "Current box is distinct from send-box history; fourteen boxes of thirty slots",
    "src/pokedex_screen.c": "Three seen mirrors and owned bit; SET_CAUGHT alone does not mark seen",
    "src/overworld.c": "IncrementGameStat saturates at 0xFFFFFF",
    "include/pokemon.h": "BoxPokemon versus Pokemon stored field boundary",
    "include/constants/global.h": "FireRed4, English2, player name7 and nickname10 encoded characters",
    "include/constants/region_map_sections.h": "Route1 source enum value101",
    "src/data/pokemon/species_info.h": "Pidgey/Rattata source base stats, abilities, growth and friendship",
    "src/data/pokemon/level_up_learnsets.h": "Exact Route1 initial move sets",
    "src/data/pokemon/experience_tables.h": "Medium Slow/Medium Fast initial experience",
    "src/data/battle_moves.h": "Source maximum PP for Tackle/SandAttack/TailWhip",
}


def encode(text, capacity):
    assert len(text) <= capacity
    return [GLYPHS[c] for c in text] + [255] * (capacity+1-len(text))


def mon(species=16, level=5, personality=25, hp=1, pp=None, ot=1):
    nature = personality % 25
    raised, lowered = divmod(nature, 5)
    stats = []
    for index, base in enumerate(BASE[species]):
        value = (2*base+15)*level//100+(level+10 if index == 0 else 5)
        if index and raised != lowered:
            if index-1 == raised: value = value*110//100
            elif index-1 == lowered: value = value*90//100
        stats.append(value)
    moves = [33, 39 if species == 19 else 28 if level == 5 else 0, 0, 0]
    return dict(speciesId=species, personality=personality, otId=ot, nature=nature,
                abilityId=51 if species == 16 else (62 if personality & 1 else 50),
                abilityNum=0 if species == 16 else personality & 1,
                gender=254 if personality & 255 < 127 else 0,
                level=level, experience=level**3 if species == 19 else 6*level**3//5-15*level**2+100*level-140,
                friendship=70, hp=hp, stats=dict(zip(KEYS, stats)), ivs=dict.fromkeys(KEYS, 15),
                evs=dict.fromkeys(KEYS, 0), status=0, heldItemId=0,
                moves=[dict(moveId=m, pp=(pp[i] if pp else max(0, PP[m]-3)) if m else 0, ppUps=0) for i, m in enumerate(moves)])


def admission(creature=None, **context):
    default = dict(trainerName="TRAINER", trainerGender=0, seen=False, caught=False, captureCount=0,
                   partyMask=1, currentBox=0, sendBox=0, shownFullMessage=False, billPC=False, boxMasks=[0]*14)
    default.update(context)
    return dict(creature=creature or mon(), context=default)


def first_party(mask):
    return next((i for i in range(6) if not mask >> i & 1), None)


def first_box(context):
    for offset in range(14):
        box = (context["currentBox"]+offset) % 14
        for slot in range(30):
            if not context["boxMasks"][box] >> slot & 1:
                return box, slot
    return None


def preflight(c):
    box, _ = first_box(c)
    scratch = c["sendBox"]
    if scratch != box: c["shownFullMessage"] = False
    c["sendBox"] = box
    full_message = not c["shownFullMessage"] and c["currentBox"] != box
    if full_message: c["shownFullMessage"] = True
    return scratch, (3 if full_message else 1) + int(c["billPC"])


def case(identifier, initial, decision=None):
    decision = decision or dict(kind="keep")
    c, creature = deepcopy(initial["context"]), deepcopy(initial["creature"])
    assert first_party(c["partyMask"]) is not None or first_box(c) is not None
    nickname = "PIDGEY" if creature["speciesId"] == 16 else "RATTATA"
    stage = dict(sequence=0, creature=creature, context=c, nickname=nickname,
                 nicknameBytes=encode(nickname, 10), trainerNameBytes=encode(c["trainerName"], 7),
                 metLevel=creature["level"], metLocation=101, metGame=4, language=2, ballItemId=4,
                 otGender=c["trainerGender"], mail=255, newDex=False, scratchBox=0, decision=0,
                 partyCount=first_party(c["partyMask"]) if c["partyMask"] != 63 else 6,
                 pcMessage=0, placement=None)
    stages = [deepcopy(stage)]
    # The earlier battle encounter has a deferred SET_SEEN boundary here, before
    # Cmd_trysetcaughtmondexflags. Three coherent seen mirrors become set.
    c["seen"] = True
    stage["newDex"] = not c["caught"]
    c["caught"] = True
    c["captureCount"] = min(0xFFFFFF, c["captureCount"]+1)
    stage["sequence"] = 1
    stages.append(deepcopy(stage))
    stage["decision"] = 1 if decision["kind"] == "keep" else 2
    if decision["kind"] == "rename":
        text = decision["name"]
        if any(char != " " for char in text):
            stage["nickname"] = text
            stage["nicknameBytes"] = encode(text, 10)
        if c["partyMask"] == 63:
            stage["scratchBox"], stage["pcMessage"] = preflight(c)
    stage["sequence"] = 2
    stages.append(deepcopy(stage))
    # GiveMonToPlayer writes the explicitly admitted original trainer ID; no
    # owner identifier is inferred from the species or created by this oracle.
    creature["otId"] = initial["creature"]["otId"]
    party = first_party(c["partyMask"])
    if party is not None:
        c["partyMask"] |= 1 << party
        stage["partyCount"] = party+1
        stage["placement"] = dict(kind="party", slot=party)
    else:
        box, slot = first_box(c)
        stage["scratchBox"] = c["sendBox"]
        if c["sendBox"] != box: c["shownFullMessage"] = False
        c["sendBox"] = box
        for move in creature["moves"]:
            if move["moveId"]: move["pp"] = PP[move["moveId"]]
        c["boxMasks"][box] |= 1 << slot
        stage["placement"] = dict(kind="box", box=box, slot=slot)
        if decision["kind"] == "keep":
            full_message = not c["shownFullMessage"] and c["currentBox"] != box
            if full_message: c["shownFullMessage"] = True
            stage["pcMessage"] = (3 if full_message else 1) + int(c["billPC"])
    stage["sequence"] = 3
    stages.append(deepcopy(stage))
    return dict(id=identifier, input=initial, decision=decision, stages=stages)


def fixtures():
    cases = [case("canonical-party-keep", admission()), case("canonical-box-keep", admission(partyMask=63)),
             case("canonical-box-rename", admission(partyMask=63), dict(kind="rename", name="Bird"))]
    for species, levels in [(16, range(2, 6)), (19, range(2, 5))]:
        for level in levels:
            for personality in [0, 25, 150, 0xFFFFFFFF]:
                cases.append(case(f"identity-{species}-{level}-{personality}", admission(mon(species, level, personality))))
    for seen, caught in [(False, False), (True, False), (True, True)]:
        for count in [0, 1, 0xFFFFFE, 0xFFFFFF]:
            cases.append(case(f"dex-{int(seen)}-{int(caught)}-count{count}", admission(seen=seen, caught=caught, captureCount=count)))
    for gender in [0, 1]:
        for name in ["A", "AbCdEfG", "A B C D"]:
            cases.append(case(f"trainer-{gender}-{name}", admission(trainerName=name, trainerGender=gender)))
    for index, glyph in enumerate(GLYPHS):
        cases.append(case(f"keyboard-glyph-{index:02d}", admission(), dict(kind="rename", name=glyph)))
    for text in ["", " "*10, "A"*10, " a B ", "  A       ", "0123456789", "♂♀/!?…“”‘'"]:
        for party in [1, 63]:
            cases.append(case(f"nickname-boundary-{party}-{len(cases)}", admission(partyMask=party), dict(kind="rename", name=text)))
    for party in range(6):
        cases.append(case(f"party-first-empty-{party}", admission(partyMask=(1 << party)-1)))
    for mask in [2, 5, 10, 21, 42, 62]:
        cases.append(case(f"diagnostic-party-hole-{mask}", admission(partyMask=mask)))
    for trainer_id in [0, 0x12345678, 0xFFFFFFFF]:
        cases.append(case(f"diagnostic-original-OTID-{trainer_id}", admission(mon(ot=trainer_id))))
    for box in range(14):
        for slot in range(30):
            masks = [FULL]*14; masks[box] ^= 1 << slot
            cases.append(case(f"last-PC-space-{box}-{slot}", admission(partyMask=63, currentBox=(box+1) % 14,
                              sendBox=(box+7) % 14, boxMasks=masks), dict(kind="rename", name="") if slot % 2 else None))
    for current in range(14):
        for slot in [0, 29]:
            masks = [0]*14; masks[current] = (1 << slot)-1
            cases.append(case(f"selected-PC-box-{current}-slot{slot}", admission(partyMask=63, currentBox=current,
                              sendBox=(current+7) % 14, boxMasks=masks)))
    for decision in [dict(kind="keep"), dict(kind="rename", name="Named"), dict(kind="rename", name="   ")]:
        for prior in [0, 1, 13]:
            for shown in [False, True]:
                for bill in [False, True]:
                    masks = [FULL]+[0]*13
                    cases.append(case(f"PC-history-{decision['kind']}-{len(cases)}", admission(partyMask=63, currentBox=0,
                                      sendBox=prior, shownFullMessage=shown, billPC=bill, boxMasks=masks), decision))
    for species, level in [(16, 5), (19, 4)]:
        for party in [1, 63]:
            for pp in [[0, 0, 0, 0], [1, 1, 0, 0]]:
                cases.append(case(f"HP-PP-preservation-{species}-{party}-{pp[0]}", admission(mon(species, level, pp=pp), partyMask=party)))
    lock = json.loads((ROOT/"source-lock.json").read_text(encoding="utf-8-sig"))
    manifest = json.loads((ROOT/"reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pins = {row["path"]: row["sha256"] for row in manifest["records"]}
    records = []
    for path, evidence in SOURCES.items():
        digest = hashlib.sha256((Path(lock["reference"]["localPath"])/path).read_bytes()).hexdigest()
        assert digest == pins[path]
        records.append(dict(path=path, sha256=digest, evidence=evidence))
    return dict(schemaVersion=1, sourceFingerprint=FINGERPRINT,
                independence="Independent Python source literals, integer formulas and keyboard bytes; no production module/extractor/host-generated expectations and no ROM comparison",
                scope="Private candidate metadata/dex/nickname/placement; no owned asset, account, database or combat-readmission claim",
                sourceRecords=records, keyboard=GLYPHS, cases=cases)


def main():
    if "--check" in sys.argv: read_fixture_text(TARGET)
    data = json.dumps(fixtures(), indent=2, ensure_ascii=False)+"\n"
    if "--check" in sys.argv:
        assert read_fixture_text(TARGET) == data, "Capture source literals differ; audit before regeneration"
        print("Capture independent source-literal reproducibility passed without writes.")
    else:
        write_fixture_text(TARGET, data)
        print(f"Wrote independent capture source cases: {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
