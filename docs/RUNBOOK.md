# Local runbook

P00/P01 and the connected Pallet Town, Player's House 1F and Route 1 preview passed local Windows checks on development and built serving. P04 supports local accounts, persisted trainer profiles and owned party/bag records. Shared development exploration and automatic recovery from brief transport loss are verified. The app now exposes the retained source battle engine through isolated practice for development trainers, with separate saved sessions. Normal world encounters, story, capture/rewards and owned-party management remain unfinished; see STATUS for the latest completed gate. Keep reference content local/private.

## Start and stop

From the project root in PowerShell:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Click the map, then use arrows/WASD. Movement walks by default; hold Shift to run outdoors. The house always uses walking. Move north into the left house door to enter; step south from the exit mat to return. The north path leads to Route 1, where ledges can be crossed only southward. Anonymous preview movement is local and unsaved; the optional shared development mode below persists its server-owned location. Other destinations stop with an explicit message; encounters and story progression are unavailable.

Click **Account**, then **Create account** or **Sign in**. Local email/password accounts use a 12–128 character password. Choose one trainer name of 1–7 letters; it is stored uppercase and need not be globally unique. Creating a trainer saves it and connects its private profile session. After a reload, choose **Connect trainer**; **Save trainer** persists its profile checkpoint. A second tab takes over the trainer and the first must reconnect before it can save. The opening story is not started, and the renderer's position, audio settings, party and inventory are not changed by this profile save. Expand **Saved party & bag** to inspect the owner-only records; ordinary trainers begin empty. Sign out revokes the cookie session and its character connection. Email verification, reset emails and public account recovery are not connected.

For an existing installation, run `npm.cmd run db:migrate` and restart the backend after updating. Migrations through `0006_practice_battles.sql` preserve existing data and add isolated practice records. Keep the generated `BETTER_AUTH_SECRET` stable across restarts; changing it invalidates existing signed sessions. `BETTER_AUTH_URL` and `APP_ORIGIN` are exact loopback origins. The configured browser/backend ports allow the localhost, 127.0.0.1 and IPv6 loopback aliases; cookies belong to the hostname used, so use the same URL consistently. Auth and character mutations require an allowed Origin header.

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

The optional fixture is a local operator command, never part of signup or a browser mutation. It is deliberately visible as **Development fixture** in Saved party & bag. It grants one legal source-defined level-5 Squirtle (Tackle and Tail Whip), five Potions, five Poke Balls, 3,000 money, a safe Pallet anchor at (10,12), and two named development markers. It sets no actual story unlocks. The trainer begins in recovering activity and can explicitly enter shared development exploration or isolated practice battles. Practice saves its temporary teams separately and grants no assets or rewards. Normal world battle admission, progression, complete owned-capture handling and durable outcomes are still required before playable R1 battles.

Create an ordinary trainer first. While signed in, open `/api/account` on the same preview origin and copy `character.id`. Sign out or close all connected trainer tabs, then allow the 15-second lease to expire if necessary. Run:

```powershell
npm.cmd run db:seed:dev -- --character <trainer-UUID> --profile r1-squirtle-v1
```

An optional `--command <UUID>` makes the command receipt explicit. Repeating the command, including with a different command UUID, returns the original permanent outcome without granting more assets. Sign in again and expand **Saved party & bag**. No existing user account is seeded automatically by setup, migration, verification or this pass.

Only an untouched staged trainer without assets/progression can be initialized. Active leases, unsupported profiles, tester/production modes, non-loopback databases and database URLs with query overrides are rejected. The CLI does not create auth accounts or migrate/reset data. The source content is hash-pinned; changed content requires auditing a new profile version. Permanent outcomes and audit rows are retained; no receipt/outcome pruning command exists. Normal world-battle outcomes, scripts and trades must implement their own durable recovery before being enabled; isolated practice uses separate state and receipts.

## Shared development exploration

Initialize the optional fixture above, then sign in and choose **Account → Enter shared world**. Entry is explicit; ordinary staged trainers cannot use it. The mode label switches from **Anonymous preview** to **Shared world**. Two independent browser contexts with separately seeded trainers see each other within the same map, including public names. Players do not block one another; source walls and visible NPCs do. The nearby list changes when a trainer enters, leaves or changes maps.

Use the same walking and Shift controls. Running is disabled indoors. The server accepts directions, validates source traversal and owns the position. Pallet, the house and Route 1 are available; other destinations, shared dialogue, encounters and story interactions remain unavailable. The anonymous preview retains its six message-only interactions. Reset position is disabled while shared exploration is active.

**Save trainer** checkpoints the authoritative location. Finished movement is also checkpointed periodically (five-second target), on a map transfer, and during authorized graceful disconnect/leave. A revoked or expired account session cannot save further movement. A sudden process loss may return the trainer to its last committed position; an unfinished step is not a saved tile. Checkpoints contain map, tile, elevation and facing; they do not grant items or story progress.

**Leave shared world** restores the anonymous preview position. Brief network interruption now shows **Shared world reconnecting** and automatically tries to recover the same character transport for up to sixty seconds. Movement freezes, held directions and Shift clear, and the disconnected avatar disappears from other players' presence. Failed attempts do not extend the original deadline. Recovery waits for fresh server snapshots before movement is enabled; release and press a direction again. No offline movement or command queue is replayed.

The server requires the same current authenticated cookie session and character owner, renews the fenced lease during the bounded grace, and advances the connection generation on resume. Old-generation input is rejected. The private snapshot's `worldActive` flag identifies the actual retained shared activity: reconnecting a profile-only trainer does not enter the world just because a previous saved activity was overworld. Native WebSocket resume and the SDK's manual reconnect HTTP route are both subject to server authentication checks. Reconnect tokens remain in process/browser memory; they are not saved as account credentials.

If a Save was awaiting confirmation when the connection dropped, it is not automatically resent. After recovery, **Retry save** checks the same command ID and unchanged payload. This safely reconciles an acknowledged-late or uncertain Save; a definitive stale-revision error requires a new user Save. It does not silently overwrite revisions or promise that an unfinished step was saved.

**Leave shared world**, signout, replacement by another tab, and terminal errors stop automatic recovery. Leaving while offline cancels the browser's attempts and returns to preview; the offline browser cannot deliver Leave to the server, so its already-hidden server reservation expires within the original grace. Signing out still requires the HTTP request to succeed before the cookie session is revoked. After signout, the shared scene stays frozen and disconnected until you choose **Leave shared world** to return to anonymous preview. A replaced tab must be explicitly reconnected to take control again.

Grace cannot recover a lost backend process. After server shutdown, process loss, grace expiry or a terminal rejection, use **Account → Reconnect trainer** for fresh authenticated admission and the committed location. An abrupt exit can leave the previous database lease active for up to fifteen seconds; retry after it expires. A sudden loss may discard walking since the last checkpoint. After a full page reload, enter shared exploration explicitly again. Stale map data gives a reload/rebuild error before shared movement is admitted.

Twelfth-pass verification: 17 real PostgreSQL/native-SDK reconnect groups passed, with actual grace expiry at 60,512 ms; four built-client reconnect scenarios and all 39 browser scenarios passed in the full ten-stage gate at 2026-09-27T00:29:21.516Z. The network report includes authenticated manual HTTP lookup and clean shutdown during an active grace. See reports/reconnect-network.json, reports/reconnect-browser.json, reports/verification.json and reports/reconnect-runtime.json. Historical results above retain their original scope. Existing ADMINA/ADMINB accounts remain unchanged. General private story overlays and durable battle/script/trade continuations remain incomplete.

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
.\.venv\Scripts\python.exe tools/battle-pursuit/build.py
npm.cmd run verify
```

Setup installs pinned Python dependencies and Chromium, creates the local database/configuration if absent, and applies reviewed migrations. The direct Pursuit build prepares the current server-loaded WASM before unit/integration checks or backend startup; the full gate later rebuilds and verifies all retained engine profiles. Existing `.env` and database settings are preserved. No Git, Docker or Windows service is required. Node and PostgreSQL downloads are hash checked with the provenance recorded in `ENVIRONMENT.md`/`DECISIONS.md`.

The default database listener is `127.0.0.1:5433`. To select another free port on the first setup only, set `$env:LOCAL_DB_PORT = '5434'` before setup. It must be an integer from 1 to 65535. The value is persisted in `.local/database.json`; changing the variable later does not reconfigure an existing cluster. Follow `../packages/database/README.md` for deliberate stopped-cluster reconfiguration. Never print or commit `.env`/`.local/database.json` credentials.

## Checks and built preview

`npm.cmd run verify` runs twenty-four stages: doctor, lint, typecheck, TypeScript/Python tests, database/network/asset/world/supervisor integration, independent content rebuild, the original C/WASM battle experiment, encounter factory, real-team Route 1 battle mechanics, victory progression, blackout continuation, capture continuation, evolution continuation, family combat, party switching, tactics, charge continuation, Protect, Pursuit, playable-practice checks, build, public/private file boundaries, built-backend account recovery and browser tests. Failures fail the command. Detailed results are under `reports/`; the current run is `reports/verification.json`.

The account integration checks use a separate loopback `TEST_DATABASE_URL` ending in `_test` and remove only their generated fixtures. `npm.cmd run test:recovery` requires a current build and free port 2570; it starts two separate built backend processes, verifies session/profile/receipt recovery, and shuts them down. Account browser scenarios serve the built client through an isolated backend on a random test port; asset browser scenarios use a separate owned backend OS process to isolate the auth library rate-limit state; the other browser scenarios use the normal preview or `TEST_BASE_URL`. Run `npm.cmd run build` before standalone `test:e2e` or `test:recovery`. Neither command seeds user accounts into the normal development database.

`npm.cmd run build` builds client/backend. After stopping the development preview, `npm.cmd run start` serves the built app on `http://127.0.0.1:2567`. It also starts the local database if configured. Retained fifth-pass checks passed all 25 browser scenarios and verified graceful shutdown on an isolated port. It remains a local preview, not a tester deployment.

`npm.cmd run content:build` verifies the pinned reference, converts the bounded maps and gameplay definitions, and stages browser-safe output into `.local/client-public/content` for the running Vite server. Reload the browser after a successful build. `npm.cmd run content:check` independently rebuilds and compares hashes. Only `content/generated/client` is staged; private server definitions, manifests and the reference snapshot stay outside the web root. A missing manifest, map, required image or invalid Field guide record gives a visible rebuild error instead of declaring the preview ready.

`npm.cmd run db:migrate` applies reviewed SQL migrations. The test database is separate and configured by `TEST_DATABASE_URL`; test URLs must not point to real user data. Database lifecycle and migration/restart evidence is in `reports/backend-verification.json`.

## Optional battle experiment toolchain

`npm.cmd run battle:setup` downloads the pinned Zig 0.16.0 Windows x64 archive from its official source, verifies its size/SHA256 and installs it under `.tools/`. No PATH, registry or system service changes are made. This compiler is required for the current twenty-four-stage `verify`; ordinary `dev`/`start` use existing generated content and the previously built Pursuit WASM without compiling it.

`npm.cmd run battle:spike` verifies the compiler receipt, extracts pinned C inputs twice and compiles identical private WASM modules. It runs damage/RNG and turn goldens, C checkpoint rejection, logical recovery across independent builds/fresh Node processes, the six-method adapter and resource measurements. Reports are `reports/battle-spike-*.json`; outputs stay under `.local/battle-spike`. Missing tools, incompatible checkpoints and unsupported states fail clearly. Measurement output is observational and varies with machine load; it does not assert the later database/population/soak gates. No grass encounters, inventory effects or live saves are enabled. See [the experiment README](../tools/battle-spike/README.md) and [ADR-001](DECISIONS.md#adr-001---battle-implementation).

`npm.cmd run encounter:check` independently builds the private Route 1 encounter module twice, checks the real-team dependency ledger, and verifies source-derived encounter/creature fixtures and checkpoint recovery. It uses the same pinned compiler; no additional installation is needed. Outputs stay under `.local/encounter-core`, with evidence in `reports/encounter-*.json`. The factory has no room, browser, account or database entry point and does not enable grass battles. See [its scope and source boundary](../tools/encounter-core/README.md).

`npm.cmd run battle:route1` independently builds the private real-team profile twice, checks retained Fight/Run and new Potion/Poke Ball source fixtures, verifies capture/inventory checkpoint recovery and exercises the existing six-method adapter. The captured result stops at pending disposition; it does not grant an owned creature. Run `encounter:check` first when its artifacts are absent. Source fixtures are test-only evidence; the command neither logs into testing accounts nor writes their assets. Outputs stay under `.local/battle-route1`, with evidence in `reports/battle-route1-*.json`. See [the profile scope](../tools/battle-route1/README.md) and ADR-015/016. Old real-profile snapshots are rejected after the version upgrade; no durable battle migration is implied.

`npm.cmd run test:boundaries` requires completed `battle:spike`, `encounter:check`, `battle:route1`, `battle:progression`, `battle:loss`, `battle:capture`, `battle:evolution`, `battle:family`, `battle:party`, `battle:tactics`, `battle:charge`, `battle:protect`, `battle:pursuit` and `build` outputs. It scans the built public tree for private paths/WASM/selected identifiers, then starts an isolated Vite server on an ephemeral loopback port. Real private files must return HTTP 403 for direct, raw and URL requests, while the app and public content remain available. The server is closed afterward. Reports: `client-bundle-check.json` and `private-client-boundary.json`. This is a focused package/content boundary check, not a general security audit.


Thirteenth-pass verification: Full twelve-stage gate passed at 2026-09-27T01:05:06.972Z. 86 Vitest tests, 49 Python tests, 34 profile storage checks, 21 account/network groups, 30 asset groups, 27 world storage groups, 18 world network groups, 17 reconnect groups, retained battle checks, built account recovery and all 39 browser scenarios passed. The new encounter gate passed 43 independent creature cases, 17 transcripts/374 steps, 417 cross-build checkpoint boundaries and 93 fresh-process restores. The public boundary gate passed 31 HTTP checks and scanned 73 built files. Reports: encounter-core-verification.json, encounter-core-recovery.json, private-client-boundary.json, verification.json and encounter-runtime.json. This is a private encounter foundation; live R1 battles, captured assets and durable battle activity remain unimplemented.

Fourteenth-pass verification: Full thirteen-stage gate passed at 2026-09-28T05:09:26.290Z. All 39 browser scenarios passed, along with retained unit, Python, database/network, content, synthetic battle, encounter and process-recovery checks. The real-team profile passed 21 independent literal scenarios/44 turns with 406 checked RNG draws, 65 cross-build boundaries and 65 fresh-process restores replaying 95 transitions. Integration passed all twelve real encounter slots across 45 natural turns. The public boundary gate passed 37 HTTP checks and scanned 73 built files. The live app remains shared exploration with battles disabled. Private mechanics, recovery and read-only runtime evidence are in `reports/fourteenth-battle-route1-*.json` and `reports/battle-route1-runtime.json`; remaining commands/outcomes and durable activity are still required.

Fifteenth-pass verification: Full thirteen-stage gate passed at 2026-09-28T17:59:56.825Z, including all 39 browser scenarios and retained unit, Python, database/network, content, synthetic battle, encounter and process-recovery checks. The item/capture gate passed 20 independent scenarios/26 turns, 235 literal RNG draws, 132 HP/odds cases, 17 strict-threshold cases and 25 integer-square-root cases. All 46 new cross-build and 46 fresh-process boundaries passed, replaying 32 transitions. Item integration passed 11 groups with 7 captures and 22 failed throws. The original 21 literal battle fixtures remain byte-identical and pass. Public boundaries passed 37 HTTP checks across 73 built files. Capture is still pending disposition and does not create an owned asset. See `reports/battle-route1-items*.json`, `reports/battle-items-runtime.json` and ADR-016.

## Private victory progression checks

`npm.cmd run battle:progression` builds the source supplement twice, checks independent progression literals/recovery and verifies actual encounter-to-combat-to-progression handoff. A clean private tool build first needs `battle:spike`, `encounter:check` and `battle:route1`; the full `verify` already orders these. Outputs stay under `.local/battle-progression`, reports under `reports/battle-progression-*.json`. See [the progression README](../tools/battle-progression/README.md).

`(await loadProgressionCore()).fromBattle(terminal)` admits only a compatible private terminal. `createDiagnostic` is a separate source arithmetic/continuation test surface, including explicit friendship metadata and optional diagnostic XP. Neither authorizes an account command or progressed-team combat. Snapshot/restore preserves pending move decisions; `decide` accepts the current decision ID and replacement slot or decline. Evolution, capture and loss can enter their separate private continuations below; all durable effects remain pending. No database migration or testing-account reset is needed.

Full fourteen-stage gate passed at 2026-09-28T18:34:07.305Z, including 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all prior battle/encounter checks, fresh-process account recovery and all 39 browser scenarios. The new progression gate passed 159 independent source-literal cases and 176 settled checkpoints with 17 move decisions. All 176 host boundaries and 386 raw continuation boundaries restored across builds and fresh processes, with 53 host and 34 raw rejection checks. All twelve real encounter slots and all five natural combat outcomes passed the strict terminal bridge. Public boundaries passed 43 HTTP checks across 73 built files. Existing combat artifacts and all 41 combat/item literal fixtures remain byte-identical.

The retained hidden development launch remains available at http://127.0.0.1:5173. Read-only runtime/account existence evidence is `reports/battle-progression-runtime.json`; STATUS lists verified PIDs and logs. No testing account was logged into or mutated.

## Private blackout checks

`npm.cmd run battle:loss` builds the source continuation twice, verifies independent source literals and cross-build/fresh-process recovery, and exercises actual Route1 losses/draws through both direct and progression bridges. Clean builds require the four preceding private modules; the full `verify` orders them. Outputs stay under `.local/battle-loss`, with evidence in `reports/battle-loss-*.json`. See [the loss README](../tools/battle-loss/README.md) and ADR-018.

`core.fromBattle(terminal, core.developmentContext({money: currentMoney}))` requires a compatible lost/draw terminal and explicitly selects the named Pallet development context. `fromProgression` accepts its compatible pending-loss checkpoint instead. No account wallet or last-heal record is read or reset. `advance({expectedSequence:0})` applies faint friendship; sequence1 applies the blackout mechanics. Sequence2 is terminal `pending-world-application`, with no acknowledgement/application method. Snapshot/restore validates deterministic replay at all three boundaries. Current money must be supplied to preserve a depleted wallet; the explicit helper without an override selects only the fixture baseline3000 for diagnostics. Durable blackout application, arrival scripts and normal world battles remain unavailable; isolated practice does not apply this loss handoff.

Seventeenth-pass verification: Full fifteen-stage gate passed at 2026-09-28T19:43:34.715Z, including 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all prior private battle/encounter/progression checks, fresh-process account recovery and all 39 browser scenarios. The new loss gate passed 557 independent source-literal cases covering all 256 badge masks and all 20 canonical heal records. All 1,671 host and raw stage boundaries recovered across builds and fresh processes, with 56 host and 39 raw rejection checks. Actual combat integration passed all 12 encounter-slot losses and a natural three-turn simultaneous knockout, with 20 handoffs and 60 stage restores. Public boundaries passed 49 HTTP checks across 73 built files. All four prior WASM artifacts and 200 retained combat/progression literal fixtures remain byte-identical. Read-only post-gate runtime/account existence evidence is `reports/battle-loss-runtime.json`; STATUS lists the retained PIDs and logs.

## Private capture checks

`npm.cmd run battle:capture` builds the source supplement twice, verifies independent metadata/dex/nickname/party/PC literals and cross-build/fresh-process recovery, then exercises actual captured terminals. Clean outputs require the five preceding private checks, including `battle:loss` for retained-artifact verification. The full `verify` orders them. Outputs stay under `.local/battle-capture`, reports under `reports/battle-capture-*.json`. See [the capture README](../tools/battle-capture/README.md) and ADR-019.

`core.fromBattle(terminal, core.developmentContext({trainerName, trainerGender}))` requires a compatible captured terminal and an explicit trainer name/gender. `fromProgression` accepts its validated pending-capture checkpoint. The named context uses the existing one-member party, empty boxes and explicitly selected prior dex/stat/storage metadata; it does not read account history. Stage0 advance prepares the source dex/nickname boundary. `decideNickname` requires sequence1 and the current decision ID, with `keep-species-name` or `nickname` and a source-valid name. Stage2 advance performs source allocation and ends at `pending-ownership-application`. It allocates no database record and never spends another ball.

Source PC behavior and full-capacity rejection are exercised through separate diagnostics. Party placement preserves damaged HP and depleted PP; boxed output contains restored PP and excludes party runtime fields. Actual owned-party/PC management, withdrawal, durable capture grants, naming UI and normal capture battles remain unavailable. Isolated practice does not apply this capture handoff. No migration, account login or fixture reset is needed for these checks.

Eighteenth-pass verification: Full sixteen-stage gate passed at 2026-09-29T02:45:39.971Z, including 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all five prior private engine checks, fresh-process account recovery and all 39 browser scenarios. The new capture gate passed 646 independent source-literal cases, including all 420 last-free PC slots and 76 source keyboard glyphs. All 2,584 host and raw boundaries recovered across builds and fresh processes, replaying 3,876 transitions, with 84 host and 57 raw rejection checks. Actual combat integration passed all twelve encounter-slot captures, 23 handoffs and 92 stage restores. Public boundaries passed 55 HTTP checks across 73 built files. All five previous WASM artifacts and 757 retained literal fixtures remain byte-identical. Read-only post-gate runtime/account existence evidence is `reports/battle-capture-runtime.json`; STATUS lists the retained PIDs and logs.


## Private evolution checks

`npm.cmd run battle:evolution` builds the supplement twice, verifies independent source literals and eligibility, checks raw/host cross-build and fresh-process recovery, then exercises restored progression handoffs. Clean outputs require all six preceding private checks because retained-artifact verification includes blackout and capture. The full `verify` orders them. Outputs stay under `.local/battle-evolution`, with reports under `reports/battle-evolution-*.json`. See [the evolution README](../tools/battle-evolution/README.md) and ADR-020.

`core.fromProgression(checkpoint, {nickname, language: 2, targetDex: {seen, caught}, evolutionStat, canCancel: true})` requires a compatible pending-evolution checkpoint and explicit prior metadata. Current admitted progression checkpoints have diagnostic origin; no actual combat-v2 terminal can evolve. `createDiagnostic` is a separate eight-species source test surface. `session.decide` requires the current expected sequence and decision ID with `accept-evolution` or `cancel-evolution`; a pending move accepts `replace-move` plus slot 0-3 or `decline-move`. Decisions survive restore and end at `pending-ownership-application`.

No migration, account login, fixture reset or development-server restart is needed. English-only text and supported source level-up moves are explicit boundaries. No live evolution UI, durable mutation or broader team admission is added.

Nineteenth-pass verification: Full seventeen-stage gate passed at 2026-09-29T04:09:03.487Z, including 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all six previous private engine checks, fresh-process account recovery and all 39 browser scenarios. The new evolution gate passed 871 independent source-literal cases and 810 eligibility rows. All 1,921 host and 2,940 raw boundaries recovered across independent builds and fresh processes, replaying 1,229 host and 3,843 raw transitions in each recovery path. Rejection checks passed for 81 host and 54 raw cases, with three injected candidate failures. Integration passed ten groups: 178 diagnostic progression handoffs, 358 restored boundaries and rejection of all five natural combat outcomes that cannot currently evolve. Public boundaries passed 61 HTTP checks across 73 built files. All six previous WASM artifacts and 1,403 retained literal cases remain byte-identical. Read-only runtime/account existence evidence is `reports/battle-evolution-runtime.json`; STATUS lists retained processes and exact next work.


## Twentieth-pass private family combat

Run `npm.cmd run battle:family` after the prerequisite private engine gates, or use `npm.cmd run verify` for the ordered full gate. The family gate builds two independent source modules, compares independent move/ability/RNG literals, checks portable recovery and exercises proof-bound progression/capture/evolution diagnostic bridges. Reports are `reports/battle-family-*.json`; implementation is private under `tools/battle-family/` and `.local/battle-family/`.

This profile is not an account command or a playable battle UI. It preserves source-result HP, PP, bag context and pending ownership. Unsupported moves, unresolved decisions and boxed capture data fail explicitly. No testing-account login/reset or server restart is needed for this tooling pass. Keep the existing local app running and preserve ADMINA/ADMINB. The previous final gate/browser/evolution evidence is archived under `reports/nineteenth-*.json`.

Full eighteen-stage gate passed at 2026-09-29T05:18:28.129Z, including 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all seven prior private engine gates, fresh-process account recovery and all 39 browser scenarios. The new family gate passed 134 independent source-literal cases, 250 turns and 2,605 RNG draws. All 384 host and 384 raw boundaries recovered across independent builds and fresh processes, replaying 556 future transitions on each host/raw recovery path. Rejection checks passed for 73 host and 37 raw cases, with three failed-candidate checks and four timeout-bounded exhaustion checks. Integration passed 13 groups, 31 source-result handoffs, 93 restores and 57 diagnostic turns across all eight species. Public boundaries passed 67 HTTP checks across 73 built files. All seven previous WASM artifacts and 2,274 retained literal cases remain byte-identical. Focused log: `.local/twentieth-family-focused.log`; full log: `.local/twentieth-verify.log`. Post-gate read-only runtime/account evidence: `reports/battle-family-runtime.json`. The retained hidden app launch and process ownership are recorded in STATUS.

PowerShell logging note: `*>` can set `$?` false when a successful native process writes ordinary diagnostics to stderr. Capture `$LASTEXITCODE` immediately after the native process and use that value explicitly when wrapping a logged gate. This pass retained all original output and recorded the discrepancy in `reports/twentieth-gate-shell-status.json`; every awaited stage and browser scenario passed.

## Private party switching checks

Run `npm.cmd run battle:party` after the retained engine dependency gates (see tools/battle-party/README.md for clean-output order). This builds twice and checks source literals, raw/host recovery, failure isolation and coherent actual-capture diagnostics. It does not enable a battle or party-management screen in the live app.

Full nineteen-stage gate passed at 2026-09-30T15:48:11.208Z with native exit 0: 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all eight prior private engine gates, fresh-process account recovery and all 39 browser scenarios. The party gate passed 220 independent source-literal cases, 529 accepted transitions and 4,036 RNG draws. All 749 host and 749 raw boundaries recovered across independent builds and fresh processes, replaying 1,282 future transitions per host/raw path. Rejection checks passed for 80 host and 53 raw cases, with 6 candidate-failure checks and 6 timeout-bounded exhaustion checks. Integration passed 11 groups, 14 coherent capture-party handoffs, 103 restores and 89 diagnostic transitions. Public boundaries passed 73 HTTP checks across 73 built files. All eight previous WASM artifacts and 2,408 retained literal cases remain byte-identical.

The app was relaunched during this pass after both endpoints were unavailable. Current process ownership and shutdown instructions are in STATUS; reports/battle-party-runtime.json records post-gate health and read-only testing-account preservation. Logs: .local/twentyfirst-focused.log and .local/twentyfirst-verify.log. Portable Python orchestration captures native exit codes directly in reports/twentyfirst-*-exit-status.json, avoiding the prior PowerShell stderr-redirection ambiguity.

## Private tactics checks

Run `npm.cmd run battle:tactics` after all nine retained private engine checks,
ending with `battle:party`. The [tactics README](../tools/battle-tactics/README.md)
lists the clean-output order; `npm.cmd run verify` includes it automatically.
The command builds twice, verifies independent source mechanics and raw/host
recovery, then checks coherent capture-party and source-learned/evolved diagnostic
inputs. Outputs stay in `.local/battle-tactics/`; reports are
`reports/battle-tactics-*.json`. No database migration, account login, fixture
reset or development-server restart is required for this private command.

`firered-family-tactics-v1` retains the party profile's eight species, up to six
player members, switches and faint decisions. It adds Super Fang, Endeavor,
Rapid Spin, Rain Dance and ordinary-wild Whirlwind for 21 family moves plus
automatic Struggle. Battle-created rain survives recovery and switches, expires
at the source field boundary, and cannot be supplied as initial weather.
Whirlwind's `forced-escape` ends combat without a reward or reserve shuffle.
The weather event reports observed state after a nonflinched Rain Dance attempt;
a failed repeat reports unchanged rain while attack flags retain failure.

Focused checks passed 344 source cases, 759 transitions and 1,103 host/raw
boundaries on the matching 93,348-byte builds. Each recovery path replayed 1,699
future transitions across independent builds and fresh processes. Rejection,
candidate rollback and bounded exhaustion checks passed. The full twenty-stage gate passed at 2026-10-01T02:04:15.254Z with native exit 0, including all 39 browser scenarios; see STATUS and `reports/verification.json`. Historical gate results above retain their original scope.

Protect, Skull Bash, Pursuit and Mirror Move remain rejected in every occupied
move slot, including the bench and moves with no PP. Broader weather, hazards,
trapping, trainer/double battles and party-aware result application are excluded.
Capture/evolution proofs remain pending ownership; this tool grants no account
assets, live battle entry or durable effects. Preserve ADMINA/ADMINB and use
STATUS for current process ownership rather than historical runtime paragraphs.

The resumed app uses foreground tool session 24597, with output streamed to that session. Current PIDs and coordinated shutdown are in STATUS; reports/battle-tactics-runtime.json records post-gate readiness and read-only account preservation. Logs: .local/twentysecond-focused.log and .local/twentysecond-verify.log; portable Python orchestration records native exits in reports/twentysecond-*-exit-status.json.

## Private Skull Bash checks

Run `npm.cmd run battle:charge` after the ten retained private engine gates,
ending with `battle:tactics`; the full `verify` orders them automatically.
The [charge README](../tools/battle-charge/README.md) lists the clean-output
sequence. Outputs remain under `.local/battle-charge/`, with reports under
`reports/battle-charge-*.json`. No database migration, account login, fixture
reset or live battle entry is involved.

The new profile admits 22 family moves plus automatic Struggle. Skull Bash's
first turn spends PP and raises Defense, then the player has only the current
sequence-fenced `continue-charge` acknowledgement. A locked release remains
valid at zero PP and spends no additional PP. Wild continuation skips move
selection RNG; its target remains the opposing actor after a party replacement.
Flinch and faint cleanup release the active lock. Snapshot/restore retains the
source's distinct active bit, inert locked move and charging-turn state.

Focused integration passed 19 groups, 14 coherent handoffs, 128 restores,
109 transitions and 25 faint decisions. Full twenty-one-stage gate passed at 2026-10-01T02:55:13.834Z with native exit 0: 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all ten prior private engine gates, fresh-process account recovery and all 39 browser scenarios. The charge gate passed 410 independent source-literal cases, 937 accepted transitions and 6,964 RNG draws. All 1,347 host and 1,347 raw boundaries recovered across independent builds and fresh processes, replaying 2,080 future transitions per host/raw path. Rejection checks passed for 113 host and 78 raw cases, with 18 candidate-failure checks and 14 timeout-bounded exhaustion checks. Integration passed 19 groups, 14 coherent capture-party handoffs, 128 restores and 109 diagnostic transitions. Public boundaries passed 85 HTTP checks across 73 built files. All ten previous WASM artifacts and 2,972 retained literal cases remain byte-identical. Historical gates above retain their original scope.
Protect, Pursuit and Mirror Move remain rejected, including benched/exhausted
slots. The separate [Protect audit](../reports/protect-source-audit.json) records
source and separately pinned existing compiled artifacts without implementing
Protect, rebuilding the ROM or executing it. Source-result proposals remain
unowned diagnostics; complete party-aware results and durable/live application
are still required. Preserve the existing user testing accounts.

The foreground development process was retained throughout this pass. Current process ownership is in STATUS; reports/battle-charge-runtime.json records post-gate health and read-only testing-account preservation. Focused/full logs are .local/twentythird-focused.log and .local/twentythird-verify.log; reports/twentythird-*-exit-status.json records native exits.

## Twenty-fourth-pass private Protect: verified

`firered-family-protect-v1` extends the private party/rain/charge diagnostics to
23 family moves plus automatic Struggle. The explicit `firered-protect-rom-v1`
policy embeds the complete separately pinned 256-entry ROM lookup, preserving
inclusive comparison, RNG order, repeated-use counter and source resets without
undefined C array access or an invented clamp. Checkpoint eight retains 512
words, including protection and future-read move history. Raw full-counter tests
verify the bounded policy, not whole-game reachability or emulator equivalence. No fresh ROM reproduction build is claimed.

First integration passed 23 groups, 14 actual capture-party handoffs, 169 restores
and 148 diagnostic transitions. It learns Protect through source progression,
accepts or cancels evolution, and blocks a wild zero-PP Skull Bash release while
preserving source cleanup. Full twenty-two-stage gate passed at 2026-10-02T01:44:14.135Z with native exit 0: 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all eleven prior private engine gates, fresh-process account recovery and all 39 browser scenarios. The Protect gate passed 476 independent source-literal cases, 1,084 accepted transitions and 7,976 RNG draws. All 1,560 host and 1,560 raw boundaries recovered across independent builds and fresh processes, replaying 2,367 future transitions per host/raw path. Rejection checks passed for 142 host and 91 raw cases, with 25 candidate-failure checks and 19 timeout-bounded exhaustion checks. The complete 256-entry ROM policy passed 7,518 raw command checks across primary, rebuild and fresh-process contexts, covering 997 distinct threshold witnesses, both action positions, resets and byte wrapping. These command-domain tests do not establish whole-game reachability. Integration passed 23 groups, 14 coherent capture-party handoffs, 169 restores and 148 diagnostic transitions. Public boundaries passed 94 HTTP checks across 73 built files. All eleven previous WASM artifacts and 3,382 retained literal cases remain byte-identical. No normal ownership, party rewards, field acknowledgement or
live battle UI is enabled. Pursuit and Mirror Move remain unsupported in every
roster slot. See ADR-025 and tools/battle-protect/README.md. The sections below
retain the original scope of earlier passes.

Run `npm.cmd run battle:protect` for the new private build, literals, recovery
and integration checks. `npm.cmd run verify` now includes it as the eighteenth
of 22 stages. The separately pinned ROM/ELF/map/object inputs are build evidence;
runtime uses only the private module and pinned policy. Do not modify the
read-only reference directory or create/reset the user testing accounts.
The local app was restarted in a foreground tool session for this pass.
Current process ownership is recorded in STATUS and .local/dev-launch.json.

Post-gate runtime and read-only testing-account preservation passed; see reports/battle-protect-runtime.json and STATUS for current process ownership. Native focused/full exits are recorded in reports/twentyfourth-*-exit-status.json.

## Twenty-fifth-pass private Pursuit: verified

The new private profile extends Protect/charge/party diagnostics to 24 family
moves plus automatic Struggle. Normal Pursuit and ordinary-wild switch
interception retain distinct source command, damage, PP, history and action
consumption rules. A lethal interception completes the already selected
voluntary switch; a subsequent residual faint can open a new decision.
Checkpoint nine retains 512 words and the existing pinned Protect policy.
Full twenty-three-stage gate passed at 2026-10-02T09:49:42.194Z with native exit 0: 86 Vitest tests, 49 Python tests, retained PostgreSQL/account/asset/world/reconnect checks, all twelve prior private engine gates, fresh-process account recovery and all 39 browser scenarios. Pursuit passed 603 independent source-literal cases (476 retained controls and 127 additions), 1,245 accepted transitions and 9,302 checked RNG draws. All 1,848 host and 1,848 raw boundaries recovered across independent builds and fresh processes, replaying 2,590 future transitions per host/raw path. Rejection checks passed for 141 host and 125 raw cases, with 37 candidate-failure checks and 31 timeout-bounded exhaustion checks. The unchanged 256-entry Protect policy passed 7,518 raw commands across two builds and a fresh process. Integration passed 29 groups, 14 coherent capture-party handoffs, 189 restores and 159 diagnostic transitions. Public boundaries passed 100 HTTP checks across 73 built files. All twelve prior WASM artifacts and 3,858 retained literal cases remain byte-identical. Mirror Move,
complete party-aware results and durable/live application remain open.
Earlier sections retain their original verified scope. See ADR-026 and
tools/battle-pursuit/README.md.

Run `npm.cmd run battle:pursuit` for the new private gate. The full verify
command now has 23 stages. The current local development launch is retained;
see STATUS and reports/twentyfifth-startup.json. No user-account reset is required.

Post-gate runtime and read-only testing-account preservation passed; see reports/battle-pursuit-runtime.json and STATUS for current process ownership. Native focused/full exits are recorded in reports/twentyfifth-*-exit-status.json.

## Playable practice battles

Open http://127.0.0.1:5173, sign in with an existing development testing account through Account, and click **Practice battle**. Connect practice if prompted; when actively exploring, use **Leave shared world & practice**. A saved overworld location with no active world runtime can enter directly. Choose **First battle** or another preset and click **Start battle**. Custom team controls select species, level, up to four legal moves, ability and optional status/HP/PP settings. **End practice** or **Finish practice** closes the test session; closing the dialog alone preserves it. Reopen or refresh to resume. If an acknowledgement is lost, wait for reconnection and use **Retry last action**; that exact UUID cannot spend PP twice. The screen labels practice and no rewards explicitly. ADMINA/ADMINB remain ordinary development players, with no powers or fixture reset.

Run `npm.cmd run practice:check` for deterministic sprite/factory checks, real PostgreSQL storage/failure recovery and authenticated socket/process recovery. `npm.cmd run build` exports the bounded source sprites before staging public content. `npm.cmd run verify` now has 24 stages; browser tests include four practice scenarios. Private WASM dependencies must already be built, as documented for the retained engine profiles. Migration command: `npm.cmd run db:migrate`. Practice remains available only for local development fixtures; ordinary new-game accounts receive guidance rather than grants.

Full twenty-four-stage gate passed at 2026-10-02T11:02:47.170Z with native exit 0: 91 Vitest tests, 49 Python tests, retained database/account/asset/world/reconnect checks, all thirteen retained private engine gates and all 43 browser scenarios. Practice additionally passed all 8 supported species and 24 moves through 74 legal species/move source turns, 32 level admissions and 9 presets; 17 real-PostgreSQL storage/failure/recovery groups and 6 authenticated socket/restart groups passed, including immediate world entry after hello. All 4 new practice browser scenarios passed, including native acknowledgement loss and exact retry, refresh/backend restart, source charging/PP, Pursuit switching, faint/replacement/run and mobile rendering. All thirteen previous WASMs and 4,461 retained literal cases remain unchanged. The 16 source sprites plus metadata rebuild deterministically from 31 pinned inputs. Public boundaries passed 106 HTTP checks across 90 built files.

Runtime ownership is in STATUS and reports/practice-runtime.json. Native focused/full exits: reports/twentysixth-*-exit-status.json.
