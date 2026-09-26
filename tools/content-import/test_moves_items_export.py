"""Source-generation fixtures and strict failure paths for gameplay records."""
import copy
import json
from pathlib import Path
import re
import unittest

from c_source import CSource, CSourceError
from import_content import ROOT, Source
from moves_items_export import (
    CONSTANT_PATHS, MovesItemsError, export_moves_items, read_item_effect,
    read_items, read_moves, selected_records,
)


class PinnedMovesItemsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
        manifest = json.loads((ROOT / lock["fingerprint"]["manifest"]).read_text(encoding="utf-8-sig"))
        cls.source = Source(Path(lock["reference"]["localPath"]), {row["path"]: row for row in manifest["records"]})
        cls.env = CSource(defines={"FIRERED": 1, "ENGLISH": 1, "REVISION": 0})
        for path in CONSTANT_PATHS:
            cls.env.load(cls.source.text(path))
        cls.move_text = cls.env.load(cls.source.text("src/data/battle_moves.h"))
        cls.name_text = cls.env.load(cls.source.text("src/data/text/move_names.h"))
        cls.document = cls.source.json("src/data/items.json")
        cls.data = export_moves_items(cls.source,
                                     {"MOVE_TACKLE", "MOVE_QUICK_ATTACK", "MOVE_WHIRLWIND", "MOVE_BUBBLE"},
                                     {"ITEM_NONE", "ITEM_POKE_BALL", "ITEM_POTION", "ITEM_ORAN_BERRY", "ITEM_SITRUS_BERRY"},
                                     {"ABILITY_NONE", "ABILITY_KEEN_EYE", "ABILITY_GUTS", "ABILITY_OVERGROW"})

    def test_generation_three_move_values_priority_effects_and_flags(self):
        moves = {row["symbol"]: row for row in self.data["moves"]}
        tackle = moves["MOVE_TACKLE"]
        self.assertEqual((tackle["id"], tackle["power"], tackle["accuracy"], tackle["pp"]), (33, 35, 95, 35))
        self.assertEqual(tackle["type"], {"id": 0, "symbol": "TYPE_NORMAL"})
        self.assertEqual(tackle["effect"], {"id": 0, "symbol": "EFFECT_HIT"})
        self.assertEqual(tackle["flags"], {"value": 51, "symbols": ["FLAG_MAKES_CONTACT", "FLAG_PROTECT_AFFECTED",
                                                                  "FLAG_MIRROR_MOVE_AFFECTED", "FLAG_KINGS_ROCK_AFFECTED"]})
        self.assertEqual(moves["MOVE_QUICK_ATTACK"]["priority"], 1)
        self.assertEqual(moves["MOVE_WHIRLWIND"]["priority"], -6)
        bubble = moves["MOVE_BUBBLE"]
        self.assertEqual((bubble["power"], bubble["pp"], bubble["secondaryEffectChance"]), (20, 30, 10))
        self.assertEqual(bubble["target"], {"id": 8, "symbol": "MOVE_TARGET_BOTH"})

    def test_canonical_items_match_separate_generated_header_values(self):
        # The generated source header is a separate representation of the JSON
        # input. This fixture does not reuse the JSON reader or integer parser.
        text = self.source.text("src/data/items.h").split("const struct Item gItems[] =", 1)[1]
        rows = re.findall(r"\{\s*\.name\s*=\s*_(.*?)\n\s*\}", text, re.S)
        self.assertEqual(len(rows), 375)
        for item in self.data["items"]:
            row = rows[item["id"]]
            self.assertIn('.itemId = ' + item["symbol"] + ',', row)
            self.assertEqual(json.loads(re.match(r'\(("(?:[^"\\]|\\.)*")\),', row)[1]), item["name"])
            self.assertEqual(int(re.search(r"\.price = (\d+),", row)[1]), item["price"])
            self.assertEqual(int(re.search(r"\.holdEffectParam = (\d+),", row)[1]), item["holdEffectParam"])
        ball = next(item for item in self.data["items"] if item["id"] == 4)
        self.assertEqual((ball["name"], ball["price"], ball["pocket"]["id"]), ("POKé BALL", 200, 3))
        self.assertIn("wild\nPOKéMON", ball["description"])
        self.assertEqual(ball["battleUseFunc"], "BattleUseFunc_PokeBallEtc")
        self.assertIsNone(ball["itemEffect"])

    def test_medicine_effect_bytes_retain_zero_initializers_and_fixed_heal_amounts(self):
        items = {row["symbol"]: row for row in self.data["items"]}
        for name, amount, binding in (("POTION", 20, "Potion"), ("ORAN_BERRY", 10, "OranBerry"),
                                      ("SITRUS_BERRY", 30, "SitrusBerry")):
            item = items["ITEM_" + name]
            self.assertEqual(item["itemEffect"], {"symbol": "sItemEffect_" + binding,
                                                "bytes": [0, 0, 0, 0, 4, 0, amount]})
            self.assertEqual(item["holdEffectParam"], amount)
            self.assertEqual(item["battleUseFunc"], "BattleUseFunc_Medicine")
        self.assertEqual(items["ITEM_POTION"]["price"], 300)
        self.assertEqual(items["ITEM_ORAN_BERRY"]["holdEffect"], {"id": 1, "symbol": "HOLD_EFFECT_RESTORE_HP"})

    def test_ability_names_and_descriptions_keep_stable_source_ids(self):
        abilities = {row["symbol"]: row for row in self.data["abilities"]}
        self.assertEqual(abilities["ABILITY_OVERGROW"], {"id": 65, "symbol": "ABILITY_OVERGROW", "name": "OVERGROW",
                                                       "description": "Ups GRASS moves in a pinch."})
        self.assertEqual(abilities["ABILITY_KEEN_EYE"]["id"], 51)
        self.assertEqual(abilities["ABILITY_GUTS"]["description"], "Ups ATTACK if suffering.")
        self.assertEqual(abilities["ABILITY_NONE"]["id"], 0)

    def test_inventory_counts_padding_and_dependency_selection_are_explicit(self):
        self.assertEqual(self.data["coverage"], {
            "moves": {"available": 355, "exported": 4},
            "items": {"available": 308, "sourceSlots": 375, "unusedSlots": 67, "exported": 5},
            "abilities": {"available": 78, "exported": 4},
        })
        for kind in ("moves", "items", "abilities"):
            self.assertEqual([row["id"] for row in self.data[kind]], sorted({row["id"] for row in self.data[kind]}))
        with self.assertRaisesRegex(MovesItemsError, "Missing required moves"):
            selected_records({}, {"MOVE_UNKNOWN"}, "moves")

    def test_changed_json_shape_padding_slot_and_integer_types_fail(self):
        for mutate, error in (
            (lambda data: data["items"][13].update(unhandledProperty=1), "fields"),
            (lambda data: data["items"][52].update(price=1), "padding"),
            (lambda data: data["items"][13].update(itemId="ITEM_POKE_BALL"), "displaced"),
            (lambda data: data["items"][13].update(price=True), "booleans"),
        ):
            with self.subTest(error=error):
                document = copy.deepcopy(self.document)
                mutate(document)
                with self.assertRaisesRegex(MovesItemsError, error):
                    read_items(self.env, document)

    def test_unknown_move_fields_or_required_constants_fail(self):
        with self.assertRaisesRegex(MovesItemsError, "move fields"):
            read_moves(self.env, self.move_text.replace(".power = 0,", ".power = 0, .newField = 1,", 1), self.name_text)
        with self.assertRaisesRegex(CSourceError, "Unresolved source constant"):
            read_moves(self.env, self.move_text.replace(".power = 0,", ".power = MISSING_REQUIRED_VALUE,", 1), self.name_text)

    def test_effect_array_bounds_duplicates_and_unknown_bytes_fail(self):
        text = """static const u8 testEffect[7] = {[4] = ITEM4_HEAL_HP, [6] = 20};
        const u8 *const gItemEffectTable[] = {[ITEM_POTION - ITEM_POTION] = testEffect};"""
        self.assertEqual(read_item_effect(self.env, text, "ITEM_POTION")["bytes"], [0, 0, 0, 0, 4, 0, 20])
        for bad, error in ((text.replace("[6]", "[7]"), "outside"),
                           (text.replace("[6]", "[4]"), "duplicate"),
                           (text.replace("= 20", "= 256"), "outside")):
            with self.assertRaisesRegex(MovesItemsError, error):
                read_item_effect(self.env, bad, "ITEM_POTION")


if __name__ == "__main__":
    unittest.main(verbosity=2)
