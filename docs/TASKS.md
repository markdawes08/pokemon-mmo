# Ordered tasks

The [project plan](PROJECT_PLAN.md) defines acceptance; this ledger keeps stable task
IDs and their current states. Detailed test results belong in machine reports,
not duplicated pass summaries. `in_progress` means only the bounded scope below is
verified. No phase or task status changed during workflow cleanup.

## Current order

Workflow improvements and cleanup are complete; [verified evidence](../reports/workflow-verification.json).

1. Resume P06 party-aware source victory progression/result admission.
2. Complete normal durable battle outcomes and the R1 scenario, then follow the
   phase dependencies below. Every new move/Pokemon mechanic must be playable in
   practice in the same chunk; temporary testing never grants owned progress.

| Phase | State | Current boundary / evidence |
|---|---|---|
| P00 | verified | Pinned source, environment and scope; [source lock](../source-lock.json), [environment](ENVIRONMENT.md). |
| P01 | verified | Workspace, PostgreSQL, protocol and process foundation; [runbook](RUNBOOK.md). |
| P02 | partial | Three connected maps, bounded sprites/dialogue/audio and gameplay exports; broader content and terrain remain. [Content importer](../tools/content-import/README.md). |
| P03 | verified | Source C/WASM commands with audited host scheduling selected; [ADR-001](DECISIONS.md#adr-001---battle-implementation). |
| P04 | partial | Accounts, leases, receipts, owned asset foundation and testing records; full gameplay outcomes remain. [Database contract](../packages/database/README.md). |
| P05 | partial | Authoritative movement, map transfer, nonblocking presence and reconnect; general private story overlays remain. [World/reconnect decisions](DECISIONS.md#adr-012---bounded-shared-exploration-over-one-character-owner). |
| P06 | partial | Practice and opt-in wild tests playable; source continuations private. Party-aware results and normal owned transactions remain. [Latest gameplay verification](../reports/thirtieth-verification.json), [Mirror contract](../tools/battle-mirror/README.md). |
| P07-P11 | todo | Campaign, multiplayer, complete mechanics/content and release hardening. |
| P12 | deferred | Original-content public release requires separate authorization. |

Keep ADMINA/ADMINB, saves, source/checkpoint compatibility and walking/Shift controls.
Read-only Git is allowed; Git mutations, reference-source edits and public release
are not. See [STATUS](STATUS.md) for current runtime and exact next action.

## P00: Baseline, scope, and environment

Dependencies: none. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p00-baseline-scope-and-environment).

| Task | State | Required outcome |
|---|---|---|
| P00-01 | verified | Inspect the actual folders, branch, dirty state, tools, and existing instructions. Preserve user changes. |
| P00-02 | verified | Create the continuity files and root AGENTS.md; copy this specification into `docs/PROJECT_PLAN.md`. |
| P00-03 | verified | Pin the reference source and create `source-lock.json`; inventory source paths and build variants. |
| P00-04 | verified | Record dependency compatibility and exact tool versions. Choose the local PostgreSQL route. |
| P00-05 | verified | Create the scope/feature ledger, distinguishing normal FireRed content, unused records, event gating, and deferred link features. |

## P01: Workspace foundation and executable contracts

Dependencies: P00. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p01-workspace-foundation-and-executable-contracts).

| Task | State | Required outcome |
|---|---|---|
| P01-01 | verified | Create npm workspaces, strict TS configuration, lockfile, package boundaries, Python environment, and root scripts. |
| P01-02 | verified | Add a placeholder Phaser scene, backend health/readiness, and a versioned protocol handshake. |
| P01-03 | verified | Configure local PostgreSQL, baseline migrations, validated environment, and coordinated development processes. |
| P01-04 | verified | Implement structured errors/logs, test databases, Vitest/Playwright setup, and a clean build. |
| P01-05 | verified | Implement meaningful network smoke tests and verify Ctrl+C shutdown. Document the exact start/stop commands. |

## P02: Content importer and accurate local overworld

Dependencies: P01. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p02-content-importer-and-accurate-local-overworld).

| Task | State | Required outcome |
|---|---|---|
| P02-01 | in_progress | Implement source discovery, map block/metatile/palette decoding, manifest generation, and structural tests. |
| P02-02 | in_progress | Import player/NPC sprites, representative animations, fonts, and the required map dependency closure. |
| P02-03 | in_progress | Implement tile movement, layer occlusion, elevation/collision, doors, boundaries, camera, input focus, and integer scaling. |
| P02-04 | verified | Implement a debug map overlay and one animated map feature; prototype one music track and one SFX. |
| P02-05 | in_progress | Add reproducibility and visual fixtures; expose unsupported dependencies explicitly. |
| P02-06 | in_progress | Export and validate the structured gameplay data needed by R1, including creature/move/item/encounter references, with a parser strategy that extends to the full inventory. |

## P03: Battle backend decision

Dependencies: P01. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p03-battle-backend-decision).

| Task | State | Required outcome |
|---|---|---|
| P03-01 | verified | Specify the battle interface and golden fixture format; trace original dependencies. |
| P03-02 | verified | Execute the bounded C/WASM experiment defined in Section 7. |
| P03-03 | verified | Measure isolation, snapshot/replay behavior, memory, latency, and remaining dependencies. |
| P03-04 | verified | Record the decision and implement the selected adapter skeleton without maintaining two production engines. |

## P04: Accounts, characters, and durable command infrastructure

Dependencies: P01. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p04-accounts-characters-and-durable-command-infrastructure).

| Task | State | Required outcome |
|---|---|---|
| P04-01 | verified | Integrate auth, browser session flow, account UI, and server-owned character selection. |
| P04-02 | verified | Implement character registry, activity state, connection generation, leases/fencing, and serialized domain commands. |
| P04-03 | in_progress | Implement core database tables, migrations, command receipts, revisions, business uniqueness keys, and commit-to-memory recovery. |
| P04-04 | verified | Test duplicate commands, replacement logins, transaction rollback, unknown commit outcome, and database unavailability. |

## P05: Shared authoritative overworld

Dependencies: P02, P04. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p05-shared-authoritative-overworld).

| Task | State | Required outcome |
|---|---|---|
| P05-01 | verified | Add zone rooms, public avatar projections, sequenced directional input, validation, and interpolation. |
| P05-02 | verified | Implement movement checkpoints, safe map transfer, activity restrictions, and reconnection snapshots. |
| P05-03 | in_progress | Separate private story overlays from shared presence; test nonblocking player movement. |
| P05-04 | verified | Reject speed/teleport attempts, stale-zone input, malformed packets, and hidden-state access. |

## P06: Persistent PvE vertical slice, R1

Dependencies: P03, P05. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p06-persistent-pve-vertical-slice-r1).

| Task | State | Required outcome |
|---|---|---|
| P06-01 | in_progress | Implement server-generated encounters, a basic battle presentation, legal commands, party state, and ordered events. |
| P06-02 | in_progress | Implement attack/switch/item/run paths needed for the slice; use real source behavior for supported moves. |
| P06-03 | in_progress | Implement capture, experience, fainting/loss, terminal outcome transactions, and pending nickname/storage decisions. |
| P06-04 | todo | Implement one server-owned NPC interaction and save confirmation. |
| P06-05 | todo | Run the R1 scenario and failure-injection checks before, during, and after durable outcomes. |

## P07: Opening campaign through Brock

Dependencies: P06. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p07-opening-campaign-through-brock).

| Task | State | Required outcome |
|---|---|---|
| P07-01 | todo | Implement script compiler/interpreter foundations, command/special registries, checkpoints, and private story NPCs. |
| P07-02 | todo | Implement bedroom/start sequence, names, starter selection, rival battle, parcel delivery, Pokédex progression, and early route/trainer events. |
| P07-03 | todo | Implement inventory menus, party management, PC storage, healing, shops, money, early move learning/evolution, blackout/respawn, and relevant field interactions. |
| P07-04 | todo | Expand import scope through Viridian Forest and Pewter Gym, including all required interiors and side interactions. |
| P07-05 | todo | Verify all starter/rival branches and players sharing a map at different story states. |

## P08: Multiplayer interactions and private alpha, R2

Dependencies: P07. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p08-multiplayer-interactions-and-private-alpha-r2).

| Task | State | Required outcome |
|---|---|---|
| P08-01 | todo | Implement nearby trade negotiation, versioned confirmations, atomic exchange, capacity/eligibility checks, and trade evolution consequences. |
| P08-02 | todo | Implement direct PvP challenge, consent, team-copy policy, private choices, deadlines, disconnect handling, and battle restoration. |
| P08-03 | todo | Implement presence/local chat, mute/block/report, rate limits, and basic operator diagnostics. |
| P08-04 | todo | Test cancel/confirm races, duplicate requests, two-tab abuse, stale leases, rollback, and crash-after-commit scenarios. |
| P08-05 | todo | Package a reproducible local/private test build and run alpha load/soak scenarios. |

## P09: Complete mechanics and script support

Dependencies: P08. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p09-complete-mechanics-and-script-support).

| Task | State | Required outcome |
|---|---|---|
| P09-01 | todo | Complete full-scope structured gameplay exports and required battle effects, trainer AI, battle formats, items/abilities, capture variants, and Gen III numeric semantics. |
| P09-02 | todo | Complete move learning, evolution, Pokédex, Day Care/breeding where applicable, friendship, party/storage capacity, and relevant step counters. |
| P09-03 | todo | Complete traversal, transport, fishing, Safari rules, puzzles, story barriers, map patches, and remaining used native specials. |
| P09-04 | todo | Complete game menus, input/settings, fonts/text effects, map/battle animations, music/SFX, and audio lifecycle. |
| P09-05 | todo | Map every required mechanic to source evidence, meaningful fixtures, affected content, and implementation status. |

## P10: Full campaign and postgame content

Dependencies: P09, with area imports allowed earlier. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p10-full-campaign-and-postgame-content).

| Task | State | Required outcome |
|---|---|---|
| P10-01 | todo | Expand in area batches: early Kanto to Cerulean/Vermilion, central routes and Celadon/Lavender, Fuchsia/Saffron, Cinnabar/Viridian, Victory Road/Indigo Plateau, then Sevii/postgame. |
| P10-02 | todo | For every area, verify entrances/exits, required events, optional interiors, trainers, encounters, items, shops, healing, puzzles, story branches, and relevant return visits. |
| P10-03 | todo | Cover Game Corner, Safari Zone, optional caves/legendaries, transport, and source-defined postgame facilities. |
| P10-04 | todo | Produce graph/reachability reports and investigate unreachable required records, invalid warps, and unresolved scripts. |
| P10-05 | todo | Complete a normal new-game-to-Champion run and the agreed postgame; exercise alternate starter/rival and failure paths with targeted scenarios. |

## P11: Hardening, recovery, and complete private game, R3

Dependencies: P10. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p11-hardening-recovery-and-complete-private-game-r3).

| Task | State | Required outcome |
|---|---|---|
| P11-01 | todo | Run fresh-clone setup on Windows, deployment build on Linux, and browser coverage. Resolve environment-specific failures. |
| P11-02 | todo | Rehearse schema/content upgrades, backup restoration, server shutdown/restart, and recovery of battles/scripts/trades. |
| P11-03 | todo | Run load and soak tests, measure limits, fix leaks/backpressure, and document supported capacity for the measured deployment. |
| P11-04 | todo | Complete release checklist, runbook, operator procedures, known-issues list, and content/mechanics evidence. |
| P11-05 | todo | Re-run critical end-to-end scenarios and review all deferred/blocked tasks against R3 scope. |

## P12: Optional original-content public release

Dependencies: R3 or a separately agreed product scope. Acceptance gate: [canonical phase](PROJECT_PLAN.md#p12-optional-original-content-public-release).

| Task | State | Required outcome |
|---|---|---|
| P12-01 | deferred | Define and implement the original-content profile with provenance for code, art, audio, names, text, maps, and data. |
| P12-02 | deferred | Make the public build fail if reference-profile content or disallowed provenance is included. Verify the actual built bundle. |
| P12-03 | deferred | Choose hosting, spending limits, domain, authentication recovery/email provider, moderation process, and release policies. |
| P12-04 | deferred | Prepare deployment and rollback, test it in the authorized environment, and publish only when authorized. |
