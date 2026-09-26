"""Bounded source move/item/ability records, without executable effect behavior.

The inventory readers accept the source tables' complete row shapes, then emit
only the requested dependency closure. Item records come from canonical JSON;
repeated ITEM_NONE padding is accounted for separately from real item IDs.
"""
from __future__ import annotations

import re

from c_source import CSource, Expr, designated, fields, parse_table, string, symbol, values


class MovesItemsError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise MovesItemsError(message)


CONSTANT_PATHS = (
    "include/constants/global.h", "include/constants/pokemon.h",
    "include/constants/moves.h", "include/constants/battle_move_effects.h",
    "include/constants/items.h", "include/constants/hold_effects.h",
    "include/constants/abilities.h", "include/constants/item_effects.h",
    "include/battle.h", "include/item.h",
)
MOVE_FIELDS = {
    "effect", "power", "type", "accuracy", "pp", "secondaryEffectChance",
    "target", "priority", "flags",
}
ITEM_FIELDS = {
    "english", "itemId", "price", "holdEffect", "holdEffectParam",
    "description_english", "importance", "registrability", "pocket", "type",
    "fieldUseFunc", "battleUsage", "battleUseFunc", "secondaryId",
}
FLAG_SYMBOLS = (
    "FLAG_MAKES_CONTACT", "FLAG_PROTECT_AFFECTED", "FLAG_MAGIC_COAT_AFFECTED",
    "FLAG_SNATCH_AFFECTED", "FLAG_MIRROR_MOVE_AFFECTED", "FLAG_KINGS_ROCK_AFFECTED",
)


def bounded_integer(env: CSource, value, minimum: int, maximum: int, location: str) -> int:
    require(not isinstance(value, bool), f"{location}: booleans are not source integers")
    require(isinstance(value, (int, str, Expr)), f"{location}: unsupported source integer value {value!r}")
    result = value if isinstance(value, int) else env.integer(value)
    require(minimum <= result <= maximum, f"{location}: value {result} outside {minimum}..{maximum}")
    return result


def source_reference(env: CSource, value, prefix: str, location: str) -> dict:
    name = value if isinstance(value, str) else symbol(value)
    require(isinstance(name, str) and re.fullmatch(re.escape(prefix) + r"[A-Z0-9_]+", name) is not None,
            f"{location}: expected {prefix} source symbol, found {name!r}")
    return env.reference(name)


def function_binding(value: object, location: str) -> str | None:
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z_]\w*", value) is not None,
            f"{location}: unsupported item function binding {value!r}")
    return None if value == "NULL" else value


def item_text(value: object, location: str) -> str:
    require(isinstance(value, str) and len(value) > 0, f"{location}: missing source text")
    result = value.replace("\\n", "\n")
    require("\\" not in result, f"{location}: unsupported source string escape")
    return result


def string_declaration(text: str, name: str) -> str:
    # Restrict this to the source's exact string declaration grammar. Passing
    # the expression through the shared parser preserves C string escapes.
    pattern = (r"(?:static\s+)?const\s+u8\s+" + re.escape(name)
               + r"\s*\[\s*\]\s*=\s*(_\s*\(\s*(?:\"(?:[^\"\\]|\\.)*\"\s*)+\))\s*;")
    matches = re.findall(pattern, text)
    require(len(matches) == 1, f"Ability description: missing or unsupported declaration {name}")
    initializer = parse_table("const u8 parsedDescription[] = {" + matches[0] + "};", "parsedDescription")
    return string(values(initializer)[0])


def read_moves(env: CSource, move_text: str, name_text: str) -> dict[str, dict]:
    definitions = designated(parse_table(move_text, "gBattleMoves"))
    names = designated(parse_table(name_text, "gMoveNames"))
    require(set(definitions) == set(names), "Move names/definitions do not have the same source IDs")
    require(len(definitions) == env.resolve("MOVES_COUNT"), "Move table does not cover MOVES_COUNT")
    records, ids = {}, set()
    flag_values = {name: env.resolve(name) for name in FLAG_SYMBOLS}
    require(len(set(flag_values.values())) == len(flag_values)
            and all(value > 0 and value & (value - 1) == 0 for value in flag_values.values()),
            "Move flags must be distinct nonzero bits")
    known_flags = sum(flag_values.values())
    for name, raw in definitions.items():
        ref = source_reference(env, name, "MOVE_", "Move row")
        require(ref["id"] not in ids, f"Move table duplicates numeric ID {ref['id']}")
        ids.add(ref["id"])
        row = fields(raw)
        require(set(row) == MOVE_FIELDS, f"{name}: unsupported/missing move fields {sorted(set(row) ^ MOVE_FIELDS)}")
        flags = bounded_integer(env, row["flags"], 0, 255, name + ".flags")
        require(flags & ~known_flags == 0, f"{name}: unknown source move flags {flags:#x}")
        records[name] = {
            **ref, "name": string(names[name]),
            "effect": source_reference(env, row["effect"], "EFFECT_", name),
            "type": source_reference(env, row["type"], "TYPE_", name),
            **{field: bounded_integer(env, row[field], 0, 255, name + "." + field)
               for field in ("power", "accuracy", "pp", "secondaryEffectChance")},
            "target": source_reference(env, row["target"], "MOVE_TARGET_", name),
            "priority": bounded_integer(env, row["priority"], -128, 127, name + ".priority"),
            "flags": {"value": flags, "symbols": [flag for flag in FLAG_SYMBOLS if flags & flag_values[flag]]},
        }
    require(ids == set(range(env.resolve("MOVES_COUNT"))), "Move table numeric IDs are not complete")
    return records


def read_items(env: CSource, document: object) -> tuple[dict[str, dict], dict]:
    require(isinstance(document, dict) and set(document) == {"items"}, "Items JSON: unsupported root fields")
    rows = document["items"]
    require(isinstance(rows, list) and rows, "Items JSON: missing ordered item slots")
    records, padding = {}, []
    for index, row in enumerate(rows):
        require(isinstance(row, dict) and ITEM_FIELDS <= set(row) <= ITEM_FIELDS | {"moveId"},
                f"Item slot {index}: unsupported or missing canonical JSON fields")
        name = row["itemId"]
        ref = source_reference(env, name, "ITEM_", f"Item slot {index}")
        if name == "ITEM_NONE" and index:
            require(row == rows[0], f"Item slot {index}: nonidentical ITEM_NONE padding")
            padding.append(index)
            continue
        require(ref["id"] == index and name not in records,
                f"Item slot {index}: duplicate or displaced source item ID {name}")
        if "moveId" in row:
            require(isinstance(row["moveId"], str) and re.fullmatch(r"[A-Z][A-Za-z0-9]*", row["moveId"]) is not None,
                    f"{name}: unsupported TM/HM move-description reference")
        records[name] = {
            **ref, "name": item_text(row["english"], name + ".name"),
            "description": item_text(row["description_english"], name + ".description"),
            "price": bounded_integer(env, row["price"], 0, 65535, name + ".price"),
            "holdEffect": source_reference(env, row["holdEffect"], "HOLD_EFFECT_", name),
            "pocket": source_reference(env, row["pocket"], "POCKET_", name),
            **{field: bounded_integer(env, row[field], 0, 255, name + "." + field)
               for field in ("holdEffectParam", "importance", "registrability", "type", "battleUsage", "secondaryId")},
            "fieldUseFunc": function_binding(row["fieldUseFunc"], name),
            "battleUseFunc": function_binding(row["battleUseFunc"], name),
            "itemEffect": None,
        }
    require(len(rows) == env.resolve("ITEMS_COUNT"), "Item slot count differs from ITEMS_COUNT")
    return records, {"available": len(records), "sourceSlots": len(rows), "unusedSlots": len(padding)}


def read_abilities(env: CSource, text: str) -> dict[str, dict]:
    names = designated(parse_table(text, "gAbilityNames"))
    descriptions = designated(parse_table(text, "gAbilityDescriptionPointers"))
    require(set(names) == set(descriptions) and len(names) == env.resolve("ABILITIES_COUNT"),
            "Ability name/description tables do not cover ABILITIES_COUNT")
    records, ids = {}, set()
    for name in names:
        ref = source_reference(env, name, "ABILITY_", "Ability row")
        require(ref["id"] not in ids, f"Ability table duplicates numeric ID {ref['id']}")
        ids.add(ref["id"])
        records[name] = {**ref, "name": string(names[name]),
                         "description": string_declaration(text, symbol(descriptions[name]))}
    require(ids == set(range(env.resolve("ABILITIES_COUNT"))), "Ability table numeric IDs are not complete")
    return records


def selected_records(records: dict[str, dict], requested: set[str], label: str) -> list[dict]:
    require(requested <= set(records), f"Missing required {label}: {sorted(requested - set(records))}")
    return sorted((records[name] for name in requested), key=lambda item: item["id"])


def read_item_effect(env: CSource, text: str, item_symbol: str) -> dict | None:
    table = parse_table(text, "gItemEffectTable")
    bindings, indices = {}, set()
    for designator, value in table.entries:
        require(designator is not None and designator[0] == "index", "Item effects: expected indexed binding")
        expression = designator[1]
        require(expression.kind == "binary" and expression.value == "-"
                and symbol(expression.args[1]) == "ITEM_POTION", "Item effects: unsupported source table offset")
        name = symbol(expression.args[0])
        if name == "LAST_BERRY_INDEX":
            require(symbol(value) == "NULL", "Item effects: unsupported last-berry boundary binding")
        else:
            source_reference(env, name, "ITEM_", "Item effects")
        index = env.integer(expression)
        require(index >= 0 and index not in indices and name not in bindings,
                f"Item effects: duplicate or negative source index for {name}")
        indices.add(index)
        bindings[name] = symbol(value)
    binding = bindings.get(item_symbol)
    if binding in (None, "NULL"):
        return None
    dimensions = re.findall(r"\b" + re.escape(binding) + r"\s*\[([^\]]+)\]\s*=", text)
    require(len(dimensions) == 1, f"{binding}: missing or unsupported explicit effect-byte array size")
    size = bounded_integer(env, dimensions[0], 6, 255, binding + ".length")
    result, assigned = [0] * size, set()
    for designator, value in parse_table(text, binding).entries:
        require(designator is not None and designator[0] == "index",
                f"{binding}: unsupported positional effect-byte initializer")
        index = bounded_integer(env, designator[1], 0, size - 1, binding + ".index")
        require(index not in assigned, f"{binding}: duplicate effect-byte index {index}")
        assigned.add(index)
        result[index] = bounded_integer(env, value, 0, 255, binding + f"[{index}]")
    return {"symbol": binding, "bytes": result}


def export_moves_items(source, move_symbols: set[str], item_symbols: set[str], ability_symbols: set[str]) -> dict:
    env = CSource(defines={"FIRERED": 1, "ENGLISH": 1, "REVISION": 0})
    for path in CONSTANT_PATHS:
        env.load(source.text(path))
    moves = read_moves(env, env.load(source.text("src/data/battle_moves.h")),
                       env.load(source.text("src/data/text/move_names.h")))
    item_document = source.json("src/data/items.json")
    items, item_coverage = read_items(env, item_document)
    required_tm_items = {row["itemId"] for row in item_document["items"] if "moveId" in row} & item_symbols
    require(not required_tm_items, f"TM/HM move-description bindings are not exported yet: {sorted(required_tm_items)}")
    abilities = read_abilities(env, env.load(source.text("src/data/text/abilities.h")))
    chosen_moves = selected_records(moves, move_symbols, "moves")
    chosen_items = selected_records(items, item_symbols, "items")
    chosen_abilities = selected_records(abilities, ability_symbols, "abilities")
    # Populated by the bounded designated-byte reader below. Effect bytes and
    # function references are data only; importing them implements no gameplay.
    effect_text = env.load(source.text("src/data/pokemon/item_effects.h"))
    for item in chosen_items:
        item["itemEffect"] = read_item_effect(env, effect_text, item["symbol"])
        require(item["battleUseFunc"] != "BattleUseFunc_Medicine" or item["itemEffect"] is not None,
                f"{item['symbol']}: missing required medicine effect bytes")
    return {"moves": chosen_moves, "items": chosen_items, "abilities": chosen_abilities,
            "coverage": {"moves": {"available": len(moves), "exported": len(chosen_moves)},
                         "items": {**item_coverage, "exported": len(chosen_items)},
                         "abilities": {"available": len(abilities), "exported": len(chosen_abilities)}}}
