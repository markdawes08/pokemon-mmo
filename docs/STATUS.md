# Project status

Updated: 2026-10-02. Target: R1; the complete requested game remains R3.
P00/P01/P03 are verified; P02/P04/P05/P06 are partial. [Task ledger](TASKS.md).

## Working and verified

Open **http://127.0.0.1:5173** (badge **030**) and choose **Play as ADMINA** or
**Play as ADMINB**. These existing local accounts have ordinary player permissions;
their selected valid session restores on refresh. Use a different trainer in each
browser for shared presence. Walk with arrows/WASD; hold Shift to run outdoors.

Pallet Town, Player's House 1F and Route 1 work in anonymous preview and authenticated
shared exploration. The server owns shared movement, saves, transfers and recovery.
The preview also has bounded source dialogue, a read-only Field guide and optional
Pallet music. Unsupported destinations and stateful scripts fail explicitly.

**Practice battle** offers configurable temporary teams and presets. The latest
addition is **Mirror Move**: select that preset, start, then use Mirror Move to copy
Bubble. The source engine supports eight family species and 25 selectable moves
plus automatic Struggle. New manual battles use Mirror's versioned engine; existing
Pursuit saves and Route 1 wild tests retain their original engine binding.

**Enable wild encounters** enters shared exploration if needed. Walk into Route 1
grass to meet source-generated Pidgey/Rattata using a temporary level-5 Squirtle.
Fight, Run or End encounter test, then return to the same saved tile. Hiding the
battle keeps it active; refresh/reconnect restores it. This switch defaults off.
Practice and wild tests preserve normal party, items, money and story state.

Pass 30's source, storage, recovery, privacy and browser gates passed in combined
evidence. Movement heartbeat stalls and the automatic-checkpoint/Save race were
corrected without weakening generation fences or unknown-outcome UUID replay.
The initial failed browser evidence remains preserved; affected application gates
passed after the fixes. Exact coverage and counts live in
[the verification report](../reports/thirtieth-verification.json),
[Mirror's source contract](../tools/battle-mirror/README.md) and their linked reports.
No gameplay was changed by the current workflow cleanup.

## Current work and remaining scope

Workflow cleanup is verified: reusable focused/milestone commands, resumable
checks, content-based reuse with metadata guards, and fresh stateful checks.
All retained engines and focused application gates passed; fixture bytes and
WASM hashes are unchanged. Detailed timings, coverage and unverified scope are in
[workflow verification](../reports/workflow-verification.json). Commands and cache
requirements are in [RUNBOOK](RUNBOOK.md#verification).

R1 is incomplete. Next gameplay work is **P06 party-aware source victory
progression/result admission**, followed by normal durable battle outcomes.
Owned captures, XP/rewards, evolution/loss application, authoritative NPC scripts,
normal new-game progression and later campaign/multiplayer phases remain required.
Private continuation tests do not establish playable or durable owned outcomes.

Preserve all 14 retained source modules/checkpoint bindings, accounts and saves.
Every new move/Pokemon mechanic must be playable in the testing loop in its chunk.
Keep the reference checkout read-only and content local/private. Source bytes are
pinned by [source-lock.json](../source-lock.json); upstream revision is unknown.
Read-only Git observation is authorized; staging, commits, pushes and other Git
mutations are not. Include a suggested commit message in completed handoffs.

## Running processes

Last verified **2026-10-02T16:41:13.853Z**. Read-only readiness,
existing account listing and process ownership passed; no restart/reset occurred.
[Runtime evidence](../reports/workflow-runtime.json), [process evidence](../reports/workflow-processes.json).

| Process | PID | Address / owner |
|---|---:|---|
| Vite | 34880 | 127.0.0.1:5173 |
| Backend | 31260 | 127.0.0.1:2567 |
| PostgreSQL | 28864 | 127.0.0.1:5433 |
| Launcher / supervisor | 35248 / 30772 | Foreground exec session 38062 |

Launch: 2026-10-02T15:14:44.7498700Z; metadata: `.local/dev-launch.json`.
No browser-test backend remained after the final focused check. Verify current process
ownership before stopping anything. Normal dev shutdown leaves PostgreSQL running.

## Exact next action

Resume P06 party-aware victory progression/result admission with an immediately
playable practice example. Preserve current task acceptance states and normal-owned-outcome
boundaries; use focused checks and the milestone gate appropriate to the change.
