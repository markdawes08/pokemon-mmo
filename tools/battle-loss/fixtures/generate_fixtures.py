"""Independent source-literal loss/blackout oracle; no production code imports.

The input tuple is diagnostic. Higher levels, friendship, PP bonuses, arbitrary
clearable status and later healing points do not authorize combat or map entry.
Only the mechanical continuation is expected; arrival scripts remain pending.
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
BASE = dict(zip(KEYS, (44, 48, 65, 43, 50, 64)))
LEARN = [(1, 33, 35), (4, 39, 30), (7, 145, 30), (10, 110, 40),
         (13, 55, 25), (18, 44, 25), (23, 229, 40), (28, 182, 10),
         (33, 240, 5), (40, 130, 15), (47, 56, 5)]
PP = {0: 0, **{move: pp for _, move, pp in LEARN}}
MULTIPLIERS = [2, 4, 6, 9, 12, 16, 20, 25, 30]
# Independently transcribed from heal_locations.json, map_groups.h and NPC IDs.
# id, outdoor map group/number, checkpoint x/y, indoor group/number, healer ID.
HEALS = [
    (1, 3, 0, 6, 8, 4, 0, 1), (2, 3, 1, 26, 27, 5, 4, 1),
    (3, 3, 2, 17, 26, 6, 5, 3), (4, 3, 3, 22, 20, 7, 3, 1),
    (5, 3, 4, 6, 6, 8, 0, 1), (6, 3, 5, 15, 7, 9, 1, 1),
    (7, 3, 6, 48, 12, 10, 12, 1), (8, 3, 7, 25, 32, 11, 5, 1),
    (9, 3, 8, 14, 12, 12, 5, 1), (10, 3, 9, 11, 7, 13, 0, 2),
    (11, 3, 10, 24, 39, 14, 6, 1), (12, 3, 22, 12, 6, 16, 0, 1),
    (13, 3, 28, 13, 21, 21, 0, 1), (14, 3, 12, 14, 6, 32, 0, 1),
    (15, 3, 13, 21, 8, 33, 2, 1), (16, 3, 14, 14, 28, 34, 1, 1),
    (17, 3, 15, 18, 21, 35, 1, 1), (18, 3, 16, 18, 7, 36, 0, 1),
    (19, 3, 17, 12, 4, 31, 3, 1), (20, 3, 18, 11, 12, 37, 0, 1),
]
SOURCE_EVIDENCE = {
    "src/battle_script_commands.c": "Cmd_tryfaintmon calls player faint friendship; Cmd_getmoneyreward previews loss without debiting; Cmd_getexp skips fainted recipient",
    "src/battle_util2.c": "AdjustFriendshipOnBattleFaint uses opponent level minus player level >29",
    "src/battle_main.c": "LOST and DREW route HandleEndTurn_BattleLost; special link and early-rival branches are excluded",
    "src/battle_setup.c": "IsPlayerDefeated maps LOST/DREW to CB2_WhiteOut for ordinary wild battle",
    "src/pokemon.c": "Friendship negative bands/clamp, no positive-context bonuses or RNG; highest non-egg party level; CalculatePPWithBonus integer arithmetic",
    "src/script_pokemon_util.c": "HealPlayerParty sets HP to cached maximum, restores each PP, clears status without stat calculation or XP/EV changes",
    "src/overworld.c": "Whiteout multiplier table and capped debit; E4 reset then debit/heal/field resets/respawn; final on-foot north avatar",
    "src/money.c": "RemoveMoney saturates at zero; source wallet maximum999999",
    "src/heal_location.c": "Canonical last-heal destination/healer selection; home/Indigo/One Island special coordinates; unknown table index requires validation",
    "src/field_screen_effect.c": "Home arrival script requires the complete canonical Pallet last-heal tuple; otherwise nurse; no gender branch",
    "src/data/heal_locations.json": "All twenty source heal-point records and order",
    "include/constants/map_groups.h": "Literal outdoor and indoor map group/number values",
    "include/constants/map_event_ids.h": "Healer local IDs, notably Pewter3 and Indigo2",
    "include/constants/flags.h": "Badge bits; six field flags and five Elite Four flags",
    "include/constants/vars.h": "Three field variables plus League scene reset",
    "include/constants/opponents.h": "Six Champion trainer flags reset by source script",
    "data/scripts/hall_of_fame.inc": "EventScript_ResetEliteFour clears five defeat flags, six Champion flags and League scene",
    "data/scripts/white_out.inc": "Mom/nurse pending scripts; Brock flag only selects nurse post-heal text",
    "src/data/pokemon/species_info.h": "Squirtle base stats; fixed IV15/Hardy diagnostic identity",
    "src/data/pokemon/experience_tables.h": "Medium Slow diagnostic initial XP, level1 explicit1",
    "src/data/pokemon/level_up_learnsets.h": "Legal Squirtle diagnostic moves by level",
    "src/data/battle_moves.h": "Source base PP for admitted Squirtle moves",
}


def experience(level):
    return 1 if level == 1 else 6*level**3//5 - 15*level**2 + 100*level - 140


def attributes(level, evs):
    return {key: ((2*BASE[key]+15+evs[key]//4)*level)//100 + (level+10 if key == "hp" else 5) for key in KEYS}


def heal_record(identifier):
    _, group, number, x, y, indoor_group, indoor_number, healer = HEALS[identifier-1]
    return dict(id=identifier, lastHeal=dict(mapGroup=group, mapNum=number, warpId=-1, x=x, y=y),
                destination=dict(mapGroup=indoor_group, mapNum=indoor_number, warpId=-1,
                                 x=8 if identifier == 1 else 13 if identifier == 10 else 5 if identifier == 14 else 7,
                                 y=5 if identifier == 1 else 12 if identifier == 10 else 4), healerLocalId=healer)


def admission(level=5, friendship=70, opponent=3, money=3000, badges=0, heal=1, outcome="lost",
              pp_ups=None, status=0, evs=None, calculated_evs=None, brock=False, field=None):
    evs = deepcopy(evs) if evs is not None else dict.fromkeys(KEYS, 0)
    basis = deepcopy(calculated_evs) if calculated_evs is not None else deepcopy(evs)
    selected = [move for at, move, _ in LEARN if at <= level][-4:]
    selected += [0] * (4-len(selected))
    pp_ups = pp_ups or [0, 0, 0, 0]
    moves = [dict(moveId=move, pp=0, ppUps=pp_ups[i] if move else 0) for i, move in enumerate(selected)]
    return dict(creature=dict(speciesId=7, abilityId=67, personality=25, otId=1, level=level, experience=experience(level),
                             friendship=friendship, hp=0, stats=attributes(level, basis), ivs=dict.fromkeys(KEYS, 15),
                             evs=evs, calculatedEvs=basis, moves=moves, status=status, heldItemId=0),
                opponentLevel=opponent, outcome=outcome,
                context=dict(money=money, badgeMask=badges, healLocationId=heal, brockDefeated=brock,
                             field=deepcopy(field) if field else dict(flags=63, route16=65535, safariEntrance=4321, questLogEntrance=999,
                                 eliteFourFlags=31, championFlags=63, league=65535, avatarFlags=255, direction=4, hasDirection=True)))


def case(identifier, initial):
    c, context = initial["creature"], initial["context"]
    badge_count = context["badgeMask"].bit_count()
    loss = min(context["money"], c["level"]*4*MULTIPLIERS[badge_count])
    penalty = (10 if c["friendship"] >= 200 else 5) if initial["opponentLevel"] - c["level"] > 29 else 1
    stages = []
    heal = heal_record(context["healLocationId"])
    for sequence in range(3):
        mon, field = deepcopy(c), deepcopy(context["field"])
        if sequence >= 1:
            mon["friendship"] = max(0, c["friendship"]-penalty)
        if sequence == 2:
            mon["hp"] = mon["stats"]["hp"]
            mon["status"] = 0
            for move in mon["moves"]:
                base = PP[move["moveId"]]
                move["pp"] = base + base*20*move["ppUps"]//100
            field = dict(flags=0, route16=0, safariEntrance=0, questLogEntrance=0, eliteFourFlags=0,
                         championFlags=0, league=0, avatarFlags=1, direction=2, hasDirection=True)
        stages.append(dict(sequence=sequence, creature=mon, moneyBefore=context["money"],
                           money=context["money"]-loss if sequence == 2 else context["money"],
                           moneyLoss=loss, badgeCount=badge_count, friendshipBefore=c["friendship"],
                           friendshipLoss=c["friendship"]-mon["friendship"] if sequence >= 1 else 0,
                           field=field, lastHeal=heal["lastHeal"],
                           respawn=(dict(destination=heal["destination"], healerLocalId=heal["healerLocalId"],
                                         arrivalScript="EventScript_AfterWhiteOutMomHeal" if context["healLocationId"] == 1 else "EventScript_AfterWhiteOutHeal",
                                         message="mom" if context["healLocationId"] == 1 else "nurse" if context["brockDefeated"] else "nurse-pre-brock")
                                    if sequence == 2 else None)))
    return dict(id=identifier, input=initial, stages=stages)


def fixtures():
    cases = [case("canonical-"+outcome, admission(outcome=outcome)) for outcome in ("lost", "draw")]
    for mask in range(256):
        cases.append(case(f"badge-mask-{mask:02x}", admission(badges=mask, money=999999)))
    for level in [1, 5, 100]:
        for count in range(9):
            loss = level*4*MULTIPLIERS[count]
            for wallet in [0, loss-1, loss, loss+1, 999999]:
                cases.append(case(f"wallet-level{level}-badges{count}-money{wallet}", admission(level=level, badges=(1 << count)-1, money=wallet)))
    for friendship in [0, 1, 4, 5, 9, 10, 99, 100, 199, 200, 254, 255]:
        for opponent in [1, 5, 34, 35, 100]:
            cases.append(case(f"faint-friendship{friendship}-level5-opponent{opponent}", admission(friendship=friendship, opponent=opponent)))
    for status in [0, 1, 7, 8, 16, 32, 64, 128, 0xFFFFFFFF]:
        for ups in range(4):
            cases.append(case(f"heal-status{status}-PPups{ups}", admission(level=12, status=status, pp_ups=[ups]*4)))
    for rotation in range(4):
        cases.append(case(f"heal-packed-PPbonus-rotation{rotation}", admission(level=12, pp_ups=[(i+rotation) % 4 for i in range(4)])))
    for identifier in range(1, 21):
        for brock in [False, True]:
            cases.append(case(f"last-heal-{identifier}-brock{int(brock)}", admission(heal=identifier, brock=brock)))
    empty = dict(flags=0, route16=0, safariEntrance=0, questLogEntrance=0, eliteFourFlags=0,
                 championFlags=0, league=0, avatarFlags=1, direction=2, hasDirection=True)
    cases.append(case("already-reset-field-state", admission(field=empty)))
    for name, bits in [("flags", 6), ("eliteFourFlags", 5), ("championFlags", 6)]:
        for bit in range(bits):
            fields = deepcopy(empty); fields[name] = 1 << bit
            cases.append(case(f"clear-only-{name}-{bit}", admission(field=fields)))
    for name in ["route16", "safariEntrance", "questLogEntrance", "league"]:
        fields = deepcopy(empty); fields[name] = 65535
        cases.append(case(f"clear-only-{name}", admission(field=fields)))
    current = dict.fromkeys(KEYS, 0); current["speed"] = 76
    basis = dict.fromkeys(KEYS, 0); basis["speed"] = 75
    cases.append(case("heal-preserves-unrecalculated-EV-stat-cache", admission(evs=current, calculated_evs=basis)))
    capped = dict.fromkeys(KEYS, 0); capped["hp"] = capped["speed"] = 255
    cases.append(case("heal-preserves-capped-EVs-and-cached-maxHP", admission(level=100, evs=capped)))
    lock = json.loads((ROOT/"source-lock.json").read_text(encoding="utf-8-sig"))
    manifest = json.loads((ROOT/"reports/source-manifest.json").read_text(encoding="utf-8-sig"))
    pins = {row["path"]: row["sha256"] for row in manifest["records"]}
    records = []
    for path, evidence in SOURCE_EVIDENCE.items():
        digest = hashlib.sha256((Path(lock["reference"]["localPath"])/path).read_bytes()).hexdigest()
        assert digest == pins[path]
        records.append(dict(path=path, sha256=digest, evidence=evidence))
    return dict(schemaVersion=1, sourceFingerprint=FINGERPRINT,
                scope="Private ordinary-wild mechanical loss continuation; map load, arrival scripts, persistent wallet/party/world effects and subsequent combat remain unapplied",
                independence="Test-only source-literal arithmetic and tables; no generated C/WASM or production host inputs used for expected results; no ROM/emulator claim",
                sourceRecords=records, badgeMultipliers=MULTIPLIERS, healLocations=[heal_record(i) for i in range(1, 21)], cases=cases)


def main():
    if "--check" in sys.argv: read_fixture_text(TARGET)
    value = json.dumps(fixtures(), indent=2) + "\n"
    if "--check" in sys.argv:
        assert read_fixture_text(TARGET) == value, "Loss source literals differ; audit source before regeneration"
        print("Loss independent source-literal reproducibility passed without writes.")
    else:
        write_fixture_text(TARGET, value)
        print(f"Wrote independent loss fixtures: {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
