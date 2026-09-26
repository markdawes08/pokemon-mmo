/** Source-derived turn transcripts plus boundary/isolation checks for batch two. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { initializeProbe, instantiateProbe, loadProbeModule, statusOk } from './probe';
import { TurnProbe, stepSchema, turnInputSchema, type TurnExports } from './turn-probe';

const fixtureSchema = z.object({
  schemaVersion: z.literal(1), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ id: z.string().min(1), initial: turnInputSchema,
    expectedInitial: z.object({ state: z.unknown() }),
    steps: z.array(z.object({ input: stepSchema, expected: z.object({ state: z.unknown(), goldenEvents: z.unknown() }) })).nonempty(),
  })).nonempty(),
});
const fixtureBytes = await readFile('tools/battle-spike/fixtures/batch-2.json');
const fixture = fixtureSchema.parse(JSON.parse(fixtureBytes.toString('utf8')));
const build = JSON.parse(await readFile('reports/battle-spike-build.json', 'utf8'));
assert.equal(fixture.sourceFingerprint, build.extraction.sourceFingerprint);
assert.equal(new Set(fixture.cases.map(row => row.id)).size, fixture.cases.length, 'Duplicate transcript identifiers');
const module = await loadProbeModule();
const observations = [];
for (const row of fixture.cases) {
  const battle = new TurnProbe(module, row.initial);
  const repeated = new TurnProbe(module, row.initial);
  assert.deepEqual(battle.inspect(), row.expectedInitial.state, `${row.id}: initial state`);
  const steps = [];
  for (const [index, step] of row.steps.entries()) {
    const result = battle.advance(step.input);
    assert.deepEqual(result.state, step.expected.state, `${row.id}, step ${index}: source state`);
    assert.deepEqual(result.events, step.expected.goldenEvents, `${row.id}, step ${index}: source events`);
    assert.deepEqual(repeated.advance(step.input), result, `${row.id}, step ${index}: repeated battle`);
    steps.push(result);
  }
  observations.push({ id: row.id, status: 'passed', steps });
}

// Interleave every scenario, including paused replacements, against its golden
// independent run. A rejected choice in one battle cannot alter its peers.
const interleaved = fixture.cases.map(row => new TurnProbe(module, row.initial));
const maxSteps = Math.max(...fixture.cases.map(row => row.steps.length));
let interleavedSteps = 0;
for (let index = 0; index < maxSteps; index++) {
  for (const [caseIndex, row] of fixture.cases.entries()) {
    const step = row.steps[index];
    if (!step) continue;
    const battle = interleaved[caseIndex]!;
    const peers = interleaved.map(instance => instance.inspect());
    assert.throws(() => battle.advance({ kind: 'turn', choices: [{ kind: 'move', slot: 99 }, { kind: 'move', slot: 0 }] }));
    assert.deepEqual(interleaved.map(instance => instance.inspect()), peers, 'Invalid choices mutate no battle');
    assert.deepEqual(battle.advance(step.input), observations[caseIndex]!.steps[index], `${row.id} interleaved ${index}`);
    interleavedSteps++;
  }
}

const first = fixture.cases[0]!;
const boundary = new TurnProbe(module, first.initial);
const initial = boundary.inspect();
const badChoices = [
  { kind: 'turn', choices: [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], seed: 7 },
  { kind: 'turn', choices: [{ kind: 'switch', partyIndex: 0 }, { kind: 'move', slot: 0 }] },
  { kind: 'replace', choices: [null, null] },
  { kind: 'turn', choices: [{ kind: 'item', item: 13 }, { kind: 'move', slot: 0 }] },
  { kind: 'turn', choices: [{ kind: 'move', slot: -1 }, { kind: 'move', slot: 0 }] },
];
for (const choice of badChoices) {
  assert.throws(() => boundary.advance(choice));
  assert.deepEqual(boundary.inspect(), initial, 'Rejected choice preserves full observed state and RNG');
}
const leaked = boundary.inspect();
leaked.active[0] = 99;
leaked.parties[0]![0]!.hp = 0;
leaked.parties[0]![0]!.stages[1] = 0;
assert.deepEqual(boundary.inspect(), initial, 'Returned observations never alias owned state');

const zeroPP = structuredClone(first.initial);
zeroPP.parties[0][0]!.moves[0]!.pp = 0;
const noPPBattle = new TurnProbe(module, zeroPP);
const noPPBefore = noPPBattle.inspect();
assert.throws(() => noPPBattle.advance({ kind: 'turn', choices: [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }] }));
assert.deepEqual(noPPBattle.inspect(), noPPBefore, 'Zero PP does not consume RNG or a turn');

const badInputs = [
  { ...first.initial, seed: -1 }, { ...first.initial, weather: 1 },
  { ...first.initial, parties: [first.initial.parties[0]] },
];
for (const input of badInputs) assert.throws(() => new TurnProbe(module, input));
for (const edit of [
  (input: typeof first.initial) => { input.parties[0][0]!.moves[0]!.move = 52 as 33; },
  (input: typeof first.initial) => { input.parties[0][0]!.moves[0]!.pp = 99; },
  (input: typeof first.initial) => { input.parties[0][0]!.type1 = 9; },
  (input: typeof first.initial) => { input.parties[0][0]!.status1 = 64 as 0; },
  (input: typeof first.initial) => { input.parties[0][0]!.defense = 0; },
]) {
  const input = structuredClone(first.initial); edit(input);
  assert.throws(() => new TurnProbe(module, input));
}
let terminalGuards = 0;
let replacementGuards = 0;
for (const row of fixture.cases) {
  const battle = new TurnProbe(module, row.initial);
  for (const step of row.steps) {
    const result = battle.advance(step.input);
    if (result.state.phase === 'ended') {
      assert.throws(() => battle.advance(step.input), /already ended/);
      assert.deepEqual(battle.inspect(), result.state);
      terminalGuards++;
    } else if (result.state.phase === 'replacement') {
      assert.throws(() => battle.advance({ kind: 'turn', choices: [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }] }), /phase/);
      assert.throws(() => battle.advance({ kind: 'replace', choices: [null, null] }));
      assert.deepEqual(battle.inspect(), result.state);
      replacementGuards++;
    }
  }
}
assert.ok(terminalGuards >= 2, 'Win and loss transcripts must reach terminal guards');
assert.ok(replacementGuards >= 2, 'Both replacement phases need transcript coverage');

const raw = instantiateProbe(module) as TurnExports;
for (const call of [() => raw.spike2_attack(0, 0), () => raw.spike2_begin_turn(), () => raw.spike2_set_speed(0, 10),
  () => raw.spike2_set_status(0, 8), () => raw.spike2_switch_cleanup(0), () => raw.spike2_residual(0)]) assert.equal(call(), 3);
const oldFixtures = JSON.parse(await readFile('tools/battle-spike/fixtures/batch-1.json', 'utf8'));
initializeProbe(raw, oldFixtures.cases[0].input);
for (const actor of [0, 1]) {
  statusOk(raw.spike2_set_speed(actor, 10 + actor), 'raw speed setup');
  statusOk(raw.spike2_set_move(actor, 0, 33, 35), 'raw move setup');
  statusOk(raw.spike2_set_party(actor, 0, 1, 40, 0), 'raw party setup');
}
const observeRaw = () => ({ rng: raw.spike_get_rng() >>> 0, outcome: raw.spike2_get_outcome(),
  battlers: [0, 1].map(actor => ({ fields: Array.from({ length: 8 }, (_, field) => raw.spike_get_battler(actor, field)),
    stages: Array.from({ length: 8 }, (_, stat) => raw.spike2_get_stage(actor, stat)),
    moves: Array.from({ length: 4 }, (_, slot) => [raw.spike2_get_move(actor, slot, 0), raw.spike2_get_move(actor, slot, 1)]),
    party: Array.from({ length: 6 }, (_, slot) => [0, 1, 2].map(field => raw.spike2_get_party(actor, slot, field))) })),
  events: Array.from({ length: raw.spike_get_result(11) }, (_, index) => [0, 1, 2].map(field => raw.spike_get_event(index, field))) });
const cRejections = [
  { id: 'actor-outside-singles', call: () => raw.spike2_set_speed(2, 10), status: 1 },
  { id: 'zero-speed', call: () => raw.spike2_set_speed(0, 0), status: 1 },
  { id: 'unused-hp-stage', call: () => raw.spike2_set_stage(0, 0, 7), status: 2 },
  { id: 'stage-overflow', call: () => raw.spike2_set_stage(0, 1, 13), status: 1 },
  { id: 'unsupported-paralysis', call: () => raw.spike2_set_status(0, 64), status: 2 },
  { id: 'unsupported-ember', call: () => raw.spike2_set_move(0, 0, 52, 25), status: 2 },
  { id: 'move-slot-overflow', call: () => raw.spike2_set_move(0, 4, 33, 35), status: 1 },
  { id: 'pp-above-source-base', call: () => raw.spike2_set_move(0, 0, 33, 36), status: 1 },
  { id: 'order-slot-overflow', call: () => raw.spike2_order(0, 5), status: 1 },
  { id: 'attack-slot-overflow', call: () => raw.spike2_attack(0, 4), status: 1 },
  { id: 'empty-move-slot', call: () => raw.spike2_attack(0, 1), status: 2 },
  { id: 'living-mon-faint', call: () => raw.spike2_faint_cleanup(0), status: 1 },
  { id: 'party-side-overflow', call: () => raw.spike2_set_party(2, 0, 1, 40, 0), status: 1 },
  { id: 'party-slot-overflow', call: () => raw.spike2_set_party(0, 6, 1, 40, 0), status: 1 },
  { id: 'party-HP-sum-overflow', call: () => raw.spike2_set_party(0, 1, 1, 65535, 0), status: 1 },
];
for (const row of cRejections) {
  const before = observeRaw();
  assert.equal(row.call(), row.status, row.id);
  assert.deepEqual(observeRaw(), before, `${row.id}: no HP, status, stages, moves, party, RNG or events changed`);
}
statusOk(raw.spike_set_battler(1, 5, 1, 40, 12, 9, 13, 8, 0, 0, 0, 0), 'faint boundary target');
statusOk(raw.spike2_set_move(0, 0, 55, 25), 'certain accuracy boundary move');
statusOk(raw.spike2_attack(0, 0), 'HP zero boundary attack');
assert.equal(raw.spike_get_battler(1, 0), 0);
for (const call of [() => raw.spike2_begin_turn(), () => raw.spike2_residual(1), () => raw.spike2_attack(1, 0)]) {
  const before = observeRaw();
  assert.equal(call(), 3, 'HP zero must reject before source mutations');
  assert.deepEqual(observeRaw(), before);
}
statusOk(raw.spike2_faint_cleanup(1), 'source faint boundary cleanup');
statusOk(raw.spike2_set_party(1, 0, 1, 0, 0), 'terminal party projection');
statusOk(raw.spike2_check_teams_lost(), 'terminal source outcome');
assert.equal(raw.spike2_get_outcome(), 1);
const terminalCalls = [
  () => raw.spike2_begin_turn(), () => raw.spike2_order(0, 0), () => raw.spike2_residual_order(),
  () => raw.spike2_attack(0, 0), () => raw.spike2_set_status(0, 8), () => raw.spike2_set_speed(0, 20),
  () => raw.spike2_set_stage(0, 1, 7), () => raw.spike2_set_move(0, 0, 33, 35),
  () => raw.spike2_set_party(1, 0, 1, 40, 0), () => raw.spike2_switch_cleanup(0), () => raw.spike2_residual(0),
  () => raw.spike_set_battler(1, 5, 40, 40, 12, 9, 13, 8, 0, 0, 0, 0), () => raw.spike_set_stage(0, 1, 7),
  () => raw.spike_damage(33, 1),
];
for (const call of terminalCalls) {
  const before = observeRaw();
  assert.equal(call(), 3, 'Terminal gameplay mutations require an explicit reset');
  assert.deepEqual(observeRaw(), before);
}

// Inject a transport failure after the real C attack mutates its scratch
// instance. This is fault injection, not a claimed failure in the source game.
let sourceMutated = false;
const atomic = new TurnProbe(module, first.initial, module => {
  const api = instantiateProbe(module) as TurnExports;
  return { ...api, spike2_attack(actor, slot) {
    statusOk(api.spike2_attack(actor, slot), 'real attack before injected fault');
    sourceMutated = true;
    throw new Error('Injected transport failure after C mutation');
  } };
});
const beforeFault = atomic.inspect();
assert.throws(() => atomic.advance({ kind: 'turn', choices: [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }] }), /Injected transport failure/);
assert.equal(sourceMutated, true);
assert.deepEqual(atomic.inspect(), beforeFault, 'Failed source command must not commit partially consumed PP/RNG or HP');

const report = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed', batch: 2,
  scope: 'Private synthetic singles, two party members per side; source commands with bounded host turn scheduling, not a production BattleEngine',
  sourceFingerprint: fixture.sourceFingerprint, wasmSha256: build.wasmSha256,
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  transcripts: observations, interleavedBattles: interleaved.length, interleavedSteps, terminalGuards, replacementGuards,
  cRejections: cRejections.map(({ id }) => ({ id, status: 'passed' })), postMutationInjectedFaultAtomicity: 'passed',
  rawFaintedGuards: 3, rawTerminalGuards: terminalCalls.length,
  checks: ['independent-source-turn-transcripts', 'same-seed-repeatability', 'expanded-state-interleaving', 'ordered-controller-events',
    'source-order-and-RNG-boundaries', 'invalid-choice-no-state-change', 'faint-replacement-phases', 'terminal-state-guards', 'returned-state-does-not-alias',
    'raw-C-admission-guards', 'injected-post-mutation-transport-fault-does-not-commit'],
  remaining: ['production BattleEngine adapter and selected approach', 'portable versioned snapshot/restore and deterministic replay gate',
    'full-path resource measurements', 'real species/abilities/items and R1 dependency closure',
    'experience/capture/inventory/save domain effects and persistence', 'battle UI and server-authoritative encounter integration'],
};
await writeFile('reports/battle-spike-batch-2.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, transcripts: observations.length, interleavedBattles: interleaved.length,
  interleavedSteps, terminalGuards, replacementGuards, cRejections: cRejections.length }));
