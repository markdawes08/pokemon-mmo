# Private family party battle experiment

`firered-family-party-v1` extends the retained numerical engine with one player
party of one to six creatures against one ordinary wild opponent. It is a
private diagnostic profile. It does not admit a player account, persist a
creature, spend an owned item, or enable live encounters. The earlier eight
WASM profiles and their literal fixtures remain separate compatibility targets.

The admitted species are Squirtle, Wartortle, Blastoise, Pidgey, Pidgeotto,
Pidgeot, Rattata and Raticate. Whole movesets must contain only the prior 16
family moves; automatic Struggle remains available when every move is unusable.
Source validation retains levels 1–100, identity, XP, IVs, EVs, cached-stat EV
basis, PP bonuses, current HP/PP and ability slot. Held items are absent. Major
status is healthy, poison or burn; an initially fainted party member must have
cleared status. The first living member enters initially. At least one player
member and the opponent must be alive at admission.

## Source schedule

- Voluntary Switch precedes the wild move without an action-order speed-tie
  draw, as in `SetActionsAndBattlersTurnOrder`. The previously selected wild
  move is retained and targets the incoming creature. Pursuit is unsupported.
- A synchronous private controller fills the source `REQUEST_ALL_BATTLE`
  payload from the validated incoming record. Complete
  `Cmd_switchindataupdate` derives types and ability, then complete
  `SwitchInClearSetData` resets stages, Focus Energy, volatile state, disable
  state and move history. HP, PP, friendship, major status and cached stats
  belong to the roster and survive recall. Switching does not recalculate
  stats or heal a creature.
- None of Torrent, Keen Eye, Run Away or Guts has a switch-in/out effect.
  The profile has no held items, weather, entry hazards, trapping, Baton Pass
  or other switch-dependent abilities. Source branches requiring these remain
  outside admission rather than being reported as implemented.
- Attack fainting runs source faint cleanup and checks the whole party.
  With a surviving reserve and living wild opponent it pauses at the source
  “Use next Pokémon?” decision. Yes opens replacement selection. No calls
  complete `TryRunFromBattle` using the fainted outgoing creature's speed and
  ability. One failed escape opens replacement selection; it cannot be rolled
  repeatedly at that prompt. Successful escape ends combat.
- An attack-faint replacement cancels the remaining actions, then resumes the
  residual pass. A residual-faint replacement resumes at the next turn.
  `BattleScript_DoTurnDmg` checks the party outcome after each residual; a
  terminal result skips the remaining residuals. Otherwise both active actors'
  residuals finish before the replacement prompt.
- Residual order uses source `GetWhoStrikesFirst(..., FALSE)`. Switch/Run actions
  have `MOVE_NONE` priority. After forced replacement the old move position
  remains selected and can refer to a different incoming move; this is retained
  source behavior, not normalized to speed alone.
- Complete `AdjustFriendshipOnBattleFaint` and `AdjustFriendship` run once for
  each new player faint, before faint cleanup. Their admitted negative events
  do not read ball/met-location bonuses and consume no RNG. The roster retains
  the result. Initially fainted members are marked already handled.
- Source participation bits and the saturated player-switch counter survive
  recovery. Opening forced replacement increments the switch counter; escaping
  before opening that screen does not. The counter is bookkeeping, not an
  authorization or durable statistic.

The full source functions, selected counter statements and supporting script
branches are pinned with input and fragment hashes in the extraction manifest.
The script/controller schedule is a headless adaptation, not a GBA emulator.
Rendering, VBlank RNG, text/nickname preparation and party-menu presentation
order are omitted. Public API party indices identify stable original roster
records; the source UI's nibble-packed display-order mapping is not a second
roster mutation. No switchable move in this profile reads that UI mapping.

## Recovery boundary

Checkpoint version 5 contains 512 unsigned logical words, not C memory or
pointers. The first 154 retain the prior family battler/RNG layout. New words
154–159 contain party size, active index, participation bits, switch count,
replacement phase and replacement decision. Words 160–481 contain seven
46-word source-validated creature records (six player positions, then wild).
Word 482 is the player faint-applied mask; the remaining words are reserved zero.

Boundaries are ordinary choice (0), replacement before residuals (1),
replacement after residuals (2), and terminal (3). Replacement decision 0 is
unanswered, 1 is accepted use-next, and 2 is failed escape. Full immutable
admission, pending wild choice, turn/decision counters and explicit diagnostic
or pending-ownership provenance stay in the strict host envelope. The host
requires current decision IDs and executes each accepted command on an isolated
candidate. A rejection or RNG exhaustion trap does not publish candidate state.

Raw imports check source creature domains, cached stats, party/battler equality,
supported volatile/stage state, exact team-loss projections, continuation state
and RNG count/state consistency. They are semantic validation, not authenticated
history. The host additionally binds the immutable roster and non-replenishment
bounds. This is not an authenticated client save format or durable activity.

Entry data, source party indices and participation survive raw recovery.
The attack-order array is rebuilt by `party_order` or `party_residual_order`
before executing a source action. Flinch is transient inside an atomic action
pass and is rejected at settled boundaries. Focus Energy, PP bonuses, selected
positions and all mutable roster fields are retained. Source friendship scratch
is reconstructed from the selected roster and current opponent level for each
faint. Initial `party_mon_get` diagnostics require admission; runtime roster
reads use `party_roster_get` after recovery.

## Deliberate limits

Pursuit, Whirlwind and the other seven unimplemented family moves are rejected.
There are no trainer/double battles, eggs, switching opponents, items, hazards,
weather, trapping or additional statuses/abilities. Reward/progression,
evolution, capture, blackout and world continuation for party results remain
closed. Retained participation and friendship do not constitute a completed XP
or owned-result pipeline. The coherent private capture bridge verifies a single
actual capture result and its parent terminal to recover the original Squirtle
plus that captured creature; it does not combine unrelated ownership claims.
Other `BattleResults` statistics and reward bookkeeping (including faint
counters, last opponent species and the last attacker to faint the opponent)
are not a completed result projection here. None is read by the admitted
combat continuation; applying party rewards requires a separate source audit.

## Local verification

On clean private output, build the retained dependencies before this module:

```powershell
npm.cmd run battle:spike
npm.cmd run encounter:check
npm.cmd run battle:route1
npm.cmd run battle:progression
npm.cmd run battle:loss
npm.cmd run battle:capture
npm.cmd run battle:evolution
npm.cmd run battle:family
npm.cmd run battle:party
```

The module builds twice using the pinned Zig toolchain, fixed 262,144-byte
memory and no host imports. Reports record the actual artifact hash, retained
artifact comparisons, independent literal cases, raw/host recovery, rejection
checks and integration outcomes. Build success alone does not claim those
verification gates passed.
