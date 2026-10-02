# Architecture decisions

These concise records preserve decisions and compatibility boundaries. Current state
belongs in [STATUS](STATUS.md), ordered acceptance in [TASKS](TASKS.md), operational
commands in [RUNBOOK](RUNBOOK.md), and detailed source contracts in each profile
README. Machine reports retain exact coverage, counters, hashes and failed-run
evidence; this file does not repeat those results. Historical private-only decisions
remain valid for their retained profiles; later ADRs explicitly add playable bridges.

## ADR-001 - Battle implementation

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Select extracted source C commands compiled to private WASM, with an audited TypeScript scheduler behind one six-method server battle adapter. Do not build a parallel TypeScript numerical engine. The bounded P03 experiment established isolation, logical snapshots/replay and adapter feasibility; it did not establish complete gameplay. Source arithmetic, draw ordering and command effects need independent literal expectations, not self-generated expected values.

Each profile declares its admitted environment and fails unsupported required state explicitly. Fixed-memory, no-import modules expose logical checkpoints rather than native addresses/struct layouts. Compatibility binds source/module/host/rules/content/checkpoint versions; restoration validates fresh candidate memory before publishing. Checkpoints are trusted server state, not authenticated client saves or proof of arbitrary historical reachability. Private diagnostics authorize no durable domain effects. [Battle contract](../tools/battle-spike/README.md).

## ADR-002 — Source baseline without Git

Date: 2026-09-25. Status: Accepted project policy.

The user deferred Git setup and mutations. Preserve the supplied reference directory read-only; pin exact bytes in `source-lock.json`, a per-file SHA256 inventory and a deterministic private source snapshot. Record upstream revision and cleanliness as unknown rather than inventing a commit identity. Do not repin changed source silently.

The 2026-10-02 amendment permits read-only Git observation of this project, including its existing history. It does not authorize initialization, staging, commits, pushes or other Git mutations. Source reproducibility and verification must work without Git. Completed-chunk handoffs include a suggested commit message only.

## ADR-003 — Selected private content profile

Date: 2026-09-25. Status: Accepted project policy.

Use the supplied English FireRed revision-0 private profile. Inventory LeafGreen/revision variants without silently mixing their data. Preserve normal campaign/postgame scope and event gates; replacing local link features with online systems does not authorize removing unrelated content. Wireless lobby/minigames/distribution and external connectivity follow the explicit scope ledger.

Reference code/content is for the local private build. Public distribution, paid hosting and an original-content replacement profile require separate authorization. [Scope ledger](../reports/source-scope.json).

## ADR-004 — First-pass implementation boundary

Date: 2026-09-25. Status: Accepted project policy.

The initial pass established the pinned source, workspace, local database, executable contracts and a visibly bounded renderer preview. It did not claim story progression, multiplayer or battles. Later decisions extend that scope without retroactively treating placeholder presentation as implemented gameplay or changing phase acceptance criteria. The full requested game remains R3; a smaller R1 slice is an intermediate milestone.

## ADR-005 — Portable local PostgreSQL and Node

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Use hash-checked portable Node and native PostgreSQL on Windows, avoiding a Docker/service requirement. PostgreSQL binds loopback, defaults to port 5433 and preserves existing data/configuration. `LOCAL_DB_PORT` is an initial-setup override persisted in local settings; changing it later does not reconfigure a running cluster. Exact versions, download provenance and remaining platform validation belong in [ENVIRONMENT](ENVIRONMENT.md).

Supervised app shutdown owns only its children and leaves the database running unless explicitly stopped. Secrets remain outside reports/public content. Historical custom-port initialization was not verified merely by validating the option.

## ADR-006 - Connected three-map renderer preview

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

The bounded preview connects Pallet Town, Player's House 1F and Route 1 using source warp-array indices, anchors, connections, borders, collision/elevation rules and available destination checks. Preload its map dependency closure and fail unsupported transfers visibly. Traversal is a pure module usable by the preview; anonymous coordinates are not authoritative gameplay.

Walking uses sixteen source frames per tile, running eight where allowed, and ledges the thirty-two-frame two-tile source jump. Door animation uses the bounded source images/timing; general transitions, terrain effects and other elevation priorities remain incomplete. Warps activate through the admitted source tile behavior, not a guessed automatic door rule. [Importer contract](../tools/content-import/README.md).

## ADR-007 - Stationary NPCs, bounded dialogue and running controls

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Walk by default and hold Shift to request Running Shoes outdoors, as the user requested. Indoor source restrictions still apply; this development capability does not simulate the missing story unlock. Focus loss/dialogue/door transfer clears held controls, while held movement can continue across an admitted map connection.

Use source initial NPC flags/poses, with Oak hidden and the sign lady at the source on-entry location(5,15), facing north. Wanderers remain stationary and blocking. Only six audited pure-message NPC/sign scripts execute in preview; rewards, healing, conditions and mutations explicitly report unavailable. Preview RED/BLUE substitutions do not become saved trainer/rival identity.

## ADR-008 - Source dialogue font and bounded audio prototypes

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Render source normal Latin glyphs and advances on an integer canvas while preserving accessible Unicode text. Instant neutral-color dialogue and a custom message frame are explicit presentation departures; native scrolling, gender styles and general text controls remain pending.

A bounded MPlay conversion drives Pallet music and SELECT SFX through Web Audio. Source notes, controls, sample tuning/loops and voices are retained, but envelopes/resampling/panning/PSG approximate hardware; reverb and channel stealing are absent. Audio requires a gesture, defaults off, pauses on blur/hidden tabs and restarts on return. Route 1 music and persisted settings remain absent; no original-ROM/hardware-audio equivalence is claimed.

## ADR-009 - Bounded gameplay definitions and a read-only Field guide

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Parse a bounded audited C data subset rather than execute the reference or guess numeric values with loose regexes. Preserve IDs, ordering and Gen III numeric semantics. Export the required starter/Pidgey/Rattata definitions, complete admitted learnsets/evolutions, types, items, abilities, growth and Route 1 encounter records; definitions alone do not implement their mechanics.

Keep operational JSON private and generate an independent browser whitelist for the read-only Field guide. Effect/function bindings, raw encounter slots/rate and operational type relationships remain private. Route 1's source rate 21 is not a per-step percentage; displayed family shares describe composition. Unsupported syntax/references fail explicitly. [Content contract](../tools/content-import/README.md).

## ADR-010 - Local accounts and staged trainer persistence

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Better Auth with reviewed Drizzle/PostgreSQL schema supplies local cookie sessions. Names are one to seven ASCII letters stored uppercase and need not be globally unique. Ordinary signup creates an empty awaiting-new-game/recovering trainer with no world position. Email delivery/reset, public hosting and gameplay grants are outside this foundation. Only allowlisted auth endpoints, exact configured loopback Origins and normal HttpOnly/SameSite cookies are exposed.

CharacterService is the sole activity owner: per-character serialization, transactional session validation, character/lease locking, persistent connection generations and fifteen-second leases fence replacement. One-use cookie-bound admission tickets are bounded and short-lived. Command UUID/payload hashes, strict expected revision, receipt lookup before mutation, and unknown-COMMIT reconciliation prevent duplicate effects. Publish only committed state; failed publication freezes/reloads rather than invents success. Client/public room projections omit sessions, leases, hidden content and RNG. [Database contract](../packages/database/README.md).

## ADR-011 - Owned asset foundation and explicit local fixture

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Migration 0004 adds relational owned creatures/party/storage, move/PP/stat constraints, bag/wallet, source-version references, story storage contracts, permanent outcome keys and audit records. These storage foundations do not execute scripts or battle outcomes.

The explicit offline `r1-squirtle-v1` fixture grants one legal level-5 Squirtle (IV 15 / EV 0 and source initial stats/moves), five Potions, five Poke Balls,3,000 money, a safe Pallet (10,12) anchor and development-only markers. Ordinary signup stays empty. The operator CLI requires an existing untouched trainer, supported loopback development context and no active lease; it never creates accounts or resets progress. A permanent business outcome prevents repeat grants even with a new UUID or deleted receipt. Unknown COMMIT is reconciled under the same locks. [Fixture contract](../packages/database/README.md#relational-asset-foundation-and-explicit-development-fixture).

## ADR-012 - Bounded shared exploration over one character owner

Date: 2026-09-25. Status: Accepted and implemented within the stated bounded scope.

Admit only the explicit development fixture to the three-map `r1-exploration-v1` mode. This bypasses the unimplemented opening story and the pinned Pallet story-coordinate barriers under a named development policy; it sets no real story flags. Static initial NPC visibility/collision is not a general per-character story interpreter.

Keep one authenticated character transport/owner and logical map groups within one backend process. Nearby players are nonblocking public projections; private assets, story, sessions and leases never enter presence. Separate routable zone rooms/population scaling remain future work. The server admits sequenced directional intent with connection/zone generations, validates source traversal and owns timing/location. Entry/exit/Save/transfer are fenced and durable; periodic checkpoints may leave recent walking unsaved on abrupt loss. Normal movement has no command receipt; checkpoint IDs reconcile uncertain commit before publication. ADR-013 adds transport grace and ADR-029 adds opt-in encounters.

## ADR-013 - Authenticated transport reconnection grace

Date: 2026-09-26. Status: Accepted and implemented within the stated bounded scope.

Use Colyseus's documented manual reconnection lifecycle with one absolute sixty-second room timer. Numeric-duration reservation left a referenced timeout during active-grace shutdown in the installed version. A server registry binds each reconnect token to the original authenticated account session, room and transport session. Both WebSocket upgrade and manual reconnect HTTP lookup validate the cookie before consuming the token. Tokens stay in memory, not browser storage/logs.

A drop immediately hides/freezes the trainer; only already accepted movement may settle. The same valid session/lease can resume, advancing connection generation and resetting input sequence without a second owner. Failed attempts never extend the deadline. Replacement, revocation, explicit Leave, shutdown or terminal errors end grace; process death requires fresh admission to durable state. Offline input is never queued. Uncertain Save retains its exact UUID/payload for explicit retry. Profile-only resume cannot infer world entry from a saved activity label. [Network evidence](../reports/reconnect-network.json).

## ADR-014 — Private Route 1 encounter factory before live battle admission

Status: Accepted and implemented within the stated bounded scope.

The separate source-C/WASM encounter factory implements field eligibility and initial creature creation, not a second battle engine. Its admitted context is FireRed Route 1 land/on-foot, Squirtle/Torrent lead, no held lead item, Repel, flute, bike/surf or roamer. Walking/running retain source rules. Plain steps update previous behavior without advancing encounter cooldown/RNG; map transfer resets source cooldown/rate state without reseeding.

Keep distinct counted general and encounter-rate LCG streams, cooldown/rate state, trainer identity and generated identity/stat/move fields in compatible logical checkpoints. Restore/retry never reseeds. The source `Random32` macro's unspecified C operand order is explicitly low-half-first with unsigned high shift; original GBA compiler/ROM equivalence is unverified. Nature rejection, packed IV draws and even NONE held-item draws remain counted. Direct generation is a private diagnostic, never player-controlled. ADR-029 supplies the bounded live testing admission. [Encounter contract](../tools/encounter-core/README.md).

## ADR-015 - Private real-team Route 1 battle profile

Date: 2026-09-28 (UTC). Status: Accepted and implemented within the stated bounded scope.

Retain the synthetic artifact and introduce `firered-route1-singles-v1` through the same source-command architecture. Admit the pinned level-5 Squirtle and generated Route 1 Pidgey/Rattata with source Tackle, Tail Whip, Sand-Attack, exhausted-PP Struggle and Run. Ability identities are real, but initial healthy-matchup dormant branches do not establish broader ability/move support.

Start mechanical battle RNG at the factory's post-held-item state, then preserve introduction ordering and wild slot rejection draws. Select/store the wild action once before player choice; restore does not reroll it. The deterministic headless scheduler omits presentation/VBlank RNG and does not claim original-ROM seed/timing equivalence. Struggle preserves stage-sensitive accuracy, actual-damage recoil and faint order. Logical checkpoints bind immutable encounter/player admission, counted RNG, pending action and compatible source/host state. Candidate execution publishes only after validation and traps exhausted counters. Player projection hides exact enemy state/RNG. [Route 1 contract](../tools/battle-route1/README.md).

## ADR-016 - Private Potion and capture-result continuations

Date: 2026-09-28 (UTC). Status: Accepted and implemented within the stated bounded scope.

The retained Route 1 item profile combines successful living-Potion selection and its action atomically; source arithmetic heals at most 20 HP and spends one private inventory unit, retaining stages/PP. Item actions precede the already-selected wild move without a speed-tie reroll. They never spend the real bag.

Poke Ball mechanics retain source catch arithmetic and strict sequential shake checks. Deterministic floor-integer square root replaces the BIOS primitive as an explicit portability adaptation. A successful throw settles private combat as captured without a subsequent enemy action/draw, but produces only pending disposition. The original script's dex/nickname/GiveMonToPlayer work remains a deferred continuation; the descriptor alone grants no ownership. Capacity, metadata and normal transactions need their own admission. Current HP/PP, spent inventory and immutable encounter identity survive recovery. [Item/capture boundary](../tools/battle-route1/README.md#potion-and-poke-ball-boundary).

## ADR-017 - Private source victory progression and move decisions

Date: 2026-09-28 (UTC). Status: Accepted and implemented within the stated bounded scope.

A separate source progression continuation restores a compatible terminal Route 1 item battle. The strict `single-untraded-no-modifiers-v1` bridge admits its sole canonical living Squirtle; it does not infer full trainer-name provenance or support Exp Share/traded/held-item modifiers. Natural first-battle XP does not reach level 6. Diagnostic XP/context inputs exercise otherwise unreachable levels/learn decisions without authorizing ownership or live battle readmission.

Source EV-before-XP order, fainted/level 100 skips, controller >= thresholds, cached-stat behavior, HP delta and exact-level move learning remain. Rewards are deferred from the sole final faint to terminal continuation only because no later combat action exists. Required ball/met friendship context is never guessed. Move decisions bind the pending state; restore replays accepted decisions and compares logical words. Evolution is a pending handoff, other outcomes preserve their applicable continuation. No mechanical RNG is added; original final combat RNG remains. [Progression contract](../tools/battle-progression/README.md).

## ADR-018 - Private source faint and blackout continuation

Date: 2026-09-28 (UTC). Status: Accepted and implemented within the stated bounded scope.

A separate loss continuation accepts only compatible lost/draw terminals and retains terminal identity, depleted HP/PP and inventory. Explicit `r1-pallet-mom-blackout-v1` context supplies canonical last-heal, badges and current money; it never assumes an account already owns that context. Invalid/noncanonical heal records and unsupported Trainer Tower overrides fail before unsafe indexing.

The sole-participant bridge applies its previously deferred source faint friendship once, then source whiteout: bounded Elite Four reset operations, capped money debit, healing, field reset and north-facing/on-foot respawn. Scalar money uses a zero encryption-key projection, not encrypted save emulation. Broader heal records/friendship/badges are diagnostics only. No normal wallet, party, map or story mutation occurs. A later party bridge must not apply friendship already handled during combat. [Loss contract](../tools/battle-loss/README.md).

## ADR-019 - Private source capture metadata, nickname and placement

Date: 2026-09-29 (UTC). Status: Accepted and implemented within the stated bounded scope.

A compatible captured terminal, not a loose descriptor, admits this source continuation. Explicit trainer/dex/storage context supplies name/gender/identity; ball, language, version and Route 1 met data come from the selected source/profile. Four recoverable stages perform dex registration, optional source-encoded nickname, GiveMonToPlayer placement and pending ownership application. No creature is durably allocated and no ball is spent twice.

Source party placement chooses the first empty slot and preserves HP/status/PP. Full-party PC placement starts at the current box, wraps all 14 boxes and resets PP before copying BoxPokemon. Box descriptors exclude party HP/status/stats/level; withdrawal needs separate source materialization. A fully occupied party/storage context must reject before throwing/spending, not invent postcatch replacement. Future transactions must preserve a paid capture across placement conflict. Results retain proposals/provenance; noncaptured encounters still need source seen bookkeeping. [Capture contract](../tools/battle-capture/README.md).

## ADR-020 - Private source level evolution and move continuation

Date: 2026-09-29 (UTC). Status: Accepted and implemented within the stated bounded scope.

Restore an intact pending progression evolution with explicit nickname/language/dex/stat/cancel context. Current bridges have diagnostic provenance; do not infer owned evolution or reachable higher-level combat. Query source level conditions/Everstone policy rather than accepting a caller target. One scene performs at most one evolution even at level 100.

Accepted evolution writes source species/stats, conditional species-name rename, dex/stat effects and current-level move learning. Ability slot/personality persist; HP delta preserves damage and fainting. Custom names remain; source English encoding is bounded. Cancel still performs the source's first old-species current-level learn attempt before the stopped check, without species/dex writes or an invented later prompt. Restore replays decisions against logical state. The result remains pending ownership application; no durable or live effect is implied. [Evolution contract](../tools/battle-evolution/README.md).

## ADR-021 - Private family combat and proof-bound diagnostic results

Date: 2026-09-29 (UTC). Status: Accepted and implemented within the stated bounded scope.

`firered-family-singles-v1` admits eight Squirtle/Pidgey/Rattata-family species at source-valid levels with sixteen moves plus exhausted-PP Struggle, four active abilities and bounded healthy/poison/burn state. Validate every roster move, including zero-PP slots, against source legality; do not strip moves or impose an artificial gameplay level cap. Items/badges and later move families remain explicit exclusions in this retained profile.

Numerical rules stay source C; host scheduling preserves flinch, Focus Energy, priority, residuals and RNG order. Result-to-diagnostic admission restores a compatible settled progression/capture/evolution proof, retains earned/depleted state and pending ownership, and rejects boxed creatures lacking party materialization. Fresh encounter proof supplies matching trainer identity/RNG. All resulting combat remains diagnostic (`liveAdmission:false`); integrity/provenance does not create account ownership. [Family contract](../tools/battle-family/README.md).

## ADR-022 - Private source party switching and faint decisions

Date: 2026-09-30 (UTC). Status: Accepted and implemented within the stated bounded scope.

`firered-family-party-v1` extends the retained closure to one-to-six player members against one wild opponent, selecting the first living member. Whole-roster legality includes fainted/benched/exhausted slots. Source switch commands retain each member's HP/PP/status/friendship and clear outgoing volatile/history state; stable API indices replace only presentation ordering.

Voluntary switches precede the saved wild move. A living reserve after faint enables source use-next/run/replacement decisions; a failed escape cannot reroll at the same prompt. Replacement resumes residuals or the next turn at the exact boundary, retaining selected-slot residual priority. Immediate source faint friendship applies once per player member; participation/switch counters prepare later results but do not award XP. Future loss application must not repeat that friendship. Candidate/checkpoint recovery retains active roster and decision phase. [Party contract](../tools/battle-party/README.md).

## ADR-023 - Private fixed damage, rain and wild forced escape

Date: 2026-10-01 (UTC). Status: Accepted and implemented within the stated bounded scope.

`firered-family-tactics-v1` adds Super Fang, Endeavor, Rapid Spin, Rain Dance and Whirlwind to the same party architecture. Retain each source script's PP/accuracy/damage/type/secondary ordering. Rapid Spin's reachable cleanup is empty because wrapping, Leech Seed and Spikes remain outside admission; compiling a cleanup command does not implement those mechanics.

Rain starts only via an admitted move, keeps the source five-turn timer including the casting turn, and a failed repeat cannot refresh it. Field ordering/ weather precedes battler residuals; replacement recovery must never tick twice. Ordinary-wild Whirlwind keeps source priority, accuracy and lower-level success, exposing outcome 5 as forced escape without Run attempts or victory/capture rewards. Trainer forced switching and broader weather/abilities remain excluded. [Tactics contract](../tools/battle-tactics/README.md).

## ADR-024 - Private two-turn charging and forced continuation

Date: 2026-10-01 (UTC). Status: Accepted and implemented within the stated bounded scope.

`firered-family-charge-v1` adds source Skull Bash: its first turn spends PP once, raises Defense and locks the next action; the forced release spends no second PP. Source cancellation, miss, Protect interaction in later profiles, fainting and switch cleanup must retain the correct lock semantics. Active charging and an inert leftover lock are distinct states.

Version 7 logical checkpoints retain locked move, charge flags, originating slot and target. A mandatory sequence-fenced continue-charge choice cannot become Run/switch or another move. Wild selection skips its ordinary AI draw while charged, while turn-selection RNG remains. Borrowed charging added by Mirror preserves this same contract with explicit provenance. No postbattle ownership is granted. [Charge contract](../tools/battle-charge/README.md).

## ADR-025 - Private Protect with explicit compiled-ROM repeat-rate compatibility

Date: 2026-10-02 (UTC). Status: Accepted and implemented within the stated bounded scope.

`firered-family-protect-v1` uses explicit `firered-protect-rom-v1` compatibility for repeated Protect. The reference indexes beyond its declared array; portable undefined C access or an invented clamp would be dishonest. Pin the full 256-entry halfword lookup from ROM offset 0x2507e0, including counter 4 value 118, byte wrapping and source inclusive comparison/RNG-before-last-action ordering. Runtime embeds the bounded lookup; no ROM file is served or required.

This is compiled-ROM table evidence, not a verified build/run of the original game (`romBuildVerified=false`) or proof every counter is reachable. Independent policy-domain fixtures, source reset/history rules and candidate rollback remain required. A protected Skull Bash release cancels its active lock without extra PP. Compatible checkpoints bind policy/source/module/host identity. [Protect contract](../tools/battle-protect/README.md).

## ADR-026 - Private Pursuit and atomic source switch interception

Date: 2026-10-02 (UTC). Status: Accepted and implemented within the stated bounded scope.

`firered-family-pursuit-v1` retains ordinary Pursuit as source power 40 Dark/Gen III-special damage. Its separate switch-interception script doubles the final base damage, targets the outgoing player and does not substitute power 80 or an ordinary attack sequence. It spends one PP and consumes that selected wild action, preserving its own absent attack-cancel/accuracy/secondary stages.

Execute interception and the requested switch atomically: outgoing KO cleanup still loads the originally selected reserve, without a second prompt or attack. Do not export/restore a midpoint between interception and switching. Source result/history and party state must survive complete-boundary checkpoints. All earlier artifact/host compatibility remains separate. [Pursuit contract](../tools/battle-pursuit/README.md).

## ADR-027 - Playable practice battles before remaining mechanics

Date: 2026-10-02 (UTC). Status: Accepted and implemented within the stated bounded scope.

The user reprioritized playable in-game battle testing before further private-only mechanics. Every newly supported move/Pokemon mechanic must be selectable and immediately playable in this loop in the same chunk, then work resumes the original plan. This changes ordering, not normal R1 ownership/reward acceptance.

Temporary teams/presets use validated source species, legal levels/moves/abilities and explicit HP/PP/status settings. Source sprites, legal choices and sanitized narrative reach the client; raw events, hidden wild choices, checkpoints, provenance and RNG do not. Separate PostgreSQL practice state/receipts, monotonic practice revision, sole CharacterService queue and session/lease fences commit start/turn/close before acknowledgement. Exact duplicate UUID/payload returns current state without replay. Refresh/disconnect keeps the battle. Incompatible ordinary practice may close, but cannot hot-swap its engine. Practice blocks world activity and never mutates owned party/bag/money/story. ADR-029 defines the stricter wild return binding.

## ADR-028 - One-click local testing accounts

Date: 2026-10-02 (UTC). Status: Accepted and implemented within the stated bounded scope.

The user requested ready-made local accounts without repetitive login. Expose Play as ADMINA/ADMINB only for the fixed existing matching development fixtures and normal permissions. Use the installed auth plugin/cookie APIs; expose no passwords/session tokens and create/seed no fixture. Require loopback transport/Host, allowed Origin and development/test mode; production rejects.

Reuse an existing same-account session, otherwise revoke only the current browser session/reconnect binding before switching. Persist only the selected public account key so a valid session reconnects on reload. Explicit signout clears that preference and never signs back in automatically. World switching acknowledges Leave/save first. Ordinary auth, ownership and replacement leases remain authoritative. [Testing-access evidence](../reports/local-testing-verification.json).

## ADR-029 - Basic Route 1 wild encounters as an explicit testing slice

Date: 2026-10-02 (UTC). Status: Accepted and implemented within the stated bounded scope.

Offer an explicit default-off Route 1 wild-testing toggle with its own durable revision/UUID receipts and source encounter stream. Completed enabled steps atomically commit the finished tile, field RNG/counters and optional saved battle before publication. Use generated Pidgey/Rattata and a temporary level-5 Squirtle; owned progression remains separate. Map transfer applies source immunity reset without reseeding.

A saved origin binds the exact return tile/direction and pending encounter proof. Battle admission hides public presence, blocks movement and preserves refresh/reconnect. Fight/Run/End returns the counted battle RNG into the field once, then restores that tile. Incompatible/corrupt wild metadata fails NOT_READY; it cannot silently close, reset or substitute RNG. Session/character/lease/wild/practice lock order and receipt lookup govern recovery. Movement interpolation uses the actual receipt clock; late held packets are ignored only after current authority/generation and wild-origin validation, preventing a battle-start disconnect without accepting stale control. [Wild evidence](../reports/wild-test-verification.json).

## ADR-030 - Source Mirror Move with playable practice and retained saved-engine bindings

Date: 2026-10-02T15:15:28.795271+00:00. Status: Accepted and implemented within the stated bounded scope.

`firered-family-mirror-v1` adds Mirror Move with a separate version 10/512-word checkpoint and source-history/copy dispatch. The chosen move remains Mirror for priority/PP; the copied effect retains source target-selection RNG. Copy only eligible source last-taken history, including Struggle; Mirror/Protect cannot be copied. A borrowed Skull Bash retains the Mirror slot, then releases 130 without extra PP and records actual release history. Do not invent copied move ownership or chain history. [Mirror contract](../tools/battle-mirror/README.md).

New manual practice uses Mirror; existing Pursuit practice and all Route 1 wild tests keep the exact prior engine binding. Restore selects by rules version then validates the full fingerprint, never reinterprets a save. The public copy event names selected/copied attacks without exposing hidden state. The preset's lower-level Blastoise makes copied Bubble visible in the HP-percentage projection.

Related regression repairs preserve existing authority: defer at most one parsed movement only behind automatic heartbeat, revalidate when drained and fence stale async generations. Save receipt lookup stays before definitive rejection. Only a matching definitive stale response with a newer same-character/activity/generation snapshot permits one fresh UUID within the original deadline; unknown/BUSY retains the old UUID. An admitted battle can definitively reject uncommitted Save and release its UI blocker; a committed Save still replays its receipt. [Combined verification](../reports/thirtieth-verification.json).
