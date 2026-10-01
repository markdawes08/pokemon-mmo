# Private source loss continuation

`firered-route1-loss-v1` is a separate, server-private C/WASM continuation for the existing Route 1 battle profile's lost and draw outcomes. It preserves the synthetic battle, encounter, real-team singles-v2, and progression-v1 modules. It does not change an account, persist a wallet or party, load a map, acknowledge a field encounter, or make a healed party eligible for another live battle.

Run `npm run battle:loss` after the prerequisite private modules exist. From clean private outputs, run `npm run battle:spike`, `npm run encounter:check`, `npm run battle:route1`, `npm run battle:progression`, then `npm run battle:loss`. The full verification command orders these prerequisites. `build.py` alone performs two independent compilations and requires identical extraction manifests and WASM bytes; the verifiers supply independent source fixtures and actual-battle integration evidence.

The build uses the existing pinned Zig receipt, source snapshot fingerprint, and per-input SHA256 checks. Outputs remain under `.local/battle-loss/{primary,rebuild}`; the build report is `reports/battle-loss-build.json`. The fixed memory is 262,144 bytes, with no imported WASM functions. The source repository is only read.

## Scope and source order

The actual bridge requires a fully restored singles-v2 lost/draw terminal, directly or through the progression supplement's `pending-loss` result, plus an explicit `r1-pallet-mom-blackout-v1` development context. This named context selects the source Pallet last-heal tuple `(group3,num0,warp-1,x6,y8)`, zero badges, and a supplied wallet from zero through the fixture's 3,000. It is not evidence of any account's previous healing location, flags, or current money. The caller must deliberately request this context; no existing user state is read or reset.

The two accepted transitions are:

1. `ready` → `faint-applied`: complete source `AdjustFriendshipOnBattleFaint` calls complete `AdjustFriendship`. Existing singles-v2 combat deliberately stops before this friendship effect. In singles, the source uses the opposite left battler's level, including self-recoil and simultaneous fainting. A greater-than-29 level gap selects the large penalty; the admitted canonical Squirtle5 versus Route1 opponent loses one friendship point, clamped at zero. Negative deltas do not read ball/met-location context and consume no RNG.
2. `faint-applied` → `pending-world-application`: the source mechanical sequence from `CB2_WhiteOut` clears the Safari flag, calls complete `DoWhiteOut`, then uses complete `SetInitialPlayerAvatarStateWithDirection(DIR_NORTH)`. `DoWhiteOut` resets the source Elite Four state, debits the source money loss, heals the party, resets the specified field state, and selects the respawn and healer. Its `WarpIntoMap` service records the pending external application. No map loading occurs.

`ComputeWhiteOutMoneyLoss`, its badge counter and source multiplier table, `GetPlayerPartyHighestLevel`, and `GetMoney`/`SetMoney`/`RemoveMoney` are compiled from the pinned source. A loss preview is available at stage zero; only `DoWhiteOut` debits it. For level5, zero badges, and wallet3,000, the preview is40 and final wallet2,960. This is the source FireRed badge-scaled loss, not a generic half-wallet rule. Projected money uses a fixed zero encryption key; these scalar words are not a source encrypted save format.

Complete `HealPlayerParty` restores HP to the cached maximum, restores each move's PP using complete `CalculatePPWithBonus`, and clears all32 status bits. It preserves identity, XP, EVs, cached stats, moves, PP Ups, and the adjusted friendship. No stat recalculation occurs during healing. Admission validates cached stats against an explicit six-EV calculation basis, which may precede the current EVs; this retains the progression supplement's delayed stat refresh behavior.

The finite `EventScript_ResetEliteFourEnd` call and its callee are extracted as an exact operation list: five defeated Elite Four/champion flags, six champion trainer flags, and the league scene variable. Unknown operations fail extraction. This is not a general script interpreter. Complete `Overworld_ResetStateAfterWhitingOut` clears its six field flags and three scene/entrance variables and resets the avatar. Complete `ResetSafariZoneFlag` contains only the flag clear; the separate Safari exit/counter reset path is not called by this source sequence. Final avatar state is on foot, facing north, with direction set.

Complete source heal-location functions and all20 source heal/center/healer table rows select the destination. Admission accepts a canonical row ID and constructs its entire source last-heal tuple, rejecting unknown rows before the unpatched source's potentially out-of-bounds indexing. Trainer Tower's separate scene override is explicitly unsupported. Pallet selects the player's house1F `(group4,num0,warp-1,x8,y5)` and Mom localID1. Diagnostics support the other19 canonical rows; they do not assert these maps have been imported into the playable world.

The complete source comparison of all five last-heal fields selects the home/center arrival. The pending home entry is `EventScript_AfterWhiteOutMomHeal`. Both nurse variants enter `EventScript_AfterWhiteOutHeal`, with the source Brock flag selecting its pre-Brock or ordinary message subscript. These scripts, dialogue, NPC movements, fanfare, fade, control locking, and their repeated healing calls remain pending. The output never claims those scripts or `WarpIntoMap`/`DoMapLoadLoop` have run in a world.

## Raw ABI and recovery

ABI/checkpoint version1 uses64 input words and96 state words. The strict TypeScript host creates fresh private memory for each candidate transition, validates the entire result, and only then replaces its accepted state. Its sequence fence rejects duplicate advancement. Checkpoints bind the source/module/host/prerequisite/map compatibility and immutable admission/context; restore replays source stages and compares all96 words. Integrity hashes detect corruption, not ownership or permission to apply future durable effects.

Raw initialization uses `loss_input_begin`,64 unique `loss_input_set` calls, then `loss_start`. `loss_advance()` accepts only initialized stages0 and1. Raw restoration uses `loss_import_begin`,96 unique `loss_import_set` calls, then `loss_import_commit`. Duplicate/out-of-range staging poisons that staging attempt. Rejected initialization/import leaves accepted runtime state intact. Import reconstructs a valid pre-effect state, replays the source transitions and compares every word. Stage2 necessarily erases original PP/status/reset-flag values; only the stricter host's immutable admission replay proves that history. Raw semantic validation alone is not such a historical proof.

The mon block has40 words: species, personality, OT ID, XP, level, friendship, HP, six cached stats, six IVs, six current EVs, four moves, four current PP values, packed PP Ups, ball, met location, status, held item, Pokérus, and ability slot. Supported diagnostics retain Squirtle/species7, personality25, OT1, all IV15, no held item/Pokérus, and Torrent slot0. They may span levels1–100, source-legal learned moves, valid EV/stat bases, all PP Ups, and any status word to exercise healing. They require HP0. Broader species, parties, eggs, trainer/tower losses, item modifiers, or a new battle admission are unsupported.

| Input words | Meaning |
| --- | --- |
| 0–39 | Mon block |
| 40–45 | Cached-stat EV calculation basis |
| 46–50 | Money, badge mask, canonical heal row1–20, opposing level, outcome2/3 |
| 51–54 | Six field flag bits and three field variables |
| 55–57 | Five Elite Four flag bits, six champion trainer bits, league variable |
| 58–63 | Avatar flags/direction/direction-set, Brock flag, Tower scene0, reserved0 |

| State words | Meaning |
| --- | --- |
| 0–8 | Version, stage, money-before/current/preview, badges, heal row, opposing level, outcome |
| 9–20 | Field/league context, avatar and Brock/Tower fields |
| 21–27 | Healer, pending arrival kind, destination tuple; zero until stage2 |
| 28–35 | Canonical last-heal tuple, friendship-before/loss, initialized flag |
| 36–47 | Six cached-stat EV basis words, six reserved zeros |
| 48–87 | Mon block |
| 88–95 | Reserved zeros |

`loss_context_count(kind)` and `loss_context_id(kind,index)` expose source IDs for badges, field flags, field variables, Elite Four flags, champion trainers, and the league variable (kinds0–5). `loss_heal_get(id,field)` exposes the source tuple in group/number/warp/x/y order. `loss_get` fields0–5 are stage, preview loss, current money, friendship loss, arrival kind and healer. All quantities use explicit unsigned words; signed warp-1 is transported as `0xffffffff`.

## Evidence and remaining work

The extraction manifest records exact input hashes, selected source ranges and declared transformations. Key evidence is `battle_script_commands.c`/`battle_util2.c` for fainting, `pokemon.c` for friendship/stats/PP/highest level, `script_pokemon_util.c` for healing, `overworld.c`/`money.c` for whiteout, `heal_location.c` and its data tables for respawn, `field_screen_effect.c` for the arrival comparison, and the Hall of Fame/whiteout/nurse scripts for resets and pending presentation.

Source player-faint statistics, battle text bookkeeping, quest-log recording, field callbacks, frame/audio effects, save-file encoding, map application, arrival scripts and durable deduplication are outside this module. None is claimed as completed or needed by the admitted scalar continuation's later calculations. There are no admitted RNG draws; unsupported random or positive-friendship metadata services trap. The next integration must apply one compatible pending result atomically to server-owned state, validate world content and activity ownership, run the supported arrival continuation, and expand battle admission before allowing another battle. The current result does none of those operations.
