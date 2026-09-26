"""Independent byte fixtures and source regressions for bounded FireRed conversion."""
import json
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from import_content import (
    ContentError, ROOT, Source, build, check, component_image, decode_4bpp,
    decode_block, layer_components, pack_indexed_tiles, palette_from_jasc, words, validate_transfers,
    prune_previous_outputs, sha, decode_dialogue_text, export_interaction,
)


class BinarySemanticsTests(unittest.TestCase):
    def test_little_endian_u32_attributes_preserve_high_bits(self):
        # Hand fixture: bytes 69 3f 00 c3 -> attribute 0xc3003f69, NOT two u16s.
        attributes = words(bytes.fromhex("693f00c3"), 4, "fixture")[0]
        block = decode_block(0xAFAD, attributes)
        self.assertEqual(block, {
            "raw": 0xAFAD, "metatile": 0x3AD, "collision": 3, "elevation": 10,
            "attributes": 0xC3003F69, "behavior": 0x169,
            "terrain": 31, "encounter": 3, "layerType": 2,
        })

    def test_unknown_layer_and_truncated_binary_fail(self):
        with self.assertRaisesRegex(ContentError, "layer type 3"):
            decode_block(0, 0x60000000)
        with self.assertRaisesRegex(ContentError, "binary length"):
            words(b"\x01\x02\x03", 4, "broken.bin")
        with self.assertRaisesRegex(ContentError, "complete"):
            decode_4bpp(bytes(31))

    def test_nibble_order_is_low_pixel_then_high_pixel(self):
        tile = decode_4bpp(bytes.fromhex("1032547698badcfe") * 4)[0]
        self.assertEqual(tile, tuple(range(16)) * 4)

    def test_png_tile_scan_is_row_major_tiles_not_image_rows(self):
        image = Image.new("P", (16, 16))
        image.paste(1, (0, 0, 8, 8))
        image.paste(2, (8, 0, 16, 8))
        image.paste(3, (0, 8, 8, 16))
        image.paste(4, (8, 8, 16, 16))
        self.assertEqual(pack_indexed_tiles(image), b"\x11" * 32 + b"\x22" * 32 + b"\x33" * 32 + b"\x44" * 32)
        image.putpixel((0, 0), 16)
        with self.assertRaisesRegex(ContentError, "non-4bpp"):
            pack_indexed_tiles(image)

    def test_normal_covered_split_layer_placement_matches_field_camera(self):
        # Direct expected assignments from field_camera.c DrawMetatile.
        entries = tuple(range(10, 18))
        self.assertEqual(layer_components(entries, 0), ((0x3014,) * 4, (10, 11, 12, 13), (14, 15, 16, 17)))
        self.assertEqual(layer_components(entries, 1), ((10, 11, 12, 13), (14, 15, 16, 17), (0,) * 4))
        self.assertEqual(layer_components(entries, 2), ((10, 11, 12, 13), (0,) * 4, (14, 15, 16, 17)))

    def test_component_palette_transparency_and_both_flips(self):
        tile = [0] * 64
        tile[0], tile[7], tile[56], tile[63] = 1, 2, 3, 4
        palettes = [[(i, 0, 0, 0 if i == 0 else 255) for i in range(16)], [(0, i, 0, 0 if i == 0 else 255) for i in range(16)]]
        image = component_image(0x1C00, (tuple(tile),), palettes)
        self.assertEqual(image.getpixel((0, 0)), (0, 4, 0, 255))
        self.assertEqual(image.getpixel((7, 7)), (0, 1, 0, 255))
        self.assertEqual(image.getpixel((3, 3)), (0, 0, 0, 0))
        with self.assertRaisesRegex(ContentError, "outside loaded graphics"):
            component_image(1, (tuple(tile),), palettes)
        with self.assertRaisesRegex(ContentError, "outside loaded palettes"):
            component_image(0x2000, (tuple(tile),), palettes)

    def test_palette_matches_source_gbagfx_quantization(self):
        text = "JASC-PAL\n0100\n16\n" + "255 131 7\n" * 16
        palette = palette_from_jasc(text, "fixture.pal")
        self.assertEqual(palette[0], (255, 131, 0, 0))
        self.assertEqual(palette[1], (255, 131, 0, 255))

    def test_changed_pinned_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / "input.bin").write_bytes(b"changed")
            source = Source(path, {"input.bin": {"size": 7, "sha256": "0" * 64}})
            with self.assertRaisesRegex(ContentError, "differs from pinned snapshot"):
                source.read("input.bin")

    def test_only_obsolete_manifest_owned_files_are_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "client").mkdir()
            (output / "manifests").mkdir()
            (output / "client/obsolete.png").write_bytes(b"old")
            (output / "client/current.png").write_bytes(b"new")
            (output / "client/untracked.png").write_bytes(b"keep unrelated")
            previous = {"generator": "tools/content-import/import_content.py", "outputs": [
                {"path": "client/obsolete.png", "sha256": sha(b"old")},
                {"path": "client/current.png", "sha256": sha(b"prior")},
            ]}
            (output / "manifests/content-manifest.json").write_text(json.dumps(previous), encoding="utf-8")
            prune_previous_outputs(output, {"client/current.png": {}})
            self.assertFalse((output / "client/obsolete.png").exists())
            self.assertEqual((output / "client/current.png").read_bytes(), b"new")
            self.assertEqual((output / "client/untracked.png").read_bytes(), b"keep unrelated")

    def test_obsolete_modified_or_unsafe_paths_fail_without_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "client").mkdir()
            (output / "manifests").mkdir()
            (output / "client/obsolete.png").write_bytes(b"hand edit")
            path = output / "manifests/content-manifest.json"
            for row, expected in [
                ({"path": "client/obsolete.png", "sha256": sha(b"old")}, "was modified"),
                ({"path": "client/../../outside.png", "sha256": sha(b"outside")}, "unsafe output path"),
            ]:
                path.write_text(json.dumps({"generator": "tools/content-import/import_content.py", "outputs": [row]}), encoding="utf-8")
                with self.assertRaisesRegex(ContentError, expected):
                    prune_previous_outputs(output, {})
                self.assertEqual((output / "client/obsolete.png").read_bytes(), b"hand edit")

    def test_pure_message_extraction_never_truncates_stateful_scripts(self):
        texts = 'Greeting::\n    .string "Hello, {PLAYER}!\\p"\n    .string "Goodbye, {RIVAL}.$"\n'
        scripts = "Safe::\n\tmsgbox Greeting, MSGBOX_NPC\n\tend\nStateful::\n\tmsgbox Greeting, MSGBOX_NPC\n\tsetflag FLAG_REWARD\n\tend\n"
        self.assertEqual(export_interaction(scripts, texts, "Safe"), {"kind": "dialogue", "pages": ["Hello, RED!", "Goodbye, BLUE."]})
        self.assertEqual(export_interaction(scripts, texts, "Stateful")["kind"], "unavailable")
        self.assertEqual(export_interaction(scripts, texts, "Stateful")["pages"], [])
        with self.assertRaisesRegex(ContentError, "Unsupported text variable"):
            decode_dialogue_text('Broken::\n    .string "{STR_VAR_1}$"\n', "Broken")
        with self.assertRaisesRegex(ContentError, "Unsupported text escape"):
            decode_dialogue_text('Broken::\n    .string "Hello\\q$"\n', "Broken")


class PinnedSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
        cls.source = Path(cls.lock["reference"]["localPath"])

    def test_independently_inspected_pallet_binary_landmarks(self):
        # Source byte offsets inspected directly, corroborated by map.json warp
        # coordinates and metatile_labels.h: house door 0x2a3, lab door 0x2ac.
        raw = (self.source / "data/layouts/PalletTown/map.bin").read_bytes()
        self.assertEqual(len(raw), 960)  # layout is 24 by 20 u16 cells.
        for offset, expected in ((596, "9532"), (348, "a306"), (366, "a306"), (656, "ac06"), (546, "0204"), (932, "2c11")):
            self.assertEqual(raw[offset:offset + 2], bytes.fromhex(expected))
        attributes = (self.source / "data/tilesets/secondary/pallet_town/metatile_attributes.bin").read_bytes()
        self.assertEqual(attributes[140:144], bytes.fromhex("69000020"))
        self.assertEqual(attributes[176:180], bytes.fromhex("69000020"))
        self.assertEqual(decode_block(0x06A3, 0x20000069)["behavior"], 0x69)

    def test_export_has_source_landmarks_and_separate_occlusion(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = build(self.source, output, self.lock)
            data = json.loads((output / "client/maps/PalletTown.json").read_text())
            self.assertEqual(data["blocks"][7 * 24 + 6]["metatile"], 0x2A3)
            self.assertEqual(data["blocks"][13 * 24 + 16]["metatile"], 0x2AC)
            self.assertEqual(data["blocks"][19 * 24 + 10]["behaviorName"], "MB_OCEAN_WATER")
            self.assertEqual(data["player"]["animations"]["walk-east"], [
                {"frame": 7, "durationFrames": 8, "flipX": True},
                {"frame": 2, "durationFrames": 8, "flipX": True},
                {"frame": 8, "durationFrames": 8, "flipX": True},
                {"frame": 2, "durationFrames": 8, "flipX": True},
            ])
            self.assertGreater(data["animations"][0]["componentCount"], 0)
            for name in ("bottom", "middle", "top"):
                with Image.open(output / f"client/maps/PalletTown/{name}.png") as image:
                    self.assertEqual(image.size, (384, 320))
                    self.assertEqual(image.mode, "RGBA")
            self.assertEqual(manifest["sourceFingerprint"], self.lock["fingerprint"]["value"])
            self.assertNotIn("scriptLabels", data)
            self.assertNotIn("metadata", data)
            self.assertTrue(check(output, self.source, self.lock)["deterministicRebuild"])
            (output / "client/maps/PalletTown/top.png").write_bytes(b"corrupt")
            with self.assertRaisesRegex(ContentError, "Content hash mismatch"):
                check(output, self.source, self.lock)

    def test_independently_inspected_interior_and_route_landmarks(self):
        # Direct source byte fixtures cover different primary tilesets and the
        # distinction between the interior normal warp tile and south-arrow tile.
        house = (self.source / "data/layouts/PalletTown_PlayersHouse_1F/map.bin").read_bytes()
        self.assertEqual(len(house), 260)
        for offset, expected in ((218, "1430"), (216, "1330"), (72, "1d30"), (240, "1a04"), (192, "0130"), (38, "3504")):
            self.assertEqual(house[offset:offset + 2], bytes.fromhex(expected))
        building_attributes = (self.source / "data/tilesets/primary/building/metatile_attributes.bin").read_bytes()
        self.assertEqual(building_attributes[19 * 4:20 * 4], bytes.fromhex("65000020"))
        self.assertEqual(building_attributes[29 * 4:30 * 4], bytes.fromhex("6c000020"))
        route = (self.source / "data/layouts/Route1/map.bin").read_bytes()
        self.assertEqual(len(route), 1920)
        for offset, expected in ((1896, "0d30"), (1898, "0d30"), (1796, "0e30"), (246, "8704")):
            self.assertEqual(route[offset:offset + 2], bytes.fromhex(expected))
        general_attributes = (self.source / "data/tilesets/primary/general/metatile_attributes.bin").read_bytes()
        self.assertEqual(general_attributes[13 * 4:14 * 4], bytes.fromhex("02020001"))
        self.assertEqual(general_attributes[135 * 4:136 * 4], bytes.fromhex("3b000020"))

    def test_three_map_manifest_transfer_resolution_and_source_border_images(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = build(self.source, output, self.lock)
            world = json.loads((output / "client/world.json").read_text(encoding="utf-8"))
            self.assertEqual(world["schemaVersion"], 5)
            self.assertEqual(world["startMap"], "MAP_PALLET_TOWN")
            self.assertEqual(len(world["maps"]), 3)
            self.assertEqual(world["maps"][1]["displayName"], "Player's House \u00b7 1F")
            maps = {entry["name"]: json.loads((output / "client/maps" / f"{entry['name']}.json").read_text(encoding="utf-8")) for entry in world["maps"]}
            pallet, house, route = maps["PalletTown"], maps["PalletTown_PlayersHouse_1F"], maps["Route1"]
            self.assertEqual(pallet["events"]["warps"][0], {"x": 6, "y": 7, "elevation": 0, "warpId": 0, "destinationMap": house["id"], "destinationWarp": 1, "destinationAvailable": True, "destination": {"x": 4, "y": 8, "elevation": 3}})
            self.assertEqual(house["events"]["warps"][1]["destination"], {"x": 6, "y": 7, "elevation": 0})
            self.assertFalse(house["events"]["warps"][2]["destinationAvailable"])
            self.assertIsNone(house["events"]["warps"][2]["destination"])
            self.assertEqual(house["blocks"][8 * 13 + 4]["behaviorName"], "MB_SOUTH_ARROW_WARP")
            self.assertEqual(house["blocks"][8 * 13 + 5]["behaviorName"], "MB_NORMAL")
            self.assertEqual(house["animations"], [])
            self.assertEqual(route["blocks"][39 * 24 + 12]["encounter"], 1)
            self.assertEqual(route["blocks"][5 * 24 + 3]["behaviorName"], "MB_JUMP_SOUTH")
            self.assertEqual(route["connections"][1], {"map": pallet["id"], "direction": "down", "offset": 0, "destinationAvailable": True})
            self.assertFalse(route["connections"][0]["destinationAvailable"])
            for row in maps.values():
                for layer in ("bottom", "middle", "top"):
                    with Image.open(output / row["border"]["layers"][layer].replace("/content/", "client/")) as image:
                        self.assertEqual(image.size, (32, 32))
            for url in pallet["doors"][0]["frames"]:
                with Image.open(output / url.replace("/content/", "client/")) as image:
                    self.assertEqual(image.size, (16, 16))
                    self.assertEqual(image.getchannel("A").getextrema(), (255, 255))
            inventory = json.loads((output / "manifests/inventory.json").read_text())
            self.assertEqual(inventory["exportedMapCount"], 3)
            self.assertEqual(inventory["verifiedPlayableMapCount"], 0)
            self.assertIn("MAP_VIRIDIAN_CITY", inventory["unresolvedDestinations"])
            self.assertNotIn("MAP_ROUTE1", inventory["unresolvedDestinations"])
            self.assertEqual(manifest["scope"], [row["id"] for row in world["maps"]])

    def test_running_sprite_reuses_source_frame_table_and_palette_exactly(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            build(self.source, output, self.lock)
            data = json.loads((output / "client/maps/PalletTown.json").read_text(encoding="utf-8"))
            self.assertEqual(data["player"]["frameCount"], 18)
            self.assertEqual(data["player"]["animations"]["run-east"], [
                {"frame": 15, "durationFrames": 5, "flipX": True}, {"frame": 16, "durationFrames": 3, "flipX": True},
                {"frame": 15, "durationFrames": 5, "flipX": True}, {"frame": 17, "durationFrames": 3, "flipX": True},
            ])
            palette = palette_from_jasc((self.source / "graphics/object_events/palettes/player.pal").read_text(), "player.pal")
            with Image.open(output / "client/sprites/red-overworld.png") as sheet:
                self.assertEqual(sheet.size, (288, 32))
                with Image.open(self.source / "graphics/object_events/pics/people/red_normal.png") as normal:
                    self.assertEqual(list(sheet.crop((0, 0, 144, 32)).getdata()), [palette[index] for index in normal.getdata()])
                with Image.open(self.source / "graphics/object_events/pics/people/red_surf_run.png") as running:
                    expected = running.crop((3 * 16, 0, 12 * 16, 32))
                    self.assertEqual(list(sheet.crop((144, 0, 288, 32)).getdata()), [palette[index] for index in expected.getdata()])

    def test_npc_initial_state_exact_safe_dialogue_and_shared_frame_aliases(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            build(self.source, output, self.lock)
            maps = {name: json.loads((output / f"client/maps/{name}.json").read_text(encoding="utf-8")) for name in ("PalletTown", "PalletTown_PlayersHouse_1F", "Route1")}
            pallet, house, route = maps.values()
            self.assertEqual([row["allowRunning"] for row in maps.values()], [True, False, True])
            lady, resident, oak = pallet["events"]["objects"]
            self.assertEqual((lady["localId"], lady["x"], lady["y"], lady["direction"], lady["visible"]), (1, 5, 15, "north", True))
            self.assertEqual(lady["movementType"], "MOVEMENT_TYPE_FACE_UP")
            self.assertFalse(oak["visible"])
            self.assertFalse(oak["implemented"])
            self.assertNotIn(oak["graphicsId"], [graphic["graphicsId"] for graphic in pallet["actorGraphics"]])
            self.assertEqual(resident["interaction"], {"kind": "dialogue", "pages": ["Technology is incredible!", "You can now store and recall items\nand POK\u00e9MON as data via PC."]})
            self.assertEqual([sign["interaction"]["kind"] for sign in pallet["events"]["signs"]], ["unavailable", "dialogue", "dialogue", "dialogue", "unavailable"])
            self.assertEqual(pallet["events"]["signs"][1]["interaction"]["pages"], ["RED's house"])
            self.assertEqual(pallet["events"]["signs"][2]["interaction"]["pages"], ["BLUE's house"])
            self.assertEqual(house["events"]["objects"][0]["interaction"]["kind"], "unavailable")
            self.assertEqual([actor["direction"] for actor in route["events"]["objects"]], ["north", "west"])
            self.assertEqual(route["events"]["objects"][0]["interaction"]["kind"], "unavailable")
            self.assertEqual(len(route["events"]["objects"][1]["interaction"]["pages"]), 3)
            self.assertEqual(sum(actor["visible"] for row in maps.values() for actor in row["events"]["objects"]), 5)
            # Mom's source pic table aliases three physical pictures into nine
            # animation frame slots; splitting the PNG directly would be wrong.
            mom_palette = palette_from_jasc((self.source / "graphics/object_events/palettes/npc_blue.pal").read_text(), "npc_blue.pal")
            with Image.open(output / "client/sprites/npc-Mom.png") as mom:
                self.assertEqual(mom.size, (144, 32))
                with Image.open(self.source / "graphics/object_events/pics/people/mom.png") as original:
                    for index, source_frame in enumerate((0, 1, 2, 0, 0, 1, 1, 2, 2)):
                        self.assertEqual(list(mom.crop((index * 16, 0, (index + 1) * 16, 32)).getdata()), [mom_palette[p] for p in original.crop((source_frame * 16, 0, (source_frame + 1) * 16, 32)).getdata()])
            for row in maps.values():
                self.assertNotIn("FLAG_", json.dumps(row))
                self.assertNotIn("EventScript_", json.dumps(row))

    def test_malformed_selected_warps_and_connections_fail(self):
        layouts = json.loads((self.source / "data/layouts/layouts.json").read_text())["layouts"]
        maps = {}
        for name in ("PalletTown", "PalletTown_PlayersHouse_1F", "Route1"):
            metadata = json.loads((self.source / f"data/maps/{name}/map.json").read_text())
            maps[metadata["id"]] = {"metadata": metadata, "layout": next(row for row in layouts if row.get("id") == metadata["layout"])}
        validate_transfers(maps)
        broken = deepcopy(maps)
        broken["MAP_PALLET_TOWN"]["metadata"]["warp_events"][0]["dest_warp_id"] = "99"
        with self.assertRaisesRegex(ContentError, "missing destination warp"):
            validate_transfers(broken)
        broken = deepcopy(maps)
        broken["MAP_PALLET_TOWN"]["metadata"]["connections"][0]["offset"] = 100
        with self.assertRaisesRegex(ContentError, "does not overlap"):
            validate_transfers(broken)
        broken = deepcopy(maps)
        broken["MAP_ROUTE1"]["metadata"]["connections"][1]["offset"] = 1
        with self.assertRaisesRegex(ContentError, "inverse offset"):
            validate_transfers(broken)


if __name__ == "__main__":
    unittest.main(verbosity=2)
