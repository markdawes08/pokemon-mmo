# Private Protect continuation

`firered-family-protect-v1` adds Protect (182) to the retained charge profile:
23 family moves plus automatic Struggle, eight species, one through six player
party members, one ordinary wild opponent, the same four abilities, held-none,
poison/burn and battle-created rain. Every occupied move is validated, including
benched and exhausted moves. Pursuit and Mirror Move remain rejected throughout
the roster. No level cap or move removal substitutes for unsupported mechanics.

This profile is private diagnostic combat. Verified capture and evolved-result
inputs retain their pending, unowned provenance. It enables no live encounter,
account mutation, database write, battle UI, durable ownership or party reward
application. The eleven previous WASMs and their checkpoint contracts remain
separate; the new profile does not reinterpret their saves.

## Explicit compiled lookup policy

The source `Cmd_setprotectlike` (`src/battle_script_commands.c:6220`) indexes
`sProtectSuccessRates` using the ordinary `u8 protectUses` field. The source
table at line 701 contains only four entries: `USHRT_MAX`, `/2`, `/4`, `/8`.
Four consecutive successes permit a fifth attempt to read past that C object.
Copying this undefined access into portable C or inventing a clamp would not
define the intended compatibility behavior.

The explicitly versioned `firered-protect-rom-v1` policy instead uses all 256
little-endian halfwords reachable by the compiled byte index, read from the
separately pinned local original ROM. The policy is stored in
[protect-policy.json](protect-policy.json):

| Binding | Value |
|---|---|
| ROM SHA-256 | `3d0c79f1627022e18765766f6cb5ea067f6b5bf7dca115552189ad65a5c3a8ac` |
| ROM byte range | `0x2507e0` through `0x2509e0`, exclusive end |
| 512-byte lookup SHA-256 | `977c6928a398eab83f1b9d0ff8b5a2d4ee4c88d1beae6872da7fe5265a87bce1` |
| Entries | 256 unsigned 16-bit values |

The first four values are checked against the exact pinned source expressions.
Counter four reads 118; counter 255 reads 196. The complete source command uses
an inclusive threshold, evaluates `Random()` even when the actor acts last,
increments the byte counter on success (including 255 to zero), and resets it
on failure. Before its roll it also resets the counter if the previous resulting
move was not Protect, Detect or Endure. Detect and Endure are not admitted moves.
No claim is made that every counter value is reachable from every legal initial
party; raw command-domain fixtures can examine the entire explicit policy.

Extraction verifies the complete ROM plus the separately pinned ELF, map and
battle-script object recorded in `reports/protect-source-audit.json`. These
compiled files are excluded from the source snapshot and remain separate
compatibility evidence. The audit records the matching advertised ROM SHA-1
and the compiled unclamped indexed load. This work does not rebuild or execute
the original ROM, prove its external provenance, or claim emulator equivalence.
Only the bounded lookup is emitted; no full ROM enters the WASM or browser.

The build report and host checkpoint both bind the exact five-field policy
object. The host verifies the exported 256 rates against the pinned table hash
before use. Runtime does not read a ROM or infer adjacent host memory.

## Source action and cleanup order

`BattleScript_EffectProtect` (`data/battle_scripts_1.s:1528`) runs the admitted
attack canceller, spends PP, and executes the complete `Cmd_setprotectlike`.
There is no accuracy, critical or damage roll. Failure sets
`MOVE_RESULT_MISSED`, not `MOVE_RESULT_FAILED`. Source priority and action order
still apply, including a roll followed by failure when acting last.

The selected protection branch of `Cmd_attackcanceler` follows the admitted
flinch/obedience boundary. For an affected targeted move it cancels multi-turn
state, marks a miss and clears the target's last-landed/type observations.
The effect script still reaches its own PP/miss path. Complete source accuracy
commands check protection before rolling accuracy. Thus normal hits, target
stat changes, fixed-damage moves, Struggle and Whirlwind are blocked without
their accuracy/damage RNG. Their original PP and failure-command order remains
in place; Endeavor still computes its source pre-accuracy HP difference.
Withdraw, Agility, Focus Energy, Rain Dance and Protect are unaffected.

Skull Bash's first charging turn is expressly exempt from the protection
attack-canceller condition. A release is blocked, clears its active lock and
does not spend PP again. Inert old `gLockedMoves` values remain intact. The
existing sequence-fenced `continue-charge` acknowledgment and no-RNG wild
locked selection remain unchanged.

Protect's future counter depends on `gLastResultingMoves`. This profile
projects only that field from the selected `MOVEEND_UPDATE_LAST_MOVES` branch
(`src/battle_script_commands.c:4235`). An obeying attempted move is recorded
even if it misses or is protected; flinch records `MOVE_UNAVAILABLE` (`0xffff`).
Run does not run move-end. Successful ordinary-wild Whirlwind's `finishaction`
also bypasses it, preserving prior history. Failed or blocked Whirlwind does
run the history branch. Other last-move fields retain their earlier bounded
projection; this is not a full move-end or Mirror Move implementation.

The explicit `protect_move_end(actor)` step executes after both attacker and
target faint cleanups, before outcome checks or replacement prompts. This
matches Struggle recoil: source faint cleanup clears the actor, then later
move-end records Struggle for that fainted actor. A subsequent switch clears
that history through the original switch function. A target or residual faint
has its history cleared normally. An incomplete attack cannot be exported as
a settled checkpoint, and a duplicate/wrong-actor history step is rejected.

On entry to field effects, `party_residual_order()` invokes the complete
`TurnValuesCleanUp(TRUE)` from `BattleTurnPassed`, before source residual order
and rain effects. It clears protection while retaining the counter. The normal
turn cleanup clears the full ProtectStruct; switching and fainting reset the
DisableStruct and history through the existing complete source functions.
Poison/burn residual damage is not blocked by Protect.

The host `protect` event reports the observed flag after a Protect attempt,
including failure or flinch, without exposing the private counter/table/history.
Attack flags and command observations preserve the reason for failure. Rain
Dance events retain the prior observed-state meaning, including an unchanged
failed repeat; they do not by themselves claim a successful weather change.

## Checkpoint and raw ABI

Checkpoint version eight keeps 512 unsigned logical words. Words 0–490 retain
the charge layout, and each actor's existing row offset 43 now carries the
selected resulting-move history, including `0xffff` after flinch.

| Words | State |
|---|---|
| 491/492 | Player/wild `protectUses`, 0–255 |
| 493/494 | Player/wild `protected`, zero or one |
| 495–511 | Reserved zero |

New exports are `protect_get(actor, field)` (0 protected, 1 counter, 2 resulting
move), `protect_rate(index)` (0–255; invalid index returns -1), and
`protect_move_end(actor)`. Call the last export after every successful raw
attack API, including forced-escape outcome five; that case clears the pending
continuation without changing history. Existing command-event types stay
unchanged. Counter, protected state and history are stored in C, never mirrored
as TypeScript mechanics.

The transient completed-attack context records actor/move/obedience only until
the required move-end step. It cannot cross a supported checkpoint. Source
order is rebuilt before each action; full roster, weather, charge, PP bonuses,
Focus Energy and source RNG state/counters remain checkpointed. Raw recovery
requires no hidden host creature reconfiguration. Imports validate bounded
field semantics, not authenticated historical reachability. Resulting-move
history must be zero, unavailable, automatic Struggle, or one of the current
actor's known moves; fainted recoil users may retain Struggle. Host validation
additionally binds immutable admission, non-replenishment, spent admitted
Protect PP, policy identity and accepted sequence/decision context. Isolated
candidates prevent a rejection or RNG-exhaustion trap from publishing partial
state; this is not a claim that every raw trapping command is reversible.

## Build and evidence boundary

The extractor records input/fragment hashes, the original scripts and selected
C commands, cleanup/history evidence, and the separate compiled policy pins.
Inherited transformation notes describe earlier layers; the current profile,
policy and checkpoint-eight fields define this module's scope. Optional
extraction parameters default to prior behavior, preserving all eleven earlier
WASM profiles and their 3,382 retained literal cases.

On clean private output, build the retained dependencies before the new gate:

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
```

The pinned compiler creates independent primary/rebuild outputs under
`.local/battle-protect`, with fixed 262,144-byte memory and no host imports.
Reports are `reports/battle-protect-*.json`. A successful build alone establishes
neither literal verification nor the complete application gate; use the dated
reports for actual results. No user account, fixture reset or database mutation
is needed for the private module gate.

Pursuit interception, Mirror Move's full history, other moves/abilities/items,
trainer/double battles and additional statuses remain unsupported. Party-aware
progression/loss/capture application and live durable outcomes are separate
work. Presentation/controller waits and VBlank RNG remain omitted under the
documented headless clock; this is a bounded source-command engine, not an
original-ROM emulator.

## Verified twenty-fourth-pass evidence

Full twenty-two-stage gate passed at 2026-10-02T01:44:14.135Z with native exit 0: 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all eleven prior private engine gates, fresh-process account recovery and all 39 browser scenarios. The Protect gate passed 476 independent source-literal cases, 1,084 accepted transitions and 7,976 RNG draws. All 1,560 host and 1,560 raw boundaries recovered across independent builds and fresh processes, replaying 2,367 future transitions per host/raw path. Rejection checks passed for 142 host and 91 raw cases, with 25 candidate-failure checks and 19 timeout-bounded exhaustion checks. The complete 256-entry ROM policy passed 7,518 raw command checks across primary, rebuild and fresh-process contexts, covering 997 distinct threshold witnesses, both action positions, resets and byte wrapping. These command-domain tests do not establish whole-game reachability. Integration passed 23 groups, 14 coherent capture-party handoffs, 169 restores and 148 diagnostic transitions. Public boundaries passed 94 HTTP checks across 73 built files. All eleven previous WASM artifacts and 3,382 retained literal cases remain byte-identical.

Twenty-fourth-pass focused and full gates passed with implementation and tests frozen. Source, host and independent QA received separate reviews, including action-index handling after Run/Switch, after-faint history ordering, protected release PP and counter/reset recovery. First root integration passed. Review tightened resulting-move history to zero, unavailable, automatic Struggle or a move the current actor knows; fainted recoil history remains valid. QA fixture-construction corrections and any first-run diagnostics are preserved in reports/battle-protect-qa-diagnostics.json; consult that report for the exact causes rather than treating failed runs as passes. The prior gate/browser/charge reports are archived under reports/twentythird-*.json. Focused/full logs: .local/twentyfourth-focused.log and .local/twentyfourth-verify.log; native exits: reports/twentyfourth-*-exit-status.json. No user testing account was logged into, reset or mutated.
