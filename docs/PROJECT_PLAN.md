# Browser Monster MMO: Technical Project Plan

Version 1.0 | Prepared September 25, 2026 | Implementation reference: `pret/pokefirered`

**Accepted workflow amendment (2026-09-25):** The user explicitly deferred Git for the first implementation pass. Do not initialize Git or require Git commands. The supplied `C:/Users/mrkda/Projects/pokefirered-master` directory is read-only and has no Git metadata. Pin its included source bytes with `source-lock.json`, a per-file SHA256 manifest, and a private reproducible snapshot; upstream commit and cleanliness remain unknown. References to commits/branches/fresh clones in this plan use the recorded worktree and snapshot evidence until Git is separately authorized. This changes source provenance handling, not gameplay scope. See ADR-002 in `docs/DECISIONS.md`.

**Accepted priority amendment (2026-10-02):** User priority amendment (2026-10-02): deliver playable in-game battle testing before implementing the remaining moves or normal durable reward chains. The first slice is an explicit practice mode using the verified source engine, selectable supported teams, source sprites and interactive battle commands. Persist isolated practice state through authenticated CharacterService commands so refresh/reconnect can resume; regular owned creatures, items, money, rewards and world progression stay separate. Once this testing loop is usable, return to the existing project plan and make each added move/Pokemon mechanic playable in this mode in the same chunk. Normal grass encounters, capture/reward application and full R1 remain unfinished; this amendment changes ordering, not their acceptance criteria. See ADR-027 and current STATUS/TASKS for verified scope.

**Purpose:** Give Codex a durable specification for implementing a browser-based FireRed-style MMO from Windows PowerShell. Keep this file in the game repository as `docs/PROJECT_PLAN.md`. It defines the architecture, scope, implementation order, acceptance gates, and working rules. Separate progress files record what has actually been completed.

**Current project status:** Planning only. No game code, importer, infrastructure, or tests are represented as implemented by this document. The user's local checkout and installed tools have not been inspected. Upstream source observations must be verified against the local revision selected in Phase P00.

**Quick use:** Put this file in the new game project folder, start Codex there, and give it the first-session prompt in Section 17. Codex then establishes `AGENTS.md`, the canonical plan, and the progress files. In later sessions, the short status file identifies where to resume.

| Jump to | Purpose |
|---|---|
| [Scope](#1-project-contract) | What the finished game includes |
| [Codex workflow](#3-codex-continuity-and-operating-rules) | How sessions stay on track |
| [PowerShell](#4-windows-and-powershell-workflow) | Environment and commands |
| [Content pipeline](#6-source-baseline-and-content-pipeline) | Importing FireRed data and scripts |
| [Battle decision](#7-battle-implementation-and-fidelity) | C/WASM feasibility and rules fidelity |
| [Persistence](#9-persistence-transactions-and-recovery) | Durable state and recovery |
| [Implementation phases](#11-phased-implementation-plan) | Ordered tasks and acceptance gates |
| [Completion checklist](#15-final-definition-of-done) | Evidence required for R3 |
| [Start/resume prompts](#17-bootstrap-and-continuation-prompts) | Instructions to give Codex |

## 1. Project contract

### Confirmed requirements

- Play directly in a desktop web browser.
- Reproduce the visual style and gameplay experience of a Pokémon GBA game.
- Use `https://github.com/pret/pokefirered` as the existing source reference.
- Build a web game without emulating GBA CPU, graphics hardware, or a ROM in the shipped runtime.
- Support an online shared world, persistent characters, and multiplayer interactions.
- Codex performs implementation; the developer starts and supervises it through Windows PowerShell.
- Pokémon terminology and development content are acceptable for this private project. Any eventual public version uses an approved original-content profile consistent with the user's stated goal.

### Proposed implementation defaults

These defaults let implementation proceed without repeatedly asking routine questions. Record changes in `docs/DECISIONS.md`.

| Decision | Default |
|---|---|
| Development platform | Native Windows, PowerShell 7 preferred; scripts also avoid unnecessary PowerShell 5.1 incompatibilities |
| First browser targets | Current desktop Chrome and Edge; add Firefox coverage before full completion |
| Initial game fidelity | Pinned FireRed rules and content, including Gen III mechanics; intentional changes documented |
| Initial display | 240 × 160 logical gameplay viewport with integer scaling and letterboxing; surrounding account/chat UI may use normal HTML |
| Controls | Keyboard first, rebindable; touch controls deferred |
| World organization | Towns, routes, and interiors are zones; battles are separate activities |
| Population | One instance per zone initially; design IDs to accommodate channels later |
| Other players | Visible and nonblocking; no player can obstruct a required doorway or story tile |
| Story progression | Per character, with shared public presence and private story overlays |
| Battles | Server authoritative, turn based, original PvE behavior; direct-challenge PvP added in private alpha |
| PvP economy | No wagers, rewards, or permanent item consumption in the initial implementation; battle on copies of eligible teams |
| Accounts | One active session per character; a replacement session invalidates the previous connection generation |
| Save model | Automatic server persistence; a familiar Save menu may request a checkpoint and display confirmation |
| Initial hosting model | One persistent Node process and PostgreSQL; run locally first |

The first playable is an intermediate gate. Completion of the requested game requires the full scope and final gates below. Do not silently redefine completion as a demo.

### Scope and finish lines

| Target | Required scope | Completion meaning |
|---|---|---|
| R1: First playable | Pallet Town, one interior, Route 1, two accounts, visible movement, one NPC interaction, one wild battle, capture, durable save and reconnect | Rendering, import, networking, battle, and persistence work together |
| R2: Private MMO alpha | Normal opening through Brock, starter and rival branches, party/PC, shops/healing, direct trade, direct PvP, local chat, recovery and basic operations | A small complete progression segment is usable by invited testers |
| R3: Complete private game | FireRed main campaign through Champion; source-defined normal Sevii/postgame progression; optional areas, mechanics, content, audio, and multiplayer adaptations listed below | All in-scope systems and content are playable and verified, with documented exceptions |
| R4: Optional public original-content release | Approved original content, deployment target, operating budget, and release validation | Separate release decision; not required to complete the private FireRed reference game |

R3 includes party and storage management, Pokédex, items and held items, shops, healing, trainer rematches where present, move learning, evolution, field moves, transport, fishing, Safari Zone, puzzles, Game Corner, Day Care/breeding where present, story cutscenes, menus, music, sound effects, and source-defined special battle formats. Inventory all reachable dependencies rather than assuming a count.

Event-distribution areas and event-only encounters retain their source gating by default. Their data must be inventoried; enabling an event is a documented configuration change. Unused/debug/other-version records are accounted for but are not automatically playable requirements. FireRed-exclusive availability remains FireRed-exclusive unless changed deliberately.

Local link trading and battling are replaced by authenticated online trade and direct PvP. Original wireless lobby presentation, link-only minigames, Mystery Gift distribution infrastructure, and external game connectivity are deferred from R3. Enumerate the exact affected facilities during P00. Rankings, auctions, guilds, raids, payments, new regions, and generative NPCs belong in a future backlog.

## 2. Stack and dependency policy

| Layer | Choice | Responsibility |
|---|---|---|
| Runtime | Node.js 24 LTS baseline | Development tools and persistent server process |
| Language | TypeScript with strict checking | Browser, network contracts, domain services, and tests |
| Browser game | Phaser | Sprites, cameras, scenes, input, map rendering, animation, game UI, audio playback |
| Client build | Vite | Local dev server and production client build |
| Multiplayer | Colyseus with WebSocket transport | Connections, room membership, state projections, reconnection plumbing |
| Database | PostgreSQL 17 baseline | Durable state, transactions, constraints, migrations |
| Database access | Drizzle ORM and `pg` | Typed schema and reviewed SQL migrations; explicit transactions and row locks where needed |
| Authentication | Better Auth, PostgreSQL-backed sessions | Account and session lifecycle; use documented library behavior |
| Validation | Zod | Runtime message/config/content-boundary validation |
| Content tools | Python 3.12+ with pinned dependencies; Pillow when needed | Binary decoding, asset processing, source parsing, deterministic export |
| Rules testing | Vitest | Unit, integration, deterministic fixture, and domain tests |
| Browser testing | Playwright | Multiple accounts, keyboard flows, reconnects, screenshots, browser regressions |
| Packaging | npm workspaces and one lockfile | Shared packages and reproducible installs |
| Local database | Docker Compose; native PostgreSQL alternative | Repeatable development database |
| Optional C preservation | Emscripten producing a server-side WASM battle module | Only if the P03 feasibility gate passes |

Node 24 is an LTS line at the preparation date [S11]. Phase P00 selects exact compatible versions, records them, and commits a lockfile. Phaser, Vite, TypeScript, Colyseus server/SDK/schema packages, auth adapters, and test tools must be tested together. Do not select prereleases merely because they have a higher version number. Do not claim a version is pinned until the actual lockfile exists.

Read documentation for the installed version before using framework APIs. Colyseus specifically documents API differences between versions and warns that old examples can generate incorrect code [S09]. Avoid copying room signatures, schema callbacks, or package names from memory.

Use plain HTML/CSS for account, settings, and chat surfaces where convenient. A separate UI framework is not a prerequisite. Use PostgreSQL in local development and tests so transaction behavior matches deployment. Redis, additional server processes, orchestration platforms, and additional backend languages are deferred until measured need.

## 3. Codex continuity and operating rules

### Required durable files

| File | Purpose | Update rule |
|---|---|---|
| `AGENTS.md` | Short startup instructions and working constraints | Change when working rules or commands change |
| `docs/PROJECT_PLAN.md` | This specification | Change for accepted scope/architecture changes |
| `docs/STATUS.md` | Current phase, verified state, blockers, exact next action | Update before every handoff or session end |
| `docs/TASKS.md` | Ordered work items with stable IDs and statuses | Update when work starts or changes status |
| `docs/DECISIONS.md` | Decisions, evidence, consequences, superseded choices | Update when resolving a meaningful tradeoff |
| `docs/CONTENT_COVERAGE.md` | Human-readable summary of imported and playable content | Regenerate/summarize with each content expansion |
| `docs/MECHANICS_COVERAGE.md` | Mechanics, source evidence, fixtures, and implementation status | Update when behavior is added or changed |
| `docs/COMPATIBILITY.md` | Intentional departures from the pinned original | Update whenever behavior differs |
| `docs/ENVIRONMENT.md` | Exact versions, ports, prerequisites, supported commands | Update when environment changes |
| `docs/RUNBOOK.md` | Start/stop, migration, backup, restore, recovery, troubleshooting | Keep synchronized with operational scripts |
| `docs/RELEASE_CHECKLIST.md` | R1/R2/R3 evidence and unresolved defects | Update at gates |

Use machine-readable inventories under `reports/` as the detailed coverage source. Markdown files summarize and link them. Do not maintain independent copies of the same task or record counts.

After the downloaded plan is installed at `docs/PROJECT_PLAN.md`, retain only that maintained copy. Replace a redundant root copy with a short pointer if needed; do not let two plans evolve independently.

### Root AGENTS.md template

During P00, create this file at the actual game repository root. If one exists, merge these rules while preserving applicable existing instructions. The long plan remains separate because Codex's automatic instruction discovery has size limits [S01].

```markdown
# Project working instructions

Build the browser MMO specified in docs/PROJECT_PLAN.md.

At session start:
1. Read docs/STATUS.md, docs/TASKS.md, and the current phase in docs/PROJECT_PLAN.md.
2. Read relevant entries in docs/DECISIONS.md and docs/COMPATIBILITY.md.
3. Check the branch, worktree, source-lock.json, and actual environment.
4. Reconcile claimed progress against code and evidence.
5. Continue the highest-priority unblocked task. Do useful authorized work without
   asking for routine approval or merely restating a plan.

Implementation rules:
- Use the declared TypeScript/Phaser/Colyseus/PostgreSQL architecture.
- Use native PowerShell-compatible commands and portable Node/Python scripts.
- Keep the reference checkout read-only. Never reset or delete unrelated work.
- Verify installed framework versions before writing version-sensitive code.
- Keep authoritative gameplay and durable mutations on the server.
- Preserve independent character, script, and battle state.
- Unsupported required content must be visible and actionable, never a silent no-op.
- Commit meaningful local changes when appropriate; do not push or deploy unless authorized.
- Routine reversible implementation choices may be made and recorded autonomously.
- Do not treat this plan as permission to bypass sandbox or organizational controls.
- Do not publish original reference content or incur paid service costs without authorization.

Validation and handoff:
- Run focused tests for changed behavior and required phase gates.
- Distinguish implemented, verified, blocked, and deferred work.
- Never mark a task done using placeholders or unexecuted checks.
- Before ending, update STATUS.md and TASKS.md with actual results, changed files,
  outstanding processes, blockers, and one concrete next action.
- Do not declare the project complete at the first-playable milestone.
```

After creating `AGENTS.md`, verify the next session recognizes it. The initial bootstrap instruction explicitly requests these reads, so the first session does not depend on discovering a file it has only just created.

### Session workflow

1. Check `git status --short`, branch, uncommitted user work, and source revision. Preserve unrelated changes.
2. Read the short status summary and current milestone, then relevant specifications. Do not reread the entire source tree on every session.
3. Choose one small verifiable task. Split work by package ownership when using subagents; keep shared migrations/protocol edits coordinated.
4. Implement real behavior, run focused validation, inspect errors and the resulting user experience.
5. Update progress and decision files. Record actual commands, outcomes, evidence paths, and tested commit/diff state.
6. Proceed to the next unblocked task while the session allows. If blocked, work on an independent authorized task and record the dependency.

Ask the user only when a missing fact materially changes scope, required access is unavailable, or an action exceeds existing authorization. Do not ask for approval to advance each phase. Actual deployment, purchases, or destructive operations remain subject to the user's instructions and environment controls.

### Status template

```markdown
# Project status
Updated: <timestamp with timezone>
Release target: R1 / R2 / R3
Current phase: P00
Current task: P00-01
Branch: <actual branch>
Last verified commit or worktree description: <actual value>
Source revision: <actual SHA or not yet pinned>

## Working and verified
- <observable result and evidence>

## Implemented but not verified
- <remaining validation>

## Blockers
- <dependency, impact, attempted resolution>

## Last checks
- <command> | <pass/fail/not run> | <evidence path>

## Running processes
- <process purpose, local port, stop procedure; no secrets>

## Exact next action
<one concrete action with files and expected outcome>
```

Tasks use `todo`, `in_progress`, `blocked`, `verified`, or `deferred`. Each task records ID, phase, outcome, dependencies, acceptance evidence, and notes. A decision record has ID, date, context, alternatives, chosen option, evidence, consequences, and revisit trigger. Reserve ADR-001 for battle implementation.

## 4. Windows and PowerShell workflow

### Initial environment

Use a new game repository separate from the existing FireRed reference checkout. Prefer a short path such as `C:\dev\monster-mmo`; still quote paths in scripts. Avoid placing the working project in a folder actively synchronized by consumer file-sync software.

Prerequisites: Git, Node 24 LTS, Python 3.12 or newer supported by the converter, a working Codex installation, and Docker Desktop with Compose or a native PostgreSQL installation. Docker Desktop may use WSL internally; the game development commands remain PowerShell-native. Only the optional original-ROM reference build or C spike may need additional toolchains. Inspect before installing or changing system settings.

Read-only prerequisite checks:

```powershell
$PSVersionTable.PSVersion
git --version
node --version
npm.cmd --version
py -3 --version
docker --version
docker compose version
codex --version
```

Use `npm.cmd` and `npx.cmd` on Windows when PowerShell's `.ps1` shim selection causes execution-policy errors. If needed, use the installed `codex.cmd` shim. Do not weaken the machine's execution policy as a default fix. Record unavailable tools as actual blockers; do not claim a check passed because the command was suggested.

Project orchestration belongs in portable Node scripts or Python modules. Do not assume Bash, GNU `make`, symlinks, POSIX environment assignment, or `rm -rf`. When invoking native programs from PowerShell automation, check `$LASTEXITCODE`; `$ErrorActionPreference = 'Stop'` alone is not a complete native-exit-code policy. Check errors between dependent steps.

### Environment contract

Create `.env.example` containing variable names and safe examples; keep actual `.env` files ignored. The backend is responsible for loading and validating its environment. Only intentionally public client configuration may use Vite's public variable prefix.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Local/application PostgreSQL connection; server only |
| `BETTER_AUTH_SECRET` | Locally generated high-entropy secret; server only |
| `BETTER_AUTH_URL` | Canonical browser-facing auth origin |
| `APP_ORIGIN` | Allowed browser origin |
| `PORT` | Backend port, initially 2567 |
| `CONTENT_PROFILE` | `firered-private` or later `original` |
| `REFERENCE_SOURCE_DIR` | Absolute path to read-only source checkout |
| `CONTENT_DIR` | Generated content location |
| `LOG_LEVEL` | Logging verbosity without secrets |

Default local ports: client 5173, backend 2567, PostgreSQL host port 5433 mapped to container port 5432. Bind database exposure to loopback. All ports must be configurable. Use a Vite proxy for auth/API/WebSocket requests and test the Colyseus connection URL advertised to clients, not just the initial HTTP request. Production uses a single browser-facing HTTPS origin and WSS routing where practical.

### Script contract and availability

The commands below are **required project interfaces, not commands that already exist**. P01 establishes the orchestration pattern; each command becomes usable in the phase shown. Do not instruct the user to run it before implementation and prerequisites exist. Pending commands must fail with a clear explanation if invoked, not report success. Each script returns a nonzero exit code on failure.

| Root command | First phase | Required behavior |
|---|---|---|
| `npm.cmd run setup` | P01 | Validate prerequisites; create Python virtual environment; install pinned converter dependencies; create missing local configuration without overwriting it; generate local secrets without printing them |
| `npm.cmd run doctor` | P01 | Report versions, config presence, source-lock match, database reachability, port conflicts, and available content compatibility checks; redact values |
| `npm.cmd run source:inventory` | P02 | Inventory the pinned source and emit coverage reports; P00 performs the initial source audit |
| `npm.cmd run content:build -- --profile firered-private` | P02 | Build deterministic content for the configured scope |
| `npm.cmd run content:check` | P02 | Validate manifests, references, parser coverage, asset bounds, and content profile |
| `npm.cmd run db:migrate` | P01 | Apply reviewed migrations to the configured database |
| `npm.cmd run db:seed:dev` | P04 | Idempotently add developer fixtures to an explicitly local development database |
| `npm.cmd run dev` | P01 | Start client and backend with clear readiness/error messages and coordinated Ctrl+C shutdown |
| `npm.cmd run lint` / `npm.cmd run typecheck` | P01 | Static validation across workspaces |
| `npm.cmd run test:unit` | P01 | Run implemented unit tests; add rules fixtures as mechanics arrive |
| `npm.cmd run test:integration` | P01 | Database/network smoke tests initially; add domain/transaction tests from P04 |
| `npm.cmd run test:e2e` | P01 | Browser smoke tests initially; add isolated-account/gameplay scenarios in later phases |
| `npm.cmd run verify` | P01 | Run the current phase's required checks, expanding as features arrive; report future gates separately, never as passed |
| `npm.cmd run build` | P01 | Build deployable client/server artifacts without embedding private server data in the client |
| `npm.cmd run start` | P01 | Run the built backend and serve the built client/public assets on the backend origin for a local production-style check |
| `npm.cmd run loadtest -- --scenario alpha` | P08 | Run a representative local/staging alpha gameplay workload and produce measurements |
| `npm.cmd run backup` / `npm.cmd run restore:check` | P08 | Create a database backup and verify restore into a disposable target |

Provide an explicit `db:reset:dev` command only with environment, database-name, and host safeguards plus an affirmative reset flag. Never call it as an automatic repair. Ordinary stop commands must preserve volumes. Document the difference between `docker compose down` and removing volumes; destructive volume removal is not part of the daily workflow.

Once P02's importer and its prerequisites are implemented, the expected full setup sequence is below. P01 uses its foundation commands and placeholder scene; it cannot yet run content conversion. Account/gameplay checks become available in their respective phases.

```powershell
Set-Location 'C:\dev\monster-mmo'
npm.cmd ci
npm.cmd run setup
docker compose up -d db
npm.cmd run doctor
npm.cmd run db:migrate
npm.cmd run source:inventory
npm.cmd run content:build -- --profile firered-private
npm.cmd run content:check
npm.cmd run dev
```

Run sequentially and stop on failure. The database service needs a health check and readiness retry. When using native PostgreSQL, skip the Compose step and use the same migration/test interfaces. For converter work, invoke `.venv\Scripts\python.exe` directly rather than requiring shell activation. Pin Python dependencies and document their installation. Install Playwright browser binaries through the pinned local package during test setup.

## 5. Repository structure and dependency boundaries

| Path | Responsibility |
|---|---|
| `apps/client/` | Phaser scenes, browser input, rendering, UI, audio, networking adapter |
| `apps/server/` | HTTP/auth integration, Colyseus rooms, session registry, domain services, operations |
| `packages/protocol/` | Versioned public message schemas, response codes, permitted projections |
| `packages/content-schema/` | Versioned types/validators for generated content |
| `packages/game-rules/` | Renderer-independent mechanics and movement helpers |
| `packages/battle-core/` | Server-facing battle interface and selected TypeScript or WASM adapter |
| `packages/database/` | Database schema, migrations, repositories, transaction helpers |
| `tools/content-import/` | Python parser, decoders, exporters, and converter tests |
| `tools/battle-spike/` | Bounded C extraction experiment; not the production architecture by default |
| `scripts/` | Portable setup, verification, dev-process, backup, and reporting commands |
| `content/manifests/` | Version/source manifests and coverage metadata |
| `content/generated/client/` | Public presentation assets and permitted static data |
| `content/generated/server/` | Full rules, scripts, encounters, and server-only data |
| `tests/fixtures/` | Small attributable fixtures and expected results |
| `tests/e2e/`, `tests/integration/`, `tests/load/` | Cross-system verification |
| `reports/` | Machine-readable inventories and verification evidence |
| `docs/` | Plan, continuity files, compatibility and operational documentation |
| `source-lock.json` | Exact upstream source selection and local modification fingerprint |

Use an ignored `reference/pokefirered/` checkout only if the user has not already supplied an external path. Never copy the entire source into the client bundle. Never modify reference files to make the importer pass. Experiments that change original C use a separate worktree or copy with its own patch record.

The client may import protocol/content-schema and explicitly browser-safe helpers. It must not import database code, server services, secret configuration, full encounter RNG state, or private battle state. Rules code cannot import Phaser or Colyseus. The battle core cannot access the database directly; domain services commit its outputs. Generated files are rebuilt, not manually patched.

## 6. Source baseline and content pipeline

### Baseline selection

P00 records repository URL, exact commit SHA, selected language/game/revision, local dirty-state fingerprint, source paths, and relevant tools in `source-lock.json`. Choose the normal English FireRed target available in the user's checkout and record the exact choice. Do not mix LeafGreen/revision-specific records accidentally. A moving branch name is insufficient.

If the reference is modified, preserve it and fingerprint the patch set. Also preserve a binary-capable patch against the recorded base plus required untracked inputs, or an equivalent complete private source snapshot. Record that archive's location and hash; a fingerprint alone cannot reproduce the inputs. Do not publish that private reference archive by default. A local source fingerprint change invalidates previously generated content. A verified original ROM build is useful evidence but is not a prerequisite to rendering source-derived maps. Its toolchain is separate from normal browser development.

### Pipeline stages

1. Discover input files and selected-build conditions.
2. Parse and resolve constants, labels, references, and binary records.
3. Normalize into a typed intermediate representation carrying source locations.
4. Validate structural integrity and required-scope coverage.
5. Export separate client/server bundles and a reproducibility manifest.
6. Produce actionable reports for unsupported or ambiguous records.

The manifest records source SHA/fingerprint, converter version, schema version, input/output hashes, stable IDs, source-to-output mappings, record counts, warnings, and unsupported dependencies. Sort outputs and exclude wall-clock timestamps from hashed deterministic content. Identical inputs and converter versions must produce identical content hashes on clean Windows and Linux builds.

Use stable symbolic content IDs with explicit mappings to original numeric IDs where mechanics depend on them. Creature instance IDs are database identities and must never be confused with species IDs. ROM addresses are not stable web content IDs.

During early phases, a named scope such as `pallet-route1` can build only its dependency closure. Unsupported required dependencies fail that scope; unrelated unimplemented areas remain visible in the full inventory. The R3 build fails on any unsupported in-scope dependency. Never silently drop records to make a report green.

### FireRed map decoding notes

Verify these source observations against the pinned checkout [S03, S04].

| Record | Interpretation |
|---|---|
| Map and border block | Little-endian unsigned 16-bit value |
| Metatile ID | `block & 0x03FF` |
| Collision | `(block & 0x0C00) >> 10` |
| Elevation | `(block & 0xF000) >> 12` |
| FireRed metatile attributes | Unsigned 32-bit entry; do not apply an Emerald-specific 16-bit assumption |
| Behavior | `attributes & 0x000001FF` |
| Terrain | `(attributes & 0x00003E00) >> 9` |
| Encounter surface | `(attributes & 0x07000000) >> 24` |
| Layer type | `(attributes & 0x60000000) >> 29` |

Retain the full raw attribute value. Preserve primary/secondary tileset indexing, border dimensions, component tile ordering, flip flags, palette indices, transparency, and normal/covered/split layer behavior. Derive the exact masks and layout conventions from the pinned source. A flattened background image cannot represent every required occlusion or dynamic map edit.

Import map connections and offsets, warp IDs/destinations, elevation, object/coordinate/background events, hidden items, music/weather metadata, map hooks, movement ranges, and dynamic tile changes. Collision is a behavior rule using map state and capabilities, not a test of what a tile looks like. Keep ledges, surf transitions, doors, bridges, boulders, cut trees, and scripted barriers distinguishable.

Pallet Town's map metadata and `layouts.json` provide concrete starting records [S05]. Add a diagnostic renderer that can overlay metatile IDs, collision, elevation, event triggers, and resolved warp destinations. This is a developer tool, disabled in normal play.

### Structured gameplay data

Export species/stat definitions, catch rates, move definitions/effect bindings, level-up learnsets, TM/HM compatibility, tutor/egg moves, evolutions, abilities, item effects/prices/pockets, trainer parties and AI settings, encounter tables and slot distributions by method, growth/experience tables, type interactions, shop inventories, and source-defined special-mode data. Record the exact paths discovered in the selected revision rather than assuming another pret project's organization.

Resolve C initializer constants, enums, macros, includes, arrays, and build conditionals through a deliberate parser/preprocessing strategy. Never treat an unresolved expression as zero. Preserve order and numeric semantics where rules depend on them. Check all species/move/item/trainer references, table dimensions, range values, selected-game availability, and any expected totals derived from the source. Generate browser-safe descriptions separately from server-only operational state.

Start with the dependency closure for R1 encounters/creatures/moves/items, then expand to R3 without changing stable IDs. Species tables are definitions; player-owned creatures carry their own durable runtime values. A data row importing successfully does not prove its move effect, evolution rule, or trainer AI is implemented. Runtime gameplay uses generated source records; hand-authored approximations are restricted to explicitly named test fixtures. Verify selected exported values against independently inspected source records.

### Graphics, text, and audio

- Export sprite frames with dimensions, offsets, transparency, palette variants, animation sequences, and direction metadata.
- Decode indexed graphics with their intended palettes. Verify fonts, icons, UI frames, trainer sprites, battle sprites, overworld sprites, and effects separately.
- Represent animated tiles and palette changes as explicit tracks. Inventory native animation callbacks and unsupported effects.
- Inventory battle-animation scripts, sprite/affine sequences, palette effects, sound events, and native animation callbacks. Define the browser equivalent and coverage status for every used construct; record deliberate visual substitutions explicitly.
- Preserve layer occlusion and elevation behavior. Use fixed-camera screenshots to inspect interiors, roofs/trees, water, doorways, and animated scenery.
- Parse the original text encoding and control codes into structured text tokens. Substitute player/rival names and variables through validated rendering. Do not render arbitrary source text as HTML.
- Use Unicode for web text with explicit handling for original glyphs and layout controls.
- Inventory music/SFX source formats and available conversion tools. Choose a documented offline conversion path or a browser audio implementation that does not require a GBA emulator. Record loop points, fades, transitions, and effects.
- Prototype audio conversion on one music track and one SFX before processing the inventory. Browser audio starts after a user gesture; provide mute/volume controls and handle focus changes.

### Script compiler and interpreter

Build a parser for the used script language and its build-time constructs. It must handle includes, constants, labels, macros, conditional build sections, movement sequences, text references, command operands, and direct native calls where present. Use a typed intermediate representation; do not rely on a growing set of text substitutions.

Maintain coverage registries for script commands, movement commands, specials, and native-call bindings [S06]. Each registry entry lists source location, implementation, affected content, tests, and status. Recognizing a `special` opcode does not implement the native function it names.

Run progression checks, branching, rewards, event eligibility, battle creation, and durable mutations on the server. Emit presentation events for dialogue, menus, fades, camera motion, sounds, and choreography. Client responses identify a server-issued interaction and one of its allowed choices. A browser animation acknowledgement is not authority to grant an item.

Interpreter requirements:

- Distinguish persistent character flags/variables, temporary map variables, script-local state, battle-local state, and intentionally shared state.
- Persist the content version, active script, instruction/checkpoint position, relevant locals, pending interaction, and completed durable steps.
- Commit rewards and the script checkpoint advance in the same transaction.
- Define safe resume behavior for dialogue, choice prompts, starter selection, cutscenes, battles, healing, move learning, and evolution.
- Scope story NPC visibility, movements, and map patches per player or private event instance. Collision uses the same player-specific view.
- Apply instruction budgets and loop protection. Yield cleanly at blocking operations.
- Unsupported commands fail with a source location and affected content. A no-op is allowed only if explicitly classified as a nonessential presentation omission for an early milestone; it remains incomplete for R3.

## 7. Battle implementation and fidelity

### Stable interface

Both possible implementations expose the same server-facing contract. These are project interfaces to design, not Colyseus or Emscripten APIs:

```text
createBattle(config, initialState, rngState) -> BattleState
validateChoice(state, actorId, choice) -> Accepted | Rejection
advance(state, acceptedChoices) -> { nextState, orderedEvents, domainEffects }
snapshot(state) -> VersionedBattleSnapshot
restore(snapshot) -> BattleState
project(state, viewerId) -> PermittedBattleView
```

`domainEffects` describe item consumption, captured creatures, experience, rewards, progression, or pending decisions. Each effect has a stable identity such as `(battleId, transitionSequence, effectIndex)`. Application services apply each new effect exactly once with its corresponding snapshot, including experience/level-up and follow-up choices that occur before battle end. Never replay cumulative effect history as new database mutations. The terminal transaction applies only outstanding terminal effects. The battle module must not mutate published room state or durable records while calculating a result.

Persist the mode/rules policy at creation. For initial `pvp-copy` battles, the domain service rejects effects that alter owned creatures, persistent HP/PP, held items, inventory, experience, or party ownership. Battle-local copies may change. Enforce this boundary independently of presentation and engine code.

State includes rules/content version, participants, teams, turn/action order, pending choices, statuses, effects, RNG state, and unresolved follow-up decisions. Events have monotonically increasing sequence IDs. Clients can skip or accelerate presentation and still converge to the latest authoritative snapshot.

### P03: bounded C/WASM feasibility experiment

The original stores battle data in globals and interleaves mechanics with presentation waits [S07, S08]. Extraction is a hypothesis to test, not an assumed shortcut.

Set a decision budget of three focused work batches, with a planning ceiling of 24 actual engineering hours if time is tracked. This is a limit on exploration, not an estimate of project duration. Record results after each batch. Continue map work independently.

1. Trace dependencies; compile a minimal headless path; replace presentation calls with emitted events.
2. Run representative attacks, switching, status, fainting, an end-of-turn effect, victory, and loss. Interleave two independent battles.
3. Demonstrate deterministic replay, snapshot/restore, Node integration, and measured memory/latency. Inventory remaining mechanics and dependencies.

Success requires all three batches' outcomes with real mechanics, no GBA execution loop, no CPU/GPU emulation, no shared-state contamination, and a comprehensible remaining extraction boundary. Independent WASM instances may isolate global state; measure their memory cost. A coherent per-battle C context is another option but can require more refactoring.

If the gates fail within the budget, record ADR-001 choosing TypeScript and continue through the same interface. Do not extend the spike indefinitely or retain stubbed gameplay to claim success. Successful C reuse still requires full mechanics coverage and persistence integration.

### Rules fidelity

Default to the selected FireRed generation and data. Track move order/priority, speed ties, accuracy, critical hits, damage rounding, type interactions, abilities, held items, statuses, volatile effects, switching, immunity, weather, multi-hit moves, recoil, drain, fainting, doubles where used, trainer AI, capture, fleeing, experience, EV/IV behavior, growth, friendship, evolution, and move learning.

Gen III physical/special behavior follows the selected source; do not accidentally import later-generation move categories. Preserve C integer width, signedness, overflow, and rounding where observable. For 32-bit arithmetic in TypeScript, use explicit operations and fixtures rather than assuming JavaScript number multiplication matches C overflow.

Use per-battle server-controlled RNG with serializable state. Test seeds are explicit; live seeds are generated server-side and never accepted from the client. Keep future RNG state and unchosen opponent information private. Authentication secrets use cryptographic APIs independently of game RNG.

Fixtures must be derived from source semantics or a trustworthy reference execution, not generated solely by the implementation under test. Every fixture records the input, seed, expected event/state result, source evidence, and any intentional departure. Optional original-game captures can support development verification; the shipped game remains emulator-free.

## 8. Authoritative world and message design

### Ownership model

Start with one Node process containing a character session registry, domain services, and Colyseus rooms. PostgreSQL is authoritative for committed durable state; the running session owns its current simulation state.

| Component | Owns | Must not own independently |
|---|---|---|
| Character session service | Character activity, command serialization, connection generation, durable mutation coordination | A second divergent party/inventory copy |
| Zone room | Active movement simulation and permitted nearby avatar projection | Rewards, authoritative inventories, or another room's character ownership |
| Battle service/room | Battle simulation and viewer-specific projections | Direct unchecked writes to character persistence |
| Trade service | Versioned offers and negotiated activity | Long database transactions while users consider an offer |
| Script service | Authoritative interaction/checkpoint execution | Shared story flags by accident |
| Browser | Input, prediction, interpolation, presentation, UI | Final position legality, encounter generation, damage, captures, balances, ownership, progression |

All modules mutate a character through the same domain service. Serialize commands for one character. Acquire multi-character application locks in sorted character-ID order and database locks in a documented consistent order. Node's single event loop does not prevent asynchronous race conditions.

Character activity is explicit: `overworld`, `scripted_event`, `battle`, `trade`, `transferring`, or `recovering`. Nested transitions, such as a script starting a battle, retain a resumable parent continuation. Reject incompatible actions and commands from replaced connection generations.

Persist a character ownership generation/fencing token with an expiring server lease before external testing. Every durable write verifies that generation in its transaction. A losing process stops mutations. This prevents an old process or stale socket from overwriting a character after takeover. Do not introduce multiple game processes before this behavior is tested.

### Protocol contract

Handshake exchanges protocol version, server build, content hash, rules version, and authenticated character identity. Reject incompatible clients with a clear reload/update response. Content changes must not silently alter an active battle.

Reliable gameplay commands include a unique command ID, payload type/version, activity ID, expected activity revision/turn, and bounded payload. The server derives account/character identity from the authenticated session. It validates IDs, enum values, array lengths, numeric bounds, rate, eligibility, cost, ownership, and state.

Movement uses sequenced directional input and connection/zone generations. Do not create a database receipt for every movement packet. Ignore old sequence numbers, enforce server movement timing, cap queued inputs, and prevent teleport/speed manipulation. Durable outcomes triggered by movement still use transactions and business uniqueness keys.

Example command families:

| Command | Server checks |
|---|---|
| Move direction | Sequence, activity, speed, collision, elevation, capabilities |
| Interact with object | Same applicable map, range/facing, visibility, story state |
| Choose dialogue option | Active interaction ID, offered options, current step |
| Choose battle action | Actor, turn, legal move/target/switch/item, current activity |
| Purchase item | Shop inventory, price from server content, funds, capacity |
| Update/confirm trade | Offer version, ownership, activity, confirmation state |
| Change party or storage | Ownership, eligibility, capacity, current restrictions |

Clients receive explicit errors and a replacement snapshot when their state is stale. Hide private parties, inventory, quest flags, auth data, RNG, and unrevealed PvP choices through server-side projection. Omitting a field from the UI does not protect it if the room schema broadcasts it.

### Movement and zones

Begin with a configurable 20 Hz authoritative world simulation and 10 Hz state publication, with client rendering near 60 FPS. These are initial design parameters to measure. Movement step duration must match source behavior; render interpolation must not change legal movement speed. Client prediction is optional in the first test but required if measured latency makes walking visibly unresponsive.

Predict only permitted local movement from the same static rules, then reconcile with server sequence acknowledgements. Interpolate remote avatars. Story barriers, dynamic obstacles, doors, surfing, and scripted motion remain server validated. Never assume every tile collision rule fits generic physics collision boxes.

Load nearby asset bundles and unload inactive scene resources. Start with zone-wide presence for small maps; introduce interest management when measured room size/bandwidth requires it. Cosmetic animation does not need a network message each frame.

### Map transition transaction

1. Validate the boundary/warp from current server position and progression.
2. Set activity to transferring and stop old-zone input.
3. Commit destination map/position and a new transition generation.
4. Update runtime membership and provide a destination snapshot.
5. Accept input only for the new generation.

If membership changes fail after commit, recover from the persisted destination. The character must never accept movement in two zones at once. Battle/trade subscriptions do not grant a second owner of the character. Empty room disposal must not delete durable progress.

## 9. Persistence, transactions, and recovery

### Minimum data model

Use relational records for ownership and economy. JSONB is appropriate for versioned battle/script snapshots, not as a substitute for integrity constraints on every asset.

| Entity | Key requirements |
|---|---|
| Auth tables | Managed through the selected auth library and reviewed migrations |
| Characters | Account FK, name rules, map/position, progression summary, activity, revision |
| Character leases | Character uniqueness, server owner, fencing generation, expiration |
| Creatures | Stable instance ID, owner FK, species, identity/personality, IV/EV/experience, moves/PP, status, provenance |
| Party/storage slots | Unique occupied slot, one location per owned creature, capacity constraints |
| Inventory/wallet | Item definition references, nonnegative values, uniqueness by owner/item/pocket as appropriate |
| Story state | Flags/variables, trainer completion, collected items, map patches, one-time claim keys |
| Script executions | Content version, resumable state, pending choices, durable effect IDs |
| Battles | Status, participants, versioned snapshot, RNG, pending choices, result, rules/content version |
| Trades | Versioned offer, confirmations, status, expiry, immutable completion receipt |
| Command receipts | Actor, command ID, payload hash, committed result, timestamp |
| Domain outcomes | Permanent unique reward/capture/quest/trade keys that outlive short-lived receipt cleanup |
| Audit records | Structured operational and asset-change events; no secrets or plaintext credentials |

Generate DDL with explicit FKs, unique/check constraints, indexes, and migration tests. Define deletion and retention behavior; do not cascade-delete owned assets casually. Account erasure/public privacy workflows are a separate public-release requirement.

### Durable mutation algorithm

For purchases, captures, item use, party/storage changes, evolution, rewards, script effects, trades, and battle turns:

1. Acquire application locks for affected character/activity IDs.
2. Begin a transaction; lock affected rows in stable order.
3. Verify lease/generation and check the command receipt and payload hash.
4. Load/validate current revisions and business uniqueness keys.
5. Compute the next state without changing published memory. Battle simulation runs within the serialized activity boundary, but avoid holding database locks while doing unnecessary expensive work.
6. Write the committed state, domain outcomes, and receipt atomically, rechecking versions as needed.
7. Commit, then replace runtime state with the committed revision and acknowledge/publish.

On rollback, published state remains unchanged. If commit succeeds but publication fails, freeze the affected activity, reload committed state, and resynchronize. If the connection fails during commit, the outcome is unknown: reconnect and query the command receipt before retrying. The same ID with the same payload returns the original result; the same ID with a changed payload is rejected.

Use permanent business keys such as `battleId:terminalReward`, `characterId:itemEventId`, and `tradeId:complete` so deduplication survives receipt cleanup. Prefer explicit row locks and revision checks for core economy flows; bounded retries may handle recognized deadlock/serialization failures. All transaction retries must preserve idempotency and RNG state.

### Save frequency and crash semantics

Persist meaningful changes immediately. Ordinary walking checkpoints may occur every five seconds, at safe map transitions, at requested saves, and on graceful disconnect. This interval is a design default. A crash may move a character back to the last walking checkpoint; it must not duplicate or roll back acknowledged captures, consumed items, rewards, trades, or progression.

Persist the authoritative location with any durable encounter or interaction so a recovered character cannot resume the result from an inconsistent earlier location. If the database is unavailable, fail durable commands clearly and stop gameplay that depends on them. Do not accumulate an unbounded queue of promised rewards in memory.

### Battle and script recovery

Persist accepted battle choices before acknowledging them and commit each resolved turn with its new identified effects, item consumption, and next RNG state. Persist encounter identity before exposing a generated wild encounter. Terminal resolution commits the completed result, any outstanding final effects, and the character's next activity together. That next activity may be move learning, evolution, nickname/storage selection, blackout handling, or a parent script continuation. Release to `overworld` only when all required continuations are complete.

Move learning, evolution, nickname, and full-storage decisions are explicit pending states. Define behavior when party and storage are full before enabling capture, trade, gifts, or breeding claims. Disconnecting must not bypass costs, duplicate gifts, or reroll encounters.

Proposed disconnect policy:

- Live connection interruption: allow a 60-second transport reconnection grace, then release the transport while retaining recoverable durable activity.
- PvE: pause at a safe committed decision boundary; authenticate and resume from the persisted battle/script state. Never reseed on reconnect.
- PvP: 60-second turn deadline while the server is operating; missing the deadline forfeits. Reconnection does not reset it. Choices remain private.
- Process restart: restore persisted PvE state. For PvP, first resolve any turn whose required choices were already acknowledged, exactly once. Otherwise the first recovery of that interrupted turn grants one fresh 60-second wall-clock deadline, atomically persisted with `recoveryGraceUsed` against `(battleId, turnId)`. Subsequent recovery of the same turn reuses that deadline. If another outage exhausts it, end the unranked match as no contest. Ordinary deadline expiry while the server remains running still forfeits. Do not grant grace on an ordinary socket reconnect. A different policy requires an ADR and compatibility entry.
- Negotiating trade: cancel uncommitted offers on lease expiry/restart; committed trades remain completed and receipts are returned.

Keep timeouts configurable and test boundary behavior. Colyseus transport reconnection does not by itself restore state after process death. Full recovery starts from authenticated account ownership and PostgreSQL records.

### Trade integrity

Trading initially occurs between nearby players in the same zone. Reserve both characters' activities but do not hold a database transaction while waiting for confirmation. Each offer edit increments a version and clears both confirmations.

Final confirmation locks the trade, both characters, offered creatures/items, and relevant capacities. Revalidate the exact confirmed version, ownership, eligibility, session/activity state, and remaining party rules. Transfer all assets, handle deterministic trade-evolution consequences or durable pending choices, and write the immutable receipt in one transaction. Confirm/cancel/disconnect races compete on the same trade status transition.

A disconnect after commit cannot cancel or reverse the trade. Two simultaneous trades cannot spend the same creature. Client-supplied creature attributes never replace server records.

## 10. Authentication, abuse resistance, and operations

Use Better Auth's documented PostgreSQL/session integration [S12]. Keep auth tables and migration ownership consistent with the chosen Drizzle adapter. Use secure HttpOnly cookies in HTTPS environments, narrow allowed origins, and server-side session validation when admitting a connection. Test the exact browser/Colyseus auth flow before committing to implementation details. If the installed SDK cannot carry the chosen same-origin session flow reliably, issue a short-lived one-use room admission ticket through authenticated HTTP; never place long-lived credentials in room URLs or logs.

A development-only identity shortcut may be used in P01 network smoke tests, clearly gated to loopback and disabled in builds used by testers. It is removed from the acceptance path once P04 authentication exists. No hardcoded production accounts or passwords.

Rate-limit login, chat, movement, interaction, battle, and trade commands independently. Bound connection count, payload size, queued work, script instructions, and outgoing buffers. Disconnect slow consumers cleanly. Escape text rendering; cap names/chat lengths. Alpha chat includes mute/block/report and an operator action log; no global chat history requirement.

Logs include request/command IDs, character/activity IDs, source content version, rejection reason, transaction failures, and recovery events. They exclude credentials, cookies, tokens, future RNG, and private messages unless an explicit retention requirement exists. Metrics include active connections, room sizes, tick time, event-loop delay, simulation latency, database latency, outgoing bandwidth, disconnects, and persistence failures.

Expose separate liveness and readiness endpoints. Readiness checks database/content compatibility. Graceful shutdown stops admission, finishes or checkpoints accepted work, closes sockets, and exits. A process supervisor restarts the server; it does not repair a broken migration automatically.

## 11. Phased implementation plan

All tasks below start unverified. Instantiate their IDs in `docs/TASKS.md`; split large tasks into subtasks without renumbering completed work. Phases advance when their gates pass. P02 and P03 may proceed in parallel after P01. UI and content tooling can proceed independently of unresolved battle extraction.

### P00: Baseline, scope, and environment

**Outcome:** A reproducible reference point and durable project instructions.

- [ ] P00-01 Inspect the actual folders, branch, dirty state, tools, and existing instructions. Preserve user changes.
- [ ] P00-02 Create the continuity files and root AGENTS.md; copy this specification into `docs/PROJECT_PLAN.md`.
- [ ] P00-03 Pin the reference source and create `source-lock.json`; inventory source paths and build variants.
- [ ] P00-04 Record dependency compatibility and exact tool versions. Choose the local PostgreSQL route.
- [ ] P00-05 Create the scope/feature ledger, distinguishing normal FireRed content, unused records, event gating, and deferred link features.

**Gate:** Another session can identify the exact source, current task, setup prerequisites, and R3 scope. No gameplay implementation claims are made yet.

### P01: Workspace foundation and executable contracts

**Depends on:** P00. **Outcome:** Client, backend, database, and automated checks run locally.

- [ ] P01-01 Create npm workspaces, strict TS configuration, lockfile, package boundaries, Python environment, and root scripts.
- [ ] P01-02 Add a placeholder Phaser scene, backend health/readiness, and a versioned protocol handshake.
- [ ] P01-03 Configure local PostgreSQL, baseline migrations, validated environment, and coordinated development processes.
- [ ] P01-04 Implement structured errors/logs, test databases, Vitest/Playwright setup, and a clean build.
- [ ] P01-05 Implement meaningful network smoke tests and verify Ctrl+C shutdown. Document the exact start/stop commands.

**Gate:** Fresh setup reaches the placeholder client, backend, and database from PowerShell. A browser connects through the intended dev proxy. Static checks/build pass. Test failures fail the command. No silent fallback database or auth bypass in tester builds.

### P02: Content importer and accurate local overworld

**Depends on:** P01. **Outcome:** Pallet Town, one house, and Route 1 render and connect correctly.

- [ ] P02-01 Implement source discovery, map block/metatile/palette decoding, manifest generation, and structural tests.
- [ ] P02-02 Import player/NPC sprites, representative animations, fonts, and the required map dependency closure.
- [ ] P02-03 Implement tile movement, layer occlusion, elevation/collision, doors, boundaries, camera, input focus, and integer scaling.
- [ ] P02-04 Implement a debug map overlay and one animated map feature; prototype one music track and one SFX.
- [ ] P02-05 Add reproducibility and visual fixtures; expose unsupported dependencies explicitly.
- [ ] P02-06 Export and validate the structured gameplay data needed by R1, including creature/move/item/encounter references, with a parser strategy that extends to the full inventory.

**Gate:** The three areas are navigable with correct collision/warps/layers. Two clean conversions match. A malformed binary or missing palette/reference fails clearly. The map renderer is not declared story-complete.

### P03: Battle backend decision

**Depends on:** P01. **Outcome:** ADR-001 selects the production battle approach based on evidence.

- [ ] P03-01 Specify the battle interface and golden fixture format; trace original dependencies.
- [ ] P03-02 Execute the bounded C/WASM experiment defined in Section 7.
- [ ] P03-03 Measure isolation, snapshot/replay behavior, memory, latency, and remaining dependencies.
- [ ] P03-04 Record the decision and implement the selected adapter skeleton without maintaining two production engines.

**Gate:** Real evidence supports C reuse, or TypeScript is selected with explicit reasons. The project continues even if extraction fails. No hardware emulator is introduced.

### P04: Accounts, characters, and durable command infrastructure

**Depends on:** P01. **Outcome:** Two real accounts own separate recoverable characters.

- [ ] P04-01 Integrate auth, browser session flow, account UI, and server-owned character selection.
- [ ] P04-02 Implement character registry, activity state, connection generation, leases/fencing, and serialized domain commands.
- [ ] P04-03 Implement core database tables, migrations, command receipts, revisions, business uniqueness keys, and commit-to-memory recovery.
- [ ] P04-04 Test duplicate commands, replacement logins, transaction rollback, unknown commit outcome, and database unavailability.

**Gate:** Accounts cannot access each other's character/private state. Restart preserves characters. Stale sockets cannot mutate state. Duplicate durable commands apply once.

### P05: Shared authoritative overworld

**Depends on:** P02, P04. **Outcome:** Two players share the imported areas.

- [ ] P05-01 Add zone rooms, public avatar projections, sequenced directional input, validation, and interpolation.
- [ ] P05-02 Implement movement checkpoints, safe map transfer, activity restrictions, and reconnection snapshots.
- [ ] P05-03 Separate private story overlays from shared presence; test nonblocking player movement.
- [ ] P05-04 Reject speed/teleport attempts, stale-zone input, malformed packets, and hidden-state access.

**Gate:** Two independent browser contexts see each other, cross zones, and reconnect. A transfer failure recovers to one destination. Wall crossing and double ownership fail tests.

### P06: Persistent PvE vertical slice, R1

**Depends on:** P03, P05. **Outcome:** A complete small gameplay loop survives interruptions.

Because normal starter/story progression is implemented in P07, R1 uses an explicit development-only seed profile: a legal source-defined team, capture items, a safe location, and named test progression flags. This profile is visible in the test UI/logs, available only in the local development environment, and separate from ordinary character creation. The NPC interaction may use a small named server handler before the general script interpreter exists. R1 evidence must state these limitations. R2 acceptance and tester builds use normal new-game progression and cannot enable the R1 shortcut.

- [ ] P06-01 Implement server-generated encounters, a basic battle presentation, legal commands, party state, and ordered events.
- [ ] P06-02 Implement attack/switch/item/run paths needed for the slice; use real source behavior for supported moves.
- [ ] P06-03 Implement capture, experience, fainting/loss, terminal outcome transactions, and pending nickname/storage decisions.
- [ ] P06-04 Implement one server-owned NPC interaction and save confirmation.
- [ ] P06-05 Run the R1 scenario and failure-injection checks before, during, and after durable outcomes.

**Gate R1:** Two development-seeded accounts share Pallet/Route 1, interact, battle, capture, reconnect, and survive backend restart with correct creature ownership and item counts. The slice uses generated source records for creatures, moves, items, encounter distributions, and experience behavior. Full storage and repeated capture/result messages cannot duplicate or delete assets. Unsupported mechanics and development shortcuts remain listed.

### P07: Opening campaign through Brock

**Depends on:** P06. **Outcome:** Normal early progression is playable without debug grants.

- [ ] P07-01 Implement script compiler/interpreter foundations, command/special registries, checkpoints, and private story NPCs.
- [ ] P07-02 Implement bedroom/start sequence, names, starter selection, rival battle, parcel delivery, Pokédex progression, and early route/trainer events.
- [ ] P07-03 Implement inventory menus, party management, PC storage, healing, shops, money, early move learning/evolution, blackout/respawn, and relevant field interactions.
- [ ] P07-04 Expand import scope through Viridian Forest and Pewter Gym, including all required interiors and side interactions.
- [ ] P07-05 Verify all starter/rival branches and players sharing a map at different story states.

**Gate:** A fresh character reaches and defeats Brock using normal play. Reloading during starter choice, a reward, or a cutscene cannot corrupt progression. Both rendering and script reachability are verified. Implement the complete mechanic dependency closure of all content allowed in R2, including level-up moves and evolutions reachable by grinding and trade. The fact that remaining full-game mechanics are scheduled for P09 does not permit unsupported behavior to remain reachable in R2. Any deliberate temporary content/level restriction must be explicit in the milestone profile and compatibility ledger; no silent cap is assumed.

### P08: Multiplayer interactions and private alpha, R2

**Depends on:** P07. **Outcome:** Invited testers can use a reliable small MMO.

- [ ] P08-01 Implement nearby trade negotiation, versioned confirmations, atomic exchange, capacity/eligibility checks, and trade evolution consequences.
- [ ] P08-02 Implement direct PvP challenge, consent, team-copy policy, private choices, deadlines, disconnect handling, and battle restoration.
- [ ] P08-03 Implement presence/local chat, mute/block/report, rate limits, and basic operator diagnostics.
- [ ] P08-04 Test cancel/confirm races, duplicate requests, two-tab abuse, stale leases, rollback, and crash-after-commit scenarios.
- [ ] P08-05 Package a reproducible local/private test build and run alpha load/soak scenarios.

**Gate R2:** R1's underlying features and the Brock campaign remain playable through normal accounts and progression; trade and PvP work between two real accounts; restart and retry cannot duplicate assets; operators can diagnose failures and restore a backup. PvP completion, forfeiture, no contest, and restart leave persistent HP/PP, held items, inventory, experience, and party ownership unchanged. R1 development shortcuts are excluded from tester builds. Inviting testers or deploying externally follows existing user authorization.

### P09: Complete mechanics and script support

**Depends on:** P08. **Outcome:** Required systems support the whole selected campaign.

- [ ] P09-01 Complete full-scope structured gameplay exports and required battle effects, trainer AI, battle formats, items/abilities, capture variants, and Gen III numeric semantics.
- [ ] P09-02 Complete move learning, evolution, Pokédex, Day Care/breeding where applicable, friendship, party/storage capacity, and relevant step counters.
- [ ] P09-03 Complete traversal, transport, fishing, Safari rules, puzzles, story barriers, map patches, and remaining used native specials.
- [ ] P09-04 Complete game menus, input/settings, fonts/text effects, map/battle animations, music/SFX, and audio lifecycle.
- [ ] P09-05 Map every required mechanic to source evidence, meaningful fixtures, affected content, and implementation status.

**Gate:** No unimplemented command/special/mechanic required by the declared R3 scope remains hidden. Required behavior is verified or explicitly documented as an agreed MMO adaptation. Deferred required mechanics keep R3 incomplete.

### P10: Full campaign and postgame content

**Depends on:** P09, with area imports allowed earlier. **Outcome:** All selected FireRed progression is reachable.

- [ ] P10-01 Expand in area batches: early Kanto to Cerulean/Vermilion, central routes and Celadon/Lavender, Fuchsia/Saffron, Cinnabar/Viridian, Victory Road/Indigo Plateau, then Sevii/postgame.
- [ ] P10-02 For every area, verify entrances/exits, required events, optional interiors, trainers, encounters, items, shops, healing, puzzles, story branches, and relevant return visits.
- [ ] P10-03 Cover Game Corner, Safari Zone, optional caves/legendaries, transport, and source-defined postgame facilities.
- [ ] P10-04 Produce graph/reachability reports and investigate unreachable required records, invalid warps, and unresolved scripts.
- [ ] P10-05 Complete a normal new-game-to-Champion run and the agreed postgame; exercise alternate starter/rival and failure paths with targeted scenarios.

**Gate:** Every in-scope record is accounted for as implemented/verified or an explicit scope exclusion. Main campaign and normal postgame complete without console cheats, debug teleports, or database edits. Import success alone is insufficient.

### P11: Hardening, recovery, and complete private game, R3

**Depends on:** P10. **Outcome:** A documented, repeatable, operable game.

- [ ] P11-01 Run fresh-clone setup on Windows, deployment build on Linux, and browser coverage. Resolve environment-specific failures.
- [ ] P11-02 Rehearse schema/content upgrades, backup restoration, server shutdown/restart, and recovery of battles/scripts/trades.
- [ ] P11-03 Run load and soak tests, measure limits, fix leaks/backpressure, and document supported capacity for the measured deployment.
- [ ] P11-04 Complete release checklist, runbook, operator procedures, known-issues list, and content/mechanics evidence.
- [ ] P11-05 Re-run critical end-to-end scenarios and review all deferred/blocked tasks against R3 scope.

**Gate R3:** Section 15 passes. Remaining future backlog is clearly separate. The private game may be complete without public deployment.

### P12: Optional original-content public release

**Depends on:** R3 or a separately agreed product scope. This phase is not automatic authorization to publish.

- [ ] P12-01 Define and implement the original-content profile with provenance for code, art, audio, names, text, maps, and data.
- [ ] P12-02 Make the public build fail if reference-profile content or disallowed provenance is included. Verify the actual built bundle.
- [ ] P12-03 Choose hosting, spending limits, domain, authentication recovery/email provider, moderation process, and release policies.
- [ ] P12-04 Prepare deployment and rollback, test it in the authorized environment, and publish only when authorized.

## 12. Coverage and regression strategy

### Coverage ledger fields

For content: stable ID, source location/revision, category, scope, imported status, interpreter/mechanics dependencies, playable status, verification evidence, blockers, and compatibility decision. For mechanics: name, original behavior, implementation module, fixture/scenario, tested boundaries, and known deviations.

Content states distinguish `discovered`, `parsed`, `exported`, `rendered`, `executable`, and `verified`. A total percentage must state its denominator and category. Do not combine map rendering and story completion into one misleading percentage.

### Required verification layers

| Layer | Evidence |
|---|---|
| Converter | Exact binary fixtures, bounds/reference checks, reproducible output hashes, coverage reports |
| Rules | Source-grounded deterministic outcomes, edge cases, fixed-width arithmetic checks |
| Scripts | Branches, native specials, checkpoints, one-time rewards, resume and invalid-choice behavior |
| Domain/database | Real PostgreSQL transactions, locking races, constraints, duplicate-command and unknown-commit recovery |
| Network | Authentication, projection privacy, stale sessions, invalid actions, bounds, reconnection |
| Browser | Keyboard/menu flows, two contexts, display scaling, audio gesture, focus, rendering screenshots |
| Complete play | Fresh character campaign and postgame evidence, alternate branches, loss/capacity paths |
| Operations | Fresh setup, built artifacts, migration, backup restore, restart, load/soak reports |

Tests should target concrete regressions and failure modes. Avoid large suites that merely restate function implementations. Once a focused change and its required gate are sufficiently verified, proceed. Mark checks that need unavailable Windows hardware or a real browser as not run and provide the exact follow-up command.

### Failure-injection scenarios

At minimum test: failure before DB commit; commit success before acknowledgement; unknown commit outcome; retry with same and changed payload; two simultaneous purchases; trade completion versus cancellation; capture with full storage; battle restart with hidden choices/RNG; evolution interruption; script reward interruption; map transfer failure after destination commit; stale session/lease; database outage; slow client; browser tab suspension; two players at different story checkpoints.

Do not compare two outputs both calculated by the same implementation and call that source fidelity. Keep expected values and provenance reviewable.

## 13. Performance and scalability plan

These are **initial acceptance workloads and engineering budgets**, not promised production capacity. Record hardware, operating system, build, content scope, network conditions, and database topology with every result.

| Scenario | Starting target |
|---|---|
| R1 browser | Near 60 FPS at the selected viewport on the developer's recorded desktop |
| R2 population | 50 simulated clients across zones, including 20 together and 10 concurrent PvE battles |
| R3 population | 100 simulated clients, including 50 in one zone and 20 concurrent battles |
| World tick | At 20 Hz, p95 processing below 25 ms and p99 below the 50 ms interval under the selected workload |
| Battle command | p95 server processing including persistence below 100 ms for ordinary turns; record outliers separately |
| Network tolerance | Playable, convergent behavior with 150 ms simulated round-trip delay and brief connection interruptions |
| Soak | At least 60 minutes with connection/battle churn and no unexplained retained-memory growth after cleanup |

Measure asset loading, browser memory, server event-loop delay, database query/transaction time, room bandwidth, and CPU separately. Use real Playwright sessions for a smaller rendering cohort and lightweight protocol clients for population tests. A bot that only connects is not a representative gameplay load.

First optimize payload projections, unnecessary updates, room cleanup, indexes, blocking work, and asset loading. Move expensive conversions entirely out of the server request path. Consider worker execution for battle computation only after profiling, while retaining serialized activity ownership.

Colyseus rooms reside on individual processes; distributing rooms can increase overall capacity but does not automatically accelerate one crowded room [S10]. Add Redis and multiple processes only after profiling and after cross-process ownership, routing, recovery, and transaction tests exist. Introduce channels/interest management when a single zone is the measured bottleneck. Record actual supported limits and admission behavior.

## 14. Deployment and maintenance design

Initial deployable shape: static client/assets, one persistent Node service supporting WebSockets, PostgreSQL, HTTPS termination, persistent logs/metrics, and scheduled backups. Build a Docker image for the backend with pinned runtime dependencies. The Vite dev server is not the production web server. Keep provider selection open until the user chooses an authorized environment and budget.

Use hashed client assets and versioned manifests. The initial release may use a brief maintenance window for incompatible updates: stop admission, checkpoint activities, back up, apply reviewed migrations, deploy a compatible rules/content build, verify readiness, and reopen. Do not hot-swap battle rules beneath active snapshots. Keep the previous compatible content available or finish/migrate affected activities through a tested procedure.

Migrations are versioned and reviewed. Production uses migrations, not schema-push/reset commands. Use backward-compatible expand/contract changes when practical. A code rollback is allowed only when the old build remains compatible with the current database; otherwise use the documented recovery procedure. Rehearse restore before relying on backups.

Initial private test target: daily backups with a seven-day retention baseline, pre-migration backups, and restore verification into a separate database. Proposed operating goals are at most 24 hours of loss from a total database disaster and recovery within four hours; these differ from the no-loss-of-acknowledged-writes goal for an ordinary app-process crash. Before a broader launch, use point-in-time recovery and revise these goals to match the chosen hosting service and budget.

## 15. Final definition of done

R3 is complete only when all of the following have evidence:

- [ ] A fresh Windows setup follows the documented commands and runs the built game.
- [ ] Exact source revision, dependencies, generated content, database migrations, and protocol/rules versions are recorded.
- [ ] The runtime uses no GBA emulator and does not require a ROM to play.
- [ ] Two independent accounts can play concurrently without shared story-state corruption.
- [ ] Main campaign and declared normal postgame complete through ordinary play.
- [ ] All required maps, scripts, native specials, mechanics, menus, audio, and presentation features are verified or explicitly covered by a documented scope adaptation.
- [ ] Captures, item use, rewards, evolution, storage, trade, and progression are transactionally correct under retries and interruptions.
- [ ] Battles and scripts recover from process restart using persisted state and compatible content.
- [ ] Private data is absent from unauthorized projections; malformed and stale commands are rejected.
- [ ] Direct PvP, trading, presence/chat, and their disconnect/timeout policies pass tests.
- [ ] The declared browser and performance workloads pass on recorded hardware, or revised targets are explicitly accepted and documented.
- [ ] Backups restore successfully; migrations and shutdown/restart procedures are rehearsed.
- [ ] STATUS, TASKS, coverage files, runbook, release checklist, and known issues match the actual implementation.
- [ ] No required feature is hidden behind a placeholder, unimplemented branch, or silently ignored content entry.

Public release is a separate target. Do not call R3 incomplete merely because the user elects to keep it private; do not call R3 complete merely because the first map works.

## 16. Main risks and decision triggers

| Risk | Early evidence | Response |
|---|---|---|
| C engine extraction expands indefinitely | Hardware/global dependencies remain after bounded spike | Choose TypeScript behind the same battle interface |
| Imported maps look right but play incorrectly | Collision/elevation/layer or script tests fail | Preserve semantic data; inspect source behavior; add focused fixtures |
| Script coverage explodes late | Unimplemented specials in a required area | Inventory dependencies early; block that area's completion visibly |
| Duplicate or lost assets | Retry/crash/race tests expose divergence | Fix transaction, ownership, and receipt design before more economy features |
| Shared story state | One player's event changes another's progression | Classify state and use private overlays/instances |
| AI coding drift | Different stack, duplicate modules, untracked decisions | Reconcile code to plan; use decision records and package boundaries |
| False progress | Maps parsed counted as campaign complete | Separate structural, executable, and playable coverage |
| Windows friction | Scripts require Bash or shims fail | Portable task scripts, `.cmd` invocation, documented prerequisite checks |
| Growing scope | New regions/markets/raids appear before R3 | Move additions to future backlog unless user redirects priorities |
| Original/public content mixing | Reference material enters a public build | Separate content profiles and enforce provenance checks |

## 17. Bootstrap and continuation prompts

### First Codex session

Save this file in the intended new game folder. Start Codex from that folder and provide:

```text
Read POKEMON_MMO_PROJECT_PLAN.md and use it as the project specification.
Implement this browser MMO using the existing pret/pokefirered reference source.
I am working through Windows PowerShell.

First inspect the current folder, existing instructions, installed tools, and any
available reference checkout. Preserve existing work. Put the canonical plan at
docs/PROJECT_PLAN.md and create/merge AGENTS.md and the continuity files described
in the plan. Begin P00, then proceed with the highest-priority unblocked tasks.

Use the declared architecture. Keep the reference checkout read-only. Do not
silently reduce scope, substitute an emulator, or count stubs as complete.
Make routine implementation choices and record them. Ask only for genuinely
blocking information or actions that exceed my authorization.

Before ending each session, update STATUS.md and TASKS.md with actual changes,
verification results, blockers, and the exact next action. Do not stop at a plan
when implementation work can proceed.
```

When the source checkout path is known, append `The reference checkout is at <actual path>.` If it is absent and network access permits, Codex can obtain the public reference into the ignored reference location, record its SHA, and continue. Never guess which of multiple modified local checkouts the user intended.

### Future sessions

```text
Read AGENTS.md, docs/STATUS.md, docs/TASKS.md, and the relevant phase in
docs/PROJECT_PLAN.md. Check the actual worktree and last verification evidence.
Continue the highest-priority unblocked task. Keep the plan's scope and
architecture, verify the result, and update the continuity files before stopping.
```

### Milestone review

```text
Audit the current milestone against its acceptance gate. Inspect implementation,
tests, content coverage, and actual runtime behavior. Identify any placeholders,
untested claims, missing source semantics, persistence risks, or scope drift.
Fix concrete issues within the current scope and update the progress records.
Do not mark the milestone verified until its gate has evidence.
```

## 18. Primary references

These references were consulted during planning. Links to upstream `master` explain observations, not a pinned implementation baseline. P00 must replace source evidence with commit-specific links in the project's own ledgers. Most architecture, scope, timing, and workload requirements above are design decisions, not guarantees supplied by a framework.

| ID | Reference | Use |
|---|---|---|
| S01 | https://developers.openai.com/codex/guides/agents-md | Repository instructions and discovery |
| S02 | https://developers.openai.com/codex/windows/windows-sandbox | Native Windows execution context |
| S03 | https://github.com/pret/pokefirered/blob/master/include/global.fieldmap.h | Map block fields and layer semantics |
| S04 | https://github.com/pret/pokefirered/blob/master/src/fieldmap.c | FireRed map attribute decoding |
| S05 | https://github.com/pret/pokefirered/blob/master/data/layouts/layouts.json and https://github.com/pret/pokefirered/blob/master/data/maps/PalletTown/map.json | Layouts, tilesets, events, and connections |
| S06 | https://github.com/pret/pokefirered/blob/master/data/script_cmd_table.inc and https://github.com/pret/pokefirered/blob/master/data/specials.inc | Script commands and native specials |
| S07 | https://github.com/pret/pokefirered/blob/master/src/battle_main.c | Original battle state and integration |
| S08 | https://github.com/pret/pokefirered/blob/master/data/battle_scripts_1.s | Battle sequencing and presentation coupling |
| S09 | https://docs.colyseus.io/getting-started | Framework setup and version-sensitive APIs |
| S10 | https://docs.colyseus.io/scalability | Room/process scaling boundaries |
| S11 | https://nodejs.org/en/about/previous-releases | Node release support |
| S12 | https://better-auth.com/docs/installation | Authentication integration and adapters |
| S13 | https://docs.npmjs.com/cli/v11/using-npm/workspaces/ | Workspace structure |
| S14 | https://orm.drizzle.team/docs/get-started/postgresql-new | PostgreSQL integration |
| S15 | https://playwright.dev/docs/intro and https://vitest.dev/guide/ | Test tooling |
| S16 | https://docs.phaser.io/ and https://vite.dev/guide/build | Browser rendering/build foundation |
| S17 | https://emscripten.org/docs/porting/guidelines/portability_guidelines.html | C portability constraints |
| S18 | https://www.postgresql.org/docs/17/tutorial-transactions.html | Transaction fundamentals |
| S19 | https://docs.docker.com/compose/install/ | Local Compose setup |
| S20 | https://github.com/pret/pokefirered/blob/master/data/maps/PalletTown/scripts.inc | Story and map hook examples |
