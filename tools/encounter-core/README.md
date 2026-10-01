# Private Route 1 encounter foundation

This tool implements the bounded `firered-route1-encounter-v1` factory using pinned
FireRed source C compiled to one private WASM module. It does not enable encounters
in the client or shared world, create a battle, admit an activity, or save a creature.
The existing four-move battle experiment remains a separate, unchanged artifact.

Run `npm.cmd run encounter:check` for the coordinated factory checks. To compile
only, run `.venv/Scripts/python.exe tools/encounter-core/build.py`. The existing
pinned local Zig compiler is reused; no reference-source write or Git command is
needed. Two independent extraction/build directories must produce identical WASM
and manifests. Output stays under `.local/encounter-core/{primary,rebuild}`; the
build evidence is `reports/encounter-core-build.json`. Nothing belongs in public
content or a browser bundle.

## Admitted source boundary

The policy is an on-foot Route 1 standard land check with the selected Squirtle
lead, Torrent, no held item, no egg, no Repel, no flute flags and no active roamer.
Walking and running have the same encounter arithmetic here. The caller supplies
the trainer's original ID and explicit RNG seeds; this factory does not invent
world entropy or advance RNG for rendering, input timing or unrelated field work.
The raw ABI accepts source metatile attributes: no-encounter type zero updates the
previous behavior, and land type one requires `MB_TALL_GRASS`. Water and other land
behaviors are rejected before execution. The host admits this policy explicitly;
there are no hidden defaults for unsupported modifiers.

Complete selected functions from `src/wild_encounter.c` own the cooldown, behavior
change gate, rate test, buff, slot and level selection. Source fieldmap extraction
masks/shifts are retained. The generated C twelve-slot Route 1 table is checked
against pinned `src/data/wild_encounters.json`, including its rate of 21. The source
cooldown uses six eligible steps with a five-percent early bypass, followed by the
sixty-percent gate when behavior changes. The wild-rate stream uses its own LCG;
failed rate rolls add 21 to the source `u16` buff, including its wrap. Successful
standard encounters clear the buff and cooldown. Even a fixed-level slot consumes
the source level-selection RNG draw.

The inactive-roamer adapter returns before any RNG draw, matching the excluded
source path. The fixed environment rejects unsupported requests at the host
boundary; it does not emulate another map, cycling, surfing, flutes, Repel,
Stench/Illuminate, Unown, fishing, Rock Smash, Sweet Scent, safari, legendary,
trainer, double, scripted, or roaming encounters. This is not the complete field
loop: movement eligibility, scripts, map entry/exit and the field's additional
counter-reset call sites are not connected. Direct `generate()` explicitly starts
at source slot/level selection, bypasses step eligibility and clears cooldown as a
factory encounter boundary. It preserves previous behavior.

The non-Unown generation branch calls complete extracted `CreateMonWithNature`,
`CreateMon`, `CreateBoxMon`, stat, nature, gender, ability and initial-moveset
routines from `src/pokemon.c`. Selected full species entries and learnsets, source
experience tables, nature modifiers and the three required move PP fields supply
their inputs. Generated Pidgey and Rattata have real personality, nature, original
trainer ID, six IVs, zero EVs, source stats/full HP, experience, friendship,
ability slot and ID, gender, legal moves/full PP, no status and no held item.
Source `SetWildMonHeldItem` is included as an explicit ordinary-battle introduction
projection: it consumes one RNG draw even when the species has no possible item.
Battle introduction callbacks, rendering, audio, game statistics, Pokédex updates
and subsequent battle RNG are outside this boundary. Do not run that held-item
operation again when a later battle adapter accepts this projection.

The projected Pokemon storage omits GBA encryption/checksums, display strings,
language and encounter display metadata. Those seams do not replace source stat
or creation arithmetic. A later captured-creature admission must add its durable
identity and met metadata; the factory result is private data, not an owned asset.

## RNG, portability and recovery

The main source LCG uses `1103515245 * state + 24691`; the wild-rate LCG uses
`1103515245 * state + 12345`, each with source 32-bit wrap and high-half output.
Both complete source function bodies run behind counted wrappers. Reset accepts
an explicit 32-bit main state and the source 16-bit wild seed; no reset draws occur.
Counters are unsigned 32-bit logical fields and fail at exhaustion rather than
wrapping. A trap can interrupt the private candidate instance; the host commits
only a successful candidate, preserving the accepted factory checkpoint.

The source `Random32()` macro has unspecified operand evaluation order and an
unsafe signed high-half shift under modern C. This adapter explicitly takes the
low-half draw first, then the high-half draw with an unsigned shift. The manifest
records this portability adaptation; fixtures bind the resulting deterministic
behavior. No original-ROM compiler/call-order equivalence is claimed.

ABI version 1 has 44 logical words, no pointers and no raw memory images. Core
words are version, main state, wild state, main draw count, wild draw count,
previous behavior, encounter-rate buff, cooldown steps, fixed ability modifier,
fixed held-item modifier, trainer ID and encounter serial. The remaining 32 words
contain the last creature projection. A no-encounter check retains that projection;
only a successful result returns it as a newly generated encounter. The host's
pending-encounter phase prevents further generation until explicit continuation.

`encounter_reset` and successful staged `encounter_import_commit` initialize the
module. Calls before initialization fail. Reset/import/set return zero on success;
step returns zero or one, direct generation returns one, and rejected calls return
negative values. Imports require every word exactly once, validate fixed policy,
source slot/species/level and trainer identity, then recompute creature fields
through source routines without RNG before assigning live state. Failed imports
preserve accepted logical state. Compatibility envelopes bind source, module and
host implementation hashes, validate both counted LCG states and retain pending
creatures without a reroll. Checkpoints are trusted private server data, not
authenticated client save files or a database transaction implementation.

## Remaining required work

The real-team battle adapter still needs Tail Whip, Sand-Attack, PP exhaustion and
Struggle, required abilities, Fight/Run/Bag behavior, Potion and Poké Ball,
capture/capacity rules, victory experience/EV and later level/move learning, and
loss/blackout. Encounter admission, partial choices, outcomes and asset effects
must use the character owner, lease fencing and durable transactions. Until that
closure is verified, Route 1 remains exploration-only in the live app.

The independent test oracle is test-only; it is not a second production mechanics
engine. The pinned-source manifests distinguish compiled complete functions,
selected fields/entries, noncompiled evidence, projected storage and environment
adaptations. Verification reports, rather than this README, record completed
checks and their exact results.
