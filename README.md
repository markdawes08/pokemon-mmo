# PokéWaterBlue

A local browser game foundation and source-derived three-area exploration preview.
The complete MMO remains in development; see [project status](docs/STATUS.md) and
the [project plan](docs/PROJECT_PLAN.md).

## Run the preview

From this folder in PowerShell:

```powershell
npm.cmd run dev
```

Open <http://127.0.0.1:5173>. Click the map, then use arrow keys or WASD.
Walking is the default; hold Shift to use the Running Shoes outdoors. Indoors, movement stays at
walking speed. Face a person or sign and press E, Enter, or Space to interact.
Use the same keys to advance dialogue, or Escape to close it.
Dialogue uses the source pixel font. Click **Sound off** to enable Pallet Town
music (also inside the house) and dialogue sounds; adjust the volume beside it.
Sound pauses when the preview is inactive. Route 1 music is not included yet.
Click **Field guide** to browse 14 starter-family and Route 1 Pokémon, their
stats, level-up moves, evolutions, experience tables, items and encounter shares.
The guide is a reference; opening it pauses movement. Escape or Close returns to the map.
The collision overlay highlights blocked tiles, ledges, water, doors, and story triggers.
Reset position returns to the preview spawn. Movement is local and is not saved.
Open http://127.0.0.1:5173 and click **Play as ADMINA** or **Play as ADMINB** in the visible **Local testing** panel. No email, password, account creation or separate Connect trainer step is required. Then click **Practice battle**, or click the trainer name in the topbar and **Enter shared world**. Use a different trainer in each browser to see both players. The selected valid session reconnects on refresh. After explicit sign-out or session expiry, the same one-click buttons remain available. Selecting the same trainer in another tab retains the existing one-character/one-controller replacement rule.

Click **Account** to create a local account or sign in, choose a trainer name,
and save its profile. An existing trainer can reconnect after a reload or backend
restart. Connecting it in another tab replaces the previous trainer connection.
Profiles are stored in PostgreSQL. Trainers with the explicit development fixture
can choose **Enter shared world** to see other signed-in trainers and move through
the three supported maps. Shared positions save through checkpoints and Save;
brief connection interruptions can resume within the fixed grace period.
Isolated practice battles are playable with a development trainer. Normal wild
encounters, opening story and battle rewards remain unfinished. Email verification
and password recovery are not connected.
Expand **Saved party & bag** in Account to inspect your persisted records. New
trainers start empty. A separate [local developer fixture](docs/RUNBOOK.md#local-development-fixture)
can supply a source-defined Squirtle and starting items for upcoming development.
Walk north into Route 1 or enter the player's house through its door. The ground
floor, return exit, route connections, and one-way ledges work in this preview.
Five NPCs appear at their source starting positions and block occupied tiles.
Simple source conversations and signs are readable; story-dependent interactions
explain that they are unavailable. These simple interactions belong to the
anonymous preview; shared dialogue, NPC wandering, story progression and normal world battles
remain future work. Other destinations remain blocked.

Ctrl+C stops the client and backend. The local database retains its data.
To stop it too: `npm.cmd run db:stop`.

## Setup on Windows x64

Requirements: Python 3.12+, an existing Node/npm installation to invoke commands,
and network access for package/runtime downloads. No Git or Docker is required for
the local preview. The reference folder is read-only; its exact bytes are captured in
`source-lock.json` and the private `reference/` snapshot.

Run each command separately and stop on a failure:

```powershell
py -3 scripts/bootstrap-runtime.py
.\.tools\node-v24.21.0-win-x64\node.exe .\.tools\node-v24.21.0-win-x64\node_modules\npm\bin\npm-cli.js ci
npm.cmd run setup
npm.cmd run source:inventory
npm.cmd run content:build -- --profile firered-private
npm.cmd run doctor
npm.cmd run battle:setup
.\.venv\Scripts\python.exe tools/battle-pursuit/build.py
.\.venv\Scripts\python.exe tools/battle-mirror/build.py
npm.cmd run verify
npm.cmd run dev
```

The direct Pursuit and Mirror builds prepare the server-loaded WASMs before the unit
and integration stages need them. The full gate later rebuilds and verifies all
retained engine profiles. Run this prerequisite on a clean setup before `verify`
or starting the backend.

The scripts use project-local Node 24 and PostgreSQL 17. Setup preserves an existing
`.env`. Database credentials stay in ignored local files. Keep `.env`, `.local/`,
`reference/`, and reference-profile content private. The P03 compiler setup installs a pinned optional
compiler inside `.tools/`; it is required by the current verification gate, not by
the running browser preview.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm.cmd run verify` | Foundation, preview and current battle experiment checks |
| `npm.cmd run test:recovery` | Verify saved accounts/profiles across two built backend processes |
| `npm.cmd run battle:setup` | Install the pinned local C-to-WASM experiment compiler |
| `npm.cmd run battle:spike` | Rebuild and verify the bounded headless source battle prototype |
| `npm.cmd run encounter:check` | Verify private Route 1 encounter generation and recovery |
| `npm.cmd run battle:route1` | Verify private real-team Fight/Run/Potion/Poke Ball mechanics |
| `npm.cmd run battle:progression` | Verify private victory progression and move decisions |
| `npm.cmd run battle:loss` | Verify private faint/blackout mechanics and pending world handoff |
| `npm.cmd run battle:capture` | Verify private capture metadata, nickname and party/PC placement |
| `npm.cmd run battle:evolution` | Verify private evolution decisions and resulting stats, names, dex and moves |
| `npm.cmd run battle:family` | Verify private eight-species family combat and source-result diagnostic bridges |
| `npm.cmd run battle:party` | Verify private party switching, faint decisions and coherent capture-party diagnostics |
| `npm.cmd run battle:tactics` | Verify private rain, fixed damage, Rapid Spin and wild Whirlwind mechanics |
| `npm.cmd run battle:charge` | Verify private Skull Bash charging, forced continuation and recovery |
| `npm.cmd run battle:protect` | Verify private Protect, its pinned repeat-rate policy and recovery |
| `npm.cmd run testing:check` | Verify one-click testing access, session reuse/switching and local-only guards |
| `npm.cmd run practice:check` | Verify source practice teams, sprites, persisted turns and recovery |
| `npm.cmd run battle:pursuit` | Verify private Pursuit attacks, switch interception and recovery |
| `npm.cmd run battle:mirror` | Verify Mirror Move copying, move history, borrowed charging and recovery |
| `npm.cmd run content:check` | Rebuild independently and verify generated hashes |
| `npm.cmd run build` | Build the client and backend |
| `npm.cmd run start` | Serve the built preview at http://127.0.0.1:2567 |
| `npm.cmd run db:start` / `db:stop` | Start/stop the project-local database |
| `npm.cmd run db:migrate` | Apply reviewed migrations |
| `npm.cmd run db:seed:dev -- --character <UUID> --profile r1-squirtle-v1` | Apply the explicit local development fixture to a disconnected staged trainer |

See [environment](docs/ENVIRONMENT.md), [runbook](docs/RUNBOOK.md), and
[importer notes](tools/content-import/README.md) for details and limitations.

The completed bounded battle experiment supports source-driven attacks, switches,
status, fainting and outcomes, with portable recovery and a private server adapter.
ADR-001 selects C/WASM source commands with TypeScript turn scheduling. An isolated
practice UI now uses the later Pursuit profile. Normal world encounters, owned-party
management and reward application remain later work. Owned asset records and
their read-only account view are implemented.
See [the experiment notes](tools/battle-spike/README.md) for its verified scope
and remaining mechanics and persistence requirements.

Private Route 1 combat, victory progression, blackout, capture and evolution continuations
build on that architecture. The retained family and party profiles verify eight-species
combat, one-to-six-member switching and recoverable faint/replacement decisions.
The separate [tactics profile](tools/battle-tactics/README.md) extends coverage to 21 family
moves with Super Fang, Endeavor, Rapid Spin, Rain Dance and ordinary-wild Whirlwind.
The [charge profile](tools/battle-charge/README.md) adds Skull Bash for 22 moves,
including its recoverable two-turn lock and forced release with no second PP cost.
The [Protect profile](tools/battle-protect/README.md) adds Protect for 23 moves,
including a separately pinned ROM policy for repeated Protect attempts.
The [Pursuit profile](tools/battle-pursuit/README.md) adds the 24th move, including
source switch interception and selected-switch continuation after a knockout.
The [Mirror profile](tools/battle-mirror/README.md) adds Mirror Move as the 25th,
including copied effects, source move history and borrowed Skull Bash charging.
The **Practice battle** button now exposes these mechanics through signed-in local development
trainers. Choose a preset or configure a temporary team; battles save after each action and
resume after refresh or reconnect. Practice grants no owned assets, rewards or world changes.
Choose the **Mirror Move** preset and **Start battle** to try Pidgey copying Bubble.
End any current practice first. Existing saved battles resume with their original engine.
Complete party-aware results, durable ownership,
arrival scripts and normal world-battle outcome application remain necessary. See [current status](docs/STATUS.md)
for verified gates and remaining work.
