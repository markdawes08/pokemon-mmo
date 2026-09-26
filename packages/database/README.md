# Database and trainer profile foundation

The schema contains runtime metadata, migration history, Better Auth account/session
records, the bounded P04 trainer profile registry and relational asset foundations.
Ordinary new characters are staged at
`awaiting-new-game` / `recovering`: no map, position, party, inventory or story
progress is invented. The renderer preview is separate and unsaved.

`npm run setup` initializes PostgreSQL 17.11 locally on Windows x64. Binaries live
under `.tools/postgres`, data and random credentials under `.local`. The process
listens on `127.0.0.1:5433` by default and uses SCRAM authentication. No Windows service is
installed. `npm run db:stop` stops it without deleting its data. Keep `.local` and
`.env` private. `scripts/db.mjs setup` pins the exact EDB archive URL and SHA-256.

For a different port on **first setup**, set `$env:LOCAL_DB_PORT = '5434'` in
PowerShell before `npm.cmd run setup`. The value must be an integer from 1 to
65535. Setup persists the chosen port and matching connection URLs in
`.local/database.json`; root setup copies those URLs into a new `.env`.
Subsequent setup/start commands preserve the stored choice, regardless of later
`LOCAL_DB_PORT` values. Existing clusters and configuration are never reset.
The host is always `127.0.0.1`; start rejects a non-loopback stored host.

To change an existing cluster's port, stop it first with `npm.cmd run db:stop`,
update `port`, `databaseUrl` and `testDatabaseUrl` together in
`.local/database.json`, then update `DATABASE_URL` and `TEST_DATABASE_URL` in
`.env` to match before running `npm.cmd run db:start`. Keep the existing data and
password. Do not edit the configuration of a running PostgreSQL process.

`npm run db:migrate` applies the reviewed SQL files. The runner serializes migration
runs with an advisory lock, records their SHA-256, and rejects changed applied
migrations. Add a new migration rather than editing an applied file. Drizzle table
definitions in `src/schema.ts` must match the reviewed SQL. No schema push/reset is
used.

`0002_auth.sql` implements the pinned authentication library's core tables;
`0003_characters.sql` adds trainer profiles, persistent leases and command receipts.
One profile per account is a permanent unique business constraint. Names are 1–7
ASCII letters normalized to uppercase and can be shared by different accounts.
The account-to-character and character-to-lease/receipt relationships use
`ON DELETE RESTRICT`. Auth-only sessions/accounts follow their library's cascading
deletion semantics; those cascades do not erase trainer data. Account erasure and
asset retention workflows are not implemented.

The character service serializes at most 32 pending operations per character.
Database lock order is the bound auth session (shared lock), character, then lease;
creation locks the account row before its creation receipt/profile. This gives
session revocation a defined ordering against writes queued before logout. Sessions
are always bound by the authenticated room; direct internal storage fixtures can
omit the session binding. Future multi-character operations must sort character
IDs before acquiring these locks.

Leases last 15 seconds by default, and the room renews them while the authenticated
connection is active. A new connection in the same service increments the durable
connection generation. Another server owner must wait for expiration; takeover
increments both fencing and connection generations. Release expires the lease
instead of deleting it, preserving monotonic generations. Save and heartbeat
transactions verify the owner, both generations and lease expiration. Old
connections cannot save, renew or release a replacement connection's lease.

The authenticated room's durable command is `save-profile`: it increments the
profile revision and records its save time. It accepts no world location or
gameplay state. A transaction writes the profile and its payload-hashed receipt
together. Same ID/same normalized payload returns the original receipt; a changed
payload conflicts. Replaying an earlier result does not rewind the registry's
current revision. Receipts are retained indefinitely in this phase; cleanup is
not scheduled. The permanent account uniqueness rule still prevents duplicate
creation if a creation receipt is removed. Profile save receipts must not be
pruned until a retention/retry policy exists.

No committed state is published before commit. A publication failure freezes the
session until a fenced database reload succeeds. An uncertain commit destroys the
affected connection, then a fresh transaction takes the same actor lock and reads
the receipt before deciding whether to retry. This lock waits for any still-running
writer; an absent receipt cannot race that writer's commit. There is at most one
automatic retry with the same command. Storage outages fail clearly and freeze
the session instead of promising an in-memory save. Recovery restores the
profile and, under the bounded development policy below, its committed world location;
battle/script/trade recovery remains future work. The separate local
development fixture command described below owns the new asset transaction.

`node scripts/db.mjs test` uses only `TEST_DATABASE_URL`, requires a database name
ending in `_test`, applies migrations idempotently, and verifies rollback, a check
constraint, and cross-connection persistence. Its temporary row is removed.

`npm.cmd run test:integration` also runs `apps/server/src/accounts-store-smoke.ts`
after migration. It requires the explicit `_test` database, uses unique fixture
accounts and removes only their rows in restrictive-FK order. Its report is
`reports/accounts-store-verification.json`. It covers creation/save races,
payload conflicts, constraints, replacement connections, lease expiration/takeover,
revision fencing, restart through a new service instance, bounded backpressure,
session revocation versus queued saves, rollback, lost commit acknowledgement,
publication failure and a closed database pool. Test-only hooks execute real
PostgreSQL commits/rollbacks before simulating an unknown acknowledgement; they
are rejected outside `NODE_ENV=test`. This is not a network-partition or machine
crash test. No inventory/economy recovery is claimed by these profile checks.

`compose.yaml` is an alternative, not required for the verified Windows path. Set a
private `POSTGRES_PASSWORD`, create the separate `pokewaterblue_test` database, and
set explicit connection URLs in `.env` before using it. Compose was not exercised
on this workstation. Do not run both alternatives on port 5433.

## Relational asset foundation and explicit development fixture

`0004_assets.sql` is additive. It preserves ordinary staged characters and adds
the `development-fixture` stage, initially restricted to `recovering` activity.
Migration 0005 additionally permits bounded `overworld`/`transferring` activity.
A stored fixture location alone does not grant a world connection or activate movement.
The TypeScript mapping is `src/asset-schema.ts`; reviewed SQL additionally owns
the immutability and source PP validation triggers.

`content_versions` identifies the SHA-256 of the private gameplay definition
bytes, their source fingerprint and schema version. The species, move, item and
ability registries use composite `(content_hash, source_id)` keys. Their rows
reject updates and deletes; a changed source needs a new content version.
Registration inserts missing rows and compares every stored definition against
the selected pinned data. The private gameplay hash differs from the complete
renderer content-manifest hash used during character admission.

`creatures` holds stable instance/owner IDs, content references, personality,
original trainer, IVs, EVs, experience, level, friendship, current and maximum HP,
stats, persistent status and acquisition provenance. IVs are 0–31, each EV is
0–255, total EVs are at most 510, and current HP cannot exceed maximum HP. Its
required location columns express exactly one occupied party or storage slot:
party slots 1–6 use box 0; storage boxes 1–14 have slots 1–30. A unique
owner/location/box/slot key enforces capacity without orphan location records.
The browser projection translates party and move slots to zero-based indices.
`creature_moves` has at most four unique moves and references its creature's
exact content version. A SQL trigger caps current PP using the registered base
PP and zero to three PP Ups. An unpopulated moveset is structurally allowed;
the seed transaction supplies the required source starting moves.

Inventory references the item's source pocket through a composite foreign key.
Occupied stacks have quantities 1–999, with an absent row representing zero.
Items/Key Items/Poké Balls/TM Case/Berry Pouch capacities are 42/30/13/58/43.
Wallet money is 0–999999. Story primitives contain character flags, unsigned
16-bit variables, one-time claims, versioned map patches and trainer completion
keys. Claims, completions and audit events use composite outcome/character
foreign keys, preventing attachment to another character's outcome. These
tables are foundations; ordinary story scripts and economy operations do not
exist yet. Creature ownership changes, learnability, species/ability pairing,
XP-to-level relationships and stat formulas must be validated by their future
gameplay services; these structural constraints do not implement those rules.

`domain_outcomes` retains a permanent `(character_id, type, business_key)`
uniqueness key independent of retry receipts. Outcomes and audit events reject
updates. Application code has no deletion/retention operation; restrictive FKs
prevent accidental parent cascades. Explicit deletion remains possible for
isolated test fixtures and future reviewed retention work. The immutable content
registry is retained even when fixture character rows are removed.

The local command requires an existing, disconnected, untouched staged trainer:

```powershell
npm.cmd run db:seed:dev -- --character <UUID> --profile r1-squirtle-v1
```

An optional `--command <UUID>` preserves a chosen retry identity. This command
accepts only local development configuration and a loopback PostgreSQL database;
there is no browser mutation endpoint. It refuses an active character lease or
existing assets/progression. The service locks character then lease, checks the
receipt and permanent outcome, and commits all assets, stage/location, revision,
receipt and audit event together. A different command ID for the same profile
returns the existing outcome and never grants another creature or item stack,
even when the earlier retry receipt has been removed. Unknown commit outcomes
discard the connection and recheck the outcome under the same locks before
retrying. No mutable asset cache is published. Read projections lock the owning
character and authenticated session, and expose only that trainer's whitelisted
party/inventory summary. Private IVs/EVs/identity, source effect bindings, other
trainer data and raw story/outcome records remain server-side.

`r1-squirtle-v1` checks exact gameplay and Pallet bytes. It persists a level-5
Squirtle with source Tackle and Tail Whip, PP 35/30, medium-slow XP 135, Torrent,
friendship 70 and source-calculated neutral stats (20 HP, 10 Attack, 12 Defense,
10 Speed, 10 Special Attack, 12 Special Defense). IV 15, EV 0, personality 25,
original trainer ID 1, five Potions, five Poké Balls and the clear Pallet tile
(10,12) are explicit development choices. Money 3000 also matches source new-game
money. Only `development:` flags/variables are written; no real story completion
is invented. The source evidence and chosen values are recorded in
`../../reports/development-profile-source.json`. The fixture remains unusable for
live battles, capture, items or storage transfers until
those owning phases implement and verify their rules. Bounded shared exploration
is admitted separately by the named P05 development policy. It is not an R1 mechanics
closure result or a replacement for the source opening adventure.

Source-profile unit checks validate the pinned values and reject changed source
identity, missing moves and blocked/occupied anchors. The asset integration and
browser checks use separate random test accounts and remove their rows in
restrictive-FK order. Full battle/script/trade recovery records remain deferred
to their owning phases; no unused snapshot tables imply those systems exist.

## Bounded world checkpoints (0005)

Migration `0005_world.sql` adds elevation, facing, transition generation and the
last world checkpoint UUID. Ordinary staged trainers keep null location. Existing
development fixtures at the audited Pallet (10,12) anchor receive elevation 3 and
south facing. Complete-location and activity constraints preserve the normal
new-game boundary. The applied migration SHA256 is
`4e89de22f3063b42bc46e34355a7152bd73b85467bd7dc0a717c2ccc708eb180`.

CharacterService serializes movement with all other character operations. Each
directional intent checks the current authenticated session and lease with a
read-only query; it neither renews the lease nor inserts a receipt. Two-second
heartbeats renew ownership. Finished tiles are checkpointed with a five-second
target, on Save and authorized graceful disconnect, and atomically on transfer.
Save during an unfinished step records the last finished tile and preserves the
accepted motion. Periodic checkpoints likewise preserve motion in progress.

Entry/leave use command receipts; ordinary movement does not. A checkpoint UUID
and the fenced character row resolve a lost COMMIT acknowledgement before retry.
Transfers increment the zone generation only with the committed destination.
Published presence derives from the one runtime location, so a character cannot
simultaneously own a source and destination zone. A failed publication reloads
the committed position. A revoked session cannot checkpoint new movement and is
hidden when the next input/checkpoint or two-second heartbeat detects revocation;
the signing-out browser disconnects immediately. Sudden process loss can discard movement since the last
checkpoint. Separate battle/script/trade continuations remain unimplemented.
