"""Pinned English normal-font atlas for the bounded dialogue preview.

The canonical indexed PNG is the input to gbagfx's full-width Latin packing.
Its 16x16 cells already have the same layout that DecompressGlyph_Normal
reassembles from four tiles. The game's width table and 14-pixel height clip
each cell; the PNG's editor palette is not the in-game dialogue palette.
"""
from __future__ import annotations

import re

from PIL import Image


class FontError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise FontError(message)


def parse_latin_charmap(text: str) -> dict[str, int]:
    require(text.count("@ Hiragana") == 1, "Font charmap: missing Latin/Japanese boundary")
    glyphs = {}
    for line in text.split("@ Hiragana", 1)[0].splitlines():
        if not line.startswith("'"):
            continue
        match = re.fullmatch(r"'((?:\\'|[^'])+)'\s*=\s*([0-9A-F]{2})\s*", line)
        require(match is not None, f"Font charmap: unsupported quoted mapping {line!r}")
        char = match[1].replace("\\'", "'")
        code = int(match[2], 16)
        require(len(char) == 1 and char not in glyphs, f"Font charmap: duplicate or multi-character mapping {char!r}")
        # $ is the source terminator, not a drawable dollar sign. Extended
        # controls, placeholders, Japanese and named multi-glyph tokens are
        # deliberately outside this atlas's Unicode mapping.
        if code < 0xF7:
            glyphs[char] = code
        else:
            require(char == "$" and code == 0xFF, f"Font charmap: unsupported control mapping {char!r}")
    require(glyphs.get(" ") == 0 and glyphs.get("A") == 0xBB and glyphs.get("é") == 0x1B,
            "Font charmap: incompatible English glyph codes")
    return glyphs


def parse_normal_widths(text: str) -> tuple[int, ...]:
    match = re.search(r"static const u8 sFontNormalLatinGlyphWidths\[\]\s*=\s*\{([^}]+)\};", text)
    require(match is not None, "Font: missing normal Latin width table")
    values = match[1].split(",")
    require(all(re.fullmatch(r"\s*\d+\s*", value) for value in values), "Font: malformed Latin width table")
    widths = tuple(int(value) for value in values)
    require(len(widths) == 512 and all(1 <= width <= 16 for width in widths), "Font: invalid Latin width count or range")
    return widths


def dialogue_palette(text: str) -> tuple[tuple[int, int, int, int], ...]:
    lines = text.splitlines()
    require(lines[:3] == ["JASC-PAL", "0100", "16"] and len(lines) == 19, "Font: invalid dialogue palette")
    colors = []
    for line in lines[3:]:
        require(re.fullmatch(r"\d+ \d+ \d+", line) is not None, "Font: malformed dialogue palette color")
        channels = tuple(int(value) for value in line.split())
        require(all(0 <= value <= 255 for value in channels), "Font: dialogue palette channel outside byte range")
        colors.append(tuple((value // 8) * 255 // 31 for value in channels) + (255,))
    # text_printer.c sFontHalfRowOffsets maps source index 3 to background,
    # just like index 0. Transparent background permits drawing on the UI's
    # white message surface without opaque glyph-sized rectangles.
    return ((0, 0, 0, 0), colors[2], colors[3], (0, 0, 0, 0))


def make_atlas(image: Image.Image, palette: tuple) -> Image.Image:
    require(image.mode == "P" and image.size == (256, 512), "Font: expected indexed 256x512 Latin PNG")
    pixels = list(image.getdata())
    require(all(isinstance(value, int) and 0 <= value <= 3 for value in pixels), "Font: PNG contains non-2bpp indices")
    atlas = Image.new("RGBA", image.size)
    atlas.putdata([palette[value] for value in pixels])
    # The game explicitly renders glyph 0 as a blank background span.
    atlas.paste((0, 0, 0, 0), (0, 0, 16, 16))
    return atlas


def validate_font_text(metadata: dict, text: str, location: str = "dialogue") -> None:
    missing = sorted(set(text) - set(metadata["glyphs"]) - {"\n"})
    require(not missing, f"{location}: unsupported font glyphs {missing!r}")


def export_dialogue_font(source, put) -> str:
    text = source.text("src/text.c")
    printer = source.text("src/text_printer.c")
    helpers = source.text("src/new_menu_helpers.c")
    characters = source.text("include/characters.h")
    converter = source.text("tools/gbagfx/font.c")
    window = source.text("src/text_window.c")
    window_graphics = source.text("src/text_window_graphics.c")
    for fragment in (
        'sFontNormalLatinGlyphs[] = INCBIN_U16("graphics/fonts/latin_normal.fwlatfont")',
        "glyphs = sFontNormalLatinGlyphs + (0x20 * glyphId);",
        "gGlyphInfo.width = sFontNormalLatinGlyphWidths[glyphId];",
        "gGlyphInfo.height = 14;",
        "else\n                textPrinter->printerTemplate.currentX += gGlyphInfo.width;",
    ):
        require(fragment in text, f"Font: unsupported source normal-font contract {fragment!r}")
    require("const u32 colors[] = {bgColor, fgColor, shadowColor};" in printer,
            "Font: unsupported glyph color lookup")
    offsets_match = re.search(r"sFontHalfRowOffsets\[\]\s*=\s*\{([^}]+)\};", printer)
    require(offsets_match is not None, "Font: missing half-row lookup")
    offsets = [int(value.strip(), 16) for value in offsets_match[1].split(",")]
    expected_offsets = [sum(((packed >> (6 - 2 * x)) & 3) % 3 * 3 ** (3 - x) for x in range(4)) for packed in range(256)]
    require(offsets == expected_offsets, "Font: unsupported 2bpp-to-ternary half-row lookup")
    normal = re.search(r"\[FONT_NORMAL\]\s*=\s*\{([^}]+)\}", helpers)
    require(normal is not None and ".maxLetterHeight = 14," in normal[1], "Font: unsupported normal height")
    parameterized = re.search(r"u16 AddTextPrinterParameterized2\([^}]+\}", helpers)
    require(parameterized is not None and "printer.lineSpacing = 1;" in parameterized[0], "Font: unsupported field message line spacing")
    require("FONT_NORMAL, gStringVar4" in helpers and "TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY" in helpers,
            "Font: unsupported neutral dialogue colors")
    for name, value in (("WHITE", 1), ("DARK_GRAY", 2), ("LIGHT_GRAY", 3)):
        match = re.search(r"#define\s+TEXT_COLOR_" + name + r"\s+0x([0-9A-Fa-f]+)\b", characters)
        require(match is not None and int(match[1], 16) == value, f"Font: unsupported {name} palette index")
    require("for (unsigned int column = 0; column < 16; column++)" in converter
            and "((glyphTile & 1) * 8)" in converter and "((glyphTile >> 1) * 8)" in converter,
            "Font: unsupported full-width Latin tile packing")
    require("LoadPalette(GetTextWindowPalette(0), palOffset, PLTT_SIZE_4BPP);" in window
            and 'INCBIN_U16("graphics/text_window/stdpal_0.gbapal")' in window_graphics,
            "Font: unsupported message palette provenance")

    widths = parse_normal_widths(text)
    charmap = parse_latin_charmap(source.text("charmap.txt"))
    palette = dialogue_palette(source.text("graphics/text_window/stdpal_0.pal"))
    atlas = make_atlas(source.image("graphics/fonts/latin_normal.png"), palette)
    metadata = {
        "schemaVersion": 1, "id": "firered-latin-normal", "image": "/content/fonts/dialogue.png",
        "atlasWidth": atlas.width, "atlasHeight": atlas.height, "lineHeight": 15, "letterSpacing": 0,
        "glyphs": {char: {"code": code, "x": code % 16 * 16, "y": code // 16 * 16,
                           "width": widths[code], "height": 14, "advance": widths[code]}
                   for char, code in sorted(charmap.items())},
        "source": {"font": "FONT_NORMAL", "graphics": "graphics/fonts/latin_normal.png",
                   "widths": "src/text.c:sFontNormalLatinGlyphWidths", "charmap": "charmap.txt",
                   "palette": "graphics/text_window/stdpal_0.pal"},
        "limitations": [
            "This preview uses the source neutral normal Latin font and neutral message colors for every speaker; gender-specific fonts/colors are not selected.",
            "Only mapped printable English/Latin glyphs and explicit line breaks are supported. Japanese, named symbol tokens and runtime text control codes are not rendered.",
            "Glyph pixels and advances are source-derived; instant display, message frame and pagination remain preview presentation.",
        ],
    }
    put("client/fonts/dialogue.png", atlas)
    put("client/fonts/dialogue.json", metadata)
    return "/content/fonts/dialogue.json"
