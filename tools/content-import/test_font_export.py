"""Independent normal-font pixel, metric and malformed-input fixtures."""
import json
from pathlib import Path
import unittest

from PIL import Image

from font_export import (
    FontError, dialogue_palette, export_dialogue_font, make_atlas,
    parse_latin_charmap, parse_normal_widths, validate_font_text,
)
from import_content import ROOT, Source


class FontSemanticsTests(unittest.TestCase):
    def test_editor_box_index_is_background_and_space_is_blank(self):
        image = Image.new("P", (256, 512), 0)
        image.putpixel((0, 0), 1)  # source glyph zero must still be a space
        for index in range(4):
            image.putpixel((16 + index, 0), index)
        palette = ((0, 0, 0, 0), (98, 98, 98, 255), (213, 213, 205, 255), (0, 0, 0, 0))
        atlas = make_atlas(image, palette)
        self.assertEqual(atlas.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual([atlas.getpixel((16 + index, 0)) for index in range(4)], list(palette))
        image.putpixel((16, 0), 4)
        with self.assertRaisesRegex(FontError, "non-2bpp"):
            make_atlas(image, palette)
        with self.assertRaisesRegex(FontError, "indexed 256x512"):
            make_atlas(Image.new("RGBA", (256, 512)), palette)

    def test_palette_uses_game_colors_after_gba_quantization(self):
        palette = "JASC-PAL\n0100\n16\n" + "255 131 7\n" * 16
        self.assertEqual(dialogue_palette(palette), ((0, 0, 0, 0), (255, 131, 0, 255), (255, 131, 0, 255), (0, 0, 0, 0)))
        with self.assertRaisesRegex(FontError, "outside byte"):
            dialogue_palette(palette.replace("255", "256"))

    def test_charmap_does_not_leak_japanese_or_control_tokens(self):
        mapping = "' ' = 00\n'A' = BB\n'é' = 1B\n'\\'' = B4\n'$' = FF\nPKMN = 53 54\n@ Hiragana\n'あ' = 01\n"
        glyphs = parse_latin_charmap(mapping)
        self.assertEqual(glyphs, {" ": 0, "A": 0xBB, "é": 0x1B, "'": 0xB4})
        with self.assertRaisesRegex(FontError, "duplicate"):
            parse_latin_charmap(mapping.replace("@ Hiragana", "'A' = BC\n@ Hiragana"))
        with self.assertRaisesRegex(FontError, "boundary"):
            parse_latin_charmap(mapping.replace("@ Hiragana", ""))
        with self.assertRaisesRegex(FontError, "multi-character"):
            parse_latin_charmap(mapping.replace("'é'", "'ee'"))

    def test_width_count_range_and_expressions_fail_explicitly(self):
        widths = "static const u8 sFontNormalLatinGlyphWidths[] = {" + ",".join(["6"] * 512) + "};"
        self.assertEqual(parse_normal_widths(widths), (6,) * 512)
        for broken in (widths.replace("6", "0", 1), widths.replace("6", "17", 1), widths.replace("6,", "", 1)):
            with self.assertRaisesRegex(FontError, "count or range"):
                parse_normal_widths(broken)
        with self.assertRaisesRegex(FontError, "malformed"):
            parse_normal_widths(widths.replace("6", "3 + 3", 1))


class PinnedFontTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
        manifest = json.loads((ROOT / lock["fingerprint"]["manifest"]).read_text(encoding="utf-8-sig"))
        cls.source = Source(Path(lock["reference"]["localPath"]), {row["path"]: row for row in manifest["records"]})
        cls.emitted = {}
        cls.url = export_dialogue_font(cls.source, cls.emitted.__setitem__)
        cls.metadata = cls.emitted["client/fonts/dialogue.json"]
        cls.atlas = cls.emitted["client/fonts/dialogue.png"]

    def test_english_metrics_and_accented_glyph_are_source_exact(self):
        self.assertEqual(self.url, "/content/fonts/dialogue.json")
        self.assertEqual((self.metadata["lineHeight"], self.metadata["letterSpacing"]), (15, 0))
        self.assertEqual(self.metadata["glyphs"]["é"], {"code": 0x1B, "x": 176, "y": 16, "width": 6, "height": 14, "advance": 6})
        self.assertEqual(self.metadata["glyphs"]["'"], {"code": 0xB4, "x": 64, "y": 176, "width": 3, "height": 14, "advance": 3})
        expected = (
            "......", "......", "......", "..##s.", ".#ss..", "......", ".###s.",
            "#sss#s", "#####s", "#ssss.", "s####s", ".ssss.", "......", "......",
        )
        colors = {".": (0, 0, 0, 0), "#": (98, 98, 98, 255), "s": (213, 213, 205, 255)}
        self.assertEqual(list(self.atlas.crop((176, 16, 182, 30)).getdata()), [colors[pixel] for row in expected for pixel in row])
        # Comma's descender reaches y=13 and must not be clipped to a shorter font.
        self.assertEqual(self.atlas.getpixel((132, 189)), (0, 0, 0, 0))
        self.assertEqual(self.atlas.getpixel((130, 189)), (213, 213, 205, 255))

    def test_preview_pages_and_reasons_have_no_missing_glyphs(self):
        count = 0
        for path in (ROOT / "content/generated/client/maps").glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            for event in data["events"]["objects"] + data["events"]["signs"]:
                interaction = event["interaction"]
                for page in interaction["pages"]:
                    validate_font_text(self.metadata, page, path.name)
                if interaction["kind"] == "dialogue":
                    count += 1
                elif "reason" in interaction:
                    validate_font_text(self.metadata, interaction["reason"], path.name)
        self.assertEqual(count, 6)
        for unsupported in ("{COLOR RED}", "$", "あ", "missing_glyph", "\t"):
            with self.assertRaisesRegex(FontError, "unsupported font glyphs"):
                validate_font_text(self.metadata, unsupported)

    def test_every_exported_glyph_stays_inside_source_atlas(self):
        for glyph in self.metadata["glyphs"].values():
            self.assertLessEqual(glyph["x"] + glyph["width"], self.atlas.width)
            self.assertLessEqual(glyph["y"] + glyph["height"], self.atlas.height)
            self.assertEqual(glyph["advance"], glyph["width"])
        self.assertNotIn("$", self.metadata["glyphs"])
        self.assertIn("graphics/fonts/latin_normal.png", self.source.inputs)
        self.assertIn("graphics/text_window/stdpal_0.pal", self.source.inputs)


if __name__ == "__main__":
    unittest.main(verbosity=2)
