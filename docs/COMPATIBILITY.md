# Compatibility and intentional departures

This ledger records bounded source adaptations, historical profile limits and
remaining work. Later entries extend earlier milestones; a retained private profile
is not silently upgraded. [STATUS](STATUS.md) describes current playability and
[DECISIONS](DECISIONS.md) the architectural rationale. Detailed mechanics/recovery
contracts and evidence remain in profile READMEs and reports; no test counts are
maintained here. No scope or acceptance status changed during this condensation.

| ID | Decision | Consequence / boundary |
|---|---|---|
| COMP-001 | Source pin without Git | Reference bytes use a reproducible snapshot/hash; upstream revision and cleanliness remain unknown. Read-only project Git observation is now allowed, mutations are not. ADR-002. |
| COMP-002 | Browser implementation without GBA emulation | Source content is explicitly converted; there is no GBA CPU/graphics/ROM emulator. Numerical source reuse is not whole-game timing equivalence. |
| COMP-003 | Nonblocking players and private story state | Shared nonblocking avatars are implemented in the three-map development slice; general per-character story overlays remain planned. ADR-012. |
| COMP-004 | Online substitutes for link features | Authenticated trade/direct PvP remain planned. Wireless lobby, minigames, distribution and external connectivity follow the explicit scope ledger. |
| COMP-005 | Independent anonymous preview | Pallet, Player's House 1F and Route 1 connect in an unsaved local renderer. Authenticated shared exploration is a separate server-owned mode; preview movement does not save a trainer. ADR-006/012. |
| COMP-006 | Bounded traversal | Normal terrain, grass, cardinal ledges, admitted warp anchors/arrows/stairs/connections and elevation 0/15 exceptions are supported. Water, other special terrain, story collision and field capabilities remain pending. |
| COMP-007 | Bounded layer priority | Player/NPC rendering uses the preview elevation 3 priority: after middle and before top, then ground-y order. Other elevation/subsprite priorities remain pending. |
| COMP-008 | Partial tile animation | Flowers animate from source. Water/current/shoreline callbacks remain inventoried but use base imagery. |
| COMP-009 | Separate anonymous and authenticated admission | Anonymous handshake checks renderer connectivity only. Cookie-bound one-use tickets admit the separate character owner; tester deployment mode remains unavailable. |
| COMP-010 | Portable loopback PostgreSQL | Default 5433; initial LOCAL_DB_PORT override persists. Existing settings are preserved; no remote listener is authorized. ADR-005. |
| COMP-011 | Explicit destination boundary | Upstairs, rival house, Oak's lab, Route 21 and Viridian remain unavailable; source IDs are retained and transfers stop visibly. |
| COMP-012 | Bounded door/ledge presentation | Doors use four five-tick stages with three image frames and closed hold. Ledges use the source 32-frame two-tile jump/height table. General fades/audio/ground effects are incomplete. |
| COMP-013 | Development access instead of story progression | Preview grass/story coordinates do not execute opening scripts or Oak barriers. Shared mode uses a named development bypass; opt-in wild tests are isolated from normal rewards. ADR-012/029. |
| COMP-014 | Held-input handling | Door transfers require release before further movement; connected boundaries can continue held input. Preview Reset cancels transfer work. Server transfers commit independently of presentation. |
| COMP-015 | Walking default, Shift running | Eight source frames/tile running and sixteen walking; house disallows running. The story Running Shoes unlock is not simulated. Source door/ledge timing is retained. |
| COMP-016 | Stationary source NPCs | Initial flags hide Oak; sign lady uses source on-entry (5,15), north. Five visible NPCs block tiles; native wandering is absent. Preview dialogue facing restores afterward. |
| COMP-017 | Pure-message scripts only | Six source NPC/sign messages execute in preview. Healing, rewards, conditions, flags and general authoritative scripts explicitly report unavailable. |
| COMP-018 | Bounded names/text presentation | Preview RED/BLUE labels are not saved trainer/rival state. Source Latin glyph/advance rendering retains accessible text, but uses neutral colors, instant pages and a custom frame. Native scroll/control/gender styles remain pending. |
| COMP-019 | Web Audio prototype | Pallet/house theme and SELECT use bounded source MPlay conversion. Hardware mixing/envelopes/PSG are approximate; reverb/channel stealing, Route 1 music and saved settings are absent. Gesture/blur/hidden-tab behavior is explicit. ADR-008. |
| COMP-020 | Definitions are not implemented mechanics | Field guide receives a separate public whitelist of the bounded species/learnsets/evolutions/items/abilities. Raw slots/rates, effect bindings and operational relationships stay private. Source rate 21 is not a per-step percentage. TM/HM and wider required exports remain incomplete. ADR-009. |
| COMP-021 | Historical P03 batch 1 scope | Post-accuracy Tackle/Water Gun damage with supplied critical multiplier proved a restricted command probe; it did not implement a turn, faint outcome, original-memory snapshot or persistence. |
| COMP-022 | Historical P03 batch 2 scheduler | Synthetic singles and one reserve per side admit four moves, poison/burn and Foresight fixtures. C owns bounded arithmetic/effects; TypeScript schedules actions/replacement and diagnostics. Synthetic tokens are not real species or owned creatures. Action/residual faint boundaries and selected-priority/tie RNG remain source-ordered; party maximum-HP sums above 65,535 reject. |
| COMP-023 | Selected P03 logical adapter | Six-method server interface; synthetic v1 snapshots retain 148 logical C words plus host party/phase/counters/RNG. Compatibility rejects wrong versions. Views hide enemy reserves/moves/stats, RNG/core words and continuations. Partial player-choice collection and durable effects are not supplied by the adapter alone. ADR-001. |
| COMP-024 | Staged ordinary trainers | Local naming is one-to-seven ASCII letters, uppercase, not globally unique. Ordinary creation has empty awaiting-new-game/recovering state with no location/assets; source opening/gender/rival flows remain later work. |
| COMP-025 | Local auth without email delivery | Better Auth/Drizzle uses host-only HttpOnly SameSite=Lax cookies; HTTP loopback lacks Secure, HTTPS canonical origin enables it. Only local signup/signin/signout are exposed. Email verification/recovery/social login/erasure and public hosting are absent. ADR-010. |
| COMP-026 | Durable ownership before full gameplay | Fifteen-second leases, generations, session-in-transaction checks, UUID/payload receipts and publish-after-commit protect profile/asset/testing commands. One command per socket and bounded admission/rates apply. Auth tokens, leases, private content and RNG stay out of public projections. Complete outcome/script/trade data/recovery remains partial. ADR-010/011. |

### COMP-027: Local developer fixture and read-only owned assets

The named `r1-squirtle-v1` operator fixture supplies a legal fixed Squirtle, starting supplies/money, safe Pallet anchor and development-only markers independently of ordinary new-game creation. It is visibly labelled and never seeds automatically. Source capacities and initial calculations do not implement owned management, item use or story unlocks. Permanent outcome identity prevents repeat replenishment. Later ADR-012/027/029 allow this fixture into separate exploration/testing modes. [ADR-011](DECISIONS.md#adr-011---owned-asset-foundation-and-explicit-local-fixture).

### COMP-028: Bounded shared development exploration

One backend owns logical map groups over existing private character connections; there are no separate routable zone servers. Static NPCs block, public players do not. The explicit development policy bypasses three Pallet story triggers and permits outdoor running without granting story flags. Ordinary staged trainers cannot enter. General story overlays, prediction and population/latency/load claims remain outside verified scope.

Source step timing is authoritative; transfers commit before door presentation. External revocation is detected by input/checkpoint/heartbeat. Periodic saves can lose recent walking on abrupt process loss. Ordered-message-delay observations are local evidence, not a network-partition benchmark. [ADR-012](DECISIONS.md#adr-012---bounded-shared-exploration-over-one-character-owner), [world observations](../reports/world-rendering.json).

### COMP-029: Bounded automatic transport recovery

A single sixty-second transport-grace deadline retains one authenticated owner and hides/freezes the avatar. Both native WebSocket and manual SDK reconnect require the original valid cookie/session binding; a token alone cannot resume. Generation advances and fresh snapshots precede input. Process loss, expiry and terminal errors require fresh admission; an old lease may last fifteen seconds.

The installed SDK emits onReconnect before JOIN acknowledgement and does not recheck enabled in its scheduled callback. The client delays hello appropriately, guards cancellation/deadline, disables message buffering and clears queues. No offline movement or uncertain Save is auto-replayed. Retry save retains exact UUID/payload; the narrow definitive-stale exception is in ADR-030. This is a bounded integration workaround, not a patched dependency. [ADR-013](DECISIONS.md#adr-013---authenticated-transport-reconnection-grace).

### COMP-030: Bounded private encounter generation

The private factory retains source Route 1 on-foot eligibility, cooldown/behavior/rate, twelve-slot selection and creature creation with its admitted lead/modifiers. Diagnostic direct generation bypasses eligibility and is never a player command. Distinct counted RNG streams restore without reseeding; held-item setup consumes its source draw even when both items are NONE.

Explicit low-half-first Random32 evaluation and unsigned shifting resolve portable C ambiguity; original-ROM compiler order is unverified. Encrypted save layout and captured met/display metadata are outside the projection. Digests/source recomputation detect corruption, not client authenticity or all historical reachability. Candidate failure leaves accepted state intact. The public server denies source/private/operational paths while allowing only staged client content. ADR-029 adds live test admission without changing these source boundaries. [Factory contract](../tools/encounter-core/README.md).

### COMP-031: Private real-team battle mechanics

The real-team Route 1 profile admits only its pinned initial matchup/moves. Start RNG at the encounter's post-held-item state, retain mechanical introduction/selection draws, and select the hidden wild action once. Presentation/VBlank RNG is omitted, so source-derived literals are not original-game/emulator comparison evidence. Ability identity alone does not establish active ability coverage in the healthy initial matchup. Checkpoints are private logical server state; no pointer/native layout, enemy internals or live ownership is exposed. [ADR-015](DECISIONS.md#adr-015---private-real-team-route-1-battle-profile).

### COMP-032: Private item use and pending capture disposition

Private living-Potion selection and action are one atomic headless transition rather than the original menu/controller timing. Poke Ball replaces BIOS Sqrt with checked floor-integer arithmetic. Combat may settle captured while dex/nickname/placement remain pending, explicitly differing from the original script's pre-outcome ordering. The capture descriptor is not ownership; immutable private item counts are not the real bag. Full-capacity checks must precede a future paid throw. [ADR-016](DECISIONS.md#adr-016---private-potion-and-capture-result-continuations).

### COMP-033: Private victory progression policy and continuations

The sole-untraded-participant/no-modifiers reward policy defers the final wild faint's source reward work to a recoverable terminal boundary. It cannot substitute for party-aware XP or infer trainer provenance. The natural initial Squirtle battle cannot level; diagnostic XP/context exercises source continuations without granting ownership/readmission. Unknown friendship/met context stays unknown. EV/stat-cache, HP delta, level threshold and pending move/evolution order follow source; owner projection hides proofs/seeds. [Progression contract](../tools/battle-progression/README.md).

### COMP-034: Private blackout policy and pending world application

Blackout uses explicit canonical development last-heal/badge/wallet context and bounded source Elite Four reset operations, not a general script VM or real-account inference. Invalid heal indices fail rather than reproduce unsafe indexing. The old sole-participant profile defers faint friendship; later party profiles already apply it and future bridging must not double-apply. Money uses an unencrypted logical projection. Healing/respawn proposals remain unapplied to owned world state. [Loss contract](../tools/battle-loss/README.md).

### COMP-035: Private capture metadata and source placement

Capture resumes source metadata/dex/nickname/placement after private combat settled. English source naming is bounded; no substitute nickname UI semantics are invented. Party placement preserves current battle state; PC insertion resets PP and stores BoxPokemon fields only. Withdrawal needs its own materialization. Storage search starts at current box, not the message destination variable. Full capacity is an inadmissible prethrow context, not a postcatch release/choice feature. Pending ownership remains explicit. [Capture contract](../tools/battle-capture/README.md).

### COMP-036: Private source evolution decisions and unapplied ownership

Evolution continues only admitted source level edges with explicit context and at most one species change per scene. Current progression bridges are diagnostic. Source conditional rename, damage-preserving stats and current-level move learning survive recovery; cancellation still allows the source's first old-species learn attempt. Graphics/sound/frame RNG are omitted; supported mechanics consume no RNG. The result remains pending ownership, with no live account mutation or battle readmission. [Evolution contract](../tools/battle-evolution/README.md).

### COMP-037: Private family combat preserves unapplied result provenance

Family admission checks real source species/level/ability/stats/whole movesets, including depleted slots. It never strips unsupported moves or adds a gameplay level cap. Result-to-diagnostic bridges retain compatible prerequisite proofs, depleted/earned state and pending ownership; boxed captures without party materialization reject. Source-derived result data does not become an owned creature. Later profiles extend mechanics without reinterpreting this retained profile. [Family contract](../tools/battle-family/README.md).

### COMP-038: Private party state and immediate faint friendship

Stable party indices replace presentation-menu ordering only. Source switching and faint decisions retain roster state, selected-slot residual priority and exact resume point. Failed faint-run decisions cannot reroll; source friendship is applied immediately once per member. Participation/switch counters are stored for future results but do not award XP. General held items, hazards and unsupported effects remain excluded. [Party contract](../tools/battle-party/README.md).

### COMP-039: Private fixed damage, recoverable rain and forced escape

Fixed damage retains distinct source PP/accuracy/type order. Rapid Spin cleanup has no admitted wrapping/seed/spikes state, so those mechanics are not implied. Rain's source timer/field order persists through switches and recovery; failed recast does not refresh. Ordinary-wild Whirlwind yields forced escape, not trainer forced switching, victory or capture. Broader weather/ability context remains unsupported. [Tactics contract](../tools/battle-tactics/README.md).

### COMP-040: Private charging and source-forced continuation

Skull Bash preserves source charge Defense/PP and forced release, including lock/target/slot state and the distinction between inert lock and active charge. Continuation cannot become a voluntary move/run/switch; no second PP spend or wild-AI reroll occurs. Versioned logical state replaces native pointers; failed candidates cannot partially publish. [Charge contract](../tools/battle-charge/README.md).

### COMP-041: Private Protect and bounded compiled-ROM repeat policy

Protect repeat behavior uses the explicit pinned 256-halfword `firered-protect-rom-v1` lookup rather than portable out-of-bounds C or an invented cap. It covers the complete byte counter domain, inclusive comparison, wrapping and source RNG/reset/history order. Runtime embeds the lookup; original-ROM build/execution remains unverified. Domain coverage does not prove whole-game reachability. Compatibility binds the policy, and earlier profiles remain unchanged. [Protect contract](../tools/battle-protect/README.md).

### COMP-042: Private Pursuit and atomic source switch interception

Wild Pursuit can intercept a voluntary switch in this source. Its dedicated path doubles final base damage rather than power, attacks the outgoing battler, consumes one selected action/PP and has different command stages from an ordinary hit. Interception plus the originally selected replacement is atomic even after KO; no midpoint checkpoint or extra enemy attack/prompt is invented. [Pursuit contract](../tools/battle-pursuit/README.md).

### COMP-043: Playable isolated practice and user priority amendment

User priority requires every new mechanic to become immediately manually testable through isolated practice in the same chunk. Source-legal temporary teams/presets and sanitized UI projections are gameplay tests, not normal-owned rewards. Authenticated choices commit to separate practice records before acknowledgment, with strict revisions, receipts, lease/generation fences and exact retry. Missing/incompatible required content fails explicitly.

Fixed ADMINA/ADMINB shortcuts use ordinary cookie sessions, require local development safeguards and never reset/create assets. Default-off Route 1 wild testing additionally binds field RNG, pending proof and original tile to the saved battle; return merges battle RNG once. It cannot discard/reseed incompatible saves as ordinary practice can close. Walking/Shift, map presence and saved owned assets remain separate. [ADR-027 through 030](DECISIONS.md#adr-027---playable-practice-battles-before-remaining-mechanics).

### COMP-044: Mirror Move and saved practice compatibility

New manual practice selects `firered-family-mirror-v1`; saved Pursuit practice and all Route 1 wild tests use their exact retained profile. Full source/module/host/checkpoint compatibility is checked after rules-version dispatch. Mirror's selected PP/priority differs from copied effect identity, and borrowed Skull Bash releases from the Mirror slot without extra PP or invented ownership. Eligible source history and targeting RNG are preserved; private enemy/history/checkpoint state is never projected.

Heartbeat deferral and Save retry repairs preserve prior authority: at most one parsed movement waits behind automatic maintenance; stale async generations cannot mutate resumed state. A fresh Save UUID requires a matching definitive rejection/newer same-character/activity/generation snapshot, at most once; unknown outcomes retain the old payload/UUID. Save overtaken by wild admission is rejected only after receipt lookup so Run/End stay usable and an already committed Save still replays. [ADR-030](DECISIONS.md#adr-030---source-mirror-move-with-playable-practice-and-retained-saved-engine-bindings).
