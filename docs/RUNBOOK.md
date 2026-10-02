# Local runbook

Run commands from the project root in PowerShell. Keep reference content private.
Current scope, last verified process ownership and next work are in [STATUS](STATUS.md).

## Start and stop

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. Reuse an already running instance instead of opening
a second one on the same ports. `dev` starts the portable PostgreSQL cluster if
needed, stages browser-safe content and supervises client/backend together.
Ctrl+C stops client/backend and leaves PostgreSQL running. If PowerShell asks to
terminate the batch job, answer `Y`; check logs/listeners because the shell can
report interruption exit 1 after orderly shutdown.

```powershell
npm.cmd run db:stop
npm.cmd run db:start
```

These stop/start PostgreSQL without deleting its data. Check current ownership
before stopping a process; historical PIDs are not proof of ownership today.
After stopping development serving, `npm.cmd run build` then `npm.cmd run start`
serves the built local app at **http://127.0.0.1:2567**.

After an update, apply reviewed migrations with `npm.cmd run db:migrate` and
restart the backend when needed. Migrations through `0007_wild_encounter_testing.sql`
preserve existing data. Keep `BETTER_AUTH_SECRET` stable; changing it invalidates
signed sessions. `BETTER_AUTH_URL` and `APP_ORIGIN` are exact loopback origins.
Use one hostname consistently because cookies belong to that hostname.

## Immediate gameplay testing

Choose **Play as ADMINA** or **Play as ADMINB** in Local testing, Account or unsigned
Practice. No password or extra seeding is needed. The selected valid session
restores on refresh; explicit Sign out clears the preference. These are fixed
local fixtures with ordinary player permissions. The shortcut requires loopback
transport/Host and an allowed Origin, is disabled in production, and never creates
missing accounts or resets their assets. A second tab using the same trainer takes
over its controller; use different trainers to test reciprocal presence.

For a manual battle, open **Practice battle**, end any current test, choose a preset
or edit temporary teams, then **Start battle**. **Mirror Move** uses level-50 Pidgey
against level-40 Blastoise; choose Mirror Move to copy Bubble. Supported moves must
be source-legal at the selected level. Fight, switch, Run and prompted charge/faint
decisions use server choices. Saves survive refresh, reconnect and backend restart.
Hide keeps a battle active; reopen Practice to resume. End test closes it.

For natural encounters, choose **Enable wild encounters**; this enters shared
exploration if necessary. Close any panel and walk north from Pallet into Route 1
grass. Source-generated Pidgey/Rattata open against a temporary level-5 Squirtle.
Use Tackle, Tail Whip or Run, then Return to Route 1. End encounter test returns
early to the same committed grass tile. Hiding freezes movement until the saved
battle is resumed or ended. The switch defaults off and persists per character.
No practice or wild test grants captures, items, XP, money or story progress.

New manual practice uses the Mirror profile. Existing Pursuit practice saves and
Route 1 wild tests retain the exact older engine. An incompatible ordinary
practice can be closed; an incompatible wild checkpoint requires restoring its
compatible engine because its RNG must return to the field. Never delete/reseed a
saved wild encounter to bypass this error.

## Exploration, controls and recovery

Use arrows/WASD to walk, Shift to run outdoors; indoors always walk. Click the
trainer name and **Enter shared world** for authoritative movement and nearby
players. Pallet, Player's House 1F and Route 1 are available. Players do not block
one another; source walls and static NPCs do. Unsupported destinations stop with
a visible explanation. The anonymous preview is independent and unsaved.

Save trainer checkpoints the server location. Finished movement is also saved at
a five-second target, on transfer and on authorized graceful Leave/disconnect.
Enabled wild-test steps commit their finished tile and encounter state together.
Sudden process loss may return to the last committed tile. An unfinished step is
not a saved position. Shared Reset position and normal story/reward scripts remain
unavailable.

Brief transport loss freezes movement, clears held controls and hides the avatar.
Automatic recovery has one sixty-second deadline and requires the same authenticated
session/lease. Wait for fresh snapshots, then release and press a direction again;
offline movement is never replayed. Signout, replacement, terminal errors and Leave
stop recovery. Offline Leave cancels the browser attempt; its hidden server grace
expires independently. Backend loss/grace expiry requires fresh Reconnect trainer;
a prior lease may need up to fifteen seconds to expire.

An uncertain Save keeps its command UUID and payload; after recovery use **Retry
save** to reconcile it. A matching definitive stale rejection may trigger one new
UUID only with a newer same-character/activity/generation snapshot and the original
deadline. BUSY, unknown outcomes and unrelated errors never silently rebase it.
If a completed step begins a wild battle before Save, definitive rejection releases
the pending Save so battle controls remain usable.

In anonymous preview, face an adjacent NPC/sign and press E, Enter or Space. Six
message-only interactions work; stateful rewards/healing explain their missing
support. Escape closes dialogue/Field guide. Focus loss clears movement. Doors
require releasing directions; held movement can cross the Route 1 connection.
The collision overlay is diagnostic; Reset cancels preview transfers and returns
to Pallet. Field guide shows source records, not owned assets or executable effects.

Sound starts off. Enable it with a gesture; Pallet/house share the source theme,
Route 1 remains silent. Select SFX and volume/mute work; blur/hidden tabs pause
sound and returning restarts music. Settings are not persisted. This is a bounded
Web Audio rendition, not GBA hardware emulation.

## First local setup

Windows x64 needs Python 3.12+, an existing Node/npm launcher, network access and
the pinned read-only reference directory. Run separately and stop on failure:

```powershell
py -3 scripts/bootstrap-runtime.py
.\.tools\node-v24.21.0-win-x64\node.exe .\.tools\node-v24.21.0-win-x64\node_modules\npm\bin\npm-cli.js ci
npm.cmd run setup
npm.cmd run source:inventory
npm.cmd run content:build -- --profile firered-private
npm.cmd run doctor
npm.cmd run battle:setup
npm.cmd run verify
```

Setup installs pinned Python/Chromium dependencies, creates absent database/config
and applies reviewed migrations. Existing configuration/data is preserved. The
verifier builds source modules before dependent application checks and startup.
No Git, Docker or Windows service is required. Exact versions/download provenance
are in [ENVIRONMENT](ENVIRONMENT.md).

PostgreSQL defaults to `127.0.0.1:5433`. On first setup only,
`$env:LOCAL_DB_PORT = '5434'` selects another port; it is persisted in
`.local/database.json`. Later environment changes do not reconfigure the cluster.
See the [database README](../packages/database/README.md) for deliberate stopped
reconfiguration. Never print or commit `.env`, `.local/database.json` or
`.local/.env.admin-test-accounts` credentials. One-click testing does not need the
credential file.

## Verification

Use the reusable runner rather than a pass-specific wrapper:

```powershell
npm.cmd run verify:focus -- --area battle --profile mirror --list
npm.cmd run verify:focus -- --area battle --profile mirror
npm.cmd run verify:focus -- --area app
npm.cmd run verify:focus -- --area content
npm.cmd run verify:focus -- --area tooling
npm.cmd run verify
```

`verify:focus` defaults to the current battle profile (Mirror). `--list` shows the
selected dependency stages without running them. `verify` selects the full
milestone gate. Deterministic checks may reuse a passing receipt only when their
declared input/tool/dependency fingerprints and required evidence still match;
database, browser and health checks run fresh. Append `-- --force` to `verify`,
or `--force` to an existing argument list, to rerun deterministic checks too.
A focused run is not evidence that every milestone gate ran.
Engine keys include their own registry entry and relevant fixture metadata, so an
unrelated new profile or npm shortcut does not by itself rebuild older profiles.
Snapshot guards detect metadata edits during a run. Global fixture validation
runs before any selected engine; changes to shared executable code still invalidate
affected results. Keep the catalog's input closures complete when adding commands.
Installed tools are managed through `package-lock.json`, Python requirements and
pinned tool receipts. After manually modifying `node_modules` or the Python
installation, run `npm.cmd run verify -- --force`; do not rely on a prior receipt.

```powershell
npm.cmd run verify:stage -- battle:mirror
npm.cmd run test:workflow
npm.cmd run test:ts
npm.cmd run test:content
```

`verify:stage` runs explicit gate(s) plus their dependency closure for diagnosis;
it does not claim a complete feature gate. `test:workflow` checks runner/catalog
behavior. `test:unit` remains the combined TypeScript/content alias. Each run writes
an immutable `reports/verification-runs/<id>/run.json` plus stage logs/evidence;
these per-run archives stay local and are ignored by Git. Keep the compact chunk
verification report as durable handoff evidence. Cache receipts live under
`.local/verification`; a missing archive prevents reuse. Git is not required for cache keys.
Keep failure evidence and report reused versus fresh checks accurately. Do not
copy counts into multiple Markdown files or write a new pass finalizer.

The underlying focused commands remain available:

| Scope | Command / detailed contract |
|---|---|
| Workspace | `doctor`, `lint`, `typecheck`, `test:unit` |
| Real storage/network | `test:integration`, `testing:check` |
| Content determinism | `content:check`; [importer](../tools/content-import/README.md) |
| Source encounter factory | `encounter:check`; [contract](../tools/encounter-core/README.md) |
| Synthetic / Route 1 | `battle:spike`, `battle:route1` |
| Private result continuations | `battle:progression`, `battle:loss`, `battle:capture`, `battle:evolution` |
| Family profiles | `battle:family`, `battle:party`, `battle:tactics`, `battle:charge`, `battle:protect`, `battle:pursuit`, `battle:mirror` |
| Playable bridge | `practice:check`, `wild:check` |
| Build/privacy/recovery/UI | `build`, `test:boundaries`, `test:recovery`, `test:e2e` |

Run these as `npm.cmd run <command>`. Profile READMEs under `tools/` define source
admission, portability, logical checkpoint and recovery scope; their reports retain
literal expectations and results. Do not replace exact saved-engine compatibility
with a new engine merely because the catalogue gained a move.

Tests use a separate loopback `TEST_DATABASE_URL` ending in `_test` and clean only
their generated fixtures. Serialize database/browser runners. They never seed
normal accounts. Standalone `test:recovery` needs a current build and free port 2570;
standalone `test:e2e` also needs a current build. Built-account scenarios use owned
isolated backends; preview scenarios use the normal preview or `TEST_BASE_URL`.
The runner owns its test children, not the user's development servers.

`content:build` verifies the pinned reference and stages only the browser whitelist
under `.local/client-public/content`; reload after rebuilding. Private definitions,
source archives and operational manifests stay outside the web root. Missing or
unsupported required content must fail visibly rather than present a ready game.

## Optional development fixture

ADMINA/ADMINB already have their fixtures: do not reseed them. Ordinary signup uses
local email/password (12-128 characters), a 1-7 letter uppercase trainer name, and
an empty awaiting-new-game/recovering profile. Email delivery/recovery is absent.
The optional operator command initializes only an untouched staged trainer:

```powershell
npm.cmd run db:seed:dev -- --character <trainer-UUID> --profile r1-squirtle-v1
```

Obtain the existing trainer UUID from authenticated `/api/account`; sign out/close
its connections and let any lease expire first. The explicit fixture grants one
legal level-5 Squirtle, five Potions, five Poke Balls, 3,000 money, Pallet (10,12) and
development markers, with no real story unlocks. An optional `--command <UUID>`
fixes the receipt. Permanent outcome identity prevents repeats from replenishing
assets, even after a different command UUID or receipt removal. Active leases,
existing progress, unsupported profiles and nonlocal/production contexts reject.
The command neither creates auth accounts nor migrates/resets data.
