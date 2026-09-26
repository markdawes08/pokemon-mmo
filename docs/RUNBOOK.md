# Local runbook

P00/P01 and the connected Pallet Town, Player's House 1F and Route 1 preview passed local Windows checks on development and built serving. P04 supports local accounts, persisted trainer profiles and owned party/bag records. The eleventh pass adds bounded shared exploration for the explicit local development fixture; see STATUS for verification state. Story, battles and party management remain unavailable. Keep reference content local/private.

## Start and stop

From the project root in PowerShell:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Click the map, then use arrows/WASD. Movement walks by default; hold Shift to run outdoors. The house always uses walking. Move north into the left house door to enter; step south from the exit mat to return. The north path leads to Route 1, where ledges can be crossed only southward. Anonymous preview movement is local and unsaved; the optional shared development mode below persists its server-owned location. Other destinations stop with an explicit message; encounters and story progression are unavailable.

Click **Account**, then **Create account** or **Sign in**. Local email/password accounts use a 12–128 character password. Choose one trainer name of 1–7 letters; it is stored uppercase and need not be globally unique. Creating a trainer saves it and connects its private profile session. After a reload, choose **Connect trainer**; **Save trainer** persists its profile checkpoint. A second tab takes over the trainer and the first must reconnect before it can save. The opening story is not started, and the renderer's position, audio settings, party and inventory are not changed by this profile save. Expand **Saved party & bag** to inspect the owner-only records; ordinary trainers begin empty. Sign out revokes the cookie session and its character connection. Email verification, reset emails and public account recovery are not connected.

For an existing installation, run `npm.cmd run db:migrate` and restart the backend after updating. Migrations through `0005_world.sql` preserve existing data. Keep the generated `BETTER_AUTH_SECRET` stable across restarts; changing it invalidates existing signed sessions. `BETTER_AUTH_URL` and `APP_ORIGIN` are exact loopback origins. The configured browser/backend ports allow the localhost, 127.0.0.1 and IPv6 loopback aliases; cookies belong to the hostname used, so use the same URL consistently. Auth and character mutations require an allowed Origin header.

Face an adjacent NPC or sign and press E, Enter or Space. Six message-only source interactions work: Pallet's PC-advice resident, Route 1's ledge-advice boy and the town, route and two house signs. E/Enter/Space or Continue advances a page; Escape or Close dismisses it. NPCs remain stationary and block their tiles. Stateful interactions such as Mom's healing and the clerk's Potion reward show an explanation of what is unavailable. RED/BLUE are explicit preview name labels, not saved characters.

Click **Field guide** to browse the 14 selected Pokémon and their base stats, abilities, level-up moves, evolutions and experience totals. Select a species and level; Route 1 encounter shares and item descriptions are also available. Opening it releases movement; Escape or Close returns focus to the map, and a fresh direction press resumes walking. These are reference records, not a party or executable encounters/battles.

The collision overlay highlights blocked tiles, water, ledges, available/unavailable warps and story coordinates. It does not enable interactions. Reset position returns to the Pallet starting tile from any preview map, closes dialogue and cancels an in-progress transfer. Moving focus off the map releases held controls, including Shift. Door transfers and dialogue clear held movement; crossing the Route 1 boundary continues while a direction is held.

Dialogue draws the source normal Latin font, with accessible text retained for screen readers. Sound starts off. Click **Sound off** to enable it, then use the Volume slider or the same button to mute. Pallet Town and the house share the source Pallet theme; Route 1 stays silent until its music is imported. The source select effect plays when a dialogue page opens or advances, or the Field guide opens. Sound pauses on window blur or a hidden tab; returning restarts the theme. Reloading returns to sound off; no settings are saved. Missing audio reports a retryable error while the map remains usable.

`dev` starts the portable PostgreSQL cluster if needed, stages browser-safe content, and launches client/backend together. Ctrl+C stops client/backend and leaves PostgreSQL running. If `npm.cmd` asks to terminate the batch job, answer `Y`. The tested PowerShell PTY reported interruption exit code 1 after orderly application shutdown; check logs/listeners rather than treating this shell code alone as an application failure.

```powershell
npm.cmd run db:stop
```

This stops PostgreSQL and retains its data. `npm.cmd run db:start` restarts it. Current owned sessions/PIDs are recorded in `STATUS.md`; do not stop unrelated processes. If the preview is already running, use its existing URL instead of launching a second copy on the same ports.

## Local development fixture

Two ready-to-use local testing accounts were explicitly created at the user's request: `admin1@pokewaterblue.test` (ADMINA) and `admin2@pokewaterblue.test` (ADMINB). Both have ordinary player permissions and the fixture below. Their shared testing password is in `.local/.env.admin-test-accounts`; passwords are not kept in this runbook or public content. In separate browsers, sign into different accounts at `http://127.0.0.1:5173`, then select **Account → Enter shared world**. Their saved starting positions are beside each other in Pallet Town. No further seeding is needed for these two accounts. Verification sessions were signed out so they are ready for use.

The optional fixture is a local operator command, never part of signup or a browser mutation. It is deliberately visible as **Development fixture** in Saved party & bag. It grants one legal source-defined level-5 Squirtle (Tackle and Tail Whip), five Potions, five Poke Balls, 3,000 money, a safe Pallet anchor at (10,12), and two named development markers. It sets no actual story unlocks. The trainer begins in recovering activity and can explicitly enter shared development exploration. Battles remain unavailable. Torrent and Tail Whip still need battle-engine implementation before this becomes a playable R1 team.

Create an ordinary trainer first. While signed in, open `/api/account` on the same preview origin and copy `character.id`. Sign out or close all connected trainer tabs, then allow the 15-second lease to expire if necessary. Run:

```powershell
npm.cmd run db:seed:dev -- --character <trainer-UUID> --profile r1-squirtle-v1
```

An optional `--command <UUID>` makes the command receipt explicit. Repeating the command, including with a different command UUID, returns the original permanent outcome without granting more assets. Sign in again and expand **Saved party & bag**. No existing user account is seeded automatically by setup, migration, verification or this pass.

Only an untouched staged trainer without assets/progression can be initialized. Active leases, unsupported profiles, tester/production modes, non-loopback databases and database URLs with query overrides are rejected. The CLI does not create auth accounts or migrate/reset data. The source content is hash-pinned; changed content requires auditing a new profile version. Permanent outcomes and audit rows are retained; no receipt/outcome pruning command exists. Battle, script and trade effects must implement their own durable recovery before being enabled.

## Shared development exploration

Initialize the optional fixture above, then sign in and choose **Account → Enter shared world**. Entry is explicit; ordinary staged trainers cannot use it. The mode label switches from **Anonymous preview** to **Shared world**. Two independent browser contexts with separately seeded trainers see each other within the same map, including public names. Players do not block one another; source walls and visible NPCs do. The nearby list changes when a trainer enters, leaves or changes maps.

Use the same walking and Shift controls. Running is disabled indoors. The server accepts directions, validates source traversal and owns the position. Pallet, the house and Route 1 are available; other destinations, shared dialogue, encounters and story interactions remain unavailable. The anonymous preview retains its six message-only interactions. Reset position is disabled while shared exploration is active.

**Save trainer** checkpoints the authoritative location. Finished movement is also checkpointed periodically (five-second target), on a map transfer, and during authorized graceful disconnect/leave. A revoked or expired account session cannot save further movement. A sudden process loss may return the trainer to its last committed position; an unfinished step is not a saved tile. Checkpoints contain map, tile, elevation and facing; they do not grant items or story progress.

**Leave shared world** restores the anonymous preview position. If the connection ends, movement freezes and nearby avatars clear; open Account to reconnect, or leave to resume anonymous exploration. Reconnection uses fresh authenticated admission and the committed location. After an abrupt backend exit, its previous lease can delay reconnection for up to fifteen seconds; retry afterward. A replacement tab disconnects its predecessor. After a full page reload, enter the shared world explicitly again. Stale map data gives a reload/rebuild error before shared movement is admitted.

The first implementation uses logical map groups over the existing private character connection in one backend process. It does not start a separate game server per map. See ADR-012 for the bounded topology and unverified later scaling/story work. No normal development accounts are created or seeded by verification.

## First local setup

Windows x64 prerequisites: Python 3.12+, an existing Node/npm launcher, network access, and the pinned reference directory. Run separately and stop if a command fails:

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

Setup installs pinned Python dependencies and Chromium, creates the local database/configuration if absent, and applies the baseline migration. Existing `.env` and database settings are preserved. No Git, Docker or Windows service is required. Node and PostgreSQL downloads are hash checked with the provenance recorded in `ENVIRONMENT.md`/`DECISIONS.md`.

The default database listener is `127.0.0.1:5433`. To select another free port on the first setup only, set `$env:LOCAL_DB_PORT = '5434'` before setup. It must be an integer from 1 to 65535. The value is persisted in `.local/database.json`; changing the variable later does not reconfigure an existing cluster. Follow `../packages/database/README.md` for deliberate stopped-cluster reconfiguration. Never print or commit `.env`/`.local/database.json` credentials.

## Checks and built preview

`npm.cmd run verify` runs ten stages: doctor, lint, typecheck, TypeScript/Python tests, database/network/asset/world/supervisor integration, independent content rebuild, the C/WASM battle experiment, build, built-backend account recovery and browser tests. Failures fail the command. Detailed results are under `reports/`; the full current run is `reports/verification.json`.

The account integration checks use a separate loopback `TEST_DATABASE_URL` ending in `_test` and remove only their generated fixtures. `npm.cmd run test:recovery` requires a current build and free port 2570; it starts two separate built backend processes, verifies session/profile/receipt recovery, and shuts them down. Account browser scenarios serve the built client through an isolated backend on a random test port; asset browser scenarios use a separate owned backend OS process to isolate the auth library rate-limit state; the other browser scenarios use the normal preview or `TEST_BASE_URL`. Run `npm.cmd run build` before standalone `test:e2e` or `test:recovery`. Neither command seeds user accounts into the normal development database.

`npm.cmd run build` builds client/backend. After stopping the development preview, `npm.cmd run start` serves the built app on `http://127.0.0.1:2567`. It also starts the local database if configured. Retained fifth-pass checks passed all 25 browser scenarios and verified graceful shutdown on an isolated port. It remains a local preview, not a tester deployment.

`npm.cmd run content:build` verifies the pinned reference, converts the bounded maps and gameplay definitions, and stages browser-safe output into `.local/client-public/content` for the running Vite server. Reload the browser after a successful build. `npm.cmd run content:check` independently rebuilds and compares hashes. Only `content/generated/client` is staged; private server definitions, manifests and the reference snapshot stay outside the web root. A missing manifest, map, required image or invalid Field guide record gives a visible rebuild error instead of declaring the preview ready.

`npm.cmd run db:migrate` applies reviewed SQL migrations. The test database is separate and configured by `TEST_DATABASE_URL`; test URLs must not point to real user data. Database lifecycle and migration/restart evidence is in `reports/backend-verification.json`.

## Optional battle experiment toolchain

`npm.cmd run battle:setup` downloads the pinned Zig 0.16.0 Windows x64 archive from its official source, verifies its size/SHA256 and installs it under `.tools/`. No PATH, registry or system service changes are made. This compiler is required for the current ten-stage `verify`; ordinary `dev`/`start` use existing generated content without it.

`npm.cmd run battle:spike` verifies the compiler receipt, extracts pinned C inputs twice and compiles identical private WASM modules. It runs damage/RNG and turn goldens, C checkpoint rejection, logical recovery across independent builds/fresh Node processes, the six-method adapter and resource measurements. Reports are `reports/battle-spike-*.json`; outputs stay under `.local/battle-spike`. Missing tools, incompatible checkpoints and unsupported states fail clearly. Measurement output is observational and varies with machine load; it does not assert the later database/population/soak gates. No grass encounters, inventory effects or live saves are enabled. See [the experiment README](../tools/battle-spike/README.md) and [ADR-001](DECISIONS.md#adr-001---battle-implementation).
