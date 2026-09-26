"""Bounded, deterministic FireRed three-area exporter; no ROM/emulator required.

Only the explicitly supported source constructs below are accepted. The original
reference remains read-only. PNG indices and JASC palettes are canonical source
inputs, so generated .4bpp/.gbapal files in a local checkout are not trusted.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import tempfile

from PIL import Image, __version__ as pillow_version
from font_export import export_dialogue_font, validate_font_text
from audio_export import export_audio
from gameplay_export import export_gameplay

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 5
LAYER_NAMES = ("bottom", "middle", "top")
MAP_SPECS = (
    ("PalletTown", "Pallet Town", (10, 12, 3)),
    ("PalletTown_PlayersHouse_1F", "Player's House \u00b7 1F", (5, 7, 3)),
    ("Route1", "Route 1", (10, 37, 3)),
)
TILESETS = {
    "gTileset_General": ("data/tilesets/primary/general", "InitTilesetAnim_General"),
    "gTileset_PalletTown": ("data/tilesets/secondary/pallet_town", "NULL"),
    "gTileset_Building": ("data/tilesets/primary/building", "NULL"),
    "gTileset_GenericBuilding1": ("data/tilesets/secondary/generic_building_1", "NULL"),
}
SOURCE_EVIDENCE = (
    "include/global.fieldmap.h", "include/fieldmap.h", "src/fieldmap.c",
    "src/field_camera.c", "src/event_object_movement.c", "src/tileset_anims.c",
    "src/data/tilesets/headers.h", "src/data/tilesets/metatiles.h",
    "src/data/object_events/object_event_anims.h",
    "src/data/object_events/object_event_graphics_info.h",
    "src/data/object_events/object_event_pic_tables.h",
    "src/data/object_events/object_event_graphics.h", "tools/gbagfx/gfx.c",
    "include/constants/metatile_behaviors.h", "src/field_door.c", "include/constants/metatile_labels.h",
    "src/data/object_events/object_event_graphics_info_pointers.h", "src/new_game.c", "src/event_data.c",
    "data/event_scripts.s", "tools/mapjson/mapjson.cpp",
)


class ContentError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContentError(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def words(data: bytes, size: int, location: str) -> tuple[int, ...]:
    require(size in (2, 4) and len(data) % size == 0, f"{location}: invalid u{size * 8} binary length {len(data)}")
    return struct.unpack("<" + ("H" if size == 2 else "I") * (len(data) // size), data)


def decode_block(raw: int, attributes: int) -> dict:
    require(0 <= raw <= 0xFFFF and 0 <= attributes <= 0xFFFFFFFF, "block/attribute outside unsigned source width")
    layer = (attributes >> 29) & 3
    require(layer <= 2, f"Unsupported required metatile layer type {layer}")
    return {
        "raw": raw, "metatile": raw & 0x3FF,
        "collision": (raw & 0xC00) >> 10, "elevation": raw >> 12,
        "attributes": attributes, "behavior": attributes & 0x1FF,
        "terrain": (attributes >> 9) & 0x1F,
        "encounter": (attributes >> 24) & 7, "layerType": layer,
    }


def decode_4bpp(data: bytes) -> tuple[tuple[int, ...], ...]:
    require(len(data) % 32 == 0, "4bpp data must contain complete 8x8 tiles")
    return tuple(tuple(v for byte in data[i:i + 32] for v in (byte & 15, byte >> 4)) for i in range(0, len(data), 32))


def pack_indexed_tiles(image: Image.Image) -> bytes:
    require(image.mode == "P", f"Expected indexed PNG, found {image.mode}")
    require(image.width % 8 == 0 and image.height % 8 == 0, "PNG dimensions must be multiples of 8")
    result = bytearray()
    for tile_y in range(0, image.height, 8):
        for tile_x in range(0, image.width, 8):
            for y in range(8):
                for x in range(0, 8, 2):
                    a, b = image.getpixel((tile_x + x, tile_y + y)), image.getpixel((tile_x + x + 1, tile_y + y))
                    require(isinstance(a, int) and isinstance(b, int) and 0 <= a < 16 and 0 <= b < 16, "PNG contains non-4bpp indices")
                    result.append(a | b << 4)
    return bytes(result)


def palette_from_jasc(text: str, location: str) -> list[tuple[int, int, int, int]]:
    lines = text.splitlines()
    require(lines[:3] == ["JASC-PAL", "0100", "16"] and len(lines) == 19, f"{location}: unsupported palette format")
    result = []
    for index, line in enumerate(lines[3:]):
        channels = [int(value) for value in line.split()]
        require(len(channels) == 3 and all(0 <= c <= 255 for c in channels), f"{location}: invalid palette color")
        # Match gbagfx's 8->5->8 conversion; index 0 is transparent in every BG/OBJ palette.
        result.append(tuple((c // 8) * 255 // 31 for c in channels) + (0 if index == 0 else 255,))
    return result


def component_image(entry: int, tiles: tuple, palettes: list) -> Image.Image:
    tile_id, palette_id = entry & 0x3FF, entry >> 12
    require(tile_id < len(tiles), f"Component tile {tile_id} outside loaded graphics ({len(tiles)})")
    require(palette_id < len(palettes), f"Component palette {palette_id} outside loaded palettes")
    image = Image.new("RGBA", (8, 8))
    image.putdata([palettes[palette_id][v] for v in tiles[tile_id]])
    if entry & 0x400:
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if entry & 0x800:
        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return image


def layer_components(entries: tuple, layer: int) -> tuple:
    require(len(entries) == 8, "A FireRed metatile must have eight component entries")
    # Source field_camera.c DrawMetatile: normal deliberately fills BG3 with 0x3014.
    if layer == 0:
        return ((0x3014,) * 4, entries[:4], entries[4:])
    if layer == 1:
        return (entries[:4], entries[4:], (0,) * 4)
    if layer == 2:
        return (entries[:4], (0,) * 4, entries[4:])
    raise ContentError(f"Unsupported required layer {layer}")


class Source:
    def __init__(self, path: Path, pinned_records: dict | None = None):
        self.path = path.resolve()
        self.inputs: dict[str, dict] = {}
        self.pinned_records = pinned_records

    def read(self, relative: str) -> bytes:
        target = (self.path / relative).resolve()
        require(target.is_relative_to(self.path), f"Unsafe source path {relative}")
        require(target.is_file(), f"Missing required source input {relative}")
        data = target.read_bytes()
        if self.pinned_records is not None:
            pinned = self.pinned_records.get(relative)
            require(pinned is not None and pinned["sha256"] == sha(data) and pinned["size"] == len(data), f"Source input differs from pinned snapshot: {relative}")
        self.inputs[relative] = {"path": relative, "bytes": len(data), "sha256": sha(data)}
        return data

    def text(self, relative: str) -> str:
        return self.read(relative).decode("utf-8-sig")

    def json(self, relative: str):
        return json.loads(self.text(relative))

    def image(self, relative: str) -> Image.Image:
        image = Image.open(io.BytesIO(self.read(relative)))
        image.load()
        return image


def validate_source_contract(source: Source) -> dict[str, str]:
    evidence = {path: source.text(path) for path in SOURCE_EVIDENCE}
    expected = {
        "NUM_TILES_IN_PRIMARY": 640, "NUM_TILES_TOTAL": 1024,
        "NUM_METATILES_IN_PRIMARY": 640, "NUM_PALS_IN_PRIMARY": 7,
        "NUM_PALS_TOTAL": 13,
    }
    for symbol, value in expected.items():
        match = re.search(r"#define\s+" + symbol + r"\s+(\d+)\b", evidence["include/fieldmap.h"])
        require(match is not None and int(match[1]) == value, f"include/fieldmap.h: unsupported {symbol}")
    for symbol, expected_value in {"MAPGRID_METATILE_ID_MASK": 0x3FF, "MAPGRID_COLLISION_MASK": 0xC00, "MAPGRID_ELEVATION_MASK": 0xF000}.items():
        match = re.search(r"#define\s+" + symbol + r"\s+(0x[0-9A-Fa-f]+)\b", evidence["include/global.fieldmap.h"])
        require(match is not None and int(match[1], 16) == expected_value, f"Unsupported block mask {symbol}")
    for symbol, (path, callback) in TILESETS.items():
        name = symbol.removeprefix("gTileset_")
        match = re.search(r"gTileset_" + name + r"\s*=\s*\{(.*?)\};", evidence["src/data/tilesets/headers.h"], re.S)
        require(match is not None and re.search(r"\.callback\s*=\s*" + callback + r"\s*,", match[1]) is not None, f"Unsupported tileset callback for {name}")
        secondary = "TRUE" if "/secondary/" in path else "FALSE"
        require(re.search(r"\.isSecondary\s*=\s*" + secondary + r"\s*,", match[1]) is not None, f"Unsupported tileset slot for {name}")
        for field, prefix in (("metatiles", "gMetatiles_"), ("metatileAttributes", "gMetatileAttributes_")):
            require(re.search(r"\." + field + r"\s*=\s*" + prefix + name + r"\s*,", match[1]) is not None, f"Unsupported {field} for {name}")
        require(f'gMetatiles_{name}[] = INCBIN_U16("{path}/metatiles.bin")' in evidence["src/data/tilesets/metatiles.h"], f"Unsupported metatile path for {name}")
        require(f'gMetatileAttributes_{name}[] = INCBIN_U32("{path}/metatile_attributes.bin")' in evidence["src/data/tilesets/metatiles.h"], f"Unsupported attributes path for {name}")
    return evidence


def load_tileset(source: Source, path: str) -> dict:
    entries = words(source.read(f"{path}/metatiles.bin"), 2, path)
    attributes = words(source.read(f"{path}/metatile_attributes.bin"), 4, path)
    require(len(entries) == len(attributes) * 8, f"{path}: metatiles and u32 attribute counts differ")
    tiles = decode_4bpp(pack_indexed_tiles(source.image(f"{path}/tiles.png")))
    return {"metatiles": tuple(entries[i:i + 8] for i in range(0, len(entries), 8)), "attributes": attributes, "tiles": tiles}


def parse_actor_animations(evidence: dict, table_name: str, running: bool = False) -> dict:
    animation_text = evidence["src/data/object_events/object_event_anims.h"]
    table = re.search(r"\b" + table_name + r"\[\]\s*=\s*\{(.*?)\};", animation_text, re.S)
    require(table is not None, f"Missing source animation table {table_name}")
    animations = {}
    actions = [("idle", "Face", "ANIM_STD_FACE"), ("walk", "Go", "ANIM_STD_GO")]
    if running:
        actions.append(("run", "Run", "ANIM_RUN"))
    for action, prefix, slot in actions:
        for direction in ("South", "North", "West", "East"):
            name = f"sAnim_{prefix}{direction}"
            require(re.search(r"\[" + slot + "_" + direction.upper() + r"\]\s*=\s*" + name + r"\s*,", table[1]) is not None, f"Unsupported source animation slot {table_name}/{slot}/{direction}")
            match = re.search(r"\b" + name + r"\[\]\s*=\s*\{(.*?)\};", animation_text, re.S)
            require(match is not None, f"Missing source animation {name}")
            tokens = re.findall(r"ANIMCMD_FRAME\((\d+),\s*(\d+)(,\s*\.hFlip\s*=\s*TRUE)?\)", match[1])
            remainder = re.sub(r"ANIMCMD_FRAME\(\d+,\s*\d+(?:,\s*\.hFlip\s*=\s*TRUE)?\),?", "", match[1])
            remainder = re.sub(r"ANIMCMD_JUMP\(0\),?", "", remainder)
            require(not remainder.strip() and tokens, f"Unsupported command in {name}")
            animations[f"{action}-{direction.lower()}"] = [{"frame": int(frame), "durationFrames": int(duration), "flipX": bool(flip)} for frame, duration, flip in tokens]
    return animations


def sprite_info(evidence: dict, name: str) -> str:
    info = re.search(r"\bgObjectEventGraphicsInfo_" + name + r"\s*=\s*\{(.*?)\};", evidence["src/data/object_events/object_event_graphics_info.h"], re.S)
    require(info is not None, f"Missing graphics info {name}")
    require(".width = 16," in info[1] and ".height = 32," in info[1], f"Unsupported {name} sprite dimensions")
    return info[1]


def export_sprite_sheet(source: Source, evidence: dict, info: str, palette: list, frame_count: int) -> Image.Image:
    table_name = re.search(r"\.images\s*=\s*(\w+),", info)
    require(table_name is not None, "Missing sprite frame table reference")
    table = re.search(r"\b" + table_name[1] + r"\[\]\s*=\s*\{(.*?)\};", evidence["src/data/object_events/object_event_pic_tables.h"], re.S)
    require(table is not None, f"Missing sprite frame table {table_name[1]}")
    pattern = r"overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\),?"
    frames = re.findall(pattern, table[1])
    require(not re.sub(pattern, "", table[1]).strip() and len(frames) >= frame_count, f"Unsupported frame table {table_name[1]}")
    sheet = Image.new("RGBA", (16 * frame_count, 32))
    images = {}
    for index, (symbol, width, height, source_frame) in enumerate(frames[:frame_count]):
        require((int(width), int(height)) == (2, 4), "Unsupported source sprite frame dimensions")
        if symbol not in images:
            declaration = re.search(r"\b" + symbol + r'\[\]\s*=\s*INCBIN_U16\("([^"]+)\.4bpp"\)', evidence["src/data/object_events/object_event_graphics.h"])
            require(declaration is not None, f"Missing sprite graphic declaration {symbol}")
            images[symbol] = source.image(declaration[1] + ".png")
        image = images[symbol]
        require(image.mode == "P" and image.height == 32 and image.width % 16 == 0, "Unsupported indexed sprite sheet layout")
        x = int(source_frame) * 16
        require(x + 16 <= image.width, f"Missing source sprite frame {symbol}[{source_frame}]")
        pixels = list(image.crop((x, 0, x + 16, 32)).getdata())
        require(all(0 <= p < 16 for p in pixels), "Sprite uses indices beyond 4bpp")
        frame = Image.new("RGBA", (16, 32))
        frame.putdata([palette[p] for p in pixels])
        sheet.paste(frame, (index * 16, 0))
    return sheet


def export_player(source: Source, evidence: dict, put) -> dict:
    info = sprite_info(evidence, "RedNormal")
    require(".anims = sAnimTable_RedGreenNormal," in info, "Unsupported RedNormal animation table")
    palette = palette_from_jasc(source.text("graphics/object_events/palettes/player.pal"), "player.pal")
    put("client/sprites/red-overworld.png", export_sprite_sheet(source, evidence, info, palette, 18))
    animations = parse_actor_animations(evidence, "sAnimTable_RedGreenNormal", running=True)
    require(all(frame["frame"] < 18 for sequence in animations.values() for frame in sequence), "Player animation frame outside exported sheet")
    return {"image": "/content/sprites/red-overworld.png", "frameWidth": 16, "frameHeight": 32, "frameCount": 18, "sourceFrameRate": 60, "animations": animations}


def export_actor_graphics(source: Source, evidence: dict, graphics_id: str, put) -> dict:
    pointer = re.search(r"\[" + re.escape(graphics_id) + r"\]\s*=\s*&gObjectEventGraphicsInfo_(\w+),", evidence["src/data/object_events/object_event_graphics_info_pointers.h"])
    require(pointer is not None, f"Missing object graphics pointer {graphics_id}")
    name = pointer[1]
    info = sprite_info(evidence, name)
    require(".anims = sAnimTable_Standard," in info, f"Unsupported NPC animation table {name}")
    tag = re.search(r"\.paletteTag\s*=\s*(\w+),", info)
    require(tag is not None, f"Missing NPC palette tag {name}")
    entry = re.search(r"\{(\w+),\s*" + tag[1] + r"\}", evidence["src/event_object_movement.c"])
    require(entry is not None, f"Missing NPC palette entry {name}")
    declaration = re.search(r"\b" + entry[1] + r'\[\]\s*=\s*INCBIN_U16\("([^"]+)\.gbapal"\)', evidence["src/data/object_events/object_event_graphics.h"])
    require(declaration is not None, f"Missing NPC palette declaration {name}")
    palette = palette_from_jasc(source.text(declaration[1] + ".pal"), declaration[1])
    path = f"sprites/npc-{name}.png"
    put("client/" + path, export_sprite_sheet(source, evidence, info, palette, 9))
    return {"graphicsId": graphics_id, "image": "/content/" + path, "frameWidth": 16, "frameHeight": 32,
            "frameCount": 9, "sourceFrameRate": 60, "animations": parse_actor_animations(evidence, "sAnimTable_Standard")}


def label_block(text: str, label: str) -> str:
    match = re.search(r"^" + re.escape(label) + r"::?[ \t]*\n(.*?)(?=^\w+::?|\Z)", text, re.M | re.S)
    require(match is not None, f"Missing source label {label}")
    return match[1]


def decode_dialogue_text(text: str, label: str) -> list[str]:
    block = label_block(text, label)
    pattern = r'^[ \t]*\.string[ \t]+"((?:[^"\\]|\\.)*)"[ \t]*$'
    fragments = re.findall(pattern, block, re.M)
    require(fragments and not re.sub(pattern, "", block, flags=re.M).strip(), f"Unsupported text construct at {label}")
    joined = "".join(fragments)
    require(joined.endswith("$") and joined.count("$") == 1, f"Unsupported text terminator at {label}")
    joined = joined[:-1].replace("{PLAYER}", "RED").replace("{RIVAL}", "BLUE")
    require("{" not in joined and "}" not in joined, f"Unsupported text variable at {label}")
    escapes = {"n": "\n", "l": "\n", "p": "\f", '"': '"', "\\": "\\"}
    require(all(match[1] in escapes for match in re.finditer(r"\\(.)", joined)), f"Unsupported text escape at {label}")
    joined = re.sub(r"\\(.)", lambda match: escapes[match[1]], joined)
    pages = joined.split("\f")
    require(all(page.strip() for page in pages), f"Empty dialogue page at {label}")
    return pages


def export_interaction(scripts: str, text: str, label: str) -> dict:
    if label in ("0x0", "0", "NULL"):
        return {"kind": "none", "pages": []}
    lines = [line.split("@", 1)[0].strip() for line in label_block(scripts, label).splitlines()]
    lines = [line for line in lines if line]
    # Entire-script matching is deliberate: extracting the first message from a
    # healing, reward, branch or flag script would misrepresent the interaction.
    message = re.fullmatch(r"msgbox (\w+), (MSGBOX_NPC|MSGBOX_SIGN)", lines[0]) if lines else None
    if len(lines) != 2 or lines[1] != "end" or message is None:
        return {"kind": "unavailable", "pages": [], "reason": "This interaction needs story state or gameplay that is not available in the preview."}
    return {"kind": "dialogue", "pages": decode_dialogue_text(text, message[1])}


def export_actors_and_signs(source: Source, evidence: dict, metadata: dict, scripts: str, put) -> tuple[list, list, list, dict]:
    text_path = f"data/maps/{metadata['name']}/text.inc"
    texts = source.text(text_path)
    require('text << "\\tobject_event " << i + 1' in evidence["tools/mapjson/mapjson.cpp"], "Unsupported source object local-id numbering")
    require("InitEventData();" in evidence["src/new_game.c"] and "RunScriptImmediately(EventScript_ResetAllMapFlags);" in evidence["src/new_game.c"], "Unsupported new-game event initialization")
    require("memset(gSaveBlock1Ptr->flags, 0, sizeof(gSaveBlock1Ptr->flags));" in evidence["src/event_data.c"] and "memset(gSaveBlock1Ptr->vars, 0, sizeof(gSaveBlock1Ptr->vars));" in evidence["src/event_data.c"], "Unsupported initial event state")
    reset_script = label_block(evidence["data/event_scripts.s"], "EventScript_ResetAllMapFlags")
    require("setflag FLAG_HIDE_OAK_IN_PALLET_TOWN" in reset_script, "Unsupported initial Oak visibility")
    require("&& !FlagGet(template->flagId)" in evidence["src/event_object_movement.c"], "Unsupported object flag visibility semantics")
    facing_table = re.search(r"gInitialMovementTypeFacingDirections\[MOVEMENT_TYPES_COUNT\]\s*=\s*\{(.*?)\};", evidence["src/event_object_movement.c"], re.S)
    require(facing_table is not None, "Missing source initial facing table")
    display_names = {"OBJ_EVENT_GFX_WOMAN_1": "Woman", "OBJ_EVENT_GFX_FAT_MAN": "Resident", "OBJ_EVENT_GFX_MOM": "Mom", "OBJ_EVENT_GFX_CLERK": "Mart clerk", "OBJ_EVENT_GFX_BOY": "Boy", "OBJ_EVENT_GFX_PROF_OAK": "Professor Oak"}
    actors, graphics, actor_evidence = [], {}, []
    for index, event in enumerate(metadata["object_events"]):
        require(event["type"] == "object" and event["trainer_type"] == "TRAINER_TYPE_NONE", "Unsupported required NPC object type")
        flag, graphics_id = event["flag"], event["graphics_id"]
        require(graphics_id in display_names, f"Unsupported required NPC graphics {graphics_id}")
        require(flag == "0" or (metadata["name"] == "PalletTown" and graphics_id == "OBJ_EVENT_GFX_PROF_OAK" and flag == "FLAG_HIDE_OAK_IN_PALLET_TOWN"), "Unresolved required NPC visibility")
        visible = flag == "0"
        position = {key: event[key] for key in ("x", "y", "elevation")}
        movement_type = event["movement_type"]
        pose_source = "map object template"
        if metadata["name"] == "PalletTown" and event.get("local_id") == "LOCALID_PALLET_SIGN_LADY":
            on_entry = label_block(scripts, "PalletTown_OnTransition")
            default_pose = label_block(scripts, "PalletTown_EventScript_SetSignLadyPos")
            expected_pose = ["goto_if_set FLAG_PALLET_LADY_NOT_BLOCKING_SIGN, PalletTown_EventScript_MoveSignLadyToRouteEntrance", "setobjectxyperm LOCALID_PALLET_SIGN_LADY, 5, 15", "setobjectmovementtype LOCALID_PALLET_SIGN_LADY, MOVEMENT_TYPE_FACE_UP", "return"]
            require("call_if_eq VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY, 0, PalletTown_EventScript_SetSignLadyPos" in on_entry and [line.strip() for line in default_pose.splitlines() if line.strip()] == expected_pose, "Unsupported initial sign-lady pose script")
            require("setflag FLAG_PALLET_LADY_NOT_BLOCKING_SIGN" not in reset_script and "VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY" not in reset_script, "Sign-lady initial state differs from zero-state pose")
            position.update({"x": 5, "y": 15})
            movement_type = "MOVEMENT_TYPE_FACE_UP"
            pose_source = "PalletTown_OnTransition -> PalletTown_EventScript_SetSignLadyPos with initial unset flag and zero scene variable"
        facing = re.search(r"\[" + movement_type + r"\]\s*=\s*DIR_(SOUTH|NORTH|WEST|EAST),", facing_table[1])
        require(facing is not None, f"Unsupported NPC initial direction {movement_type}")
        if visible and graphics_id not in graphics:
            graphics[graphics_id] = export_actor_graphics(source, evidence, graphics_id, put)
        interaction = export_interaction(scripts, texts, event["script"])
        reason = "Visible in source initial state." if visible else "Hidden in source initial state; story activation is unavailable."
        actors.append({**position, "graphicsId": graphics_id, "implemented": visible, "localId": index + 1,
                       "displayName": display_names[graphics_id], "visible": visible, "direction": facing[1].lower(),
                       "movementType": movement_type, "movementRange": {"x": event["movement_range_x"], "y": event["movement_range_y"]},
                       "visibilityReason": reason, "interaction": interaction})
        actor_evidence.append({"localId": index + 1, "sourceCoordinates": {key: event[key] for key in ("x", "y", "elevation")}, "previewCoordinates": position,
                               "poseSource": pose_source, "sourceMovementType": event["movement_type"], "previewMovementType": movement_type,
                               "flag": flag, "script": event["script"], "interactionKind": interaction["kind"]})
    signs = []
    for index, event in enumerate(metadata["bg_events"]):
        require(event["type"] == "sign" and event["player_facing_dir"] == "BG_EVENT_PLAYER_FACING_ANY", "Unsupported required sign event type")
        interaction = export_interaction(scripts, texts, event["script"])
        signs.append({**{key: event[key] for key in ("x", "y", "elevation")}, "signId": index, "facing": "any", "implemented": interaction["kind"] == "dialogue", "interaction": interaction})
    return actors, list(graphics.values()), signs, {"initialState": "source new-game flags and zero variables; no gameplay session created", "actors": actor_evidence, "previewNames": {"player": "RED", "rival": "BLUE"}, "npcMovement": "stationary preview; source wandering deferred", "textSource": text_path}


def validate_transfers(maps: dict[str, dict]) -> None:
    """Validate selected map topology without inventing out-of-scope destinations."""
    opposite = {"up": "down", "down": "up", "left": "right", "right": "left"}
    for map_id, context in maps.items():
        metadata, layout = context["metadata"], context["layout"]
        for index, warp in enumerate(metadata["warp_events"]):
            require(all(isinstance(warp[key], int) for key in ("x", "y", "elevation")), f"{map_id} warp {index}: invalid point")
            require(0 <= warp["x"] < layout["width"] and 0 <= warp["y"] < layout["height"] and 0 <= warp["elevation"] <= 15, f"{map_id} warp {index}: outside map")
            require(re.fullmatch(r"\d+", str(warp["dest_warp_id"])) is not None, f"{map_id} warp {index}: unsupported destination warp expression")
            require(re.fullmatch(r"MAP_[A-Z0-9_]+", warp["dest_map"]) is not None, f"{map_id} warp {index}: malformed destination")
            target = maps.get(warp["dest_map"])
            if target:
                require(int(warp["dest_warp_id"]) < len(target["metadata"]["warp_events"]), f"{map_id} warp {index}: missing destination warp")
        for connection in metadata["connections"] or []:
            direction, offset = connection["direction"], connection["offset"]
            require(direction in opposite and isinstance(offset, int), f"{map_id}: malformed connection")
            require(re.fullmatch(r"MAP_[A-Z0-9_]+", connection["map"]) is not None, f"{map_id}: malformed connection destination")
            target = maps.get(connection["map"])
            if target:
                dimension = "width" if direction in ("up", "down") else "height"
                require(max(0, offset) < min(layout[dimension], offset + target["layout"][dimension]), f"{map_id}: connection does not overlap destination")
                reverse = [row for row in (target["metadata"]["connections"] or []) if row["direction"] == opposite[direction] and row["map"] == map_id]
                require(len(reverse) == 1 and reverse[0]["offset"] == -offset, f"{map_id}: connection lacks inverse offset")


def render_layers(source: Source, evidence: dict, blocks: list, width: int, height: int, primary: dict, secondary: dict, palettes: list, general: bool, prefix: str, put) -> tuple[dict, list]:
    tiles = primary["tiles"] + secondary["tiles"]
    size = (width * 16, height * 16)
    layers = {name: Image.new("RGBA", size) for name in LAYER_NAMES}
    flower_frames = []
    if general:
        animation_source = evidence["src/tileset_anims.c"]
        require("TILE_OFFSET_4BPP(508)), 4 * TILE_SIZE_4BPP" in animation_source and "QueueAnimTiles_General_Flower(timer / 16);" in animation_source, "Unsupported flower animation callback")
        for frame in range(5):
            frame_tiles = decode_4bpp(pack_indexed_tiles(source.image(f"data/tilesets/primary/general/anim/flower/{frame}.png")))
            require(len(frame_tiles) == 4, "Unexpected flower animation frame dimensions")
            flower_frames.append((tiles[:508] + frame_tiles + tiles[512:], {name: Image.new("RGBA", size) for name in LAYER_NAMES}))
    component_cache = {}
    flower_count = 0
    for position, row in enumerate(blocks):
        metatile = row["metatile"]
        entries = primary["metatiles"][metatile] if metatile < 640 else secondary["metatiles"][metatile - 640]
        for layer_index, layer_entries in enumerate(layer_components(entries, row["layerType"])):
            layer_name = LAYER_NAMES[layer_index]
            for quadrant, entry in enumerate(layer_entries):
                xy = ((position % width) * 16 + (quadrant % 2) * 8, (position // width) * 16 + (quadrant // 2) * 8)
                if general and 508 <= (entry & 0x3FF) < 512:
                    flower_count += 1
                    for frame_tiles, frame_layers in flower_frames:
                        frame_layers[layer_name].paste(component_image(entry, frame_tiles, palettes), xy)
                else:
                    if entry not in component_cache:
                        component_cache[entry] = component_image(entry, tiles, palettes)
                    layers[layer_name].paste(component_cache[entry], xy)
    layer_urls = {}
    for name, image in layers.items():
        put(f"client/{prefix}/{name}.png", image)
        layer_urls[name] = f"/content/{prefix}/{name}.png"
    animations = []
    if flower_count:
        animation_frames = []
        for frame, (_, frame_layers) in enumerate(flower_frames):
            urls = {}
            for name, image in frame_layers.items():
                put(f"client/{prefix}/flower-{frame}-{name}.png", image)
                urls[name] = f"/content/{prefix}/flower-{frame}-{name}.png"
            animation_frames.append(urls)
        animations.append({"id": "general-flower", "durationFrames": 16, "phaseFrames": 2, "sourceFrameRate": 60, "frames": animation_frames, "componentCount": flower_count})
    return layer_urls, animations


def export_pallet_door(source: Source, evidence: dict, palettes: list, put) -> list:
    door_source = evidence["src/field_door.c"]
    require(re.search(r"#define\s+METATILE_PalletTown_Door\s+0x2A3\b", evidence["include/constants/metatile_labels.h"]) is not None, "Unsupported Pallet door metatile")
    require(re.search(r"\{METATILE_PalletTown_Door,\s*DOOR_SOUND_NORMAL,\s*DOOR_SIZE_1x1,\s*sDoorAnimTiles_Pallet,\s*sDoorAnimPalettes_Pallet\}", door_source) is not None, "Unsupported Pallet door metadata")
    require('sDoorAnimTiles_Pallet[] = INCBIN_U8("graphics/door_anims/pallet.4bpp")' in door_source, "Unsupported Pallet door graphic")
    require("sDoorAnimPalettes_Pallet[] = {8, 8, 8, 8, 8, 8, 8, 8}" in door_source, "Unsupported Pallet door palette")
    frames = re.search(r"sDoorAnimFrames_OpenSmall\[\]\s*=\s*\{(.*?)\n\};", door_source, re.S)
    require(frames is not None and re.findall(r"\{4, (.*?)\}", frames[1]) == ["CLOSED_DOOR_TILES_OFFSET", "0 * TILE_SIZE_4BPP", "4 * TILE_SIZE_4BPP", "8 * TILE_SIZE_4BPP"], "Unsupported small door frames")
    require("if (tCounter == frames[tFrameId].duration)" in door_source and "tCounter++;" in door_source, "Unsupported inclusive door timer")
    image = source.image("graphics/door_anims/pallet.png")
    require(image.size == (16, 48) and image.mode == "P", "Unsupported Pallet door image dimensions")
    require(all(0 < value < 16 for value in image.getdata()), "Pallet door overlay must be opaque 4bpp pixels")
    rgba = Image.new("RGBA", image.size)
    rgba.putdata([palettes[8][value] for value in image.getdata()])
    urls = []
    for frame in range(3):
        path = f"maps/PalletTown/door-{frame}.png"
        put(f"client/{path}", rgba.crop((0, frame * 16, 16, (frame + 1) * 16)))
        urls.append(f"/content/{path}")
    return [{"metatile": 0x2A3, "frames": urls, "frameDurationFrames": 5, "sourceFrameRate": 60}]


def export_map(source: Source, evidence: dict, context: dict, maps: dict, player: dict, fingerprint: str | None, put) -> dict:
    metadata, layout = context["metadata"], context["layout"]
    name = metadata["name"]
    require(layout["primary_tileset"] in TILESETS and layout["secondary_tileset"] in TILESETS, f"{name}: unsupported tileset")
    primary_path, secondary_path = TILESETS[layout["primary_tileset"]][0], TILESETS[layout["secondary_tileset"]][0]
    require("/primary/" in primary_path and "/secondary/" in secondary_path, f"{name}: reversed tileset slots")
    primary, secondary = load_tileset(source, primary_path), load_tileset(source, secondary_path)
    require(len(primary["tiles"]) == 640 and len(primary["attributes"]) == 640, f"{name}: unsupported primary dimensions")
    require(len(secondary["tiles"]) <= 384 and len(secondary["attributes"]) <= 384, f"{name}: unsupported secondary dimensions")
    palettes = [palette_from_jasc(source.text(f"{primary_path if i < 7 else secondary_path}/palettes/{i:02d}.pal"), f"palette {i}") for i in range(13)]
    behavior_names = {int(value, 16): key for key, value in re.findall(r"#define\s+(MB_\w+)\s+(0x[0-9A-Fa-f]+)", evidence["include/constants/metatile_behaviors.h"])}

    def block(raw: int) -> dict:
        metatile = raw & 0x3FF
        table, index = (primary, metatile) if metatile < 640 else (secondary, metatile - 640)
        require(index < len(table["attributes"]), f"{name}: missing metatile {metatile}")
        result = decode_block(raw, table["attributes"][index])
        require(result["behavior"] in behavior_names, f"{name}: unknown behavior {result['behavior']}")
        result["behaviorName"] = behavior_names[result["behavior"]]
        return result

    blocks = [block(raw) for raw in words(source.read(layout["blockdata_filepath"]), 2, layout["blockdata_filepath"])]
    border_blocks = [block(raw) for raw in words(source.read(layout["border_filepath"]), 2, layout["border_filepath"])]
    require(len(blocks) == layout["width"] * layout["height"], f"{name}: map dimensions differ from binary")
    require(len(border_blocks) == layout["border_width"] * layout["border_height"], f"{name}: border dimensions differ from binary")
    general = layout["primary_tileset"] == "gTileset_General"
    layers, animations = render_layers(source, evidence, blocks, layout["width"], layout["height"], primary, secondary, palettes, general, f"maps/{name}", put)
    border_layers, border_animations = render_layers(source, evidence, border_blocks, layout["border_width"], layout["border_height"], primary, secondary, palettes, general, f"maps/{name}/border", put)
    require(not border_animations, f"{name}: animated border is unsupported")
    scripts = source.text(f"data/maps/{name}/scripts.inc")
    actors, actor_graphics, signs, actor_evidence = export_actors_and_signs(source, evidence, metadata, scripts, put)
    put(f"manifests/{name}.source.json", {"metadata": metadata, "layout": layout, "scriptLabels": re.findall(r"^(\w+)::?", scripts, re.M), "scriptExecution": "pure-message extraction only; other scripts unsupported", "actorPreview": actor_evidence})
    warps = []
    for index, event in enumerate(metadata["warp_events"]):
        target = maps.get(event["dest_map"])
        destination = target["metadata"]["warp_events"][int(event["dest_warp_id"])] if target else None
        warps.append({**{key: event[key] for key in ("x", "y", "elevation")}, "warpId": index,
                      "destinationMap": event["dest_map"], "destinationWarp": int(event["dest_warp_id"]),
                      "destinationAvailable": target is not None,
                      "destination": {key: destination[key] for key in ("x", "y", "elevation")} if destination else None})
    public_events = {
        "warps": warps,
        "objects": actors,
        "triggers": [{"x": e["x"], "y": e["y"], "elevation": e["elevation"], "implemented": False} for e in metadata["coord_events"]],
        "signs": signs,
    }
    limitations = [
        "Renderer preview only: no authoritative movement, saving or story execution.",
        "NPCs use source initial visibility and poses; they remain stationary. Native wandering and story changes are not implemented.",
        "Only pure-message interactions are exported. Rewards, healing, flags, conditionals and other gameplay scripts remain unavailable.",
        "Name tokens use explicit preview labels RED and BLUE; no named character or story session is created.",
        "Only Pallet Town, Player's House 1F and Route 1 are exported; other destinations are unavailable.",
        "Water/current and shoreline native animation callbacks remain frozen at source base tiles.",
        "Only the Pallet house door animation is exported; no field effects or dynamic story edits.",
        "Gameplay exports cover a bounded starter/Route 1 level-up definition set and a read-only field guide; battle/item effects, encounters and persistent ownership are not implemented.",
        "Dialogue uses the neutral normal Latin source font; full text effects and gender-specific styles remain unavailable.",
        "Audio is a bounded Pallet music/select-SFX prototype; other tracks and original GBA mixer fidelity remain unavailable.",
        "Source tall-grass and ledge behaviors are metadata; encounters and story barriers are not gameplay.",
    ]
    spawn_x, spawn_y, spawn_elevation = context["spawn"]
    spawn = blocks[spawn_y * layout["width"] + spawn_x]
    require(spawn["collision"] == 0 and spawn["elevation"] == spawn_elevation and spawn["behavior"] == 0, f"{name}: preview spawn must be clear normal ground")
    content = {
        "schemaVersion": SCHEMA_VERSION, "profile": "firered-private", "id": metadata["id"], "name": name, "displayName": context["displayName"], "mapType": metadata["map_type"],
        "allowRunning": metadata["allow_running"], "music": metadata["music"], "actorGraphics": actor_graphics,
        "width": layout["width"], "height": layout["height"], "tileSize": 16, "blocks": blocks,
        "border": {"width": layout["border_width"], "height": layout["border_height"], "blocks": border_blocks, "layers": border_layers},
        "layers": layers, "events": public_events,
        "connections": [{**row, "destinationAvailable": row["map"] in maps} for row in metadata["connections"] or []],
        "animations": animations, "doors": export_pallet_door(source, evidence, palettes, put) if name == "PalletTown" else [], "player": player,
        "previewSpawn": {"x": spawn_x, "y": spawn_y, "elevation": spawn_elevation}, "limitations": limitations,
        "source": {"map": f"data/maps/{name}/map.json", "layout": layout["blockdata_filepath"], "upstreamCommit": None, "fingerprint": fingerprint},
    }
    put(f"client/maps/{name}.json", content)
    return content


def prune_previous_outputs(output: Path, emitted: dict) -> None:
    """Remove obsolete files owned by our previous manifest, never whole folders."""
    previous_path = output / "manifests/content-manifest.json"
    if not previous_path.is_file():
        return
    previous = json.loads(previous_path.read_text(encoding="utf-8"))
    require(previous.get("generator") == "tools/content-import/import_content.py", "Existing manifest has unknown generator; refusing cleanup")
    root = output.resolve()
    obsolete = []
    for row in previous["outputs"]:
        relative = row["path"]
        if relative in emitted:
            continue
        require(isinstance(relative, str) and relative.startswith(("client/", "server/", "manifests/")) and "\\" not in relative and all(part not in ("", ".", "..") for part in relative.split("/")), "Previous manifest contains unsafe output path")
        target = root / relative
        require(target.resolve().is_relative_to(root) and target.resolve() == target and not target.is_symlink(), "Previous manifest output resolves outside its declared path")
        if not target.exists():
            continue
        require(target.is_file() and sha(target.read_bytes()) == row["sha256"], f"Obsolete generated file was modified; refusing removal: {relative}")
        obsolete.append(target)
    # Validate the entire removal set first. No recursive removal and no sweep
    # of untracked files; unrelated assets and hand edits remain intact.
    for target in obsolete:
        target.unlink()


def build(source_path: Path, output: Path, source_lock: dict | None) -> dict:
    require(pillow_version == "11.3.0", f"Expected pinned Pillow 11.3.0, found {pillow_version}")
    pinned_records = None
    if source_lock:
        source_manifest = json.loads((ROOT / source_lock["fingerprint"]["manifest"]).read_text(encoding="utf-8-sig"))
        require(source_manifest["sourceFingerprint"] == source_lock["fingerprint"]["value"], "Source manifest does not match source-lock")
        records = source_manifest["records"]
        require(len({row["path"] for row in records}) == len(records), "Duplicate source manifest paths")
        fingerprint_bytes = "".join(f"{row['sha256']}  {row['size']}  {row['path']}\n" for row in sorted(records, key=lambda row: row["path"])).encode()
        require(sha(fingerprint_bytes) == source_lock["fingerprint"]["value"], "Source manifest records do not match locked fingerprint")
        require(source_lock["selectedBuild"] == {"game": "FIRERED", "revision": 0, "language": "ENGLISH", "evidence": "config.mk:3-5"}, "Only pinned English FireRed revision 0 is supported")
        pinned_records = {row["path"]: row for row in source_manifest["records"]}
    source = Source(source_path, pinned_records)
    evidence = validate_source_contract(source)
    emitted = {}

    def put(relative: str, value):
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(value, Image.Image):
            buffer = io.BytesIO()
            value.save(buffer, format="PNG", optimize=False, compress_level=9)
            data = buffer.getvalue()
        elif isinstance(value, bytes):
            data = value
        else:
            data = json_bytes(value)
        target.write_bytes(data)
        emitted[relative] = {"path": relative, "bytes": len(data), "sha256": sha(data)}

    layouts = source.json("data/layouts/layouts.json")["layouts"]
    contexts = {}
    for name, display_name, spawn in MAP_SPECS:
        metadata = source.json(f"data/maps/{name}/map.json")
        matches = [row for row in layouts if row.get("id") == metadata["layout"]]
        require(len(matches) == 1, f"{name}: missing or duplicate layout")
        layout = matches[0]
        require(metadata["name"] == name and metadata["id"] not in contexts, f"{name}: duplicate or mismatched identity")
        for dimension in ("width", "height", "border_width", "border_height"):
            require(isinstance(layout[dimension], int) and 0 < layout[dimension] <= 1024, f"{name}: invalid {dimension}")
        require(0 <= spawn[0] < layout["width"] and 0 <= spawn[1] < layout["height"], f"{name}: spawn outside map")
        contexts[metadata["id"]] = {"metadata": metadata, "layout": layout, "displayName": display_name, "spawn": spawn}
    validate_transfers(contexts)
    dialogue_font = export_dialogue_font(source, put)
    font_metadata = json.loads((output / "client/fonts/dialogue.json").read_text(encoding="utf-8"))
    audio = export_audio(source, put)
    audio_metadata = json.loads((output / "client/audio/preview.json").read_text(encoding="utf-8"))
    player = export_player(source, evidence, put)
    fingerprint = source_lock["fingerprint"]["value"] if source_lock else None
    gameplay = export_gameplay(source, put, fingerprint)
    maps = [export_map(source, evidence, context, contexts, player, fingerprint, put) for context in contexts.values()]
    for map_data in maps:
        for event in map_data["events"]["objects"] + map_data["events"]["signs"]:
            interaction = event["interaction"]
            pages = [interaction["reason"]] if interaction["kind"] == "unavailable" else interaction["pages"]
            for page in pages:
                validate_font_text(font_metadata, page, map_data["name"])
    world = {"schemaVersion": SCHEMA_VERSION, "profile": "firered-private", "startMap": "MAP_PALLET_TOWN", "previewNames": {"player": "RED", "rival": "BLUE"},
             "dialogueFont": dialogue_font, "audio": audio, "fieldGuide": gameplay["url"],
             "maps": [{"id": row["id"], "name": row["name"], "displayName": row["displayName"], "url": f"/content/maps/{row['name']}.json"} for row in maps]}
    put("client/world.json", world)
    inventory = {
        "schemaVersion": SCHEMA_VERSION, "profile": "firered-private", "mapScope": list(contexts),
        "discoveredMapCount": len(list((source.path / "data/maps").glob("*/map.json"))),
        "exportedMapCount": len(maps), "executableMapCount": 0, "verifiedPlayableMapCount": 0,
        "maps": [{"id": row["id"], "blocks": len(row["blocks"]), "usedMetatiles": len({b["metatile"] for b in row["blocks"]}),
                  "layerTypes": sorted({b["layerType"] for b in row["blocks"]}), "behaviors": sorted({b["behaviorName"] for b in row["blocks"]}),
                  "events": {name: len(events) for name, events in row["events"].items()}, "visibleActors": sum(actor["visible"] for actor in row["events"]["objects"]),
                  "dialogueInteractions": sum(event["interaction"]["kind"] == "dialogue" for event in row["events"]["objects"] + row["events"]["signs"])} for row in maps],
        "unsupportedDependencies": maps[0]["limitations"],
        "dialogueFont": {"id": font_metadata["id"], "glyphCount": len(font_metadata["glyphs"]), "limitations": font_metadata["limitations"]},
        "audio": {**audio, "voiceCount": len(audio_metadata["voices"]), "limitations": audio_metadata["limitations"]},
        "gameplay": gameplay["coverage"],
        "nativeAnimationCallbacks": [{"name": "QueueAnimTiles_General_Flower", "status": "exported", "frames": 5}, {"name": "QueueAnimTiles_General_Water_Current_LandWatersEdge", "status": "discovered"}, {"name": "QueueAnimTiles_General_SandWatersEdge", "status": "discovered"}],
        "unresolvedDestinations": sorted({event["destinationMap"] for row in maps for event in row["events"]["warps"] if not event["destinationAvailable"]} | {connection["map"] for row in maps for connection in row["connections"] if not connection["destinationAvailable"]}),
    }
    put("manifests/inventory.json", inventory)
    inputs = sorted(source.inputs.values(), key=lambda row: row["path"])
    input_digest = sha(json_bytes(inputs))
    manifest = {
        "schemaVersion": SCHEMA_VERSION, "profile": "firered-private", "generator": "tools/content-import/import_content.py",
        "generatorSha256": sha(Path(__file__).read_bytes()), "pillowVersion": pillow_version,
        "generatorModules": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in ("font_export.py", "audio_export.py", "c_source.py", "species_export.py", "moves_items_export.py", "gameplay_export.py")},
        "sourceFingerprint": source_lock["fingerprint"]["value"] if source_lock else None,
        "inputFingerprint": input_digest, "inputs": inputs, "outputs": sorted(emitted.values(), key=lambda row: row["path"]),
        "scope": list(contexts), "status": "renderer-preview",
    }
    prune_previous_outputs(output, emitted)
    put("manifests/content-manifest.json", manifest)
    return manifest


def check(output: Path, source_path: Path, source_lock: dict | None) -> dict:
    manifest_path = output / "manifests/content-manifest.json"
    require(manifest_path.is_file(), "Content missing; run content:build first")
    recorded = json.loads(manifest_path.read_text())
    for row in recorded["outputs"]:
        path = (output / row["path"]).resolve()
        require(path.is_relative_to(output.resolve()), "Manifest contains unsafe output path")
        require(path.is_file() and sha(path.read_bytes()) == row["sha256"], f"Content hash mismatch: {row['path']}")
    with tempfile.TemporaryDirectory(prefix="pokewaterblue-content-") as temporary:
        rebuilt = build(source_path, Path(temporary), source_lock)
        require(json_bytes(recorded) == json_bytes(rebuilt), "Content is stale or not reproducible against pinned inputs; run content:build")
    return {"status": "pass", "outputsVerified": len(recorded["outputs"]), "sourceInputs": len(recorded["inputs"]), "inputFingerprint": recorded["inputFingerprint"], "deterministicRebuild": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "check", "inventory"))
    parser.add_argument("--profile", choices=("firered-private",), default="firered-private")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "content/generated")
    args = parser.parse_args()
    lock_path = ROOT / "source-lock.json"
    source_lock = json.loads(lock_path.read_text(encoding="utf-8-sig")) if lock_path.is_file() else None
    source_path = args.source or (Path(source_lock["reference"]["localPath"]) if source_lock else ROOT.parent / "pokefirered-master")
    require(source_lock is not None or args.source is not None, "source-lock.json required; explicit --source allowed for converter fixtures only")
    if args.command == "check":
        print(json.dumps(check(args.output, source_path, source_lock), indent=2))
    else:
        manifest = build(source_path, args.output, source_lock)
        if args.command == "inventory":
            print((args.output / "manifests/inventory.json").read_text())
        else:
            print(json.dumps({"status": "built", "maps": len(manifest["scope"]), "outputs": len(manifest["outputs"]), "inputFingerprint": manifest["inputFingerprint"]}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ContentError, OSError, KeyError, ValueError) as error:
        print(f"Content import failed: {error}", file=sys.stderr)
        sys.exit(1)
