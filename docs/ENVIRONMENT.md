# Environment

Inspected on Windows from PowerShell in `C:/Users/mrkda/Projects/pokewaterblue`, 2026-09-25. Reference input: `C:/Users/mrkda/Projects/pokefirered-master` (read-only). Git is explicitly deferred.

| Component | Actual version / status |
|---|---|
| Python launcher `py -3` | Python 3.13.5, verified |
| Source snapshot/inventory | Python standard library; no package installation required |
| PowerShell | 5.1.26100.9444, verified |
| Node | Portable Node 24.21.0 in `.tools/`; official SHASUMS checksum verified by root |
| npm/dependencies | Original install: 257 packages; Better Auth added 19 packages with zero reported audit vulnerabilities at its install; exact package versions in `package-lock.json`; foundation integration/build passed |
| TypeScript/Vite/Phaser | 5.9.3 / 8.3.1 / 3.90.0; installed package declarations and lockfile |
| Colyseus core/SDK/schema/transport | 0.18.16 / 0.18.4 / 5.0.34 / 0.18.3; proxy/network contract tests passed |
| Better Auth | 1.7.6, pinned server dependency; documented Drizzle/PostgreSQL integration, password/session flows and cookie-based room admission verified |
| Zod | 4.6.5; reused for the selected private battle adapter and contract |
| Optional P03 compiler | Zig 0.16.0, Windows x64, local `.tools/zig-x86_64-windows-0.16.0`; archive size/SHA256 match the official pinned metadata; no machine installation |
| Vitest/Playwright | 5.0.2 / 1.63.0; ninth-pass gate passed 80 Vitest and 28 Chromium scenarios: 25 development + 3 isolated built-client account checks; older full built-map evidence retained |
| Drizzle ORM / pg | 0.45.3 / 8.23.0; real PostgreSQL integration passed |
| Python image dependency | Pillow 11.3.0 in project virtual environment; fifth-pass gate passed all 49 Python fixtures, including seven font and three independent MIDI/audio fixtures |
| PostgreSQL/local route | Portable EDB 17.11-4 distribution, server 17.11; `.tools/postgres`, cluster `.local/postgres`; setup/restart/migrations and connections verified |
| Browser coverage | Playwright Chromium installed and exercised against dev proxy and built server; Edge/Firefox not tested |

Verified default loopback ports: client 5173, backend 2567, PostgreSQL 5433. `PORT` and `CLIENT_PORT` configure application listeners. Optional `LOCAL_DB_PORT` selects a port from 1 to 65535 on the first native setup (default 5433); the helper persists the chosen port/URLs and preserves existing settings thereafter. The database host is enforced as `127.0.0.1`. Alternate database connections use explicit `DATABASE_URL`/`TEST_DATABASE_URL` configuration. The native route needs no Docker or system service. Local credentials live in ignored `.local/database.json` and `.env`; do not print them. Use `npm.cmd`/`npx.cmd` when PowerShell shim policy requires them; do not weaken execution policy.

Source maintenance commands are available now:

```powershell
py -3 scripts/source-baseline.py verify --report reports/source-verification.json
py -3 scripts/source-inventory.py
```

`create` writes a new local baseline and is not a routine repair for verification failures. Investigate a reference change first. Snapshot archive bytes use fixed entry ordering, timestamp, permissions and compression settings; the source fingerprint excludes host paths and modification times. Original-ROM build/toolchain and upstream revision are not verified.

Environment names and safe examples are in `../.env.example`. Setup creates `.env` only if absent, preserving existing settings. Authentication configuration is now used by P04. The server still binds loopback and rejects tester mode; normal local accounts use Better Auth cookies. BETTER_AUTH_SECRET must be at least 32 characters and stable; BETTER_AUTH_URL/APP_ORIGIN are exact loopback origins. Email sending/recovery is not connected.

Commands and setup prerequisites are in `RUNBOOK.md` and the root README. The fifth pass completed its eight-stage gate: 63 Vitest tests, 49 Python tests, deterministic content rebuilding and all 25 development-browser scenarios passed. All 25 scenarios also passed on the isolated built server. Current evidence is in `../reports/verification.json`, `../reports/browser-tests.json` and `../reports/browser-tests-built.json`. A limited 73-file built-client inventory/private-identifier check passed in `../reports/client-bundle-check.json`. `../reports/built-runtime-verification.json` records the final built server's graceful IPC shutdown and release of port 2570 at 2026-09-25T19:51:36.442Z.

Fifth-pass schema-5 content records 148 pinned inputs and 75 outputs, with bounded input fingerprint `8520cdbfce30ddf5e18d5a3b95deea3bd89aad86bdb4e2e7c60be581d226ee88`; independent rebuilding matched the manifest and output hashes. The global source fingerprint is unchanged. The neutral source font contains 142 mapped Latin glyphs. The Pallet music and select sound prototypes use browser Web Audio and the existing Python standard library/Pillow toolchain; no new runtime dependency, machine service or public deployment was introduced. `../reports/font-audio-source-evidence.json` records the focused source fixtures. Development/built browser checks passed source glyph rendering, sound controls and lifecycle handlers. Headless blur/visibility tests use explicitly dispatched synthetic events and inspect native audio output; actual operating-system focus and tab-event delivery remain unverified.

The current pass reuses the pinned dependency versions and local database. First setup was verified on this Windows machine. The Compose alternative, separate-machine setup and Linux build are untested. Full font/audio coverage, native NPC behavior, general scripts, field effects and full R1 gameplay dependency closure remain outside this bounded pass.

The final `LOCAL_DB_PORT` option passed ESLint plus start/real-database smoke with the existing 5433 configuration. A newly initialized cluster on a custom alternate port has not been exercised.

The fifth pass adds source definition parsing, strict private/public schemas and the Field guide using existing Python/TypeScript dependencies. The public 14-species/44-move reference and private operational records are separately generated and validated. `reports/gameplay-source-evidence.json` and the importer/schema/browser fixtures record the bounded evidence; this introduces no executable battles, encounters or persisted state.

The sixth pass completed the nine-stage gate, including the source C/WASM probe: 74 Vitest tests, 49 Python tests, 19 damage/HP cases, 30 RNG draw checks, 19 rejection cases and all 25 development-browser scenarios. The public bundle retains the same Vite JS/CSS asset names as the fifth pass, and the limited 73-file private-artifact inspection passed. Built-browser/lifecycle checks were not repeated for this private experiment.

The optional compiler lock is `../tools/battle-spike/toolchain-lock.json`, sourced from [official Zig download metadata](https://ziglang.org/download/index.json). The 97,217,739-byte Windows archive SHA256 is `68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e`. `-g0` excludes build-directory debug paths so independent WASM builds match. Local WASM compilation uses no host imports and fixed 262,144-byte linear memory; the historical 15,159-byte batch-one probe and its cost observations do not establish full-battle performance. Other platform/compiler combinations remain untested.

The seventh pass reuses the same tools and dependencies. At that pass, both battle probe verifiers ran in `battle:spike`: 15 source-derived turn transcripts/19 transitions, expanded isolation and lifecycle/rejection/atomicity checks pass alongside the original damage fixtures. Independent builds match at 36,502 bytes with fixed private 256 KiB memory. The full nine-stage gate passed 74 Vitest/49 Python tests and 25 development-browser scenarios. The limited built-public inventory/private-identifier inspection remains at 73 files; no battle/WASM artifact is served. Built-browser/lifecycle checks were not rerun. At that handoff, portable snapshot/restore and full-path measurements remained for batch 3; the eighth pass below completes that bounded gate.

The eighth pass completes P03 and ADR-001 selects source C/WASM commands with TypeScript scheduling. No dependencies or machine tools were added. Independent builds match at 46,120 bytes (SHA256 `3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724`) and fixed 256 KiB instance memory. Versioned logical checkpoint/replay works across fresh processes and independent Windows builds. The six-method adapter remains server-only with an explicit synthetic four-move profile. All focused gates now run under `battle:spike`, including clean-child resource measurements. Ordinary full-contract turn-cycle p95 was 9.28 ms; dense 20-battle waves (25 transitions each) reached 241.71 ms p95. Measurements exclude database/network/soak and do not establish shared-world capacity. See the measured hardware/runtime and full distributions in `../reports/battle-spike-measurements.json`.

The eighth-pass nine-stage gate passed at 2026-09-25T21:53:44.992Z: 74 Vitest, 49 Python, source/recovery/adapter checks and 25 development-browser scenarios. After an extreme turn-counter guard was corrected in final review, lint/typecheck and all battle checks passed again at 2026-09-25T21:54:47.014394+00:00; this is recorded separately in `verification.json`. The limited 73-file built-client scan passed; browser assets and walking/Shift-running behavior remain unchanged. Built-browser/lifecycle evidence remains from the fifth pass. Other operating systems, cross-version checkpoint migration and real persisted battle recovery are still unverified.

The ninth pass adds Better Auth 1.7.6 through the existing Drizzle/PostgreSQL toolchain and reviewed auth/character migrations; no system tool, service or public deployment was added. The full ten-stage gate passed at 2026-09-25T22:19:52.387Z, including 80 Vitest, 49 Python, 34 storage checks, 21 account/network groups, the retained source battle gates, two separate built backend processes and 28 browser scenarios. Final readiness hardening was rechecked at 2026-09-25T22:21:50.967945+00:00. Account browser tests always use a fresh random-port backend and separate test database; built-backend recovery reserves port 2570 then releases it. The normal preview retains its database and is running under session 32963. Current evidence is in `accounts-*.json` and `verification.json`; full fifth-pass built-map/browser evidence is historical.

The 73-file built public scan still excludes server auth/storage and private battle artifacts. Profiles remain staged with no owned assets or world position. Local session/login behavior is verified, not external security, email recovery, operating-system crash, database failover or load capacity. P04-03's remaining relational asset/story foundations and developer-fixture command must be completed before advancing to shared world ownership.


## Tenth-pass persistence environment

No dependency or toolchain versions changed. Reviewed additive migration `0004_assets.sql` adds relational asset/story/outcome tables and the development-fixture stage; its applied SHA256 is `4e9500020668ad380a247c29725e97fbb3b7483f6314a9a4f94998c2d2f707e7`. `db:seed:dev` dispatches through the existing portable Node/tsx runner and accepts only an explicit existing trainer/profile in local development. No ordinary setup/migration seeds user assets.

Verification retains ten stages; integration now includes the 30-group asset smoke and fresh CLI processes. Browser coverage adds three owner-asset scenarios. The asset browser suite uses a separately owned source backend process because Better Auth 1.7.6 keeps in-memory rate-limit state in module scope (`dist/api/rate-limiter/index.mjs`); this isolates suites without changing application limits. Built backend account recovery and the ordinary dev-preview browser checks retain their existing runtime boundaries. Final current results are in `reports/verification.json`; current preview processes are in STATUS.

The tenth-pass native audio observer also records wall/audio elapsed times and waits for at least half a second of actual audio-clock progress plus a nonzero signal, bounded to ten seconds. It retains every sample for finite/clipping checks and does not restart playback. This avoids treating a short wall-time sample before native graph startup as proof of silence. Application audio scheduling was not changed.
