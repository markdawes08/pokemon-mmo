# Bounded FireRed source converter

This bounded pass exports **Pallet Town, Player's House 1F and Route 1** for the
local renderer preview. No imported area is counted as verified gameplay.
The reference folder is read-only. `source-lock.json` supplies its location and
snapshot fingerprint; every input is checked against the pinned source manifest.
There is no original ROM dependency or runtime emulation.

From the project root in PowerShell:

```powershell
py -3 -m venv .venv
.venv/Scripts/python.exe -m pip install -r tools/content-import/requirements.txt
.venv/Scripts/python.exe tools/content-import/import_content.py build --profile firered-private
.venv/Scripts/python.exe tools/content-import/import_content.py check
.venv/Scripts/python.exe -m unittest discover -s tools/content-import -p test_*.py -v
```

The `inventory` command rebuilds and prints the bounded coverage inventory. The
root npm commands wrap these operations. Output is `content/generated/`; only
its `client/` subdirectory may be served to browsers at `/content/`.

Conversion preserves little-endian map blocks, 32-bit FireRed attributes, primary
and secondary tile/metatile indexing, palettes, palette-index-zero transparency,
component flips, and all three metatile layer types. Indexed source PNGs supply
4bpp tile indices; `.pal` colors pass through gbagfx's 8-to-5-to-8-bit conversion.
Existing generated `.4bpp` and `.gbapal` files are not assumed current. Layer
assignment matches `field_camera.c:DrawMetatile`, including normal-layer BG3's
`0x3014` fill. The player PNG has the intended palette and eighteen 16-by-32
frames. The first nine come from `red_normal.png`; the final nine come from source
frames 3 through 11 of `red_surf_run.png`, matching `sPicTable_RedNormal`.
Idle/walk/run commands are parsed from the source animation table. The run cycle
uses durations 5, 3, 5, 3 and source frame ids 9 through 17.

The version-5 `WorldMap` and `WorldManifest` Zod schemas are in
`packages/content-schema`. `/content/world.json` lists the three public map URLs,
their identities and display names, with Pallet Town as the preview start map.
Its `fieldGuide` URL points to the separate version-1 public gameplay reference.
Each map preserves its source map type and zero-based warp array indices. A warp's
`destinationAvailable` means its destination map is in this bounded export;
`destination` contains the exact destination warp coordinates, not an adjusted
landing tile. Unavailable destinations retain their source identifiers and have
`destination: null`. Connection offsets and inverse selected connections are
validated. Unsupported destination maps remain explicit in the private inventory.

Images in `layers`
retain bottom, middle, and top strata. Flower components are removed from static
layers and rendered in one of five animation overlay images at that same layer
depth. Source flower timing is 16 source frames per image, with its callback phase
at timer modulo 16 equal to 2. Flower overlays only apply to the General tileset;
the interior uses Building and GenericBuilding1 with no animation callbacks.
All layer images are full map size. `border.layers` supplies the separate source
border pattern at its actual dimensions. An elevation-3
player renders after middle and before top; elevation-dependent priorities beyond
this preview need the original subsprite/elevation behavior implemented.

The Pallet house door has three opaque 16-by-16 source frames in `doors`, using
palette bank 8 and the source metatile identifier 0x2A3. Each animation frame lasts
five source ticks: `AnimateDoorFrame` compares the timer with duration 4 before
incrementing it. The original closed image remains in the static map layers.

Five visible NPCs use source graphics pointers, palette tags and picture tables.
The exported nine-frame sheets preserve picture aliases (Mom has three physical
images reused by nine frame entries). Initial directions come from the source
movement-type facing table. Native wandering is inventoried and deferred; the
preview presents stationary actors. Local ids are one-based source object-array
indices, as emitted by `tools/mapjson/mapjson.cpp`.

Initial visibility is a bounded source fixture, not a story session: new-game
initialization clears flags and variables, then hides Oak in Pallet Town. The
zero-state Pallet transition places the sign lady at (5,15), facing north.
Private per-map manifests record original coordinates, effective preview poses,
flags, scripts and the source chain. Public actors expose visibility and a reason,
without flag or script operands. Unknown required visibility fails conversion.

Only complete two-command `msgbox ..., MSGBOX_NPC|MSGBOX_SIGN` / `end` scripts
are accepted as dialogue. The resident, Route 1 boy, town sign, route sign and
two house signs supply six interactions. Stateful scripts retain unavailable
results with no extracted partial message: no healing, Potion reward, fame-checker
updates, gender branches or flag changes are implied. Text fragments are decoded
as UTF-8, preserve line/page controls and reject unknown escapes or variables.
`world.previewNames` declares RED/BLUE substitutions for the house signs.

`font_export.py` converts the canonical normal Latin indexed PNG using the source
charmap, width table, 14-pixel glyph height and neutral message palette. The
dialogue atlas and JSON retain glyph codes, rectangles and advances; line height
is 15 and English adds no letter spacing. Font background indices 0 and 3 are
transparent. All supported pages are checked for missing glyphs at conversion
and loading. Source palette/width/pixel fixtures include the accented é glyph
and descenders. Gender-specific fonts, native scrolling and text effects remain
outside this neutral, instant-display renderer.

`audio_export.py` converts the pinned MPlay streams for MUS_PALLET and SE_SELECT,
resolves their voice groups/key splits, and exports canonical WAV samples with
source tuning/loop metadata. It accepts the required note, wait, control and
loop commands explicitly; unsupported commands/voices fail. The browser uses
Web Audio samples and pulse oscillators with bounded scheduling. Sample
resampling, envelopes, stereo pan and PSG behavior approximate the GBA mixer;
reverb and channel stealing are not implemented. This prototype does not require
a ROM, emulator or third-party audio converter. Town and house source music IDs
select Pallet; the unexported Route 1 track remains silent. Mute, volume, user
gesture and focus lifecycle belong to the browser controller.

`c_source.py`, `species_export.py`, `moves_items_export.py` and
`gameplay_export.py` add bounded structured definitions. The fifth-pass manifest
currently records 148 pinned inputs and 75 outputs. The source fingerprint and
English FireRed revision-0 selection remain unchanged. The parser keeps source
symbols, designated fields and array order, selects explicit build branches, and
fails on unresolved required constants, unsupported required syntax, malformed
rows or missing dependencies. Includes are never followed implicitly. Token-level
macro expansion preserves C precedence; integer division/remainder truncate toward
zero, and fractional constants retain exact precision until an explicit integer
conversion. This preserves the starter gender threshold of 31 from
`PERCENT_FEMALE(12.5)` without treating the parser as a general C compiler.

The selected closure contains 14 species: all three starter evolution families,
Pidgey's family and Rattata's family. It preserves complete level-up learnsets
and evolution references for those species, including same-level move ordering
and repeated learned moves. Their 44 move definitions retain source power,
accuracy, PP, effects, targets, priorities and flags. Five private item records
cover `ITEM_NONE`, Poke Ball, Potion, Oran Berry and Sitrus Berry; seven private
ability records include `ABILITY_NONE`. Items use canonical `items.json`, with
67 identical unused slots recorded separately from the 308 defined item records.
Potion and the two berries retain their zero-filled source effect-byte arrays;
function and effect identifiers remain unimplemented bindings.

`content/generated/server/gameplay.json` is version 1 and explicitly marked
`definitions-only`. It also contains two complete 101-entry growth tables,
18 source types, 110 type relationships and the 12 Route 1 FireRed land encounter
slots. Type relationships retain the Foresight section as `ignoreWhenForesight`,
including the Normal/Fighting immunities against Ghost. The source encounter
rate is 21; this is an engine input, not a 21% chance per step. Public encounter
shares summarize slot weights: Pidgey 50% at levels 2-5 and Rattata 50% at levels
2-4. No encounter selection, capture, growth, item use or battle effect executes.

Only the explicit whitelist in `public_projection` reaches
`content/generated/client/field-guide.json`. Its version-1 schema exposes source
reference values and descriptions, with four displayed items and six abilities
after filtering the `NONE` sentinels. Function/effect bindings, flags, raw
encounter slots/rates and operational type relationships stay private. The
browser's read-only Field guide shows species stats, abilities, level-up moves,
evolutions, total experience at a selected level, encounter shares and items.
It does not create a party, inventory or seed profile. `gameplay-server.ts`
validates the private definition contract and is absent from the public package
entry point; `gameplay.ts` validates the browser projection independently.

Focused fifth-pass checks passed: ten parser/species fixtures, eight move/item
fixtures and ten private-schema tests, plus focused lint/typecheck for that
schema. They cover source values, ID/symbol references, dimensions and ranges,
evolution cycles, growth monotonicity, encounter weights, medicine bytes and
Foresight semantics. The full fifth-pass eight-stage gate passed, with 63 Vitest and 49 Python tests,
deterministic rebuilding and all 25 development-browser scenarios. All 25 also
passed on built serving; the isolated server shut down gracefully and released
its listener. The limited 73-file client inspection passed. TM/HM, egg/tutor moves, trainer parties, shops,
breeding, other areas/methods and full R1 dependency closure remain outside this
first definition export.

Coverage excludes general script execution, dynamic story edits, field effects,
remaining fonts/audio and executable encounters/battles. Water/current
and shoreline animation callbacks are inventoried but frozen at base tiles.
Tall grass, encounter attributes, stair arrows and ledges retain their numeric
source behaviors and names; exporting these values does not implement encounters,
story progression or a complete traversal engine. Transfer rendering and the pure
movement preview rules are maintained by the client/shared package. Movement is a
client preview with no game authority or persistence.

Verified movement presentation evidence: `event_object_movement.c` defines normal
walking as sixteen `Step1` calls in `sSpeedNormalStepFuncs`, and `sStepTimes` uses
that array's length. Each call moves one pixel, producing a sixteen-frame tile
step. Sprite initialization adds 8 to the map pixel x coordinate and
`16 - height/2` to its center y coordinate. For the 16-by-32 player this is
equivalent to a bottom-center origin positioned at `(tileX*16+8, tileY*16+16)`.
The source collision code blocks nonzero collision bits and has elevation
exceptions for 0 and 15; the shared movement preview documents its bounded
source-derived terrain and transfer rules separately.

`content:check` verifies output hashes and rebuilds into an isolated temporary
directory, requiring a byte-identical manifest. The manifest hashes the font,
audio, C parser, species, move/item and gameplay exporter modules in addition to
its main entrypoint.
Unit fixtures independently
exercise 32-bit masks, nibble order, flips/palettes/transparency, and three-layer
placement; source landmark fixtures record exact inspected map byte offsets and
door labels. Three-area fixtures verify exact binary landmarks, warp indices,
available/unavailable references, border dimensions, grass/ledge behaviors,
opaque door frames, malformed topology rejection and deterministic rebuilding.
Additional fixtures compare player running and aliased NPC frame pixels directly
against source PNGs/palettes, check exact Unicode dialogue, and reject partial
stateful-message extraction or malformed public actor references.
A generated visual is useful for inspection but is not claimed to
be a reference-game screenshot or proof of full fidelity.

After a successful export, only obsolete files listed in the previous converter
manifest are removed. Untracked files are preserved; edited obsolete files and
unsafe/redirected paths cause an explicit failure instead of deletion. No output
directory is recursively deleted.
