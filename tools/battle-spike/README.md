# Bounded C/WASM battle experiment

This is P03 batch 3, the final batch of the decision budget. It runs extracted FireRed C commands in private headless WebAssembly with a restricted TypeScript turn driver, logical checkpoints and a six-method Node adapter. The final implementation decision is recorded in [ADR-001](../../docs/DECISIONS.md). This is not a full source script interpreter or browser gameplay; the admitted four-move profile remains explicit.

## Run locally

From the project root in PowerShell:

```powershell
npm.cmd run battle:setup
npm.cmd run battle:spike
```

Setup installs optional pinned Zig 0.16.0 under .tools, verifies the official 97,217,739-byte Windows archive against [toolchain-lock.json](toolchain-lock.json), and records the executable hash/version. No global compiler or OS service is installed. The preview does not need Zig; the current ten-stage root verification includes this experiment and requires its compiler.

The spike command extracts source, builds in two independent directories, and runs damage/turn, raw-checkpoint, recovery and adapter verifiers followed by resource measurements. Outputs stay under .local/battle-spike/{primary,rebuild}; the application does not serve the WASM. The target is wasm32-freestanding, C11, O2/g0/nostdlib, with explicit exports and no entry point. Each instance has fixed private 256 KiB memory, including a 64 KiB stack, and no imports. Changed source/compiler hashes, unexpected imports/exports or unequal rebuilds fail verification.

## Source and transport

The reference at C:/Users/mrkda/Projects/pokefirered-master stays read-only and is checked against source-lock.json, using English FireRed revision 0. Unknown upstream commit remains unknown. No original ROM, Git metadata, emulator or GBA graphics/execution loop is needed.

[extract.py](extract.py) copies complete selected functions, tables, macros and declarations with input/fragment hashes and source line ranges. Two partial extractions are explicit: SetMoveEffect retains its original prefix and full primary-status branch, replacing its non-primary branch with an error; poison and burn retain complete original end-turn case blocks inside a named wrapper. The manifest records transformations. Generated source_sequence_evidence.txt contains original scripts and scheduler/cancellation functions for audit; those evidence fragments are **not compiled**.

New commands admit Tackle (33), Water Gun (55), Quick Attack (98) and Poison Powder (77):

- Damage moves execute source accuracy, PP, critical, damage/type, adjustnormaldamage, healthbar/HP and secondary-chance commands. A normal hit consumes four draws: accuracy, critical, variance, secondary chance. Zero-secondary-effect moves still consume the last draw. A miss consumes accuracy and PP.
- Poison Powder executes source PP and status/type predicates in script order, then accuracy and the retained primary-status application. Existing poison, incompatible types or another status can skip accuracy. It consumes no critical, variance or secondary draw.
- Source GetWhoStrikesFirst supplies priority, speed stages and tie RNG. The adapter projects the original singles switch partition before moves in battler order. End-turn comparison deliberately passes FALSE, retaining chosen priorities and possibly consuming another tie draw, as the pinned source does.
- Full source switch cleanup, faint cleanup plus Cmd_cleareffectsonfaint, team-HP outcome calculation, turn cleanup and special-status clearing are copied. Selected poison/burn cases calculate residual damage; original passive healthbar/HP commands apply it without attack RNG.

The seed denotes complete internal u32 RNG state **after omitted introduction effects and immediately before the first action-selection draw**. Earlier introduction ordering can consume RNG. This is neither original SeedRng(u16) nor a live client seed. The driver invokes the next selection draw after each completed nonterminal turn.

[turn-probe.ts](turn-probe.ts) owns synthetic party storage and the restricted turn flow: two sides with one or two members, voluntary switches, action cancellation after knockouts, forced replacements, residual processing and source team-HP outcomes. Attack knockouts resolve replacement before residuals; residual knockouts resolve afterward. The host projects ordering from source evidence, rather than executing the full move-end, faint or replacement scheduler.

Admitted actors obey commands and have no abilities, held items, badges, weather, side effects or disabling volatile conditions. Burn, ordinary poison, Foresight and supplied stages are supported. Other moves/statuses, disobedience, doubles, Substitute, healing, recoil and broader residuals are rejected or outside the exposed ABI. Full attack cancellation, faint counters, friendship, experience, rewards, capture and encrypted party storage remain unimplemented.

BattlePokemon and other selected structs retain their declarations. BattleStruct and service records project consulted fields. Synthetic actor IDs 1/2 address supplied baseline types for faint cleanup; they are not actual species identities. Party records contain species-presence, HP and egg status only. Team HP overflow is rejected before the source u16 accumulator. The host requires defenses of at least 4 so every admitted stage is safe; C rejects effective zero defense before RNG/PP changes.

Only named empty item/ability/badge queries have adapter answers; unexpected dependencies set errors. Original controller calls append events and acknowledge immediately: type 1 healthbar request, 2 updated HP, 3 remaining PP, 4 raw status. Healthbar requests cap at 10,000. These observations replace presentation transport, not durable production events.

## Private ABI

[c/adapter.h](c/adapter.h), [c/attack.inc](c/attack.inc) and [c/lifecycle_state.inc](c/lifecycle_state.inc) define exports. Reset precedes configuration. Original spike_* exports remain, including the stricter two-move supplied-critical kernel. New spike2_* exports configure speed/moves/PP/status/stages; begin selection; order actions; attack as either actor; perform switch/faint/residual commands; and inspect party outcomes.

spike2_order accepts slots 0-3 or sentinel 4 for switching. Valid comparison results are 0 (first), 1 (second), or 2 (second after a tie). They overlap error codes, so the host also checks result field 0. Result fields 1-11 retain damage/HP/flag/RNG/event diagnostics; 12 is critical multiplier, 13 current PP, 14 attacker, 15 target. spike2_get_move reads move ID (field 0) or PP (1); stage/party getters are separate.

Statuses: 0 success, 1 invalid argument, 2 unsupported, 3 uninitialized/unconfigured/fainted/terminal, 4 unexpected dependency, 5 event overflow, 6 unsafe effective defense. Gameplay mutations reject terminal state; reset starts a new fixture and direct RNG stepping remains diagnostic. Failed host transitions are discarded. Each candidate transition now starts in a fresh instance restored from logical state; the previous raw-memory copy has been removed.

## Portable checkpoint and RNG

The spike3_* API exports a version-1 vector of 148 explicitly named unsigned 32-bit values. It stores no native pointer, struct byte, linear-memory offset or suspended script instruction. [The state audit](../../reports/battle-spike-state-audit.json) supplies the complete field map and classifies all 98 global declarations in the restricted C translation unit, including constants and optimizer-elidable declarations. This is not an inventory of every original FireRed battle global.

Supported boundaries are choice after selection RNG, replacement before residual processing, replacement after residual processing, and terminal. The host snapshot carries parties, active indices, turn/transition/event counters, phase/resume, outcome and source/profile metadata. It cross-checks active C records and RNG against the host data. The core retains chosen actions and their old move slots because residual ordering after replacement reads the new active creature's move at that retained slot. Projected C party records may be stale at nonterminal boundaries; the host overwrites them before outcome queries.

Staged import validates version, length, every scalar, complete/unique word presence, reserved fields, HP/status/stage/move constraints, outcome and RNG relationships before mutating gameplay state. Successful import reconstructs instance-local pointers and the excluded empty context, then assigns validated logical fields without replay or RNG draws. Prior events and command scratch are consumed observations and reset. Import rejection preserves existing live state and events.

The original Random function body remains unchanged. A macro installed afterward routes subsequent calls through an adapter counter which invokes the original exactly once. Checkpoints include the initial seed, current RNG value and exact draw count up to JavaScript's maximum safe integer. An O(64) affine LCG calculation validates seed/count/state consistency without consuming gameplay RNG. Counter rollover and overflow are tested.

The omission argument applies only to this profile. Any new move, ability, item, status, volatile condition, doubles or resumable script must be audited for newly live state before admission. If omitted state becomes relevant, expand its logical representation and bump checkpoint/profile versions with an explicit compatibility policy. Unknown dependencies must continue to fail explicitly. Checkpoint validation is not cryptographic authentication or proof that a state was reached by a historical action sequence; snapshots belong to trusted server storage.

## Evidence and remaining scope

| Evidence | Artifact |
|---|---|
| Current hashes, provenance, compiler, equal rebuilds | [battle-spike-build.json](../../reports/battle-spike-build.json) |
| Dependencies, services and omissions | [battle-spike-dependencies.json](../../reports/battle-spike-dependencies.json) |
| Complete restricted-state inventory and checkpoint fields | [battle-spike-state-audit.json](../../reports/battle-spike-state-audit.json) |
| Raw checkpoint rejection and atomicity checks | [battle-spike-checkpoint-tests.json](../../reports/battle-spike-checkpoint-tests.json) |
| Recovery/replay, six-method adapter and measurements | [battle-spike-recovery.json](../../reports/battle-spike-recovery.json), [battle-spike-engine.json](../../reports/battle-spike-engine.json), [battle-spike-measurements.json](../../reports/battle-spike-measurements.json) |
| Batch-one derivations/runtime | [battle-spike-source-evidence.json](../../reports/battle-spike-source-evidence.json), [battle-spike-batch-1.json](../../reports/battle-spike-batch-1.json) |
| Batch-two derivations/runtime | [battle-spike-batch-2-source-evidence.json](../../reports/battle-spike-batch-2-source-evidence.json), [battle-spike-batch-2.json](../../reports/battle-spike-batch-2.json) |
| Literal expected values | [fixtures/batch-1.json](fixtures/batch-1.json), [fixtures/batch-2.json](fixtures/batch-2.json) |

Batch one originally passed 19 damage/HP cases, six RNG sequences/30 draws, 19 rejection cases, initialization/HP guards and two-instance interleaving. Its original 15,159-byte WASM hash was 670fe529f6a52283bcb9e27f964dca51c2b39b894c0622ccd8b43b3262dbf560. Original fixtures remain regression checks.

The batch-three build is 46,120 bytes, with matching independent SHA256 3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724. It checks 31 pinned inputs and includes 31 complete compiled source functions, three partial source fragments and 23 audit-only script/function fragments. The retained batch-two suite has 15 literal transcripts/19 transitions, 15 raw C rejection cases, three fainted-HP guards and 14 terminal guards. Raw checkpoint verification adds 60 rejection/atomicity cases, all four boundary round trips, independent LCG validation, counter rollover and overflow checks. A deliberately injected host transport fault after a real C mutation proves failed candidates are discarded; it is not a naturally occurring C fault. Recovery, adapter, resource and full-project results are recorded separately in the linked reports and reports/verification.json.

The recovery, adapter and resource gates conclude the planned three-batch exploration. ADR-001 selects source C/WASM commands with the explicit TypeScript scheduler through one adapter. Restricted-turn isolation does not establish full-mechanics coverage. The plan's 24-hour planning ceiling applies if engineering time is tracked; no elapsed-hours total is claimed. Real species/effect closure, persistent domain effects, authoritative live encounters and battle UI remain separate work.
