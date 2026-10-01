# Private source progression continuation

`firered-route1-progression-v1` continues one source Route 1 wild victory for
the development Squirtle. It is a separate source-C/WASM supplement to the
selected engine architecture, with no battle arithmetic in TypeScript. It does
not change the encounter, real battle v2 or synthetic WASM modules. There is no
browser, room, database, owned-creature write or durable reward entry point.

Build with `.venv/Scripts/python.exe tools/battle-progression/build.py`. The
coordinated `npm.cmd run battle:progression` command runs independent mechanics,
recovery and strict battle-handoff checks. Two private builds must match at
`.local/battle-progression/{primary,rebuild}/progression.wasm`; actual evidence
is recorded in `reports/battle-progression-*.json`. Every consumed reference file
is checked against the accepted source snapshot. The reference is read-only.
On clean private outputs, first run `battle:spike`, `encounter:check`, and
`battle:route1` in that order: the strict handoff loads those compatible engines.
The complete verification gate already orders these prerequisites before
`battle:progression`; the progression command builds only its own supplement.

## Admission and truthful handoff

The strict host restores a complete terminal `firered-route1-singles-v2`
checkpoint before deriving the continuation. Its sole living, participating,
untraded Squirtle has no held item, Pokerus, badge bonus, Exp Share or Lucky Egg;
the opponent is the actual generated Route 1 Pidgey or Rattata. The untraded
condition is an explicit development policy: original trainer-name metadata is
not present in the fixture, so OT ID alone is not claimed to prove source
`IsTradedMon` equality. Inventory and captured identity remain separate handoffs.

A canonical first victory starts at level five with 135 XP. Pidgey awards
15/23/31/39 XP at levels 2/3/4/5; Rattata awards 16/24/32 at levels 2/3/4.
The highest first total is 174, below level six's threshold 179. A real first
handoff therefore proves an XP and EV award, with no invented level-up. Both
species award one Speed EV. Other terminal outcomes do not award victory XP/EV;
loss and capture remain explicit external continuations rather than completed
world effects.

Explicit diagnostic admission exercises later source levels, cached stats,
friendship contexts, move decisions and evolution. It keeps Squirtle's canonical
identity (species 7, personality 25, OT ID 1, IVs 15 and Torrent), allows source
levels 1 through 100 and legal Squirtle moves, and optionally substitutes a
positive signed-16-bit XP award to exercise multiple levels. This override is a
private fixture input, not a live award or client command. Current EVs and EVs
used at the last stat calculation are explicit; the latter must not exceed the
current values. Diagnostic results are not accepted as real battle v2 teams.

## Retained source mechanics

`src/battle_script_commands.c:Cmd_getexp` supplies the ordinary reward expression
and no-Exp-Share division/minimum-one branch. The wrapper specializes one
eligible participant. Fainted recipients and creatures already at source level
100 receive neither XP nor EVs, matching the source gate before `MonGainEVs`.
The source's natural maximum is retained; there is no new level cap or reward
suppression below it.

Complete `MonGainEVs` and `CheckPartyHasHadPokerus` from `src/pokemon.c` perform
the EV update, including per-stat 255 and total 510 bounds. EVs apply once before
the experience chunks. Crucially, an award without a level-up does not recalculate
stats. Current EVs can exceed the recorded calculation basis, and the cached
stats remain valid until a source level-up recalculates them.

The completed-bar branch of
`src/battle_controller_player.c:Task_GiveExpWithExpBar` uses **greater than or
equal to** the next XP threshold. It adds XP up to one threshold, calls complete
source `CalculateMonStats`, and returns the remainder. Presentation waits,
animation tasks and controller transport become synchronous continuation seams.
`TryIncrementMonLevel`, which has a different strict comparison, is not used.
The complete source stat/nature/level functions preserve the missing HP through
the max-HP delta; leveling does not heal to full. Existing move PP is preserved.

After each level, complete `AdjustFriendship` executes before learning. The
level event uses source friendship tiers and its same-met-location/Luxury Ball
bonuses. Diagnostic ball, met location and current region must be explicit.
The real development fixture has no original met/ball metadata; its handoff
marks all three values unknown. A level-up that would read unknown context fails
explicitly before the XP chunk changes state. No placeholder location or ball
is silently chosen.

Complete `MonTryLearningNewMove`, `GiveMoveToMon`, `GiveMoveToBoxMon`,
`RemoveMonPPBonus` and `SetMonMoveSlot` use the full pinned Squirtle learnset.
An empty slot learns automatically; a known move is skipped; four occupied
slots pause for a specific replacement or decline. A replacement resets only
that slot's PP and PP bonuses. The source learning cursor survives the decision,
and all moves for that level are resolved before remaining XP reaches the next
level. The admitted learnset contains no HM, so the source HM-forgetting UI
branch is outside this policy rather than treated as implemented.

After all XP and learning, complete `GetEvolutionTargetSpecies` queries the
pinned Squirtle evolution row only if this award caused a level-up. The source
battle exit checks the leveled bit and victory before this query. Eligible
Squirtle yields Wartortle from level 16 onward. The continuation then pauses at
`pending-evolution`; it does not change species or run evolution animation,
cancel/accept input, renaming, dex flags, evolution statistics or the evolved
species' learning loop. Those source operations in `src/evolution_scene.c`
remain a required external continuation. XP has already been fully applied;
the handoff is neither a level cap nor a discarded evolution.

No admitted progression branch consumes RNG. A stray random service traps.
The source postbattle `RandomlyGivePartyPokerus` and `PartySpreadPokerus` are
empty FireRed stubs and are retained as audit evidence. This still does not
claim an original-ROM clock: frame-driven battle/presentation draws remain
outside the documented deterministic headless boundary.

## Private logical ABI

The module exports only memory and `progression_*` functions. It has no imports
and fixed private 262,144-byte memory. An input stages 46 unsigned words. Words
0-39 describe the named creature scalars below; 40-45 hold the six EV values
used for its cached stats. `progression_start` takes defeated species/level,
current region, mode 0 (ordinary source award) or 1 (diagnostic override), and
override XP. Unknown friendship metadata uses `0xffffffff` for all three
ball/met/current values together.

| Creature word | Field |
| --- | --- |
| 0-6 | species, personality, OT ID, XP, level, friendship, current HP |
| 7-12 | max HP, Attack, Defense, Speed, Sp. Attack, Sp. Defense |
| 13-18 | IVs in the same six-stat order |
| 19-24 | current EVs in the same order |
| 25-28 / 29-32 | move IDs / current PP |
| 33-39 | packed PP bonuses, ball, met location, status, held item, Pokerus, ability slot |

`progression_next` performs one meaningful source event until phase 3 requires
a choice, phase 4 holds evolution, or phase 5 completes. `progression_decide`
takes slot 0-3 or 4 to decline. Getters expose phase, pending move, remaining XP,
actual award, evolution target, level and ordinary source award. Event getters
return type, value and slot: XP applied, level-up, automatic learning,
replacement, decline, evolution handoff or completion. A move-choice boundary
uses no event until the decision; its pending move is queried separately.

The checkpoint is 64 unsigned logical words, not a memory dump. Core words
0-15 store version, phase, remainder, award, pending/source move, learning cursor,
first-move flag, leveled flag, evolution target, defeated species/level, current
region, known-context flag, diagnostic mode, ordinary award and override.
Words 16-21 store the calculation EV basis; 22 is reserved zero; 23 marks
initialization. Words 24-63 contain the creature's 40 scalars. Events and
presentation/task pointers are scratch and are not restored.

Raw staged input/import rejects malformed values before assigning active state;
an invalid duplicate or out-of-range setter poisons that staging transaction.
Raw validation checks numerical/profile bounds, cached source stats, source
move legality and pending-choice shape. It is not proof of a historical award
or arbitrary supplied learning sequence. The strict TypeScript host additionally
binds immutable admission and bounded decisions, replays the source continuation
in a fresh instance, and compares all 64 words. Candidate failure cannot publish
partial XP, EVs, HP, friendship or learning. Trusted private checkpoints are not
authenticated client saves; cross-version migration is unsupported.

## Remaining integration

Progressed teams need explicit resulting-species/move battle admission before
reuse; current battle v2 rejects them. The separate `tools/battle-loss` module
can continue compatible pending-loss checkpoints through source friendship,
money, healing, named field resets and a pending respawn proposal. Durable
evolution and capture outcomes, arrival scripts, award receipts and
transactional world resumption remain open. The separate `tools/battle-capture`
module accepts pending-capture checkpoints for private metadata, dex, nickname
and placement proposals without granting an owned creature. `CharacterService`
must retain sole authority when these private handoffs are connected. Neither
this module nor its diagnostic fixtures mutate the existing user accounts.

The separate `tools/battle-evolution` module consumes validated pending-evolution
checkpoints for source accept/cancel, species/stats/name/dex and current-level
move continuations. The current progression profile can reach that bridge only
through its explicitly diagnostic inputs; combat v2's first victory cannot level
the fixture. It ends at pending ownership application and does not authorize a
resulting team for another battle. See ADR-020 for this continuation's scope.
