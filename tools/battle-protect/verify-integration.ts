/** Coherent private capture -> extended two-member party diagnostics. No ownership,
 * account login, field acknowledgement or database mutation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { BattleSnapshot } from '@pokewaterblue/battle-core';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadEncounterCore } from '../encounter-core/encounter';
import { createRoute1Initial, loadRoute1Engine, makeRoute1Rng, route1Config, type Route1Choice } from '../battle-route1/engine';
import { loadProgressionCore, type ProgressionDiagnostic } from '../battle-progression/progression';
import { loadLossCore } from '../battle-loss/loss';
import { loadEvolutionCore, type EvolutionCreature, type EvolutionContext } from '../battle-evolution/evolution';
import { loadCaptureCore, type CaptureSession } from '../battle-capture/capture';
import { createPartyDiagnostic, loadPartyEngine, partyConfig, makePartyRng } from '../battle-party/engine';
import { createTacticsDiagnostic, loadTacticsEngine, tacticsConfig, makeTacticsRng } from '../battle-tactics/engine';
import { createProtectDiagnostic, createProtectDiagnosticFromCapture, loadProtectResources, prepareProtect, protectCreatureWords,
  protectCreatureSchema, type ProtectCreature } from './admission';
import { loadProtectEngine, makeProtectRng, protectConfig, protectCheckpointSchema, type ProtectChoice } from './engine';
import { createChargeDiagnostic, loadChargeEngine, chargeConfig, makeChargeRng } from '../battle-charge/engine';

const profile = await loadDevelopmentProfile(), retainedProfile = structuredClone(profile);
const encounters = await loadEncounterCore(), old = await loadRoute1Engine(), party = await loadProtectEngine();
const progression = await loadProgressionCore(), loss = await loadLossCore(), capture = await loadCaptureCore(), resources = await loadProtectResources();
const evolution = await loadEvolutionCore(), retainedParty = await loadPartyEngine();
const retainedTactics = await loadTacticsEngine(), retainedCharge = await loadChargeEngine();
const checks: string[] = [], terminalOutcomes = new Set<string>();
let handoffs = 0, restoredBoundaries = 0, diagnosticTransitions = 0, faintDecisions = 0;
const oldView = (state: BattleSnapshot) => old.project(state, 'player').presentation;
const view = (state: BattleSnapshot) => party.project(state, 'player').presentation;
const raw = (state: BattleSnapshot) => protectCheckpointSchema.parse(JSON.parse(Buffer.from(state.privateEngineState.data, 'base64').toString('utf8')));
const monWords = (state: BattleSnapshot, slot: number) => raw(state).core.words.slice(160 + slot * 46, 206 + slot * 46);
function restore(state: BattleSnapshot): BattleSnapshot {
  const restored = party.restore(party.snapshot(state)); assert.deepEqual(restored, state); restoredBoundaries++;
  assert.deepEqual(view(restored), view(state)); return restored;
}
function advance(state: BattleSnapshot, choice: ProtectChoice): BattleSnapshot {
  const accepted = party.validateChoice(state, 'player', choice); assert(accepted.accepted, JSON.stringify(choice));
  const retained = structuredClone(state), result = party.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []); assert.deepEqual(state, retained);
  assert.deepEqual(view(result.nextState).inventory, view(state).inventory);
  assert.throws(() => party.advance(result.nextState, [accepted.value]), 'An accepted choice cannot be replayed against the next sequence');
  diagnosticTransitions++; return restore(result.nextState);
}
function oldAdvance(state: BattleSnapshot, choice: Route1Choice): BattleSnapshot {
  const accepted = old.validateChoice(state, 'player', choice); assert(accepted.accepted);
  const before = structuredClone(state), result = old.advance(state, [accepted.value]);
  assert.deepEqual(result.domainEffects, []); assert.deepEqual(state, before); return result.nextState;
}
async function parent(seed: number, label: string, options: Parameters<typeof createRoute1Initial>[1] = {}) {
  const field = encounters.create({ mainSeed: seed, wildSeed: 0, trainerId: 1 }), generated = field.generate();
  assert(generated.kind === 'encounter'); const pending = field.snapshot(), initial = await createRoute1Initial(pending, options);
  const id = `protect:parent:${label}`;
  return { field, pending, creature: generated.creature,
    state: old.createBattle(route1Config(old, id), initial, makeRoute1Rng(id, initial)) };
}
function settle(session: CaptureSession): void {
  session.advance({ expectedSequence: 0 }); const pending = session.view().pendingNickname; assert(pending);
  session.decideNickname({ expectedSequence: 1, decisionId: pending.decisionId, kind: 'keep-species-name' });
  session.advance({ expectedSequence: 2 });
}
const context = capture.developmentContext({ trainerName: 'RED', trainerGender: 0 });
const fresh = encounters.create({ mainSeed: 0, wildSeed: 0, trainerId: 1 });
assert.equal(fresh.generate().kind, 'encounter'); const freshPending = fresh.snapshot();
async function bridge(session: CaptureSession, terminal: BattleSnapshot, label: string) {
  const checkpoint = session.snapshot(), before = structuredClone(terminal), captured = session.view();
  assert(captured.placement?.kind === 'party' && captured.origin.kind === 'battle-terminal');
  const previous = progression.fromBattle(terminal).view(); assert.equal(previous.phase, 'pending-capture');
  const initial = await createProtectDiagnosticFromCapture(checkpoint, freshPending), prepared = prepareProtect(resources, initial);
  assert.equal(prepared.player.length, 2);
  assert.deepEqual(prepared.player[0], { ...previous.creature, abilityNum: 0, ballItemId: null, metLocation: null });
  const { nature: _nature, gender: _gender, ...caught } = captured.placement.creature;
  assert.deepEqual(prepared.player[1], { ...caught, calculatedEvs: caught.evs,
    ballItemId: captured.metadata.ballItemId, metLocation: captured.metadata.metLocation });
  assert.deepEqual(prepared.context, { inventory: captured.inventory, liveAdmission: false,
    origin: { kind: 'private-capture-proof', captureDigest: checkpoint.digest, battleId: terminal.config.battleId,
      terminalSequence: terminal.transitionSequence, terminalDigest: captured.origin.terminalDigest,
      diagnosticSource: false, ownershipApplication: 'pending' } });
  assert.deepEqual(await createProtectDiagnosticFromCapture(checkpoint, freshPending), initial);
  const id = `protect:bridge:${label}:${handoffs++}`;
  const state = restore(party.createBattle(protectConfig(party, id), initial, makeProtectRng(id, initial)));
  assert.deepEqual(view(state).weather, { kind: 'clear', turnsRemaining: 0 });
  assert.equal(view(state).activeIndex, 0); assert.equal(view(state).phase, 'choice'); assert.equal(view(state).party.length, 2);
  assert.equal(view(state).liveAdmission, false); assert.deepEqual(view(state).inventory, captured.inventory);
  prepared.player.forEach((mon, index) => assert.deepEqual(monWords(state, index), protectCreatureWords(mon)));
  assert.deepEqual(monWords(state, 6), protectCreatureWords(prepared.opponent));
  for (const invalid of [{ kind: 'item', itemId: 13 }, { kind: 'item', itemId: 4 }, { kind: 'switch', partyIndex: 0 },
    { kind: 'switch', partyIndex: 2 }, { kind: 'use-next', decisionId: '0'.repeat(64) }])
    assert.equal(party.validateChoice(state, 'player', invalid as unknown as ProtectChoice).accepted, false);
  assert.throws(() => party.project(state, 'wild'));
  const publicView = JSON.stringify(view(state));
  for (const name of ['personality', 'otId', 'ivs', 'evs', 'calculatedEvs', 'words', 'admission', 'origin', 'terminalDigest', 'captureDigest'])
    assert(!publicView.includes(`"${name}"`), `Private ${name} escaped projection`);
  assert.deepEqual(session.snapshot(), checkpoint); assert.deepEqual(terminal, before); assert.deepEqual(fresh.snapshot(), freshPending);
  return { state, checkpoint, prepared };
}
function pendingChoice(state: BattleSnapshot, kind: 'use-next' | 'attempt-run'): ProtectChoice {
  const pending = view(state).pendingDecision; assert(pending);
  return { kind, decisionId: pending.decisionId } as ProtectChoice;
}
function replacement(state: BattleSnapshot): BattleSnapshot {
  const current = view(state), pending = current.pendingDecision; assert(pending && current.phase === 'replacement');
  const next = current.party.findIndex((mon, index) => mon.hp > 0 && index !== current.activeIndex); assert(next >= 0);
  return advance(state, { kind: 'replace', partyIndex: next, decisionId: pending.decisionId } as ProtectChoice);
}
function finish(input: BattleSnapshot): BattleSnapshot {
  let state = input;
  for (let step = 0; view(state).phase !== 'ended'; step++) {
    assert(step < 240, 'Diagnostic party battle must terminate within the verified bound');
    const current = view(state);
    if (current.phase === 'post-faint') state = advance(state, pendingChoice(state, 'use-next'));
    else if (current.phase === 'replacement') state = replacement(state);
    else {
      const choice = current.availableChoices.find(choice => choice.kind === 'move' || choice.kind === 'struggle' || choice.kind === 'continue-charge'); assert(choice);
      state = advance(state, choice);
    }
  }
  terminalOutcomes.add(view(state).outcome!);
  assert.throws(() => progression.fromBattle(state), 'Legacy progression cannot silently accept multi-party results or apply faint friendship twice');
  assert.throws(() => loss.fromBattle(state, loss.developmentContext()), 'Legacy loss must reject party terminals with already-applied faint friendship');
  assert.throws(() => capture.fromBattle(state, context));
  return state;
}

const naturalCaptures: { slot: number; seed: number; speciesId: number; level: number; outcome: string }[] = [];
let lastSession: CaptureSession | undefined, lastTerminal: BattleSnapshot | undefined;
for (const [slot, seed] of [3, 14, 11, 29, 47, 33, 26, 75, 130, 92, 450, 116].entries()) {
  const trial = await parent(seed, `slot-${slot}`, { hp: 1, inventory: { potion: 0, pokeBall: 1 } });
  assert.equal(trial.creature.slot, slot);
  const terminal = oldAdvance(trial.state, { kind: 'item', itemId: 4 }); assert.equal(oldView(terminal).outcome, 'captured');
  const session = capture.fromBattle(terminal, context);
  await assert.rejects(() => createProtectDiagnosticFromCapture(session.snapshot(), freshPending));
  settle(session); const { state: initial, checkpoint, prepared } = await bridge(session, terminal, `slot-${slot}`);
  const switched = advance(initial, { kind: 'switch', partyIndex: 1 });
  assert.equal(view(switched).activeIndex, 1);
  assert.deepEqual(monWords(switched, 0), protectCreatureWords(prepared.player[0]!));
  assert(monWords(switched, 1)[6]! <= prepared.player[1]!.hp);
  assert.deepEqual(monWords(switched, 1).slice(29, 33), prepared.player[1]!.moves.map(move => move.pp));

  // Independently branch from the original saved boundary. The one-HP starter
  // naturally faints after selecting non-damaging Tail Whip against source AI.
  let fainted = initial;
  for (let turn = 0; view(fainted).phase === 'choice'; turn++) {
    assert(turn < 40); fainted = advance(fainted, { kind: 'move', slot: 1 });
  }
  assert.equal(view(fainted).phase, 'post-faint'); assert.equal(view(fainted).activeIndex, 0);
  assert.equal(monWords(fainted, 0)[6], 0); assert.equal(monWords(fainted, 0)[36], 0);
  assert.equal(monWords(fainted, 0)[5], 69, 'The source small faint penalty applies before replacing, even with a living reserve');
  assert.deepEqual(monWords(fainted, 1), protectCreatureWords(prepared.player[1]!));
  const badDecision = { ...pendingChoice(fainted, 'use-next'), decisionId: '0'.repeat(64) } as ProtectChoice;
  assert.equal(party.validateChoice(fainted, 'player', badDecision).accepted, false);
  const yes = advance(fainted, pendingChoice(fainted, 'use-next')); faintDecisions++;
  assert.equal(view(yes).phase, 'replacement'); assert.deepEqual(yes.rng, fainted.rng, 'Use-next is a decision without a mechanical RNG draw');
  assert.equal(party.validateChoice(yes, 'player', pendingChoice(fainted, 'attempt-run')).accepted, false);
  const resumed = replacement(yes); assert.equal(view(resumed).activeIndex, 1);
  assert.equal(monWords(resumed, 0)[5], 69, 'Replacement must not apply the faint penalty again');
  const ended = finish(resumed);

  const escaped = advance(fainted, pendingChoice(fainted, 'attempt-run')); faintDecisions++;
  if (view(escaped).phase === 'ended') {
    assert.equal(view(escaped).outcome, 'ran'); terminalOutcomes.add('ran');
  } else {
    assert.equal(view(escaped).phase, 'replacement');
    assert.equal(party.validateChoice(escaped, 'player', pendingChoice(escaped, 'attempt-run')).accepted, false,
      'A failed post-faint escape cannot reroll that prompt');
    replacement(escaped);
  }
  assert.deepEqual(session.snapshot(), checkpoint); assert.deepEqual(trial.field.snapshot(), trial.pending);
  naturalCaptures.push({ slot, seed, speciesId: trial.creature.speciesId, level: trial.creature.level, outcome: view(ended).outcome! });
  lastSession = session; lastTerminal = terminal;
}
checks.push('all-twelve-natural-capture-slots-create-one-coherent-two-member-party-proof',
  'switches-preserve-outgoing-hp-pp-and-source-incoming-state',
  'natural-faints-apply-source-friendship-with-a-living-reserve-and-preserve-cleared-status',
  'restored-post-faint-use-next-escape-and-replacement-decisions-are-sequence-fenced',
  'completed-party-outcomes-cannot-enter-legacy-single-party-reward-or-capture-bridges');
assert(lastSession && lastTerminal);

const spentSeed = (JSON.parse(await readFile('reports/battle-capture-integration.json', 'utf8')) as { spentSeed: number }).spentSeed;
const tired = await parent(spentSeed, 'spent-and-tired', { hp: 1, inventory: { potion: 1, pokeBall: 3 } });
let state = oldAdvance(oldAdvance(tired.state, { kind: 'item', itemId: 13 }), { kind: 'move', slot: 0 });
while (oldView(state).phase !== 'ended' && oldView(state).inventory.pokeBall > 0) state = oldAdvance(state, { kind: 'item', itemId: 4 });
assert.equal(oldView(state).outcome, 'captured');
const tiredSession = capture.fromBattle(state, context); settle(tiredSession);
const tiredParty = await bridge(tiredSession, state, 'tired');
assert(tiredParty.prepared.player[0]!.moves[0]!.pp < 35);
assert(tiredParty.prepared.player[1]!.hp < tiredParty.prepared.player[1]!.stats.hp);
assert.equal(tiredParty.prepared.context.inventory!.potion, 0); assert(tiredParty.prepared.context.inventory!.pokeBall < 3);
advance(tiredParty.state, { kind: 'switch', partyIndex: 1 });
const pendingCapture = progression.fromBattle(state), pendingBefore = pendingCapture.snapshot();
const indirect = capture.fromProgression(pendingBefore, context); settle(indirect);
const viaProgression = await bridge(indirect, state, 'via-progression');
assert.deepEqual(viaProgression.prepared.player, tiredParty.prepared.player);
assert.deepEqual(viaProgression.prepared.context.inventory, tiredParty.prepared.context.inventory);
assert.deepEqual(pendingCapture.snapshot(), pendingBefore); assert.deepEqual(tired.field.snapshot(), tired.pending);
checks.push('spent-potion-ball-and-both-depleted-creatures-survive-one-terminal-handoff',
  'direct-and-progression-mediated-capture-proofs-reconstruct-the-same-party');

// These are explicit new diagnostics built from source continuation outputs,
// not ownership or proof-bound capture admissions. The source learning decision
// replaces a chosen slot; the new profile also accepts the branch retaining Protect.
const progressionRows = JSON.parse(await readFile('tools/battle-progression/fixtures/source-cases.json', 'utf8')) as {
  cases: { id: string; initial: ProgressionDiagnostic }[] };
const learnRow = structuredClone(progressionRows.cases.find(row => row.id === 'level-32-to-33-exact-threshold')!);
assert(learnRow); learnRow.initial.creature.hp = learnRow.initial.creature.stats.hp;
const learned = progression.createDiagnostic(learnRow.initial), learnChoice = learned.view().pendingMove; assert(learnChoice);
assert.equal(learnChoice.moveId, 240);
const keepsProtect = progression.restore(learned.snapshot());
keepsProtect.decide({ kind: 'replace-move', slot: 0, decisionId: learnChoice.decisionId });
assert(keepsProtect.view().creature.moves.some(move => move.moveId === 182));
const keepsProtectCreature = { ...keepsProtect.view().creature, abilityNum: 0 as const, ballItemId: null, metLocation: null };
createProtectDiagnostic({ seed: 0, player: [keepsProtectCreature], opponent: tiredParty.prepared.opponent });
assert.throws(() => createChargeDiagnostic({ seed: 0, player: [keepsProtectCreature], opponent: tiredParty.prepared.opponent }));
learned.decide({ kind: 'replace-move', slot: 3, decisionId: learnChoice.decisionId });
assert.equal(learned.view().phase, 'pending-evolution');
const learnedCheckpoint = learned.snapshot(), evolved: ProtectCreature[] = [];
for (const accept of [false, true]) {
  const scene = evolution.fromProgression(learnedCheckpoint, { nickname: 'SQUIRTLE', language: 2,
    targetDex: { seen: false, caught: false }, evolutionStat: 0, canCancel: true });
  const current = scene.view(); assert(current.pendingEvolution);
  scene.decide({ expectedSequence: current.sequence, decisionId: current.pendingEvolution.decisionId,
    kind: accept ? 'accept-evolution' : 'cancel-evolution' });
  assert.equal(scene.view().phase, 'pending-ownership-application');
  assert.equal(scene.view().origin.kind, 'progression-diagnostic');
  const checkpoint = scene.snapshot(); assert.deepEqual(evolution.restore(checkpoint).snapshot(), checkpoint);
  const mon = protectCreatureSchema.parse(scene.view().creature);
  assert.deepEqual(mon.moves.map(move => move.moveId), [55, 44, 229, 240]);
  assert.throws(() => createPartyDiagnostic({ seed: 0, player: [mon], opponent: tiredParty.prepared.opponent }));
  evolved.push(mon); assert.deepEqual(learned.snapshot(), learnedCheckpoint);
}
const rainInput = createProtectDiagnostic({ seed: 0, player: evolved, opponent: tiredParty.prepared.opponent });
let rainState = restore(party.createBattle(protectConfig(party, 'protect:learned-rain'), rainInput,
  makeProtectRng('protect:learned-rain', rainInput)));
assert.deepEqual(raw(rainState).context, { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false });
const rainTrace: number[] = [];
for (const [choice, expected] of [
  [{ kind: 'move', slot: 3 }, 4], [{ kind: 'switch', partyIndex: 1 }, 3],
  [{ kind: 'move', slot: 3 }, 2], [{ kind: 'switch', partyIndex: 0 }, 1],
  [{ kind: 'move', slot: 3 }, 0], [{ kind: 'move', slot: 3 }, 4],
] as [ProtectChoice, number][]) {
  rainState = advance(rainState, choice);
  assert.deepEqual(view(rainState).weather, { kind: expected ? 'rain' : 'clear', turnsRemaining: expected });
  rainTrace.push(expected);
}
assert.equal(view(rainState).party[0]!.moves[3]!.pp, evolved[0]!.moves[3]!.pp - 3);
assert.equal(view(rainState).party[1]!.moves[3]!.pp, evolved[1]!.moves[3]!.pp - 1);
assert.throws(() => retainedParty.restore(rainState));
const legacyInitial = await createProtectDiagnosticFromCapture(tiredSession.snapshot(), freshPending);
assert(legacyInitial.kind === 'capture-proof');
const legacyState = retainedParty.createBattle(partyConfig(retainedParty, 'protect:old-party'), legacyInitial,
  makePartyRng('protect:old-party', legacyInitial));
assert.throws(() => party.restore(legacyState));
rainState = advance(rainState, { kind: 'move', slot: 2 });
finish(rainState);
checks.push('explicit-source-rain-learning-and-evolution-results-remain-unowned-diagnostics',
  'rain-timer-survives-switches-restores-failed-refresh-expiry-and-recast',
  'older-party-profile-rejects-new-moves-and-checkpoint-compatibility-in-both-directions');

const evolutionRows = JSON.parse(await readFile('tools/battle-evolution/fixtures/source-cases.json', 'utf8')) as {
  cases: { id: string; input: { creature: EvolutionCreature & { nature: number; gender: number };
    context: Omit<EvolutionContext, 'targetDex'> & { targetSeen: boolean; targetCaught: boolean } } }[] };
const birdRow = evolutionRows.cases.find(row => row.id === 'level-16-20'); assert(birdRow);
const { nature: _birdNature, gender: _birdGender, ...birdInitial } = birdRow.input.creature;
const { targetSeen, targetCaught, ...birdContext } = birdRow.input.context;
const birdScene = evolution.createDiagnostic({ creature: { ...birdInitial, hp: birdInitial.stats.hp },
  context: { ...birdContext, targetDex: { seen: targetSeen, caught: targetCaught } } });
const birdPending = birdScene.view(); assert(birdPending.pendingEvolution);
birdScene.decide({ expectedSequence: birdPending.sequence, decisionId: birdPending.pendingEvolution.decisionId, kind: 'accept-evolution' });
const birdMove = birdScene.view(); assert.equal(birdMove.phase, 'pending-move'); assert(birdMove.pendingMove);
assert.equal(birdMove.pendingMove.moveId, 18);
birdScene.decide({ expectedSequence: birdMove.sequence, decisionId: birdMove.pendingMove.decisionId, kind: 'replace-move', slot: 0 });
assert.equal(birdScene.view().phase, 'pending-ownership-application');
const bird = protectCreatureSchema.parse(birdScene.view().creature), birdCheckpoint = birdScene.snapshot();
const whirlwindSlot = bird.moves.findIndex(move => move.moveId === 18); assert(whirlwindSlot >= 0);
const forcedExits: { actor: 'player' | 'wild'; outcome: string }[] = [];
for (const actor of ['player', 'wild'] as const) {
  const wildBird = { ...bird, moves: bird.moves.map(move => ({ ...move, pp: move.moveId === 18 ? move.pp : 0 })) };
  const input = createProtectDiagnostic({ seed: 0, player: actor === 'player' ? [bird, evolved[0]!] : [tiredParty.prepared.player[0]!, evolved[0]!],
    opponent: actor === 'player' ? tiredParty.prepared.opponent : wildBird });
  const id = `protect:forced-exit:${actor}`, start = restore(party.createBattle(protectConfig(party, id), input, makeProtectRng(id, input)));
  const ended = advance(start, { kind: 'move', slot: actor === 'player' ? whirlwindSlot : 1 });
  assert.equal(view(ended).outcome, 'forced-escape'); assert.equal(raw(ended).core.words[8], 5);
  assert.equal(view(ended).activeIndex, 0); assert.equal(raw(ended).core.words[148], 0, 'Forced escape does not count as a Run attempt');
  assert.deepEqual(monWords(ended, 1), monWords(start, 1), 'Wild Whirlwind does not shuffle or damage a reserve');
  finish(ended); forcedExits.push({ actor, outcome: view(ended).outcome! });
}
assert.deepEqual(birdScene.snapshot(), birdCheckpoint);
checks.push('source-evolved-whirlwind-ends-either-side-wild-battle-without-party-shuffle-or-rewards');

// Learn Skull Bash through the existing source continuation, including an
// explicit source learning choices. Protect can also be retained in the new
// profile. These diagnostics grant no account ownership.
const skullRow = structuredClone(progressionRows.cases.find(row => row.id === 'level-39-to-40-exact-threshold')!);
assert(skullRow); skullRow.initial.creature.hp = skullRow.initial.creature.stats.hp;
const skullLearning = progression.createDiagnostic(skullRow.initial), skullMove = skullLearning.view().pendingMove;
assert(skullMove && skullMove.moveId === 130);
const skullWrongSlot = progression.restore(skullLearning.snapshot());
skullWrongSlot.decide({ kind: 'replace-move', slot: 0, decisionId: skullMove.decisionId });
const skullAndProtect = { ...skullWrongSlot.view().creature, abilityNum: 0 as const, ballItemId: null, metLocation: null };
createProtectDiagnostic({ seed: 0, player: [skullAndProtect], opponent: tiredParty.prepared.opponent });
assert.throws(() => createChargeDiagnostic({ seed: 0, player: [skullAndProtect], opponent: tiredParty.prepared.opponent }));
skullLearning.decide({ kind: 'replace-move', slot: 2, decisionId: skullMove.decisionId });
assert.equal(skullLearning.view().phase, 'pending-evolution');
const skullLearnedCheckpoint = skullLearning.snapshot(), skullForms: ProtectCreature[] = [];
for (const accept of [false, true]) {
  const scene = evolution.fromProgression(skullLearnedCheckpoint, { nickname: 'SQUIRTLE', language: 2,
    targetDex: { seen: false, caught: false }, evolutionStat: 0, canCancel: true });
  const pending = scene.view(); assert(pending.pendingEvolution);
  scene.decide({ expectedSequence: pending.sequence, decisionId: pending.pendingEvolution.decisionId,
    kind: accept ? 'accept-evolution' : 'cancel-evolution' });
  assert.equal(scene.view().phase, 'pending-ownership-application');
  assert.equal(scene.view().origin.kind, 'progression-diagnostic');
  const saved = scene.snapshot(); assert.deepEqual(evolution.restore(saved).snapshot(), saved);
  const mon = protectCreatureSchema.parse(scene.view().creature);
  assert.equal(mon.level, 40); assert.equal(mon.speciesId, accept ? 8 : 7);
  assert.deepEqual(mon.moves.map(move => move.moveId), [44, 229, 130, 240]);
  assert.throws(() => createTacticsDiagnostic({ seed: 0, player: [mon], opponent: tiredParty.prepared.opponent }));
  skullForms.push(mon);
}
assert.deepEqual(skullLearning.snapshot(), skullLearnedCheckpoint);
const skullInput = createProtectDiagnostic({ seed: 0, player: skullForms, opponent: tiredParty.prepared.opponent });
let skullState = restore(party.createBattle(protectConfig(party, 'protect:learned-skull'), skullInput,
  makeProtectRng('protect:learned-skull', skullInput)));
assert.deepEqual(raw(skullState).context, { inventory: null, origin: { kind: 'diagnostic' }, liveAdmission: false });
skullState = advance(skullState, { kind: 'move', slot: 3 });
assert.deepEqual(view(skullState).weather, { kind: 'rain', turnsRemaining: 4 });
const beforeCharge = skullState, wildBefore = view(beforeCharge).opponent.hpPercent;
skullState = advance(skullState, { kind: 'move', slot: 2 });
const charged = view(skullState), forced = charged.pendingCharge; assert(forced);
assert.equal(charged.self.charging, true); assert.equal(forced.moveId, 130); assert.equal(forced.slot, 2);
assert.equal(charged.opponent.hpPercent, wildBefore, 'Charging does not hit the opponent');
assert.equal(charged.self.stages[2], view(beforeCharge).self.stages[2]! + 1, 'Charging raises source Defense once');
assert.equal(charged.self.moves.find(move => move.moveId === 130)!.pp, skullForms[0]!.moves[2]!.pp - 1);
assert.deepEqual(charged.weather, { kind: 'rain', turnsRemaining: 3 });
assert.deepEqual(charged.availableChoices, [{ kind: 'continue-charge', decisionId: forced.decisionId }]);
const chargedBefore = structuredClone(skullState);
for (const rejected of [{ kind: 'run' }, { kind: 'switch', partyIndex: 1 }, { kind: 'struggle' },
  { kind: 'move', slot: 2 }, { kind: 'continue-charge', decisionId: '0'.repeat(64) }] satisfies ProtectChoice[])
  assert.equal(party.validateChoice(skullState, 'player', rejected).accepted, false);
assert.deepEqual(skullState, chargedBefore);
assert.throws(() => retainedTactics.restore(skullState));
const oldTacticsInitial = createTacticsDiagnostic({ seed: 0, player: evolved, opponent: tiredParty.prepared.opponent });
const oldTacticsState = retainedTactics.createBattle(tacticsConfig(retainedTactics, 'protect:old-tactics'), oldTacticsInitial,
  makeTacticsRng('protect:old-tactics', oldTacticsInitial));
assert.throws(() => party.restore(oldTacticsState));
const released = advance(skullState, { kind: 'continue-charge', decisionId: forced.decisionId });
assert.equal(view(released).outcome, 'won'); assert.equal(view(released).self.charging, false);
assert.equal(view(released).self.moves.find(move => move.moveId === 130)!.pp, charged.self.moves.find(move => move.moveId === 130)!.pp,
  'The forced strike cannot spend PP a second time');
assert.deepEqual(view(released).weather, charged.weather, 'A winning strike skips the field-end rain tick');
assert.equal(party.validateChoice(released, 'player', { kind: 'continue-charge', decisionId: forced.decisionId }).accepted, false);
finish(released);
checks.push('source-skull-bash-learning-and-evolution-results-remain-unowned-diagnostics',
  'charging-preserves-rain-spends-PP-once-and-fences-the-forced-strike',
  'older-tactics-rejects-skull-bash-and-new-checkpoints-in-both-directions');

// A charging wild creature keeps its forced attack while poison faints the
// player's active member. After the replacement decision, its zero-PP strike
// targets the incoming member rather than the fainted creature.
const fragile = { ...tiredParty.prepared.player[0]!, hp: 1, status: 8 as const };
const wildSkull = { ...skullForms[0]!, moves: skullForms[0]!.moves.map(move => ({ ...move, pp: move.moveId === 130 ? 1 : 0 })) };
const wildChargeInput = createProtectDiagnostic({ seed: 0, player: [fragile, skullForms[1]!], opponent: wildSkull });
let wildCharge = restore(party.createBattle(protectConfig(party, 'protect:wild-replacement'), wildChargeInput,
  makeProtectRng('protect:wild-replacement', wildChargeInput)));
wildCharge = advance(wildCharge, { kind: 'move', slot: 1 });
assert.equal(view(wildCharge).phase, 'post-faint'); assert.equal(view(wildCharge).opponent.charging, true);
assert.equal(view(wildCharge).pendingDecision!.resume, 'after-residual');
assert.equal(raw(wildCharge).core.words[189 + 6 * 46 + 2], 0, 'Wild charging consumed its last PP');
const beforeNext = raw(wildCharge).rng;
wildCharge = advance(wildCharge, pendingChoice(wildCharge, 'use-next')); faintDecisions++;
assert.deepEqual(raw(wildCharge).rng, beforeNext, 'Use-next is a decision with no mechanical draw');
wildCharge = replacement(wildCharge);
assert.equal(view(wildCharge).activeIndex, 1); assert.equal(view(wildCharge).opponent.charging, true);
assert.deepEqual(raw(wildCharge).rng, { state: (Math.imul(beforeNext.state, 0x41C64E6D) + 0x6073) >>> 0,
  draws: beforeNext.draws + 1 }, 'Only the source next-turn random number is drawn; locked wild selection adds no AI draw');
const incomingHP = view(wildCharge).self.hp;
wildCharge = advance(wildCharge, { kind: 'move', slot: 3 });
assert(view(wildCharge).self.hp < incomingHP, 'The forced strike hits the incoming living member');
assert.equal(view(wildCharge).opponent.charging, false);
assert.equal(raw(wildCharge).core.words[189 + 6 * 46 + 2], 0);
finish(wildCharge);
checks.push('wild-zero-PP-charge-survives-faint-decisions-and-hits-the-incoming-member-without-AI-reroll');

// Source level-up and either evolution decision preserve the chosen Protect
// slot. These outputs remain unowned diagnostic creatures.
const protectRow = structuredClone(progressionRows.cases.find(row => row.id === 'level-27-to-28-exact-threshold')!);
assert(protectRow); protectRow.initial.creature.hp = protectRow.initial.creature.stats.hp;
const protectLearning = progression.createDiagnostic(protectRow.initial), protectMove = protectLearning.view().pendingMove;
assert(protectMove && protectMove.moveId === 182);
protectLearning.decide({ kind: 'replace-move', slot: 3, decisionId: protectMove.decisionId });
assert.equal(protectLearning.view().phase, 'pending-evolution');
const protectLearnedCheckpoint = protectLearning.snapshot(), protectForms: ProtectCreature[] = [];
for (const accept of [false, true]) {
  const scene = evolution.fromProgression(protectLearnedCheckpoint, { nickname: 'SQUIRTLE', language: 2,
    targetDex: { seen: false, caught: false }, evolutionStat: 0, canCancel: true });
  const pending = scene.view(); assert(pending.pendingEvolution);
  scene.decide({ expectedSequence: pending.sequence, decisionId: pending.pendingEvolution.decisionId,
    kind: accept ? 'accept-evolution' : 'cancel-evolution' });
  assert.equal(scene.view().phase, 'pending-ownership-application');
  assert.equal(scene.view().origin.kind, 'progression-diagnostic');
  const saved = scene.snapshot(); assert.deepEqual(evolution.restore(saved).snapshot(), saved);
  const mon = protectCreatureSchema.parse(scene.view().creature);
  assert.equal(mon.level, 28); assert.equal(mon.speciesId, accept ? 8 : 7);
  assert.deepEqual(mon.moves.map(move => move.moveId), [110, 55, 44, 182]);
  assert.throws(() => createChargeDiagnostic({ seed: 0, player: [mon], opponent: wildSkull }));
  protectForms.push(mon);
}
assert.deepEqual(protectLearning.snapshot(), protectLearnedCheckpoint);
const protectChargeTrace: { speciesId: number; hpBefore: number; hpAfter: number; wildPP: number }[] = [];
for (const [index, mon] of protectForms.entries()) {
  const input = createProtectDiagnostic({ seed: 0, player: [mon, protectForms[1 - index]!], opponent: wildSkull });
  const id = `protect:learned-protect:${index}`;
  let guarded = restore(party.createBattle(protectConfig(party, id), input, makeProtectRng(id, input)));
  guarded = advance(guarded, { kind: 'move', slot: 0 });
  assert.equal(view(guarded).opponent.charging, true);
  const hpBefore = view(guarded).self.hp, protectPP = view(guarded).self.moves.find(move => move.moveId === 182)!.pp;
  guarded = advance(guarded, { kind: 'move', slot: 3 });
  assert.equal(view(guarded).self.hp, hpBefore, 'First Protect blocks the source forced Skull Bash release');
  assert.equal(view(guarded).self.moves.find(move => move.moveId === 182)!.pp, protectPP - 1);
  assert.equal(view(guarded).opponent.charging, false, 'Blocked release clears its source charging lock');
  assert.equal(raw(guarded).core.words[189 + 6 * 46 + 2], 0, 'Blocked release does not spend a second PP');
  assert.equal(raw(guarded).core.words[491], 1, 'First successful Protect retains its private repeat counter');
  assert.equal(view(guarded).self.protected, false, 'Turn cleanup clears protection before the next choice');
  assert.throws(() => retainedCharge.restore(guarded));
  for (const name of ['protectPolicy', 'protectUses', 'lastResultingMove', 'tableSha256'])
    assert(!JSON.stringify(view(guarded)).includes(`"${name}"`), `Private ${name} escaped projection`);
  protectChargeTrace.push({ speciesId: mon.speciesId, hpBefore, hpAfter: view(guarded).self.hp,
    wildPP: raw(guarded).core.words[189 + 6 * 46 + 2]! });
  guarded = advance(guarded, { kind: 'switch', partyIndex: 1 });
  assert.equal(raw(guarded).core.words[491], 0, 'Switch resets the source protection repeat counter');
  finish(guarded);
}
const oldChargeInitial = createChargeDiagnostic({ seed: 0, player: skullForms, opponent: tiredParty.prepared.opponent });
const oldChargeState = retainedCharge.createBattle(chargeConfig(retainedCharge, 'protect:old-charge'), oldChargeInitial,
  makeChargeRng('protect:old-charge', oldChargeInitial));
assert.throws(() => party.restore(oldChargeState));
checks.push('source-protect-learning-and-either-evolution-decision-retain-all-chosen-moves-without-ownership',
  'learned-protect-blocks-zero-PP-charged-release-and-switch-resets-counter',
  'older-charge-profile-rejects-protect-and-new-checkpoints-in-both-directions',
  'repeat-policy-and-source-history-remain-private-through-projection');

const { policy: _policy, ...plainContext } = context;
const creature = lastSession.view().creature; assert(creature);
for (const partyMask of [1, 63]) {
  const diagnostic = capture.createDiagnostic({ creature, context: { ...plainContext, partyMask } }); settle(diagnostic);
  await assert.rejects(() => createProtectDiagnosticFromCapture(diagnostic.snapshot(), freshPending));
}
const forged = lastSession.snapshot(); forged.digest = '0'.repeat(64);
await assert.rejects(() => createProtectDiagnosticFromCapture(forged, freshPending));
await assert.rejects(() => createProtectDiagnosticFromCapture(lastSession.view(), freshPending));
const other = encounters.create({ mainSeed: 0, wildSeed: 0, trainerId: 2 }); assert.equal(other.generate().kind, 'encounter');
await assert.rejects(() => createProtectDiagnosticFromCapture(lastSession.snapshot(), other.snapshot()));
const idle = encounters.create({ mainSeed: 0, wildSeed: 0, trainerId: 1 });
await assert.rejects(() => createProtectDiagnosticFromCapture(lastSession.snapshot(), idle.snapshot()));
assert.deepEqual(profile, retainedProfile); assert.deepEqual(fresh.snapshot(), freshPending);
checks.push('diagnostic-boxed-unsettled-forged-and-unbound-capture-results-rejected',
  'fresh-encounter-identity-and-pending-source-proofs-preserved',
  'owner-projection-excludes-hidden-source-identity-and-checkpoint-provenance');

const earlier = JSON.parse(await readFile('reports/twentythird-battle-charge-integration.json', 'utf8')) as { retainedPins: Record<string, string> };
const retainedPins = { ...earlier.retainedPins,
  '.local/battle-charge/primary/charge.wasm': 'c2d5ac7786979cf0288ab624f5c8a7b81516c7c34458ceddd54923de99541151',
  'tools/battle-charge/fixtures/source-cases.json': '167b44266ca4b5d2bfffd9f9919d6d9b7ab60dc92688bb7ca7ca98e96e3cd54c' };
for (const [path, expected] of Object.entries(retainedPins))
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), expected, `Retained bytes changed: ${path}`);
checks.push('eleven-prior-artifacts-and-3382-retained-literal-cases-byte-identical');
await writeFile('reports/battle-protect-integration.json', JSON.stringify({ checkedAt: new Date().toISOString(), status: 'passed',
  scope: 'Actual private capture proofs feed diagnostic party battles only. No account ownership, field acknowledgement, live admission or database mutation.',
  checks, handoffs, restoredBoundaries, diagnosticTransitions, faintDecisions, naturalCaptures, rainTrace, forcedExits, protectChargeTrace,
  terminalOutcomes: [...terminalOutcomes].sort(), retainedPins, compatibility: party.compatibility,
  remaining: ['Pursuit and Mirror Move', 'complete resulting-team admission', 'durable ownership and party rewards', 'live battle presentation'] }, null, 2) + '\n');
console.log(`Protect integration passed: ${checks.length} groups, ${handoffs} handoffs, ${restoredBoundaries} restores, ${diagnosticTransitions} transitions.`);
