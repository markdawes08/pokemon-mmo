# Server battle boundary

ADR-001 selects source C commands compiled to WASM, with an explicit TypeScript
scheduler. This package contains the six-method contract, runtime guards and
selected adapter skeleton in `src/wasm-adapter.ts`. The concrete private profile
in `tools/battle-spike/engine.ts` wires it to the verified four-move source kernel.
It is not connected to a live room, database, owned party or battle UI.

`BattleEngine` describes the six operations: `createBattle`,
`validateChoice`, `advance`, `snapshot`, `restore` and `project`. Initial teams,
choices, accepted choices, events, effects, private engine state and presentation
are typed by the injected kernel. The skeleton executes real admitted mechanics;
unsupported policies and choices fail explicitly.
Inputs are deeply readonly at the TypeScript boundary. Implementations must avoid
mutating caller inputs, published room state or durable records.

Snapshots persist the battle identity, ordered participant IDs, immutable
mode/policy, engine/rules/content compatibility, transition and event sequences,
private engine bytes and private per-battle RNG bytes/draw count. Contract and
snapshot envelope versions are currently 1. `engineStateVersion` identifies the
adapter's private byte format; RNG algorithm and version are pinned separately.
Opaque bytes use bounded canonical base64. The current bound is 1,398,104 encoded
characters per payload; it is an explicit first-batch limit to revisit with
measured real snapshots. Encoding alone does not validate the bytes' internal
layout, legal state, pointers or mechanic invariants.

Call `parseCompatibleSnapshot` before asking an adapter to decode a snapshot.
It rejects mismatched engine, rules, content and byte-format versions and clones
the envelope. The selected adapter must then validate all internal fields and
restore without reseeding. Live RNG state must originate on the server, never
from a client request. Test seeds are explicit. RNG identities cannot cross
battles; transition guards reject draw-count rewind or changed RNG bytes with
no new draw. They do not implement or prove the selected RNG algorithm.

An accepted choice binds the server-validated payload to a participant, battle
and current transition. `parseAcceptedChoices` validates those bindings and
rejects duplicate actors; it does not determine who owes a choice, whether a move
is legal or whether an authenticated caller owns the actor. The adapter and
domain service must enforce those rules before acknowledging accepted choices.

`createTransitionGuard` requires explicit event and domain-effect payload
schemas. Every allowed effect kind has one registered version and validator.
The caller passes the previous snapshot and exactly one next snapshot with its
new events and effects. A transition advances once; event IDs are contiguous
after the previous snapshot's event sequence. An effect's stable identity is
`(battleId, transitionSequence, effectIndex)`, with zero-based contiguous indices
within that transition. Wrong-battle effects, duplicates, reordered indices,
old cumulative effects and unknown kinds/versions fail. The helper
`domainEffectIdentity` encodes the tuple unambiguously for a durable business key.

The mode and allowed-effect policy are fixed at creation and cannot change in a
transition. PvE permits only its explicitly registered allowed effects. Initial
`pvp-copy` permits **zero domain effects**: teams may change only inside private
battle-local copies, while match results remain in the battle record. The domain
service must apply this guard independently of engine/presentation code. It must
never interpret private engine bytes or presentation/events as mutations of
owned creatures, persistent HP/PP, held items, inventory, experience or ownership.

Guards validate and clone envelopes; they never write a database or enforce
exactly-once persistence by themselves. A domain service must atomically commit
each new effect's permanent identity, its mutation and the corresponding snapshot.
Retries must retain RNG and effect identities. Terminal commits apply only new
outstanding effects, not previous cumulative outcomes. No such persistence,
character/session authority or recovery service is implemented in this package.

`PermittedBattleView` has only battle/viewer identity, current public sequence
numbers and an explicit presentation payload. `createPermittedViewSchema`
requires a strict object whitelist; `parsePermittedView` also binds it to the
current snapshot and requested participating viewer. There is no spectator policy
in this initial boundary. RNG, private engine state and unchosen opponent
information must not be included in that whitelist or its nested fields. Raw
ordered events are server data and must not be broadcast without audience-aware
projection. A whitelist cannot detect a secret deliberately placed into an
otherwise permitted text field; projection implementation and tests remain
required.

Focused fixtures use invented `test-consume`/text payloads solely to test the
boundary. They verify compatibility rejection, malformed private bytes, snapshot
and transition identity, input immutability, RNG separation, effect delta
identity/registration, PvP policy and projection privacy. They are not golden
battle-mechanics fixtures. Golden mechanics results must separately record the
source-derived input, explicit seed, expected events/state, source evidence and
intentional departures required by `docs/PROJECT_PLAN.md` section 7.

The selected adapter stores logical snapshots, not retained WASM instances or
linear-memory images. Every operation opens a fresh validated session; advance
returns new state only after a successful transition and envelope guard. Private
JSON and RNG bytes are canonical base64. Inner/outer counters, RNG and profile
versions must agree. The private loader binds compatibility to the WASM and host
implementation hashes; cross-version migration is not implemented. Checkpoints
are trusted server data, not authenticated client input or a signed save format.

This profile admits exactly two participants and zero persistent domain effects,
including in PvE. A policy requesting unsupported effects is rejected. Choice
validation is pure, and advance requires the complete set of required accepted
choices. Collecting and durably acknowledging a partially submitted pair belongs
to the later serialized battle service. Actions/selected slots already needed by
a suspended replacement phase are included in the logical checkpoint.

The private concrete projection exposes the viewer's party and legal choices,
plus the opponent's active level, HP percentage and status. Opponent reserves,
moves, private continuation and future RNG are excluded. Raw ordered events
remain private diagnostics until an audience-aware event transport is added.

`npm.cmd run battle:spike` builds twice and verifies source goldens, atomic C
checkpoint rejection, cross-build/fresh-process recovery and the real adapter.
Reports include `battle-spike-checkpoint-tests.json`, `battle-spike-recovery.json`
and `battle-spike-engine.json`. Resource measurements show single-turn compute
headroom but dense synchronous bursts need optimization/scheduling before the
later population gates; no persistence latency or soak result is claimed.
