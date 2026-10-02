# Source Mirror Move profile

`firered-family-mirror-v1` adds Mirror Move to the eight-species source family
roster: 25 selectable level-up moves plus automatic Struggle. The new module
and checkpoint version 10 are separate from all thirteen retained modules.
Existing Pursuit practice saves and Route 1 wild tests retain their original
engine binding. New practice battles can select Mirror Move immediately.
This profile does not add normal progression, captures, XP or rewards.

## Source behavior

The extraction retains the complete `Cmd_trymirrormove` from
`src/battle_script_commands.c:6350` and `GetMoveTarget` from
`src/battle_util.c:3054`. A successful copy uses the source target selection,
including the selected-target rejection-sampling RNG loop in singles. The
source effect table chooses the effect script; explicit pointer identity tags
transport that jump to the existing bounded source-command schedules. This
does not claim to interpret arbitrary battle scripts.

Mirror Move keeps its selected action priority and occupied PP slot. The
copied move supplies damage, type, target and effect behavior. No owned
moveset is rewritten. A copy failure spends one Mirror PP without attack RNG;
flinch cancels before copying and spends no PP. A copied attack can miss or be
blocked by Protect after its target RNG. Protect itself has no source Mirror
flag, so a natural history can never copy it.

Copied Struggle spends Mirror PP and runs the source recoil effect. A copied
Skull Bash pays Mirror PP on the charging turn, locks move 130 while retaining
the original Mirror slot, and releases without another PP debit. Its forced
release uses the source locked move as the original chosen move. A copied
Pursuit is an ordinary attack; selecting Mirror Move cannot intercept a
switch. Copied Whirlwind retains the ordinary-wild terminal script behavior,
including bypassing ordinary move-end history on successful escape.

The selected `MOVEEND_MIRROR_MOVE` branch from
`src/battle_script_commands.c:4284` uses the original `gChosenMove` and its
flags. A copied hit was chosen as Mirror Move (flags zero), so it cannot create
a chain of copied-move history. Skull Bash's forced release was chosen as move
130 and can create history. Failed, missed, protected and target-KO actions
follow the source guards. Faint continuation restores the original action's
attacker, target, result flags and chosen move before applying history.

The complete retained `SwitchInClearSetData` and `FaintClearSetData` bodies
clear the source history rows and columns. Pursuit's ActionSwitch script has
no attackcanceler: the obedience marker remains clear, so its final Mirror
move-end case cannot record an interception. The ordinary switch cleanup
still clears both singles participants' history.

## ABI and recovery

The ABI retains the Pursuit exports and adds `mirror_get(actor, field)`:

| Field | Observation |
| --- | --- |
| 0 | Actor's source last-taken move |
| 1 | Actor's source move last taken from the opponent |
| 2 | Actual move dispatched by the most recent attack |
| 3 | Whether that attack successfully selected a copy |

Fields 2 and 3 describe the just-completed atomic attack, before faint
continuation. Failure/flinch reports move 119 and no copy. A copied charging
turn reports move 130 and a copy; its forced release reports move 130 without
a new copy. These observations are not future-read checkpoint state.

Version 10 retains 512 logical words. New words 495/496 store each actor's
`lastTakenMove`; 497/498 store the two opposing `lastTakenMoveFrom` entries.
Words 499–511 remain reserved zero. Noncharging copied moves can also write
the already-existing target words 489/490 through source `GetMoveTarget`.
All other source matrix entries remain zero in admitted singles.

Pending copy/attack/faint/move-end work is atomic and cannot be checkpointed.
Raw import checks the reachable singles history shape: primary and opposing
history match, empty history is zero, recorded moves have the source Mirror
flag, and recorded moves have an eligible source with spent PP. An automatic
Struggle history requires its source's PP to be exhausted. Source fallback
and unavailable-sentinel branches remain extracted but cannot be fabricated
through a settled singles checkpoint. These checks are bounded semantic
validation; immutable admission, lineage and non-replenishment remain host
responsibilities, not a proof of every historical input.

## Build and limits

```powershell
python tools/battle-mirror/build.py
npm.cmd run battle:mirror
```

The builder produces matching primary/rebuild modules under
`.local/battle-mirror` with 262,144-byte fixed memory and no imports. The
source snapshot fingerprint and extraction fragments are recorded in
`reports/battle-mirror-build.json`; upstream revision remains unknown.
Build reproducibility alone does not establish literal or application
verification. Consult the verification, integration and full-gate reports
for actual completed checks.

The original `firered-protect-rom-v1` policy and its 256-entry bounded ROM
lookup are unchanged. Its compiled reference artifacts remain read-only;
neither original ROM execution nor a matching ROM rebuild is claimed.
Presentation waits, VBlank RNG, doubles/trainers, opposing party switching,
other species/moves/statuses/abilities and held items remain outside this
profile. Unsupported required contexts fail explicitly.
