/** Real C/WASM boundary verification against independent source literals. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkpointDigest, instantiateRawEncounter, loadEncounterCore, type EncounterCheckpoint } from './encounter';
import { assertOracleCreature, assertOracleWords, checkTrace, jump, stepInput,
  type Fixtures, type RecoveryJob } from './verify-support';

async function child(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const processChild = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const output: Buffer[] = [], errors: Buffer[] = [];
    const timer = setTimeout(() => { processChild.kill(); reject(new Error('Encounter verification child exceeded sixty seconds')); }, 60_000);
    processChild.stdout.on('data', value => output.push(Buffer.from(value)));
    processChild.stderr.on('data', value => errors.push(Buffer.from(value)));
    processChild.on('error', error => { clearTimeout(timer); reject(error); });
    processChild.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Encounter verification child failed (${code}): ${Buffer.concat(errors).toString('utf8')}`));
      else resolve(Buffer.concat(output).toString('utf8'));
    });
    processChild.stdin.on('error', error => { processChild.kill(); clearTimeout(timer); reject(error); });
    processChild.stdin.end(input);
  });
}

const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
await child(python, ['tools/encounter-core/fixtures/generate_fixtures.py', '--check']);
const fixtureBytes = await readFile('tools/encounter-core/fixtures/source-cases.json');
const fixtures = JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
assert.equal(fixtures.schemaVersion, 1);
const core = await loadEncounterCore();
const rebuilt = await loadEncounterCore({ wasmPath: '.local/encounter-core/rebuild/encounter.wasm' });
assert.equal(fixtures.sourceFingerprint, core.compatibility.sourceFingerprint);
assert.deepEqual(rebuilt.compatibility, core.compatibility);
assert.deepEqual(WebAssembly.Module.imports(core.module), []);
const jobs: RecoveryJob[] = [];
let goldenBoundaries = 0, stepOperations = 0, checkedDraws = 0;
const slots = new Set<number>(), natures = new Set<number>(), abilities = new Set<number>();

for (const row of fixtures.factoryCases) {
  const initial = structuredClone(row.initial);
  const factory = core.create(initial);
  assert.deepEqual(initial, row.initial, `${row.id}: seed input unchanged`);
  const result = factory.generate();
  assert.equal(result.kind, 'encounter');
  if (result.kind !== 'encounter') throw new Error('Expected real creature');
  assertOracleCreature(result.creature, row.expected, row.id);
  assertOracleWords(factory.snapshot().words, row.state, row.initial.trainerId, row.expected, row.id);
  checkTrace(row.trace, row.initial.mainSeed, 0);
  checkedDraws += row.trace.length;
  assert.equal(row.trace.at(-1)?.role, 'held-item-even-when-both-none');
  assert.equal(row.trace.filter(draw => draw.role === 'held-item-even-when-both-none').length, 1);
  assert.equal(row.state.main.draws, 6 + 2 * row.expected.personalityAttempts, 'slot, level, nature, personality pairs, two IVs and held item');
  assert.equal(row.state.wild.draws, 0, 'Direct diagnostic generation does not roll encounter eligibility');
  slots.add(result.creature.slot); natures.add(result.creature.nature); abilities.add(result.creature.abilityId);
  const snapshot = factory.snapshot();
  assert.deepEqual(rebuilt.restore(snapshot).snapshot(), snapshot, `${row.id}: independent build restore`);
  jobs.push({ id: row.id, snapshot: structuredClone(snapshot), expected: row.state, trainerId: row.initial.trainerId,
    creature: row.expected, remaining: [] });
  goldenBoundaries++;
  const before = factory.snapshot();
  assert.throws(() => factory.generate(), /Pending encounter/);
  assert.throws(() => factory.step({ behavior: 'grass', movement: 'walk' }), /Pending encounter/);
  assert.deepEqual(factory.snapshot(), before, 'Pending encounter cannot reroll');
  result.creature.hp = 0;
  const view = factory.view(); view.creature!.ivs.hp = 99;
  snapshot.words[1] = 0;
  assert.deepEqual(factory.snapshot(), before, 'Result, view and snapshot are detached');
  factory.continueAfterEncounter();
  const continued = factory.snapshot();
  assert.equal(continued.phase, 'ready');
  assert.deepEqual(continued.words, before.words, 'Explicit continuation consumes no RNG or changes creature');
  assert.throws(() => factory.continueAfterEncounter(), /No pending encounter/);
}
assert.deepEqual([...slots].sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index));
assert.deepEqual([...natures].sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index));
assert.deepEqual([...abilities].sort((a, b) => a - b), [50, 51, 62]);
const shiny = fixtures.factoryCases.find(row => row.id === 'shiny-player-ot-no-additional-draw')!;
assert.equal(shiny.expected.otId ^ shiny.expected.personality, 0, 'Player OT can produce a shiny without extra draws');

for (const row of fixtures.stepCases) {
  const factory = core.create(row.initial);
  let mainState = row.initial.mainSeed, mainCount = 0, wildState = row.initial.wildSeed, wildCount = 0;
  for (const [index, step] of row.steps.entries()) {
    if (factory.view().phase === 'pending-encounter') factory.continueAfterEncounter();
    const input = stepInput(step), beforeInput = structuredClone(input);
    const before = factory.snapshot();
    const running = core.restore(before);
    const result = factory.step(input);
    assert.deepEqual(input, beforeInput, 'Step input remains unchanged');
    assert.deepEqual(running.step({ ...input, movement: 'run' }), result, 'Walking and running use the same source step rule');
    assert.deepEqual(running.snapshot(), factory.snapshot(), 'Movement animation mode does not alter encounter RNG');
    assert.equal(result.kind, step.creature ? 'encounter' : 'none', `${row.id}/${index}: outcome`);
    if (step.creature && result.kind === 'encounter') assertOracleCreature(result.creature, step.creature, row.id);
    if (result.kind === 'none') assert.deepEqual(factory.snapshot().words.slice(12), before.words.slice(12),
      `${row.id}/${index}: no encounter retains the prior creature projection, including an empty initial state`);
    assertOracleWords(factory.snapshot().words, step.state, row.initial.trainerId, step.creature, `${row.id}/${index}`);
    checkTrace(step.mainTrace, mainState, mainCount); checkTrace(step.wildTrace, wildState, wildCount);
    mainState = step.state.main.state; mainCount = step.state.main.draws;
    wildState = step.state.wild.state; wildCount = step.state.wild.draws;
    checkedDraws += step.mainTrace.length + step.wildTrace.length;
    const snapshot = factory.snapshot();
    assert.deepEqual(rebuilt.restore(snapshot).snapshot(), snapshot, 'Every step boundary restores across equal independent builds');
    if ([0, Math.floor(row.steps.length / 2), row.steps.length - 1].includes(index)) {
      jobs.push({ id: `${row.id}@${index + 1}`, snapshot, expected: step.state, trainerId: row.initial.trainerId,
        creature: step.creature, remaining: row.steps.slice(index + 1) });
    }
    goldenBoundaries++; stepOperations++;
  }
}

// Interleave independent instances and rejected calls. No shared RNG, creature,
// cooldown, trainer identity or pending phase is allowed between factories.
const peers = fixtures.stepCases.slice(0, 5).map(row => ({ row, factory: core.create(row.initial) }));
let interleavedSteps = 0;
for (let index = 0; index < Math.max(...peers.map(peer => peer.row.steps.length)); index++) {
  for (const peer of peers) {
    const step = peer.row.steps[index]; if (!step) continue;
    const otherBefore = peers.filter(other => other !== peer).map(other => other.factory.snapshot());
    if (peer.factory.view().phase === 'pending-encounter') peer.factory.continueAfterEncounter();
    const before = peer.factory.snapshot();
    assert.throws(() => peer.factory.step({ behavior: 'water', movement: 'walk' }));
    assert.deepEqual(peer.factory.snapshot(), before);
    peer.factory.step(stepInput(step));
    assertOracleWords(peer.factory.snapshot().words, step.state, peer.row.initial.trainerId, step.creature, 'interleaved');
    assert.deepEqual(peers.filter(other => other !== peer).map(other => other.factory.snapshot()), otherBefore);
    interleavedSteps++;
  }
}

const pristine = core.create(fixtures.factoryCases[0]!.initial);
const readySnapshot = pristine.snapshot();
const invalidSeeds = [
  { ...readySnapshot.initialSeeds, mainSeed: -1 }, { ...readySnapshot.initialSeeds, mainSeed: 0.5 },
  { ...readySnapshot.initialSeeds, mainSeed: 0x100000000 }, { ...readySnapshot.initialSeeds, wildSeed: 65536 },
  { ...readySnapshot.initialSeeds, trainerId: -1 }, { ...readySnapshot.initialSeeds, ability: 0 },
];
for (const input of invalidSeeds) assert.throws(() => core.create(input), 'Unsupported seed/environment shape');
const invalidSteps = [
  { behavior: 'water', movement: 'walk' }, { behavior: 'grass', movement: 'bike' },
  { behavior: 'grass', movement: 'walk', seed: 1 }, { behavior: 'grass', movement: 'walk', x: 12 },
];
for (const input of invalidSteps) {
  assert.throws(() => pristine.step(input)); assert.deepEqual(pristine.snapshot(), readySnapshot);
}
const pendingFactory = core.restore(readySnapshot); pendingFactory.generate();
const pendingSnapshot = pendingFactory.snapshot();
function resign(snapshot: EncounterCheckpoint): EncounterCheckpoint {
  const { digest: _digest, ...body } = snapshot;
  return { ...body, digest: checkpointDigest(body) };
}
const rejected: string[] = [];
function rejectSnapshot(id: string, value: unknown): void {
  const unchanged = structuredClone(value);
  assert.throws(() => core.restore(value), id);
  assert.deepEqual(value, unchanged, `${id}: rejected input unchanged`);
  assert.deepEqual(pristine.snapshot(), readySnapshot, `${id}: unrelated accepted state unchanged`);
  rejected.push(id);
}
rejectSnapshot('extra-hidden-envelope-field', { ...readySnapshot, hidden: {} });
rejectSnapshot('wrong-digest', { ...readySnapshot, digest: '0'.repeat(64) });
rejectSnapshot('missing-digest', { ...readySnapshot, digest: undefined });
for (const key of ['profile', 'sourceFingerprint', 'wasmSha256', 'hostSha256'] as const) {
  const altered = structuredClone(readySnapshot);
  (altered.compatibility as Record<string, unknown>)[key] = key === 'profile' ? 'other-profile' : '0'.repeat(64);
  rejectSnapshot(`wrong-${key}`, resign(altered));
}
for (const [id, edit] of [
  ['main-state', (s: EncounterCheckpoint) => { s.words[1] ^= 1; }],
  ['wild-state', (s: EncounterCheckpoint) => { s.words[2] ^= 1; }],
  ['main-draw-count', (s: EncounterCheckpoint) => { s.words[3]++; }],
  ['wild-draw-count', (s: EncounterCheckpoint) => { s.words[4]++; }],
  ['trainer-binding', (s: EncounterCheckpoint) => { s.words[10]++; }],
  ['unsupported-wrapper-previous-behavior', (s: EncounterCheckpoint) => { s.words[5] = 1; }],
  ['missing-pending-creature', (s: EncounterCheckpoint) => { s.phase = 'pending-encounter'; }],
  ['negative-word', (s: EncounterCheckpoint) => { s.words[0] = -1; }],
  ['fractional-word', (s: EncounterCheckpoint) => { s.words[0] = 0.5; }],
  ['overflow-word', (s: EncounterCheckpoint) => { s.words[0] = 0x100000000; }],
  ['truncated-state', (s: EncounterCheckpoint) => { s.words.pop(); }],
  ['trailing-state', (s: EncounterCheckpoint) => { s.words.push(0); }],
] as const) {
  const altered = structuredClone(readySnapshot); edit(altered); rejectSnapshot(id, resign(altered));
}
for (const [id, index] of [['pending-buff', 6], ['pending-cooldown', 7]] as const) {
  const altered = structuredClone(pendingSnapshot); altered.words[index] = 1;
  rejectSnapshot(id, resign(altered));
}
const semanticEdits: [string, number, number][] = [
  ['abi', 0, 2], ['behavior', 5, 512], ['buff', 6, 65536], ['cooldown', 7, 7],
  ['unsupported-ability-effect', 8, 1], ['unsupported-held-item', 9, 1],
  ['serial-presence', 11, 0], ['present', 12, 2], ['slot', 13, 12], ['species', 14, 7],
  ['slot-species', 13, pendingSnapshot.words[13] ^ 1], ['level', 15, 1],
  ['slot-level', 15, pendingSnapshot.words[15] === 3 ? 4 : 3],
  ['nature', 17, (pendingSnapshot.words[17] + 1) % 25], ['ability', 18, 0],
  ['ability-number', 19, pendingSnapshot.words[19] ^ 1], ['gender', 20, 1],
  ['creature-ot', 21, pendingSnapshot.words[21] ^ 1], ['iv', 22, 32],
  ['stat', 28, pendingSnapshot.words[28] + 1], ['hp', 34, 0], ['experience', 35, 999],
  ['friendship', 36, 0], ['status', 37, 8], ['held-item', 38, 13],
  ['move', 39, 55 | 25 << 16], ['move-pp', 39, 33 | 36 << 16], ['pp-ups', 39, 33 | 35 << 16 | 1 << 24],
  ['reserved', 43, 1],
];
for (const [id, index, value] of semanticEdits) {
  const altered = structuredClone(pendingSnapshot); altered.words[index] = value;
  rejectSnapshot(`recomputed-digest-${id}`, resign(altered));
}
for (const value of [null, [], false, 'checkpoint', 0]) rejectSnapshot('non-object', value);

// Correct private handcrafted states are valid; a digest is neither a signature
// nor proof that an encounter occurred. Exercise bounded counter exhaustion
// through mathematically consistent histories, without billions of real draws.
const exhaustion: string[] = [];
for (const [stream, stateIndex, countIndex, addend] of [['main', 1, 3, 24691], ['wild', 2, 4, 12345]] as const) {
  for (const margin of stream === 'main' ? [0, 1, 2] : [0]) {
    const crafted = structuredClone(readySnapshot);
    const count = 0xFFFFFFFF - margin;
    crafted.words[countIndex] = count;
    crafted.words[stateIndex] = jump(stream === 'main' ? crafted.initialSeeds.mainSeed : crafted.initialSeeds.wildSeed, count, addend);
    crafted.words[5] = 2; crafted.words[7] = 6;
    const factory = core.restore(resign(crafted)), before = factory.snapshot();
    assert.throws(() => stream === 'main' ? factory.generate() : factory.step({ behavior: 'grass', movement: 'walk' }));
    assert.deepEqual(factory.snapshot(), before, `${stream}: candidate traps do not publish partial source mutations`);
    exhaustion.push(`${stream}-uint32-minus-${margin}`);
  }
}
const serialLimit = structuredClone(pendingSnapshot);
serialLimit.words[11] = 0xFFFFFFFF; serialLimit.phase = 'ready';
const exhaustedSerial = core.restore(resign(serialLimit)), beforeSerial = exhaustedSerial.snapshot();
assert.throws(() => exhaustedSerial.generate());
assert.throws(() => exhaustedSerial.step({ behavior: 'plain', movement: 'walk' }));
assert.deepEqual(exhaustedSerial.snapshot(), beforeSerial); exhaustion.push('serial-uint32');

const raw = instantiateRawEncounter(core.module);
assert.equal(raw.encounter_step(0), -3); assert.equal(raw.encounter_generate(), -3);
assert.equal(raw.encounter_state_get(0) >>> 0, 0xFFFFFFFF);
assert.equal(raw.encounter_creature_get(0) >>> 0, 0xFFFFFFFF);
assert.equal(raw.encounter_reset(1, 0x10000, 1), -1);
assert.equal(raw.encounter_reset(1, 0, 1), 0);
assert.equal(raw.encounter_generate(), 1);
const rawWords = () => Array.from({ length: 44 }, (_, index) => raw.encounter_state_get(index) >>> 0);
const rawBefore = rawWords();
let rawRejected = 0;
for (const [id, index, value] of semanticEdits) {
  const altered = [...rawBefore];
  // Use independent malformed scalars, retaining this raw instance's trainer.
  if (id === 'slot-species') altered[index] ^= 1;
  else if (id === 'slot-level') altered[index] = altered[index] === 3 ? 4 : 3;
  else if (id === 'nature') altered[index] = (altered[index] + 1) % 25;
  else if (id === 'ability-number' || id === 'creature-ot') altered[index] ^= 1;
  else if (id === 'stat') altered[index]++;
  else altered[index] = value;
  raw.encounter_import_begin(); altered.forEach((word, offset) => assert.equal(raw.encounter_import_set(offset, word), 0));
  assert.notEqual(raw.encounter_import_commit(), 0, `raw ${id}`);
  assert.deepEqual(rawWords(), rawBefore, `raw ${id}: import rejection preserves accepted state`); rawRejected++;
}
raw.encounter_import_begin();
assert.equal(raw.encounter_import_set(0, 1), 0); assert.notEqual(raw.encounter_import_set(0, 1), 0);
assert.notEqual(raw.encounter_import_set(44, 0), 0); assert.notEqual(raw.encounter_import_commit(), 0);
assert.deepEqual(rawWords(), rawBefore); rawRejected += 3;
for (const attributes of [0x02000002, 0x01000000, 0x07000002]) {
  assert.equal(raw.encounter_step(attributes), -1); assert.deepEqual(rawWords(), rawBefore); rawRejected++;
}

const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./recovery-worker.ts', import.meta.url))],
  JSON.stringify({ parentPid: process.pid, wasmPath: '.local/encounter-core/rebuild/encounter.wasm', jobs }))) as {
    status: string; pid: number; results: { id: string; transitions: number }[];
  };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid);
assert.deepEqual(worker.results.map(row => row.id), jobs.map(row => row.id));
const checkedAt = new Date().toISOString();
await writeFile('reports/encounter-core-recovery.json', `${JSON.stringify({ schemaVersion: 1, status: 'passed', checkedAt,
  scope: 'Private factory logical checkpoints; no database, live room, or cross-version migration',
  goldenBoundaries, crossBuildRestores: goldenBoundaries, interleavedSteps,
  invalidSeedShapes: invalidSeeds.length, invalidStepShapes: invalidSteps.length,
  freshProcess: { pid: worker.pid, parentPid: process.pid, checkpoints: jobs.length,
    replayedSteps: worker.results.reduce((sum, row) => sum + row.transitions, 0) },
  rejectedCheckpoints: rejected, rawImportAndAdmissionRejections: rawRejected, candidateExhaustion: exhaustion,
  trustedStateLimit: 'Recomputed digest corruption tests enforce compatibility, RNG arithmetic and legal fields. Valid handcrafted private states remain accepted; no cryptographic authentication or historical reachability proof is claimed.',
  atomicity: 'Raw failed imports preserve logical state. Source execution traps may mutate their private candidate; the TS factory discards that candidate and preserves accepted state.' }, null, 2)}\n`);
await writeFile('reports/encounter-core-verification.json', `${JSON.stringify({ schemaVersion: 1, status: 'passed', checkedAt,
  scope: fixtures.scope, sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: core.compatibility.wasmSha256,
  hostSha256: core.compatibility.hostSha256, fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  fixtureReproducibility: 'Independent Python --check passed without writing fixtures', independence: fixtures.independence,
  adaptation: fixtures.adaptation, originalGameOrEmulatorComparison: false,
  factoryCases: fixtures.factoryCases.length, stepTranscripts: fixtures.stepCases.length, stepOperations,
  checkedLiteralDraws: checkedDraws, slots: [...slots].sort((a, b) => a - b), natures: [...natures].sort((a, b) => a - b),
  abilities: [...abilities].sort((a, b) => a - b), shinyPlayerOt: true,
  checks: ['exact source creature identity, stats, IVs, nature, ability, gender, growth experience and legal PP',
    'all slot threshold endpoints and fixed-level draw', 'personality rejection sampling and both RNG streams/counts',
    'one held-item draw even when both items are NONE', 'cooldown threshold and five-percent early bypass',
    'terrain behavior transition gate, no-encounter terrain and actual rate-buff threshold change',
    'pending handoff cannot reroll; continuation consumes no RNG', 'walk/run equivalence and immutable private projections',
    'version/digest/semantic rejection, isolated candidates, cross-build and fresh-process recovery'],
  sourceRecords: fixtures.sourceRecords }, null, 2)}\n`);
process.stdout.write(`Encounter factory passed: ${fixtures.factoryCases.length} factory cases, ${fixtures.stepCases.length} step transcripts/${stepOperations} steps, ${goldenBoundaries} golden boundaries, ${jobs.length} fresh-process restores.\n`);
