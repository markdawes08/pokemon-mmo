# Private Pursuit continuation

`firered-family-pursuit-v1` adds Pursuit (228) to the retained Protect profile:
24 family moves plus automatic Struggle, eight species, one through six player
party members and one ordinary wild opponent. Source admission still checks
every occupied move, including exhausted and benched moves. Mirror Move remains
unsupported. The existing four abilities, held-none policy, poison/burn,
battle-created rain, charge continuation and Protect policy remain unchanged.

This is private diagnostic combat. Coherent capture-party and evolved-result
inputs retain their pending, unowned provenance. No live encounter, battle UI,
account or database mutation, durable ownership, or party-aware result
application is enabled. Twelve earlier WASMs and checkpoint contracts remain
separate; this profile does not reinterpret their saves.

## Ordinary-wild interception is source behavior

The pinned `BattleScript_ActionSwitch` (`data/battle_scripts_1.s:3046`) enters
the Pursuit loop without a trainer-battle condition. The complete
`Cmd_jumpifnopursuitswitchdmg` (`src/battle_script_commands.c:8337`) checks the
opposing chosen action, selected target, sleep/freeze, outgoing HP, Truant
counter and chosen Pursuit move. It marks the opposing action
`B_ACTION_TRY_FINISH`, retains its selected slot and begins interception.

Ordinary-wild move selection records both chosen move and target, just as the
command expects. The trainer-only condition in `AI_TrySwitchOrUseItem` governs
AI switching/items, not Pursuit eligibility. Thus a wild Rattata or Raticate
can intercept a voluntary player switch. The admitted wild opponent never
voluntarily switches; player Pursuit uses the ordinary hit path. Run, forced
replacement and source charge acknowledgment do not enter this switch script.

The move table has power 40, Dark type, accuracy 100, PP 20 and priority zero.
Rattata learns it at level 27 and Raticate at 30; existing source ancestor
learnset validation also permits a retained move after evolution. Dark is
special in this source generation. Guts and burn's physical-damage adjustment
do not alter its special damage.

## Source script order

Normal Pursuit dispatches to `BattleScript_EffectHit`, with the existing
attack-canceller, accuracy, PP, critical, type, variance, zero-chance secondary
roll, faint cleanup and resulting-move history. Protection and flinch apply
normally. A normal successful hit consumes the four ordinary attack RNG draws.

Interception instead follows `BattleScript_PursuitDmgOnSwitchOut` (line 3081):
PP, critical, damage calculation, type, variance, HP, target faint, limited
move-end, optional player-side reward check, and return to the selected switch.
There is no attack-canceller, accuracy check or secondary-effect roll in that
script. A successful admitted interception therefore consumes two attack draws,
critical and variance. Introduction, wild selection, residual ordering and
subsequent turn draws remain separate source operations.

`Cmd_damagecalc` multiplies the completed `CalculateBaseDamage` result by the
critical multiplier and the script's damage multiplier of two. The factor is
applied after the base formula's final addition; it is not a replacement of
power 40 with power 80. Existing source numerical commands perform all damage,
PP and RNG operations. Diagnostic `baseDamage` observes the source base before
both multipliers, while `afterCritical` includes both of them.

An outgoing KO applies the source player's faint friendship and cleanup once,
then returns to the original selected incoming party index. It does not open a
Use Next Pokemon prompt or select a different replacement. The source reward
command skips experience when the fainted target is on the player side. The
source switch counter increments once before interception, and the queued wild
action is consumed, so the incoming member does not receive a second Pursuit.
Normal field and residual processing still follows; an incoming poisoned member
can faint there and open the existing post-residual decision.

The interception script's limited move-end range covers on-damage abilities
through choice-item bookkeeping. Those effects are inactive under the admitted
four abilities and held-none policy. It excludes `MOVEEND_UPDATE_LAST_MOVES`:
the pursuer's prior resulting-move history is retained. No ordinary
`protect_move_end` call belongs to this interception path. Normal Pursuit still
uses that after-faint history hook. Switching performs the full retained source
cleanup, including stages, volatile effects and the outgoing actor's history.

## Atomic switch ABI and recovery

Checkpoint version nine keeps the existing 512 logical words. All fields
through word 494 retain their Protect meanings; words 495 through 511 remain
reserved zero. No new settled state is needed because every voluntary switch
completes within one isolated host candidate.

The two new exports are:

| Call | Contract |
|---|---|
| `pursuit_switch_prepare(index)` | Requires validated voluntary-switch order; returns 0 without interception, 1 after interception damage, or a negative error. |
| `pursuit_switch_complete(index)` | Completes the same selected incoming index; returns zero on success. |

Both successful prepare results require completion. For result one, the caller
reads the source attack observations and performs `party_faint_cleanup(0)` if
the outgoing player reached zero HP, then completes the original index. It
skips the consumed wild attack and enters source residual order. Result zero
completes the switch and then lets the selected wild action run normally.
Forced replacement continues to use `party_switch(index, 1)`. Direct voluntary
`party_switch(index, 0)` is rejected in this profile so it cannot bypass
interception.

Pending-switch scratch retains the selected index and whether interception
occurred. A consumed-action marker remains until field entry. Neither can
cross a settled checkpoint: export, competing attacks, new order/selection,
ordinary Run and replacement prompts reject an incomplete transaction. Wrong
or duplicate completion rejects without abandoning the valid pending switch.
The only zero-HP voluntary completion requires the owned interception and its
already-applied faint-cleanup marker. Source selection/action/target scratch is
rebuilt from validated order; raw recovery requires no hidden host admission
reconfiguration.

The host publishes only accepted isolated candidates. Rejected choices or RNG
exhaustion cannot publish a partially damaged outgoing member or partially
completed switch. Raw field validation is bounded semantic validation, not
proof of historical reachability or a promise that every trapping raw command
can be rolled back. Immutable admission, lineage, non-replenishment and
sequence/decision checks remain additional host responsibilities.

## Retained policy and build boundary

The exact `firered-protect-rom-v1` object and 256-entry lookup are inherited
unchanged from [the original policy file](../battle-protect/protect-policy.json).
The separately pinned original ROM, ELF, map and object are verified read-only
at build time; no ROM is rebuilt or read at runtime. The host verifies exported
rates against the same pinned table hash. Raw table-domain checks do not imply
whole-game reachability or emulator equivalence.

Extraction records source input and fragment hashes, complete eligibility and
numerical commands, switch/interception scripts, ordinary-wild controller
selection, normal effect dispatch and the complete Pursuit move entry.
Inherited transformation notes describe earlier layers; the current profile
and checkpoint-nine fields define this module's scope. Optional extraction
parameters default to prior behavior, preserving the twelve prior profiles
and their 3,858 retained literal cases.

On clean private output, build the retained dependencies before this gate:

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
npm.cmd run battle:protect
npm.cmd run battle:pursuit
```

The pinned compiler produces matching primary/rebuild modules under
`.local/battle-pursuit`, with fixed 262,144-byte memory and no host imports.
Build and verification reports use `reports/battle-pursuit-*.json`. A successful
build alone does not establish literal verification or the full application
gate; consult the dated reports for actual results.

Mirror Move's full source history, trainer/double interception, opposing party
switching, other moves/abilities/items/statuses and live ownership remain
unsupported. The unused source `Cmd_pursuitdoubles` is evidence, not an admitted
mechanic. Party-aware progression/loss/capture application remains separate.
Presentation/controller waits and VBlank RNG stay omitted under the documented
headless clock.

## Verified twenty-fifth-pass evidence

Full twenty-three-stage gate passed at 2026-10-02T09:49:42.194Z with native exit 0: 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all twelve prior private engine gates, fresh-process account recovery and all 39 browser scenarios. Pursuit passed 603 independent source-literal cases (476 retained controls and 127 additions), 1,245 accepted transitions and 9,302 checked RNG draws. All 1,848 host and 1,848 raw boundaries recovered across independent builds and fresh processes, replaying 2,590 future transitions per host/raw path. Rejection checks passed for 141 host and 125 raw cases, with 37 candidate-failure checks and 31 timeout-bounded exhaustion checks. The unchanged 256-entry Protect policy passed 7,518 raw commands across two builds and a fresh process. Integration passed 29 groups, 14 coherent capture-party handoffs, 189 restores and 159 diagnostic transitions. Public boundaries passed 100 HTTP checks across 73 built files. All twelve prior WASM artifacts and 3,858 retained literal cases remain byte-identical.

Twenty-fifth-pass focused and full gates passed with implementation and tests frozen. Separate source, host and independent QA reviews covered the atomic switch seam, preserved wild history, selected-index validation, consumed action, KO cleanup and recovery. The first numerical verifier matched the source build. Initial root integration diagnostics were test-construction errors: cancellation with a full moveset does not offer replacement, and an empty slot before known moves violates the retained evolution input contract. The corrected test uses a trailing empty slot and checks source automatic learning; acceptance uses explicit replacement. An intermediate typecheck caught event-union narrowing and nested attack-result access in a strengthened assertion. These harness changes did not change mechanics. Initial logs/exits and exact causes are recorded in reports/battle-pursuit-qa-diagnostics.json. The previous gate/browser/Protect reports are archived under reports/twentyfourth-*.json. Logs: .local/twentyfifth-focused.log and .local/twentyfifth-verify.log; native exits: reports/twentyfifth-*-exit-status.json. No user testing account was logged into, reset or mutated.
