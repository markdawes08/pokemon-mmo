# Private Route 1 real-team battle profile

`firered-route1-singles-v2` extends the decided source C/WASM command engine for
one level-five fixture Squirtle against an actual pending Route 1 Pidgey or
Rattata. The existing six-method battle adapter owns compatibility, accepted
choices, candidate transitions and viewer projections. This private profile has
no room, browser, live grass, account-write or database entry point. Outcomes
produce zero persistent effects. Potion changes only private battle HP; a caught
opponent becomes a private pending disposition rather than an owned creature.
No durable bag, party, dex or trainer record changes. The encounter factory
retains its pending encounter independently.

Run `npm.cmd run battle:route1` for the coordinated profile checks. Compile alone
with `.venv/Scripts/python.exe tools/battle-route1/build.py`. The output is private:
`.local/battle-route1/{primary,rebuild}/route1.wasm`, with build evidence in
`reports/battle-route1-build.json`. Both independent extractions and builds must
match. The source repository remains read-only, each consumed file is checked
against the accepted snapshot, and the existing pinned Zig toolchain is reused.

## Shared engine and admission

`tools/battle-spike` remains the common numerical extraction and C adapter.
`WATERBLUE_ROUTE1` adds a separately compiled profile's identity, stat-command,
Struggle, wild-choice, escape, Potion/Poke Ball and checkpoint admission. The synthetic build uses
the original branches. This does not introduce a second production arithmetic
engine. The real-profile extractor supplements the same source functions and
records its additional selected branches; the encounter module is unchanged.

The host admits the exact `r1-squirtle-v1` species, personality, OT ID, IV/EV,
nature, level, ability, stats and initial moves, allowing current HP and PP to be
depleted within source limits. Its opponent must be a compatible pending factory
checkpoint, including the actual generated identity, source stats and legal
initial moves. Admission cannot accept a caller-selected replacement species,
invented stats, altered IVs or ability zero. Both actors are alive initially,
unstatused, untraded, without held items, and have no badges, weather or volatile
effects. There is exactly one creature per side and no switching command.
The private bag admits zero through five Potions and zero through five Poke
Balls, bounded by the canonical fixture. A fresh fixture builder supplies five
of each; depleted admission is explicit. Consumption occurs once in an isolated
accepted candidate. Unknown items, empty counts and no-effect Potion choices
are rejected before action scheduling or an RNG draw.

Squirtle keeps Torrent; Pidgey keeps Keen Eye; Rattata keeps Run Away or Guts.
These identities are real even where an effect is dormant in this initial
matchup. Full general ability support is not claimed. The private raw command
surface retains Water Gun and poison/burn diagnostic states to exercise selected
source arithmetic. Water Gun, arbitrary enemy depletion and diagnostic status
changes are rejected by the strict real-team host admission and are not new
level-five gameplay capabilities.
The real-team fixture gate verifies dormant ability identities; it does not
claim golden coverage of active Torrent, Keen Eye, Run Away or Guts branches.

## Source behavior

The shared complete source damage, accuracy, PP, critical, type and HP command
functions remain authoritative. Complete `ChangeStatBuffs` and
`Cmd_statbuffchange` execute Tail Whip and Sand-Attack, including source stage
limits and failure flags. The source scripts determine accuracy-before-PP and
the stat command sequence; presentation waits and text are transported as
diagnostic events rather than run through a full GBA script interpreter.

Complete `CheckMoveLimitations` and `AreAllMovesUnusable` decide forced Struggle.
Struggle is never inserted into the actor's legal move slots. The source attack
path skips PP deduction, retains accuracy-stage checks and critical/variance
draws, omits STAB/type effectiveness, and executes its certain recoil effect.
The retained source secondary-effect guards and complete quarter-recoil case
compute recoil from actual HP removed, with a minimum of one. Recoil damage and
attacker faint processing precede target faint processing. A missed Struggle
does not recoil. Unlike Tackle, its certain effect bypasses the secondary-chance
RNG draw.

Wild selection retains the original controller's `Random() & 3` loop until a
nonempty move slot is chosen. When that slot has no PP, the source selection
rejection returns to the chooser; the headless scheduler repeats that sequence.
It does not choose uniformly from a filtered usable list. All moves unusable
forces Struggle before the chooser and consumes no chooser draw. The accepted
hidden wild slot is saved before exposing a player choice, and restore does not
reroll it.

Complete source `TryRunFromBattle` owns escape arithmetic and the `u8` attempt
counter, including its wrap and the source `u8` speed threshold. Wild choice
still occurs before player Run resolves. The source singles action partition
puts Run first without an action speed-tie draw. Failure allows the already
selected wild action to execute; success ends the private battle immediately.

## Potion and Poke Ball boundary

`item_extract.py` pins the Potion effect table from
`src/data/pokemon/item_effects.h`, the non-revive living guard and complete HP
amount/update suffix of `PokemonUseItemEffects` in `src/pokemon.c`. The wrapper
admits only in-battle player Potion on its active living creature below max HP.
The source table supplies 20; the source branch adds and clamps the restoration,
updates projected party HP and battler HP, and transports the controller update.
Revive, AI item use and alternate recovery amounts are not admitted. Full or
zero HP causes no accepted item action, item consumption or RNG draw.

`src/battle_main.c:SetActionsAndBattlersTurnOrder` places items before moves
without an action speed-tie draw. The already selected wild action follows a
Potion or failed throw, including ordinary source end-turn ordering when combat
continues. `src/party_menu.c:ItemUseCB_MedicineStep` and
`src/item_use.c:BattleUseFunc_PokeBallEtc` are retained as noncompiled evidence
for no-effect/consumption and capacity boundaries. The strict one-creature party
guarantees a free second slot; this does not implement general party/PC capacity.

Capture retains source catch-rate fields for Pidgey/Rattata (255), the standard
ball multiplier table, the complete ordinary odds/status arithmetic and the
complete success/shake-result branch of `Cmd_handleballthrow` in
`src/battle_script_commands.c`. Only Poke Ball and healthy ordinary wild targets
are admitted. The source performs integer divisions in its original order and
up to four strict `Random() < threshold` checks, stopping at the first failure.
Four successful checks are the source success code, although the presentation
shows three shakes. Source guaranteed capture at odds above 254 remains in the
extracted branch but is unreachable for these living healthy targets.

The original `Sqrt` declaration and `src/libagbsyscall.s` wrapper call BIOS SWI 8;
the BIOS body is outside the pinned source. The private adapter supplies a
bounded unsigned floor-integer square root, preserving source call sites and
operation order. This numerical primitive substitution is explicit and has its
own independent boundary fixtures. It is not a claim of original BIOS execution
or emulator equivalence. Export `route1_sqrt` exists for private primitive tests.

The success script in `data/battle_scripts_2.s` normally updates capture game
statistics, dex and nickname state, calls `GiveMonToPlayer`, then sets outcome
`B_OUTCOME_CAUGHT` (7). This headless profile deliberately pauses before those
external operations and marks combat settled with the same outcome value. The
host retains a pending capture descriptor with original generated identity and
current source HP/PP, fixed Poke Ball and the free-party-slot policy. It does not
allocate an owned identity, modify an original encounter object, grant a party
member, update a dex or suppress later required continuation. These are future
durable activity operations. Cumulative catch-attempt/healing-item statistics
and success-script game statistics are excluded rather than checkpointed;
none is read by any admitted subsequent mechanic. Complete BattleResults or
post-capture script support is not claimed.

Private ABI `route1_order(playerSlot,wildSlot,actionKind)` takes 0 Fight, 1 Run,
or 2 Item. `route1_item(itemId)` accepts 13 Potion or 4 Poke Ball and returns
the ordinary C status code. The host synchronizes both party projections before
the call; terminal capture forbids later party writes. `route1_item_get` fields
0 through 6 return last item ID, restored HP, initial odds, threshold, shakes,
caught flag and the source Potion amount. The first five values are command
diagnostics, not future-read state or persisted checkpoint fields. The raw
controller transport emits HP event 2 for Potion and shake event 8 for a ball;
the host publishes its separately validated private item events.

## Headless introduction and RNG boundary

Battle admission starts with the factory's post-held-item main RNG state. The
factory already performed `SetWildMonHeldItem`; this profile does not repeat it.
The mechanical introduction projects `TryDoEventsBeforeFirstTurn`: the source
speed comparison with `ignoreChosenMoves=TRUE` runs before the initial action
selection cleanup and `gRandomTurnNumber` draw. The admitted abilities and absent
items/weather have no switch-in effects. The wild choice is then generated and
retained at the first choice boundary. Each later continuing turn performs the
source residual-order comparison, selection cleanup/draw and next wild choice.

This is a deterministic headless schedule, not an original-ROM RNG timeline.
`VBlankCB_Battle` advances Random once per display frame in the original source;
those frame-dependent presentation calls, animations, controller delays and
unrelated introduction callbacks are explicitly omitted. Mechanical source
draws and their order are retained for the admitted profile. The battle-local
draw count starts at zero at this documented boundary while the full preceding
factory stream/count remains in admission.

## Logical checkpoint v3

The shared C checkpoint has 152 unsigned scalar words, with no native pointer,
linear-memory image or suspended script address. Its first 148 words retain the
old field layout; real-profile actor rows use formerly reserved offsets 30/31 for
species/ability and 47 for `noValidMoves`. Tail word 148 stores source `runTries`,
149 records completed mechanical initialization, and 150/151 retain successful
ball ID and shakes. Both must be 4 for caught outcome 7, with a player item
action and two living actors; both must be zero otherwise. Previous profile and
checkpoint versions are rejected rather than silently migrated.
Species/type/ability combinations, slot/PP, status/stages, party outcomes, Run/capture,
RNG state/counts and fixed environment are validated before live assignment.
The real-profile counted RNG traps before drawing past the exact safe-integer
limit. It does not return a substitute zero, which could make wild slot/PP
rejection loops repeat forever. Valid source draws and their order are unchanged;
the host discards the failed candidate. The synthetic counter path is unchanged.

The host envelope retains immutable admitted identities, pending wild choice,
bounded initial/current inventory, pending capture disposition,
turn/event/transition counters and profile compatibility. Source/module/host
hashes reject incompatible restores. A candidate uses a new private 262,144-byte
WASM memory; failed commands, traps or validation cannot publish partial RNG,
PP, HP or state. Viewer data is an explicit projection: opponent IVs, exact
stats, personality, hidden choice, seeds and raw checkpoint are private.

The added future-read state is bounded: real species/abilities and source base
types survive restore; run attempts and initialization survive; selected moves
and exhaustion flags survive. Source text buffers, controller selection pointers
and target transport bytes are scratch, rewritten before the admitted command
reads them. Stat-command prevention scratch is cleared for each attack. The
source escape/capture continuation cursor is irrelevant after the private
terminal outcome. Catch rate and Potion amount are pinned constants; item
diagnostics, projected controller fields and item statistics do not affect a
subsequent admitted action and are not restored.
These claims concern this profile, not all FireRed globals or future mechanics.

## Remaining work

Fight, Run, Potion and Poke Ball in this private profile do not complete the R1
loop. General party/storage capacity, owned capture, resulting-team admission,
evolution, blackout world/arrival application, nickname/storage continuation and
durable activity/choice/outcome transactions remain required before live grass
admission. No experience suppression or level cap is introduced. CharacterService
must remain the single authenticated owner when those boundaries are connected.

The separate `tools/battle-progression` source supplement now provides private
victory XP/EV, level/stat/friendship and move-learning continuations, ending at
an explicit pending evolution handoff when required. It preserves this battle
artifact and rejects progressed-team battle readmission. Its diagnostic levels
do not change this profile's canonical battle admission or complete durable
rewards; see that supplement's README and verification reports.

The separate `tools/battle-loss` supplement can continue actual lost/draw
terminals through source faint friendship and blackout mechanics. Its final
state is a pending world/arrival proposal; it preserves the combat artifact and
does not apply a respawn or account mutation.

The separate `tools/battle-capture` supplement can continue actual captured
terminals through explicit source metadata, dex/stat updates, a resumable
nickname decision and automatic party/PC placement. It preserves this artifact
and ends at pending ownership application; no durable creature is allocated.

Verification reports record actual build, independent source fixture, integration
and recovery results. Source-derived fixtures do not establish emulator/ROM
equivalence, other compiler platforms, live network behavior or population gates.
