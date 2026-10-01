# Private source capture continuation

`firered-route1-capture-v1` completes the bounded mechanical continuation of an existing singles-v2 successful Poke Ball throw. It is a separate private source-C/WASM module. The five earlier battle, encounter, progression and loss artifacts remain unchanged. The result is a proposed owned record and party/storage destination, marked `pending-ownership-application`; no database row, account state, bag, dex, room, or field activity is mutated.

`npm.cmd run battle:capture` builds the module twice independently, checks source literals/recovery, and exercises the actual captured-battle bridge. Its prerequisite private outputs come from `battle:spike`, `encounter:check`, `battle:route1`, `battle:progression` and `battle:loss`. The full verification command orders these and all retained gates. `build.py` alone compiles the new supplement and requires identical extraction manifests and WASM hashes.

The compiler receipt, source fingerprint and every source input hash are checked. Private outputs are `.local/battle-capture/{primary,rebuild}/capture.wasm`; evidence is `reports/battle-capture-*.json`. Memory is fixed at262,144 bytes and the module imports no host functions. `codec.json` is derived from the actual English naming keyboard and pinned charmap. Its exact bytes are hashed in the build report and host compatibility.

## Admission and source sequence

The strict bridge restores a compatible singles-v2 `captured` terminal, directly or through progression's pending capture, and validates the derived pending-disposition descriptor. It preserves the generated Pidgey/Rattata identity, IVs, nature, ability, gender, experience, friendship, current HP/PP and spent bag. It does not rerun creature generation, the throw, or any RNG.

The caller must supply the explicit named development acquisition context: source-encoded trainer name and gender, original trainer ID matching the encounter, prior coherent dex state and capture statistic, and the single occupied party slot with empty boxes. Game4/FireRed, language2/English, Poke Ball4, Route1 met location and the encountered met level come from the pinned source policy. This is not an inference about an existing account's metadata. The source trainer ID is not a database ownership identity.

Private diagnostics admit the same Route1 species/levels and exact source initial moves/stats, arbitrary legal generated IVs/personality, depleted living HP/PP, zero EV/status/held item/Pokérus/PP Ups, and explicit six-slot party and fourteen-by-thirty box occupancy. They test placement without authorizing a larger combat party. Other species, levels, capture items, languages, transferred metadata, status mechanics and resulting-team combat remain unsupported.

There are four stable stages:

1. `ready`: validated capture and capacity context, with source default metadata and species nickname. The encounter factory intentionally omitted these nonrandom `CreateBoxMon` fields; this module applies that exact source statement block using the explicit context. Existing numerical identity is validated before those assignments.
2. `pending-nickname`: execute the previously omitted ordinary-wild battle-entry seen effect, then the success script's capture statistic and caught flag. This deferred ordering is explicit. Source `HandleSetPokedexFlag`, `GetSetPokedexFlag`/`DexScreen_GetSetPokedexFlag`, and `IncrementGameStat`/`GetGameStat`/`SetGameStat` run against projected source storage. The three seen mirrors stay coherent; a previously caught species skips the new-dex marker. The capture statistic saturates at `0xffffff`. Dex display, sound and frame waits are omitted.
3. `nickname-applied`: accept an explicit keep or rename decision. Complete source `SaveInputText` owns the blank-input rule. When the party is full, accepting the naming screen also runs complete `IsDestinationBoxFull` before placement, retaining its source last-box/flag/scratch changes and visible message variant. Declining does not run that naming preflight. A blank accepted name still follows the accepted naming path.
4. `pending-ownership-application`: complete source `GiveMonToPlayer` sets OT name, gender and ID, then either copies to the first empty party slot or calls complete `SendMonToPC`. The source post-Give box-message predicate still runs after an accepted naming preflight even though that later message is not printed. The output retains the visible preflight message when applicable. The original combat outcome was settled earlier by ADR-016's explicit adaptation; it is not recomputed here.

No admitted continuation step consumes RNG. The encounter and battle RNG checkpoints remain unchanged. Deferred seen registration here covers captured terminals only; wins, losses, draws and escapes still need source entry-seen bookkeeping when live battle admission is implemented. Source capture-attempt statistics already omitted by the bounded combat profile, unrelated game statistics, full battle-result bookkeeping, dex/naming presentation and source encrypted save encoding are not claimed as implemented by this supplement.

## Names and metadata

The source naming screen admits at most ten encoded nickname characters; the trainer name has seven. The codec supports the exact selected keyboard's letters, digits, spaces and symbols, including its gender and quote glyphs. Unsupported characters, embedded terminators/control codes, excessive length and malformed padding reject explicitly. There is no Unicode truncation or silent substitution.

Complete `SaveInputText` scans the whole buffer for a non-space/non-EOS character. If none exists, the existing species nickname remains. Otherwise it copies the entire fixed buffer, preserving leading and trailing spaces; the source comment does not imply trimming. Keep/decline also preserves the species nickname. Source strings are transported with canonical EOS padding after the first terminator. This deliberately excludes irrelevant uninitialized source-local suffix bytes while preserving every meaningful encoded character.

Metadata comes from `CreateBoxMon`'s nonrandom assignments in `src/pokemon.c`: source species name, language, trainer name, species/initial experience/friendship, current map section, met level/game, default Poke Ball and trainer gender. `GiveMonToPlayer` applies the same explicit current trainer identity at placement. The caught Poke Ball is already known from the validated descriptor. Mail remains the source `MAIL_NONE`. No synthetic trainer name, new random identity or unrecorded met location is substituted.

## Capacity and party/storage semantics

Complete source `IsPlayerPartyAndPokemonStorageFull` and `IsPokemonStorageFull` check capacity before any continuation effect. In the original game, `BattleUseFunc_PokeBallEtc` performs this check before removing the ball or accepting the throw. The current one-party-member combat profile always had room. The continuation rejects an impossible all-full successful-capture context before dex/stat/nickname/ownership effects; it does not invent a postcapture release, replacement or box-selection prompt.

Source party placement scans the six species slots for the first empty one, copies the full runtime creature, and sets party count to that slot plus one. HP, status and current PP are preserved. Diagnostics can expose holes to verify the source first-empty behavior; the strict actual bridge uses the canonical packed one-member party and proposes zero-based slot1, the second slot.

With a full party, source `SendMonToPC` starts at `StorageGetCurrentBox()`, scans slots0–29, advances through all fourteen boxes and wraps to box0. It does **not** start at `VAR_PC_BOX_TO_SEND_MON`. On success it restores PP using complete `MonRestorePP`/`BoxMonRestorePP` and `CalculatePPWithBonus`, copies only `BoxPokemon`, records destination box/position, and updates the last-send variable and box-full-message flag. The current box itself stays unchanged. Occupied slots are opaque markers used only for the source species-presence checks; their identities are neither invented nor overwritten.

A boxed record contains source box metadata, personality/OT/IV/EV/experience/friendship, moves and restored PP. It has no stored party level, current HP, status or cached stats. The retained private battle creature is not misrepresented as boxed runtime state. Source `BoxMonToMon` later clears status/HP/maxHP, sets mail and calculates stats when reconstructing a party creature; withdrawal is outside this continuation. No full-heal-on-capture claim is made for party placement or a stored box record.

The source naming preflight and post-Give path can produce different scratch/last-box states even for the same final destination. Both are retained. Source PC message variants distinguish Someone's/Bill's PC and the box-full message. Names of boxes, string formatting and actual display remain presentation work. Source zero-based slot indices are not silently treated as the database's one-based slot indices; future durable application must perform that explicit mapping.

## ABI and recovery

ABI/checkpoint version1 has80 input words and160 state words. `capture_input_begin`, unique `capture_input_set` calls and `capture_start` initialize an instance. `capture_advance` accepts stages0 and2 only. At stage1, `capture_decide(0)` keeps the name; `capture_name_begin`, eleven unique `capture_name_set` byte calls and `capture_decide(1)` submit an encoded name. Duplicate/out-of-range staging poisons the staging attempt. Return codes are0 success,1 invalid,3 wrong stage, and4 full capacity at admission.

`capture_capacity()` checks a complete valid input staging buffer before initialization (or the current initialized context without staging); it returns0 for room,1 for full, or-1 for invalid/incomplete state. It leaves accepted state unchanged. This supports the source prethrow predicate without publishing effects.

| Input words | Meaning |
| --- | --- |
| 0–39 | Shared numeric mon block: identity, XP/level/friendship, HP/stats, IVs/EVs, moves/PP, ball/met/status and item/ability fields |
| 40–48 | Trainer gender and eight source name bytes including EOS |
| 49–56 | Prior seen/caught, capture count, party mask, current box, last-send box, shown-full and Bill-PC flags |
| 57–70 | Fourteen thirty-bit box occupancy masks |
| 71–79 | Reserved zeros |

| State words | Meaning |
| --- | --- |
| 0–10 | Version/stage/initialized, trainer gender, prior/current dex bits, prior/current count and new-dex marker |
| 11–18 | Prior/current party mask, party count, current/last box and source message flags/scratch |
| 19–25 | Placement, party/box destination, source give result, nickname choice and visible PC message |
| 26–31 | Reserved, two seen mirrors, reserved, pending-ownership marker, reserved |
| 32–45 | Current box occupancy masks |
| 46–69 | OT name, nickname, met level/game/language/gender and mail |
| 70–79 | Reserved zeros |
| 80–119 | Current private mon block |
| 120–159 | Reserved zeros |

Pending placement indices/give result use `0xffffffff`; placement kind is0 pending,1 party or2 box. Nickname choice is0 pending,1 keep or2 rename. Visible message is0 none,1 Someone's PC,2 Bill's PC,3 Someone's box-full,4 Bill's box-full. Raw identity getters use complete source nature, ability and gender functions. Constants expose the source Route1 section, language, game, ball and box dimensions.

Raw import stages all160 words and replays the finite source continuation before acceptance. It checks every word and preserves accepted runtime **and existing nickname staging** on rejection. Source placement can erase prior depleted PP, last-send preferences and message flags; raw validation proves a compatible semantic preimage, not exact historical lineage. The strict host additionally replays immutable captured-terminal/context admission and the precise nickname decision, then compares all160 words. It retains compatibility hashes for the source, module, host, codec and prerequisites. Integrity hashes are not authentication or permanent outcome deduplication.

Host transitions run on isolated candidate memory, bind the expected sequence and decision identity, and publish only after complete validation. Checkpoints and owner projections are detached. The final descriptor remains private and pending: future work must atomically validate durable owner/capacity/activity state, allocate exactly one owned asset and destination, apply outstanding dex/stat/item effects once, and finish the parent battle/field continuation. This module does not enable live captures, PC access, trade or resulting-team battles.
