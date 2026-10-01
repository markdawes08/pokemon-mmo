# Private family tactics experiment

`firered-family-tactics-v1` is a new private profile of the shared source-C/WASM
engine. It retains the party profile's one-through-six player roster, one wild
opponent, eight species, current HP/PP/status/friendship, switching, faint
decisions and source abilities. Five moves extend the admitted family moveset
from 16 to 21: Super Fang (162), Endeavor (283), Rapid Spin (229), Rain Dance
(240), and Whirlwind (18). Automatic Struggle remains available.

Every occupied slot in every party member is validated, including exhausted
and benched moves. The four remaining moves are rejected; none is stripped and
no level cap is introduced. This profile has no account, browser, database or
live-battle entry point. Capture-derived party proofs retain their explicit
pending-ownership and diagnostic context. Inventory is retained as provenance,
not usable or spent by this profile.

## Source mechanics

Super Fang follows `BattleScript_EffectSuperFang`: accuracy precedes PP,
type checks precede `Cmd_damagetohalftargethp`, and damage is half the current
target HP with the source minimum of one. It does not use normal base-damage,
critical or variance commands. Its successful hit still reaches source
`seteffectwithchance`, including the zero-effect random draw.

Endeavor spends PP before `Cmd_setdamagetohealthdifference`. A target with no
more HP than the user fails before any accuracy draw. Otherwise the script
copies the difference into `gHpDealt`, checks accuracy/type, restores the fixed
amount and calls `Cmd_adjustsetdamage`. An accuracy miss therefore retains
the computed difference in these source diagnostic scratch fields while target
HP remains unchanged. It is not an actual damage event. The successful hit
also retains the zero-effect secondary draw; no critical/variance arithmetic
is substituted.

Rapid Spin uses the normal source attack pipeline with its certain, user-side
secondary effect. That path does not make a secondary chance draw. The complete
`Cmd_rapidspinfree` function is compiled. Wrapping, Leech Seed and Spikes cannot
enter or arise in this admitted family, so its empty-cleanup branch is the
reachable behavior. This is not a claim that trapping, seed or hazard gameplay
has been implemented. Introducing any such context requires its full source
dependency closure.

Rain Dance executes complete `Cmd_setrain`: it starts temporary rain with five
turns, or fails without resetting the timer if rain is already present. There
is no accuracy or weather RNG draw. Existing complete damage arithmetic applies
the source rain multiplier, including its order relative to Torrent and integer
rounding. At end of turn, source field order is computed first; the complete
`ENDTURN_RAIN` case then decrements/expires the timer before battler residuals.
Switching does not reset rain. Replacement before residuals resumes this field
pass once; replacement after residuals starts the next turn without repeating
the weather tick. A terminal action skips the residual/field pass. Initial
weather is always clear; rain is created by admitted battle actions only.
The host's weather event reports the observed state after every nonflinched
Rain Dance attempt, including an unchanged failed repeat; the preceding attack
flags retain that failure. The event does not imply that the weather changed.

Whirlwind follows the ordinary-wild `BattleScript_EffectRoar` branch: PP,
the source no-roll accuracy preflight, ordinary accuracy, then complete
`TryDoForceSwitchOut`. A lower-level user consumes the source extra level-test
draw; an equal/higher-level user does not. Success uses the source script's
`B_OUTCOME_PLAYER_TELEPORTED` (5), projected as `forced-escape`, regardless of
which side used the move. It does not shuffle the player's reserves in an
ordinary wild battle, increment Run attempts, grant experience, or continue
with another action/residual. Trainer-party force switching remains excluded.

The source input hashes and exact function/script fragments are recorded in the
extraction manifest. Its inherited transformation notes describe successive
engine layers, including earlier Fight/Run-only and checkpoint-version limits;
they are historical context. The current tactics profile, supported/unsupported
fields and checkpoint-six ABI define this build's scope. Source arithmetic stays
in C; the host controls only the audited command/decision schedule. Synchronous
controller transport, omitted
display waits/VBlank random calls, fixed no-badge/no-held-item context and stable
roster indices retain the earlier headless adaptations. This is not an emulator
or a claim of complete FireRed battle execution.

## Checkpoint and ABI

C checkpoint version 6 retains 512 unsigned logical words. Words 0–482 keep the
party layout; word 483 stores weather (`0` clear or source temporary-rain bit
`1`), and word 484 stores the duration. Clear weather requires duration zero;
rain requires one through five. A settled ordinary-choice or after-residual
boundary cannot retain five turns. Words 485–511 remain reserved zero.

The new exports are `tactics_field_end_turn()` and `tactics_get(field)`.
Getter fields 0 and 1 return weather and duration. Field 2 observes the current
source message chooser immediately after a rain operation: started/continued
is zero, failed/stopped is two. It has no sentinel guarantee when no rain
operation occurred. The field function runs once after `party_residual_order`
and before battler residuals. Ordinary party input, roster, switching and
decision exports are retained under their existing names.

The raw importer validates the supported source weather domain, coherent timer
and continuation phase, plus the retained party/RNG rules. Forced escape requires
both active creatures alive, current move Whirlwind, and a retained move action
selecting Whirlwind with PP below its source maximum. The strict host adds
immutable admission/provenance, PP/history bounds and initial-clear checks.
Neither semantic validation nor a digest authenticates client state or proves
an entire battle history. Accepted transitions execute on isolated candidates;
rejection or bounded RNG exhaustion does not publish partial candidate state.

## Deferred moves and outcomes

Protect is deliberately not approximated. In the pinned source,
`sProtectSuccessRates` has four entries, `protectUses` is a plain byte, and a
successful attempt increments it without a clamp. Four consecutive successes
can leave the next attempt indexing past the table. A compatibility decision
is still required; this profile invents neither a success-rate clamp nor
compiled-ROM memory behavior.

Skull Bash still requires persistent charging/locked-selection and interruption
semantics. Pursuit still requires the pre-switch interception schedule, consumed
wild action and faint/destination continuation. Mirror Move still requires full
move-end history, selection/PP rules and copied-effect dispatch. All four fail
whole-roster admission. Other weather, hazards, trapping, new statuses/abilities,
items, trainer/double battles, party-aware rewards and durable/live outcomes
remain outside this profile. Earlier progression/loss/capture modules do not
accept these terminals implicitly.

## Local checks

On clean private output, build retained dependencies in order:

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
```

Builds use the pinned toolchain, two independent output directories, fixed
262,144-byte memory and no host imports. Reports record the actual artifact,
independent literal checks, full raw/host recovery, rejection/exhaustion cases
and integration outcomes. Earlier artifacts and literals are retained separately.
Build success alone does not claim these verification gates passed.
