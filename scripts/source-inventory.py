"""Discover source records and initial scope policy; never equate discovery to playability."""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8"))
SOURCE = Path(LOCK["reference"]["localPath"])
MANIFEST = json.loads((ROOT / LOCK["fingerprint"]["manifest"]).read_text(encoding="utf-8"))
PINNED = {r["path"]: r["sha256"] for r in MANIFEST["records"]}
INPUTS: dict[str, str] = {}


def read(path: str) -> str:
    data = (SOURCE / path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if PINNED.get(path) != digest:
        raise ValueError(f"Inventory input differs from source pin: {path}")
    INPUTS[path] = digest
    return data.decode("utf-8-sig")


def discover() -> dict:
    groups = json.loads(read("data/maps/map_groups.json"))
    membership = {name: group for group in groups["group_order"] for name in groups[group]}
    maps = []
    for path in sorted((SOURCE / "data/maps").glob("*/map.json")):
        rel = path.relative_to(SOURCE).as_posix()
        data = json.loads(read(rel))
        name = path.parent.name
        group = membership.get(name)
        if name.startswith(("BirthIsland", "NavelRock")):
            scope = "event-gated"
        elif group == "gMapGroup_Link":
            scope = "deferred-original-link-facility"
        elif "Unused" in name or "Debug" in name:
            scope = "source-named-unused-needs-review"
        elif group is None:
            scope = "unreferenced-map-needs-review"
        else:
            scope = "normal-firered-candidate"
        maps.append({"id": data["id"], "name": name, "source": rel, "group": group, "layout": data["layout"], "scope": scope, "state": "discovered", "playable": False, "verification": None, "note": "Scope candidate does not prove script/warp reachability; required dependency closure is pending"})
    layouts = json.loads(read("data/layouts/layouts.json"))["layouts"]
    used_layouts = {m["layout"] for m in maps}
    layout_inventory = [{"id": item.get("id"), "tableIndex": index, "source": "data/layouts/layouts.json", "referencedByMapJson": item.get("id") in used_layouts, "scope": "empty-source-slot" if not item else "map-referenced" if item["id"] in used_layouts else "unreferenced-layout-needs-review", "state": "discovered"} for index, item in enumerate(layouts)]
    variants = [{"game": game, "revision": rev, "language": "ENGLISH", "selected": game == "FIRERED" and rev == 0} for game in ("FIRERED", "LEAFGREEN") for rev in (0, 1, 10)]
    read("config.mk")
    read("Makefile")
    read("README.md")
    commands = []
    for path in ("data/script_cmd_table.inc", "data/specials.inc"):
        for lineno, line in enumerate(read(path).splitlines(), 1):
            match = re.search(r"^\s*(?:\.4byte|def_special)\s+([A-Za-z_][A-Za-z_0-9]*)", line)
            if match:
                commands.append({"name": match.group(1), "source": path, "line": lineno, "state": "discovered", "implemented": False})
    feature_specs = [
        ("story-main", "normal-required", "Kanto campaign through Champion, alternate starter/rival branches", ["data/maps/PalletTown/scripts.inc", "data/maps/PokemonLeague_ChampionsRoom/scripts.inc"]),
        ("story-sevii", "normal-required", "Normal Sevii progression, postgame and return visits", ["data/maps/OneIsland_PokemonCenter_1F/scripts.inc", "data/maps/TwoIsland_JoyfulGameCorner/scripts.inc"]),
        ("link-trade", "online-replacement-required", "TradeCenter/Cable Club trading replaced by authenticated direct online trade", ["data/maps/TradeCenter/map.json", "src/trade.c"]),
        ("link-battle", "online-replacement-required", "BattleColosseum 2P/4P original transport/presentation deferred; initial online direct PvP required", ["data/maps/BattleColosseum_2P/map.json", "data/maps/BattleColosseum_4P/map.json", "src/cable_club.c"]),
        ("union-room", "deferred", "Original Union Room, wireless lobby/avatar/chat presentation", ["data/maps/UnionRoom/map.json", "src/union_room.c", "src/union_room_chat.c"]),
        ("record-corner", "deferred", "Original Record Corner/link record presentation; reachability not established", ["data/maps/RecordCorner/map.json", "data/maps/RecordCorner/scripts.inc", "data/scripts/cable_club.inc"]),
        ("pokemon-jump", "deferred", "Wireless Pokemon Jump minigame", ["src/pokemon_jump.c", "data/scripts/cable_club.inc"]),
        ("dodrio-berry-picking", "deferred", "Wireless Dodrio Berry Picking minigame", ["src/dodrio_berry_picking.c", "data/scripts/cable_club.inc"]),
        ("berry-crush", "deferred", "Wireless Berry Crush minigame; ordinary berry/item mechanics remain required", ["src/berry_crush.c", "data/scripts/cable_club.inc"]),
        ("mystery-gift", "deferred", "Mystery Gift/Wonder Card/news and Mystery Event distribution infrastructure", ["src/mystery_gift.c", "src/mystery_gift_link.c", "src/mystery_event_script.c"]),
        ("external-connectivity", "deferred", "GBA cable/RFU/external-game transport", ["src/link.c", "src/link_rfu_2.c", "src/AgbRfu_LinkManager.c"]),
        ("birth-island", "event-gated", "Aurora Ticket AND ship-enable flag required; Deoxys content inventoried without enabling event", ["data/maps/VermilionCity/scripts.inc", "data/maps/BirthIsland_Exterior/scripts.inc", "include/constants/flags.h"]),
        ("navel-rock", "event-gated", "Mystic Ticket AND ship-enable flag required; Lugia/Ho-Oh content inventoried without enabling event", ["data/maps/VermilionCity/scripts.inc", "data/maps/NavelRock_Base/scripts.inc", "data/maps/NavelRock_Summit/scripts.inc"]),
        ("altering-cave", "normal-required-with-event-gates", "Default encounter set retained; alternate sets inventoried, no automatic event activation", ["src/wild_encounter.c", "src/data/wild_encounters.json"]),
        ("trainer-tower", "normal-required", "Source-defined Trainer Tower formats and progression", ["data/maps/TrainerTower_Lobby/scripts.inc", "src/trainer_tower.c"]),
        ("safari", "normal-required", "Safari Zone admission, encounters, capture and expiry", ["src/safari_zone.c"]),
        ("game-corner", "normal-required", "Celadon Game Corner, prizes and slot-machine mechanics", ["src/slot_machine.c", "data/maps/CeladonCity_GameCorner/scripts.inc"]),
        ("day-care", "normal-required", "Day Care and source-defined breeding", ["src/daycare.c"]),
    ]
    features = []
    for feature_id, scope, note, evidence in feature_specs:
        for item in evidence:
            read(item)
        features.append({"id": feature_id, "scope": scope, "note": note, "source": evidence, "state": "discovered", "implemented": False, "verification": None})
    paths = [
        "src/data/pokemon/species_info.h", "src/data/battle_moves.h", "src/data/pokemon/level_up_learnsets.h",
        "src/data/pokemon/tmhm_learnsets.h", "src/data/pokemon/egg_moves.h", "src/data/pokemon/evolution.h",
        "src/data/pokemon/experience_tables.h", "src/data/items.json", "src/data/wild_encounters.json",
        "src/data/trainers.h", "src/data/trainer_parties.h", "src/battle_main.c", "src/battle_util.c",
        "data/battle_scripts_1.s", "include/global.fieldmap.h", "src/fieldmap.c",
    ]
    discovered_paths = []
    for path in paths:
        if (SOURCE / path).is_file():
            read(path)
            discovered_paths.append({"path": path, "state": "discovered", "parserImplemented": False})
        else:
            discovered_paths.append({"path": path, "state": "not-at-proposed-path", "parserImplemented": False})
    branch_files = []
    for r in MANIFEST["records"]:
        path = r["path"]
        if path.startswith(("src/", "data/", "include/")) and Path(path).suffix in {".c", ".h", ".inc", ".s"}:
            content = read(path)
            branches = sorted(set(re.findall(r"^\s*#\s*(?:if|ifdef|ifndef|elif)[^\n]*(?:FIRERED|LEAFGREEN|REVISION)[^\n]*", content, re.MULTILINE)))
            if branches:
                branch_files.append({"path": path, "conditions": branches, "state": "discovered-unresolved-build-conditions"})
    return {
        "schemaVersion": 1, "sourceFingerprint": LOCK["fingerprint"]["value"], "upstreamCommit": None,
        "selectedBuild": LOCK["selectedBuild"], "buildVariants": variants,
        "buildVariantEvidence": ["config.mk", "Makefile:225-242", "README.md"],
        "modernCompiler": "Build toolchain option, not a different selected content profile",
        "summary": {"mapRecords": len(maps), "layoutSlots": len(layouts), "mapScopeCounts": dict(sorted(Counter(m["scope"] for m in maps).items())), "unreferencedNamedLayouts": sum(x["scope"] == "unreferenced-layout-needs-review" for x in layout_inventory), "emptyLayoutSlots": sum(x["scope"] == "empty-source-slot" for x in layout_inventory), "scriptCommandAndSpecialRecords": len(commands), "buildConditionalFiles": len(branch_files)},
        "limitations": ["Structural inventory only; no global reachability or complete required mechanics/script dependency analysis yet", "Normal candidates may contain unused/debug/other-version subrecords; future parser must resolve build conditions and reachability before claiming coverage", "Unreferenced does not prove unused; entries require explicit review", "All records are discovered only; current importer evidence is tracked separately", "No upstream SHA or source cleanliness can be inferred from this supplied non-Git directory"],
        "maps": maps, "layouts": layout_inventory, "features": features,
        "scriptCommandsAndSpecials": commands, "gameplaySourcePaths": discovered_paths,
        "conditionalSourceFiles": branch_files,
        "inputs": [{"path": p, "sha256": INPUTS[p]} for p in sorted(INPUTS)],
    }


if __name__ == "__main__":
    report = discover()
    (ROOT / "reports/source-scope.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"]))
