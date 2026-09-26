"""Bounded definition export and a separate, whitelisted field-guide projection.

Definitions are not executable mechanics. Server bindings, encounter slots and
the type-effectiveness sentinel semantics stay outside public browser content.
"""
from __future__ import annotations

from c_source import CSource, designated, parse_table, string, values
from species_export import export_species
from moves_items_export import export_moves_items


def require(condition, message):
    if not condition:
        raise ValueError(message)


def export_encounters(source, env):
    data = source.json("src/data/wild_encounters.json")
    template = source.text("src/data/wild_encounters.json.txt")
    require('contains(encounter.base_label, "FireRed")' in template and '#ifdef FIRERED' in template,
            "Unsupported encounter build selection template")
    groups = [group for group in data["wild_encounter_groups"] if group["label"] == "gWildMonHeaders"]
    require(len(groups) == 1 and groups[0]["for_maps"] is True, "Missing or duplicate map encounter group")
    group = groups[0]
    fields = [field for field in group["fields"] if field["type"] == "land_mons"]
    require(len(fields) == 1, "Missing or duplicate land encounter slot weights")
    weights = fields[0]["encounter_rates"]
    require(len(weights) == 12 and all(type(weight) is int and 0 < weight <= 100 for weight in weights) and sum(weights) == 100,
            "Invalid land encounter weights")
    selected = [row for row in group["encounters"] if row["map"] == "MAP_ROUTE1" and row["base_label"] == "sRoute1_FireRed"]
    require(len(selected) == 1 and set(selected[0]) == {"map", "base_label", "land_mons"}, "Unsupported or duplicate Route 1 FireRed encounter record")
    land = selected[0]["land_mons"]
    require(set(land) == {"encounter_rate", "mons"} and len(land["mons"]) == len(weights), "Malformed Route 1 land table")
    require(type(land["encounter_rate"]) is int and 0 < land["encounter_rate"] <= 255, "Invalid source encounter rate")
    slots = []
    for index, (entry, weight) in enumerate(zip(land["mons"], weights)):
        require(set(entry) == {"species", "min_level", "max_level"} and type(entry["min_level"]) is int and type(entry["max_level"]) is int
                and 1 <= entry["min_level"] <= entry["max_level"] <= 100, "Invalid encounter slot/level range")
        slots.append({"slot": index, "weight": weight, "minLevel": entry["min_level"], "maxLevel": entry["max_level"], "species": env.reference(entry["species"])})
    return [{"mapId": "MAP_ROUTE1", "name": "Route 1", "method": "land", "sourceLabel": selected[0]["base_label"],
             "sourceRate": land["encounter_rate"], "slots": slots}]


def export_growth_and_types(source, env, required_growth):
    growth_text = env.load(source.text("src/data/pokemon/experience_tables.h"))
    tables = values(parse_table(growth_text, "gExperienceTables"))
    require(len(tables) == 8 and env.resolve("MAX_LEVEL") == 100, "Unsupported experience table dimensions")
    growth = []
    for symbol in sorted(required_growth, key=env.resolve):
        reference = env.reference(symbol)
        require(0 <= reference["id"] < 6, "Unsupported required growth rate")
        experience = [env.integer(value) for value in values(tables[reference["id"]])]
        require(len(experience) == 101 and experience[:2] == [0, 1] and all(0 <= value <= 0xFFFFFFFF for value in experience)
                and all(left <= right for left, right in zip(experience, experience[1:])), "Invalid source experience curve")
        growth.append({**reference, "name": symbol.removeprefix("GROWTH_").replace("_", " ").title(), "experience": experience})
    env.load_definitions(source.text("include/battle_main.h"), {"TYPE_MUL_NO_EFFECT", "TYPE_MUL_NOT_EFFECTIVE", "TYPE_MUL_NORMAL", "TYPE_MUL_SUPER_EFFECTIVE", "TYPE_FORESIGHT", "TYPE_ENDTABLE"})
    battle = source.text("src/battle_main.c")
    names = designated(parse_table(battle, "gTypeNames"))
    types = [{**env.reference(symbol), "name": string(text)} for symbol, text in names.items()]
    types.sort(key=lambda row: row["id"])
    require([row["id"] for row in types] == list(range(env.resolve("NUMBER_OF_MON_TYPES"))), "Missing source type name")
    flat = values(parse_table(battle, "gTypeEffectiveness"))
    require(len(flat) % 3 == 0, "Malformed source type table")
    chart, foresight, ended = [], False, False
    for index in range(0, len(flat), 3):
        attack, defense, multiplier = [env.integer(value) for value in flat[index:index + 3]]
        if attack == env.resolve("TYPE_FORESIGHT"):
            require(not foresight and defense == attack and multiplier == 0, "Invalid Foresight sentinel")
            foresight = True
        elif attack == env.resolve("TYPE_ENDTABLE"):
            require(foresight and defense == attack and multiplier == 0 and index + 3 == len(flat), "Invalid type table terminator")
            ended = True
        else:
            require(0 <= attack < len(types) and 0 <= defense < len(types) and multiplier in (0, 5, 10, 20), "Invalid type relationship")
            chart.append({"attack": env.reference(flat[index]), "defense": env.reference(flat[index + 1]), "multiplierTenths": multiplier, "ignoreWhenForesight": foresight})
    require(ended and len({(row["attack"]["id"], row["defense"]["id"]) for row in chart}) == len(chart), "Missing terminator or duplicate type relationship")
    return growth, types, chart


def validate_definitions(data):
    indexes = {}
    for key in ("species", "moves", "items", "abilities", "types", "growthRates"):
        indexes[key] = {row["id"]: row for row in data[key]}
        require(len(indexes[key]) == len(data[key]), f"Duplicate gameplay {key} id")
    def reference(ref, collection):
        require(ref["id"] in indexes[collection] and indexes[collection][ref["id"]]["symbol"] == ref["symbol"], f"Missing or inconsistent {collection} reference {ref}")
    for species in data["species"]:
        for ref in species["types"]:
            reference(ref, "types")
        reference(species["growthRate"], "growthRates")
        for ref in species["abilities"]:
            reference(ref, "abilities")
        for ref in species["heldItems"].values():
            reference(ref, "items")
        previous = 0
        for learn in species["levelUpLearnset"]:
            require(1 <= learn["level"] <= 100 and learn["level"] >= previous, "Invalid level-up ordering")
            previous = learn["level"]
            reference(learn["move"], "moves")
        for evolution in species["evolutions"]:
            reference(evolution["targetSpecies"], "species")
            require(evolution["method"]["symbol"] == "EVO_LEVEL" and 1 <= evolution["parameter"] <= 100, "Unsupported required evolution method")
    for move in data["moves"]:
        reference(move["type"], "types")
    for area in data["encounters"]:
        for slot in area["slots"]:
            reference(slot["species"], "species")


def public_projection(data):
    guide = {"schemaVersion": 1, "profile": "firered-private", "scope": "pallet-route1-reference"}
    guide["species"] = [{"id": row["id"], "name": row["name"], "types": list(dict.fromkeys(ref["id"] for ref in row["types"])),
                         "stats": row["stats"], "catchRate": row["catchRate"], "expYield": row["expYield"], "growthRate": row["growthRate"]["id"],
                         "abilities": list(dict.fromkeys(ref["id"] for ref in row["abilities"] if ref["id"] != 0)),
                         "levelUpLearnset": [{"level": learn["level"], "move": learn["move"]["id"]} for learn in row["levelUpLearnset"]],
                         "evolutions": [{"level": evolution["parameter"], "species": evolution["targetSpecies"]["id"]} for evolution in row["evolutions"]]} for row in data["species"]]
    guide["moves"] = [{**{key: row[key] for key in ("id", "name", "power", "accuracy", "pp")}, "type": row["type"]["id"]} for row in data["moves"] if row["id"] != 0]
    guide["items"] = [{**{key: row[key] for key in ("id", "name", "description", "price")}, "pocket": row["pocket"]["symbol"].removeprefix("POCKET_").replace("_", " ").title()} for row in data["items"] if row["id"] != 0]
    guide["abilities"] = [{key: row[key] for key in ("id", "name", "description")} for row in data["abilities"] if row["id"] != 0]
    guide["types"] = [{key: row[key] for key in ("id", "name")} for row in data["types"]]
    guide["growthRates"] = [{key: row[key] for key in ("id", "name", "experience")} for row in data["growthRates"]]
    guide["encounters"] = []
    for area in data["encounters"]:
        entries = {}
        for slot in area["slots"]:
            identity = slot["species"]["id"]
            if identity not in entries:
                entries[identity] = {"species": identity, "chance": 0, "minLevel": slot["minLevel"], "maxLevel": slot["maxLevel"]}
            entry = entries[identity]
            entry["chance"] += slot["weight"]
            entry["minLevel"] = min(entry["minLevel"], slot["minLevel"])
            entry["maxLevel"] = max(entry["maxLevel"], slot["maxLevel"])
        guide["encounters"].append({**{key: area[key] for key in ("mapId", "name", "method")}, "entries": list(entries.values())})
    return guide


def export_gameplay(source, put, fingerprint):
    species = export_species(source.text)
    dependencies = export_moves_items(source, set(species["requiredMoveSymbols"]), set(species["requiredItemSymbols"]) | {"ITEM_NONE", "ITEM_POKE_BALL", "ITEM_POTION"}, set(species["requiredAbilitySymbols"]) | {"ABILITY_NONE"})
    env = CSource(defines={"FIRERED": 1, "ENGLISH": 1, "REVISION": 0})
    env.load(source.text("include/constants/species.h"))
    env.load(source.text("include/constants/pokemon.h"))
    encounters = export_encounters(source, env)
    growth, types, chart = export_growth_and_types(source, env, {row["growthRate"]["symbol"] for row in species["species"]})
    limitations = [
        "Definitions only: encounters, battle effects, items, growth and evolutions are not executable gameplay.",
        "Scope is starter/Pidgey/Rattata evolution families, their complete level-up move definitions and held items, Poke Ball/Potion, and Route 1 FireRed land encounters.",
        "TM/HM, egg/tutor moves, trainer parties, shops, breeding, other areas/methods and full-game dependency closure remain outside this first data pass.",
        "Item/move function and effect identifiers are unimplemented source bindings; no R1 seed profile, accounts, party or inventory is created.",
    ]
    data = {"schemaVersion": 1, "profile": "firered-private", "scope": "pallet-route1-levelup", "status": "definitions-only", "sourceFingerprint": fingerprint,
            "species": species["species"], **{key: dependencies[key] for key in ("moves", "items", "abilities")}, "types": types, "growthRates": growth,
            "encounters": encounters, "typeEffectiveness": chart, "neutralTypeMultiplierTenths": env.resolve("TYPE_MUL_NORMAL"), "limitations": limitations}
    validate_definitions(data)
    put("server/gameplay.json", data)
    put("client/field-guide.json", public_projection(data))
    coverage = {"status": "definitions-only", "species": {"exported": len(data["species"])}, **dependencies["coverage"],
                "growthRates": len(growth), "typeRelationships": len(chart), "encounterTables": len(encounters), "limitations": limitations}
    if "coverage" in species:
        coverage["species"] = species["coverage"]
    return {"url": "/content/field-guide.json", "coverage": coverage}
