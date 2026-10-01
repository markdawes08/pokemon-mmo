# Private source family battle profile

`firered-family-singles-v1` extends the selected source-C command engine for one active creature per side in the eight-species Squirtle, Pidgey and Rattata families. Every entry is a **private diagnostic battle**, including entries backed by a verified result from another private supplement. The result proves its supplied lineage; it does not create ownership, complete a pending grant, or enable a live battle. CharacterService, accounts and the database are untouched.

The seven preceding WASM profiles and their literal fixtures remain separate and compatible. In particular, `firered-route1-singles-v2` still supplies the retained Potion/Poke Ball experiment; the new profile exposes Fight, automatic Struggle and Run only. An inherited bag is carried unchanged as provenance.

For clean private outputs, run the dependencies and this check in order:

```powershell
npm.cmd run battle:spike
npm.cmd run encounter:check
npm.cmd run battle:route1
npm.cmd run battle:progression
npm.cmd run battle:loss
npm.cmd run battle:capture
npm.cmd run battle:evolution
npm.cmd run battle:family
```

Compile alone with `.venv/Scripts/python.exe tools/battle-family/build.py`. The two independent outputs are `.local/battle-family/{primary,rebuild}/family.wasm`; `reports/battle-family-build.json` records their hash, toolchain and extraction evidence. Other `battle-family-*` reports record literal, recovery and integration results. Final full-gate evidence belongs to project STATUS and `reports/verification.json`, not an inference from a successful compile.

## Admission and implemented closure

Complete source species data, experience tables, `CalculateMonStats`, nature, ability, gender, PP-bonus and level-up tables validate each admitted creature in C. Species, level 1–100, XP, personality, OT ID, IVs, EVs, friendship, ability slot, cached statistics, current HP/PP and PP Ups are explicit. Cached statistics are checked against a separately supplied calculated-EV basis bounded by current EVs, preserving delayed-stat updates. The source derives actual types and ability. Current HP must be positive; current moves must be unique, packed before empty slots and source-learnable at the current level in the creature's own or ancestor family. PP Ups 0–3 use the source PP calculation. Empty slots have zero PP/bonus.

The sixteen family moves are Tackle, Tail Whip, Sand-Attack, Water Gun, Bubble, Withdraw, Quick Attack, Gust, Wing Attack, Hydro Pump, Bite, Hyper Fang, Agility, Feather Dance, Scary Face and Focus Energy. Struggle is automatic when all four slots are unusable, never inserted into a legal moveset. A current moveset containing any of the other nine family moves is rejected in full. No move is silently removed and no gameplay level cap is imposed.

The four actual abilities are Torrent, Keen Eye, Run Away and Guts. Torrent uses the source HP threshold and increases Water move power before damage divisions; Guts modifies Attack and bypasses the ordinary physical burn reduction. Major status is restricted to none, ordinary poison or burn; poison/burn are explicit initial context, not statuses inflicted by these sixteen moves. The full source residual branches remain responsible for damage and fainting. Keen Eye prevents accuracy loss through source `ChangeStatBuffs`; Run Away follows complete `TryRunFromBattle`, including its no-draw/no-attempt-increment success branch.

No badges, held items, weather, shields, substitute, airborne state, multi-turn locks, other volatile statuses, doubles or extra party members are admitted. Gust's source airborne doubling branch is unreachable under this explicit no-airborne closure. Rain Dance, Protect, Skull Bash, Mirror Move, Rapid Spin, Pursuit, Whirlwind, Super Fang and Endeavor remain unsupported, as do switching and their corresponding timers/history/forced-switch/fixed-damage dependencies. True species support does not imply all their possible move sets are implemented.

## Source scheduling

The common `tools/battle-spike` numerical functions and complete move data remain the damage, critical, type, accuracy, PP, random, HP, ordering and lifecycle implementation. `WATERBLUE_FAMILY` adds narrow preprocessor branches without changing previous builds' compiled paths. The new source admission translation unit uses actual Pokemon numerical routines, not TypeScript formulas or a second damage engine.

Selected source scripts determine command order. Self stat increases and Focus Energy spend PP without an accuracy draw. Target stat decreases retain accuracy before PP, then the complete source stat command. Bubble's secondary stat decrease and Bite/Hyper Fang's flinch use complete source `SetMoveEffect` cases behind the original guards. `Cmd_seteffectwithchance` retains its unusual inclusive `Random() % 100 <= chance` comparison and the zero-effect draw on ordinary damaging moves. No probability correction is substituted.

Flinch is set only while the target's source action-order index is still later in the turn. The exact `CANCELLER_FLINCH` case runs before accuracy or PP spending, clears the flinch flag, marks immobility and invokes complete `CancelMultiTurnMoves`. An immobilized action draws no attack RNG and spends no PP. Focus Energy uses its complete source command, persists across turns, and is read by the original critical calculation. Repeated attempts spend PP and produce the source failure flag.

Each turn retains the source wild-controller slot rejection loop and its chosen slot before player choice. Action ordering uses `GetWhoStrikesFirst(..., FALSE)` and Run's action partition. `DoFieldEndTurnEffects` also passes **FALSE** to that function; chosen move priority can therefore affect residual order. Mechanical introduction passes TRUE before the initial selection draw. Source secondary speed changes affect later ordering without changing an already selected action order.

Struggle retains its existing accuracy/critical/variance, no-PP path and quarter-recoil ordering. Source faint cleanup checks attacker before target after recoil. Ordinary residuals run in source order, with terminal outcome checked after each faint. No new reward or durable terminal operation is emitted.

This is a bounded headless schedule. The source script interpreter, graphics/controller waits, text, audio and VBlank/frame RNG are not executed. Mechanical RNG calls retain their source order; the source counted RNG traps before safe-integer exhaustion, and isolated candidate failure publishes no partial state. This is not original-ROM timing or emulator equivalence.

## ABI, state and recovery

The new module uses the retained scalar `spike_*` commands plus `family_input_begin/set/commit`, `family_start`, `family_choose_wild`, `family_order`, `family_run` and diagnostic getters. Admission stages 46 words per actor: the same 40-word creature projection as the continuation modules, followed by six calculated-EV values. Source validation completes before installing an actor. Malformed duplicate/out-of-range staging is poisoned; rejected admission leaves the accepted battle unchanged.

Checkpoint version four contains 154 logical words. The first 152 retain the prior real-profile layout; capture fields 150/151 must be zero. Words 152/153 store packed PP bonuses. Actor status2 retains only Focus Energy at settled choice/terminal boundaries. Supported stat-stage changes, source family move legality, types/ability and major status are checked before raw restore.

Flinch, `sFamilyOrderReady`, `gBattlerByTurnOrder` and `gCurrentTurnActionNumber` are within-turn state: no mid-turn import is offered. Flinch is cleared by the selected source turn-start statement and rejected at settled checkpoints. `family_order` reconstructs the two-actor action order before an attack or Run; an imported choice cannot execute an attack until that happens. The attack-canceller tracker is scratch in the selected single-case wrapper and does not select a later branch. Focus Energy and PP bonuses are retained because admitted future mechanics read them.

Raw import resets admission-only scratch, including source nature/gender diagnostic data. Nonserialized BattlePokemon personality/OT/IV/friendship fields are not read by these sixteen admitted mechanics; the host preserves them in immutable admission and validates them on a fresh instance before importing battle words. `family_mon_get` describes initial source admission, not raw-checkpoint identity recovery. Calculated-EV provenance likewise belongs to that immutable admission, while actual battle statistics survive in the logical rows.

The host validates fixed admitted identity/stat/type/ability/move/bonus fields, HP/PP depletion, major status, permitted stage/Focus changes, one-creature parties and the hidden wild choice. New transitions run on a fresh restored candidate; failure or exhaustion cannot publish HP, PP or RNG changes. The six-method adapter binds source/module/host/prerequisite compatibility and private RNG. Raw words are supported semantic state, not authenticated historical ownership; hashes do not authorize client-supplied saves.

Events retain HP/PP/status/stat/ability diagnostics. Added type 8 carries a changed Focus Energy/flinch status2 value; type 9 marks a flinch-prevented action. Each C command keeps the existing sixteen-event bound. Public-style viewer projection excludes raw state, seeds, hidden AI choice, opponent IVs and exact statistics. There is no room or browser entry point for this profile.

The remaining work is the nine rejected moves, broader resulting-team dependencies and party switching, then durable encounter/battle/progression/capture/evolution/blackout application through the authenticated owner. A verified pending result used as a diagnostic input does not complete any of those ownership operations.
