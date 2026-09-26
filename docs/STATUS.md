# Project status

Updated: 2026-09-26T18:35:00-05:00 (America/Chicago)
Release target: R1; full requested game remains R3
Current phase: P00/P01/P03 verified; P02/P04/P05 partial
Current task: Eleventh pass complete; bounded shared development exploration verified
Branch/commit: unavailable by accepted no-Git workflow; do not run Git
Last verified state: Full ten-stage gate passed at 2026-09-26T01:28:07.942Z. 86 Vitest tests, 49 Python tests, 34 profile storage checks, 21 account/network groups, 30 asset groups, 27 world storage groups, 18 world network groups, retained battle checks, built account recovery and 35 browser scenarios passed.
Source revision: upstream SHA unknown; exact byte baseline remains source-lock.json

Local testing accounts requested on September 26: `admin1@pokewaterblue.test` / ADMINA and `admin2@pokewaterblue.test` / ADMINB now exist in the normal local database with the explicit `r1-squirtle-v1` fixture. These are ordinary player accounts with admin-style names; no elevated role, powers or bypass was added. Credentials are kept in `.local/.env.admin-test-accounts` (excluded from Vite serving; HTTP 403 verified), not in reports or public content. Separate UI logins, reciprocal visibility, observed movement, both Save confirmations and leaving presence passed against the live app. Trainers are saved beside each other in Pallet at (9,12) and (10,12); verification sessions were signed out and neither trainer retains an active lease. Evidence: reports/admin-test-accounts.json and reports/admin-test-accounts.png. Full-gate evidence above is unchanged; no application code changed. Runtime PIDs below remain healthy.

## Working and verified

- Explicit **Account → Enter shared world** admits only the named local `r1-squirtle-v1` fixture. Two authenticated trainers share Pallet Town, Player's House 1F and Route 1, see public avatars/names, and do not block each other. Ordinary staged trainers retain null position and cannot enter. No normal development account was seeded by this pass.
- One CharacterService owns activity, position and serialization. Logical per-map groups use the existing private character transport; separate routable zone rooms are not implemented. A 20Hz tick and 10Hz periodic publication plus command acknowledgements drive movement. Sequenced directions, session/lease/connection/zone fencing, source collision/elevation, visible NPC occupancy and server timing reject forged coordinates and speed/stale inputs. Each movement performs one read-only fence query, with no movement receipt or lease write.
- Walking remains default; Shift runs outdoors at eight source frames, indoors walks at sixteen, and ledges use thirty-two. Integer anchors, alternating strides and grounded jump cameras remain intact. Shared render sampling under ordered 0/15/70/25ms message delays verifies monotonic 64-pixel travel and integer anchors. Held-wall and sustained-running tests pass; menu/focus/transfer/disconnect release held input. This is not the later 150ms RTT or population gate.
- Migration 0005 adds elevation, facing, transition generation and checkpoint identity without replacing user data. Main/test SHA256: `4e89de22f3063b42bc46e34355a7152bd73b85467bd7dc0a717c2ccc708eb180`. Finished movement checkpoints on a five-second target, Save, authorized graceful disconnect/leave and map transfer. Mid-step Save and periodic checkpoints preserve accepted motion. Unknown COMMIT outcomes reconcile before retry; publication failure recovers to one destination. Receipt retries cannot rewind movement or leave a newer activity.
- Reconnect uses fresh authenticated admission and restores committed location across separate backend processes. Replaced/expired/revoked sessions and database failures lose authority and disappear from presence. External revocation is detected on input/checkpoint or the two-second heartbeat. A sudden process loss may lose movement since the last checkpoint. The planned sixty-second transport reconnection grace remains unfinished.
- Client mode labels, nearby list, explicit Leave and disconnected freeze state distinguish shared exploration from anonymous preview. Reset is disabled while shared. All three raw map hashes must match the audited policy before client entry; changed server content also fails. Desktop and 390px screenshots were inspected. Save clearly distinguishes a world checkpoint from an unsaved anonymous preview.
- The source-pinned development policy bypasses only three known Pallet coordinate story triggers. Shared dialogue, encounters, rewards, battles and real story progression remain unavailable. Static initial NPC visibility/collision is the named fixture view; general private story overlays are not implemented. Anonymous preview keeps its six message-only interactions.
- Existing local accounts, owned party/bag records, permanent fixture outcomes, private projections and durable profile Save remain verified. P03 ADR-001 remains decided: source C/WASM commands with audited TypeScript scheduling and the bounded six-method adapter. The private four-move experiment is not live battle gameplay. Its 46,120-byte WASM SHA256 remains `3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724`.
- Independent rebuilding preserves 148 content inputs and 75 outputs. Reference fingerprint remains `f0300f9079bac985f3f6df32886357e00111a8000acc630334fd25c5cd2b2982` across 21892 files. Bounded importer fingerprint remains `8520cdbfce30ddf5e18d5a3b95deea3bd89aad86bdb4e2e7c60be581d226ee88`. The limited 73-file public build scan found no selected private auth/asset/world/battle identifiers or WASM artifacts.

## Incomplete and unverified scope

- P05-02 remains open for the plan's sixty-second transport reconnect grace; current recovery requires explicit fresh admission. P05-03 remains partial for general player-specific story overlays. Logical zones are a documented bounded topology adaptation (ADR-012), not multiple independently routed zone rooms.
- P04-03 still lacks activity-specific script/battle/trade records and durable gameplay effects. P06 is unimplemented: no encounters, live battle UI, capture, experience, item use or terminal outcomes. Torrent, Tail Whip and the full real-team dependency closure are not battle-ready.
- General scripts, NPC wandering, additional terrain/elevation/field effects and full audio/font coverage remain open. Upstairs, rival house, lab, Route 21 and Viridian destinations remain unavailable. Three exported/shared-exploration maps still count as zero campaign-verified playable maps.
- Linux/other browsers/separate-machine setup, native OS audio-focus delivery, actual machine crash/database failover, backup restoration, prediction/150ms RTT playability and population/soak gates remain unverified. No public deployment, service installation or Git operation occurred.

## Last checks

| Check | Evidence |
|---|---|
| Full ten-stage gate; 35 browser scenarios | reports/verification.json; reports/browser-tests.json |
| World transactions/fences, real SDK and process recovery | reports/world-store.json; reports/world-network.json |
| Four built-client world scenarios and render sampling | reports/world-browser.json; reports/world-rendering.json |
| Transient Save retry and pending-Save connection loss | reports/world-save-retry.json; reports/world-save-watchdog.json |
| Desktop/mobile shared UI | reports/world-two-players.png; world-house.png; world-mobile.png; world-route-ledge.png |
| Retained accounts/assets/battle checks | reports/accounts-*.json; assets-*.json; battle-spike-*.json |
| Public build and live runtime | reports/client-bundle-check.json; reports/world-runtime.json |

The first full run found two account/asset notice regressions and was also interrupted by a Vite reload during the Route 1 audio scenario. The ordinary unsaved notice and the obsolete asset expectation were corrected; application audio was unchanged. The second run found Save could be rejected while the short heartbeat/movement handler was busy. Save now retries transient BUSY responses within its existing deadline, preserving the original command identity and payload. A real server BUSY collision verifies byte-identical retries and one receipt; an actual INVALID_MESSAGE response verifies no automatic retry. The complete suite then ran again with source edits frozen. Historical evidence: reports/eleventh-first-gate.json, reports/eleventh-first-browser.json, reports/eleventh-second-gate.json and reports/eleventh-second-browser.json.

## Running processes

Normal local app restored at http://127.0.0.1:5173 on September 26. The previous client, backend and database were no longer listening. Windows had rebooted (last boot 18:15:13 CDT); the development launcher does not start automatically at boot. PostgreSQL detected the interrupted prior shutdown, completed WAL recovery and became ready at 18:24:49; no fatal startup error was found. Restarted the existing development command as a hidden background process; no application code or intentional user-data changes. Direct/proxied readiness and HTTP 200 passed, followed by the existing two-browser-context rendering and real WebSocket handshake check (one test passed). Full-gate reports are preserved; current runtime evidence is reports/runtime-recovery.json.

| Process | PID / listener | Stop |
|---|---|---|
| Vite | 18592 / 127.0.0.1:5173 | Coordinated dev shutdown |
| Backend | 7712 / 127.0.0.1:2567 | Same coordinated dev shutdown |
| PostgreSQL | 12300 / 127.0.0.1:5433 | npm.cmd run db:stop |

Background launcher PID: 6064 (`node scripts/run.mjs dev`, equivalent to `npm.cmd run dev`); no owning interactive tool session. Launch metadata/log paths: .local/dev-launch.json. Logs: .local/dev-20260926-182448.stdout.log and .local/dev-20260926-182448.stderr.log. Verify ownership before stopping anything. PostgreSQL and data are retained. The old session 50469 and PIDs in reports/world-runtime.json are historical evidence from the eleventh-pass gate, not the current runtime. This is a local background process, not an installed service or automatic boot startup.

## Exact next action

Finish the bounded P05 reconnect policy: implement and verify the planned sixty-second transport grace while retaining one authenticated character owner, authoritative checkpoints and generation fencing. Preserve the explicit development boundary, ordinary new-game staging, walking default and Shift running. General story overlays grow with P07; they must not become shared mutable flags. Then begin the P06 real-team encounter/battle dependency closure for the selected Squirtle profile before enabling live battle effects. ADR-001 is decided; do not reopen the C/TypeScript experiment.
