# Private Skull Bash continuation

`firered-family-charge-v1` extends the retained tactics profile with Skull Bash
(130). It admits the same eight species, one through six player party members,
one ordinary wild opponent, 22 family moves plus automatic Struggle, four
abilities, held-none policy, poison/burn and battle-created rain. Every occupied
move slot is validated, including the bench and exhausted moves. Protect,
Pursuit and Mirror Move remain explicitly unsupported; no level cap or move
stripping is introduced.

This is private diagnostic combat. Capture and evolved-result inputs preserve
their unowned/pending-application provenance. No account record, field encounter,
live battle UI, database write or durable result is enabled. Older modules and
checkpoint formats remain separate and unchanged.

## Source schedule

The pinned `data/battle_scripts_1.s` provides `BattleScript_EffectSkullBash`
(line 1807), `BattleScriptFirstChargingTurn` (794) and
`BattleScript_TwoTurnMovesSecondTurn` (784). The first turn runs the admitted
attack-canceller branch, spends PP once, executes the complete source charging
effect, and raises Defense by one through `Cmd_statbuffchange`. The stat cap
does not prevent charging. This turn makes no accuracy, critical, variance or
secondary-effect roll. Ordinary turn selection/order/residual RNG still applies.

The source charging effect sets `STATUS2_MULTIPLETURNS`, `gLockedMoves` and
`chargingTurn`. On the following turn, `HandleTurnActionSelectionState`
(`src/battle_main.c:3125`) bypasses the action and move menus. A wild actor also
bypasses its random move chooser. The retained move slot is used even when the
first turn spent its last PP; automatic Struggle does not replace the release.

The second turn runs the attack canceller, complete `Cmd_clearstatusfromeffect`,
then the existing source hit pipeline with `HITMARKER_NO_PPDEDUCT`. The lock bit
clears before accuracy, including a miss. A successful hit uses the normal
accuracy, critical, variance and zero-effect secondary rolls, with source power,
type, abilities, status and stat stages. A miss consumes only its accuracy draw.
PP is not charged a second time. No TypeScript damage or RNG arithmetic is used.

Only the already admitted flinch branch can cancel a living actor's move in
this status/ability policy. Complete source `CancelMultiTurnMoves` clears the
active lock before PP or accuracy; it leaves the old `gLockedMoves` value inert.
Switch and faint cleanup also clear volatile state through the retained source
functions. A player cannot voluntarily switch or Run while locked because the
source action menu is bypassed. A fainted player still reaches the existing
use-next/escape/replacement boundary after source cleanup. An opposing party
replacement occupies the same actor position, so a wild release targets that
incoming creature. No trainer/double targeting behavior is implied.

`TurnValuesCleanUp(FALSE)` clears the source ProtectStruct, including
`chargingTurn`, at each ordinary turn start. It does not clear the active lock.
The flag may still be one at a pending replacement or terminal boundary reached
in the same turn as charging. Faint cleanup clears it. Source cancellation and
switching do not invent a zero `gLockedMoves` value; the inert old value survives
recovery even if a different active member does not know Skull Bash.

The player acknowledges a forced turn with the sole sequence/digest-fenced
`continue-charge` choice. This is a headless control boundary for the source's
automatic action, not a new optional move choice; execution never silently loops
through unbounded turns. Existing source order, weather, residual, faint and
replacement schedules remain in use. A `charge` event observes the lock after
each Skull Bash attempt, including flinch cancellation; it does not by itself
claim a successful attack. Command observations retain PP, volatile and stat
changes separately.

## Checkpoint and raw ABI

Version seven retains 512 unsigned logical words. Words 0–484 keep the tactics
layout; the existing battler `status2` now admits `STATUS2_MULTIPLETURNS` alongside
Focus Energy. Existing chosen-slot words 11/12 retain the forced move slot.

| Words | State |
|---|---|
| 485/486 | Source `gLockedMoves` for player/wild: zero or Skull Bash, including an inert stale value |
| 487/488 | Source `chargingTurn` flags for player/wild |
| 489/490 | Remembered Skull Bash target actor, assigned when charging begins and retained afterward |
| 491–511 | Reserved zero |

The new `charge_get(actor, field)` export accepts actor zero or one. Fields are
0 active lock, 1 retained slot, 2 locked move, 3 charging-turn flag, and 4 target.
Existing party, tactics and source command exports remain available. The wild
chooser returns the retained slot without a draw when locked. Order/attack/Run
and switch guards reject incompatible locked actions before accepted state is
changed. First-charge admission still requires PP; the forced release permits
zero PP.

Raw imports validate supported lock values, live active-lock state, a selected
Skull Bash slot with spent source-max PP, coherent target, source turn cleanup
and a retained move action at nonchoice boundaries, plus the existing roster,
weather and RNG domains. They do not authenticate a battle
history. The host additionally binds immutable admission, exact source-result
provenance, non-replenishment and accepted sequence/decision identity. Accepted
transitions use isolated candidates; a trap or rejection publishes no partial
candidate. Raw recovery requires no hidden host creature reconfiguration.

The projected target storage covers only the admitted two-actor Skull Bash
target. Other moves retain their existing source target transport. Source
controller/display waits and frame-driven VBlank RNG remain omitted under the
prior documented headless clock. This is source-command execution, not an
emulator or a complete original battle script interpreter.

## Scope and evidence

The extractor records pinned input hashes, full selected effect commands,
charging case, source scripts and selection/cleanup evidence. Inherited
transformation notes describe historical engine layers; current charge profile
fields and checkpoint-seven ABI define this build's scope. Optional extraction
arguments default to their old behavior, preserving all ten earlier WASM
profiles and 2,972 retained literal cases.

Protect remains excluded pending its separate compatibility audit: the source
four-entry success table can be indexed beyond its C bounds by the unclamped
repeated-success counter. This profile invents no clamp or unspecified C
behavior. Pursuit interception, Mirror Move history, other two-turn moves,
held items, new statuses, hazards and trainer/double battles remain excluded.
Party-aware reward/loss/capture application and live/durable outcomes are still
required. Earlier single-party continuations reject these terminals.

On clean private output, run each retained dependency before the new gate:

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
npm.cmd run battle:tactics
npm.cmd run battle:charge
```

The pinned compiler produces two independent builds under `.local/battle-charge`
with fixed 262,144-byte memory and no host imports. Reports are
`reports/battle-charge-*.json`. Build success alone does not claim source literals,
cross-process recovery or the full application gate passed. No user account
login, fixture reset or database mutation is needed for the private module gate.
