# Private source evolution continuation

`firered-route1-evolution-v1` is a separate source-C/WASM continuation for the eight-species Squirtle, Pidgey and Rattata family closure. It preserves the six previous modules. It does not change battle admission, owned creatures, accounts or the database.

The host accepts a compatible progression checkpoint only at its pending-evolution boundary and retains its diagnostic origin. The current combat-v2 fixture cannot gain enough experience in one victory to evolve: the higher-level progression bridge and direct species inputs are explicitly private diagnostics. There is no newly playable evolved team.

On a clean private-output directory, build prerequisites in order:

```powershell
npm.cmd run battle:spike
npm.cmd run encounter:check
npm.cmd run battle:route1
npm.cmd run battle:progression
npm.cmd run battle:loss
npm.cmd run battle:capture
npm.cmd run battle:evolution
```

The final command builds twice, runs independent source literals and raw/host recovery checks, then checks integration with progression. The standalone build is `.venv/Scripts/python.exe tools/battle-evolution/build.py`. It writes `.local/battle-evolution/{primary,rebuild}/evolution.wasm`, private extracted source/codec/manifests and `reports/battle-evolution-build.json`. This README describes implementation boundaries; final gate results belong to the reports and project status.

## Source boundary

`src/battle_main.c:3861` and `TryEvolvePokemon` require a won battle and a raised-level party bit. The source clears that bit before starting the evolution scene. This supplement handles one supplied scene only: level-100 Squirtle becomes Wartortle, not Blastoise in the same scene. Complete `GetEvolutionTargetSpecies` from `src/pokemon.c:5025` and selected source item hold effects retain the normal Everstone gate. The extracted `src/data/pokemon/evolution.h` entries admit five level edges: Squirtle/Wartortle, Wartortle/Blastoise, Pidgey/Pidgeotto, Pidgeotto/Pidgeot and Rattata/Raticate. Below-threshold, final-species and Everstone inputs produce no eligible source target and fail admission explicitly.

The exact mechanical statements from `EVOSTATE_SET_MON_EVOLVED` in `src/evolution_scene.c:779` set species, calculate statistics, rename, set target dex seen/caught flags, then increment the evolution statistic. Complete source functions own these operations. Calculations use current EVs and preserve missing HP through the source maximum-HP delta; a fainted creature remains at zero HP. Input cached statistics are separately validated using the supplied calculated-EV basis, each value bounded by current EVs. Acceptance refreshes that basis; cancellation retains it.

`EvolutionRenameMon` compares the exact encoded English nickname with the old species name. Only an exact default-name match changes to the target species name. Case, spaces and custom names matter. The private codec comes from the pinned naming keyboard and one-byte charmap; names must be nonblank, at most ten source glyphs, and canonically EOS-padded. Unsupported Unicode and non-English language IDs are rejected. Canonical padding projects irrelevant unused string storage; it is not a source save-file representation.

The source preserves ability slot, personality, OT ID, XP, friendship, IVs, EVs, status, held item and existing move/PP fields. Ability ID is obtained from the resulting source species and preserved slot. Status is an opaque carried 32-bit field, not implemented status behavior. Ball/met metadata may remain explicitly unknown; this continuation never reads it for a mechanical effect.

## Decisions and learning

The host publishes `pending-evolution`, then an explicit accept or permitted cancel. Acceptance applies the evolved-state statements and runs the source current-level learning loop until it settles or requests a replacement. Complete `MonTryLearningNewMove`, `GiveMoveToMon`, `RemoveMonPPBonus` and `SetMonMoveSlot` retain source cursor semantics, duplicate handling, automatic learning into an empty slot, and replacement PP restoration/PP-Up removal. Declining advances past that particular offered move. It learns the new species' exact current-level moves, not all earlier moves.

Cancellation is deliberately not described as a universal no-op. In `EVOSTATE_TRY_LEARN_MOVE`, the source calls `MonTryLearningNewMove` **before** testing `tEvoWasStopped`. Cancellation therefore makes one first-call learning attempt for the original species, which can silently add a move to an empty slot. It does not offer replacement when full or continue to a second move. The current progression bridge already settled that level's original learning, but diagnostics preserve the source side effect.

Only source family level-up moves learned at or below the current level are admitted, including inherited ancestor moves. HM/TM inputs are rejected; the source HM replacement guard is retained, but active HM coverage is not claimed. Other evolution methods/families, foreign languages, held items other than None/Everstone, Pokerus, and unsupported metadata fail explicitly. All source family levels 1–100 are represented; this boundary introduces no level cap or suppressed move learning.

The final state is `pending-ownership-application`, with an evolved or cancelled result. No durable species mutation, dex/stat update, scripted continuation, battle re-entry, animation, audio, or renderer is executed. Evolution graphics use presentation RNG; these calls and frame waits are deliberately omitted. No admitted mechanical function draws RNG, and no original-ROM frame-timeline equivalence is claimed.

## Checkpoint and ABI

The module exports only fixed scalar functions and one nonshared 262,144-byte memory with no imports. ABI version one has 72 staged input words and 128 logical state words. State includes phase, pre/target species, choice/stopped flags, source learning cursor/first-call flag/pending move/last return, target dex mirrors, before/current evolution statistic, nickname and last event/decision slot, calculated-EV basis and the full 40-word creature projection. The source statistic saturates at `0xFFFFFF`. Dex context represents the target entry and its three seen mirrors; it is not a fabricated complete dex ledger.

Raw phases are 1 (evolution choice), 2 (learning continuation), 3 (move choice), and 4 (pending application). `choose(0|1)` means cancel/accept; `next()` performs one source learning call; `decide(0..3|4)` means replace slot/decline. Status zero means success, one invalid input, three wrong stage, and four no eligible target or an unsupported guarded operation. The host settles phase 2 and exposes only meaningful decision/application boundaries.

Input/import staging rejects missing, duplicate and out-of-range fields; duplicate/out-of-range setters poison that staging attempt. Raw import validates supported semantic boundaries and installs no partial accepted state on rejection. Raw logical words do not establish immutable historical provenance. The host binds original admission/context, source/module/codec/host/prerequisite hashes and accepted sequence-fenced decisions, replays into fresh isolated memory, and compares all 128 words. A hash is a compatibility/corruption check, not ownership authentication. Raw ABI memory is private and is not a client-authorized save format.

Every compiled source function/table fragment has its pinned path, offsets and hash in the extraction manifest. All actual source input bytes are checked against the no-Git snapshot manifest. The reference remains read-only, and the upstream revision remains honestly unknown. Extraction documents scalar-storage, scene scheduling, naming padding and presentation omissions rather than claiming an emulator or complete source engine.
