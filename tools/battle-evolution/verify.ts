/** Independent source evolution, cancellation, learning and private recovery. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadProgressionCore } from '../battle-progression/progression';
import { EvolutionCore, evolutionCheckpointDigest, instantiateRawEvolution, loadEvolutionCore, type EvolutionCheckpoint, type EvolutionDiagnostic } from './evolution';
import { assertRaw, assertView, diagnostic, expectedWords, hostDecision, importRaw, inputWords, operateRaw, rawWords, startRaw,
  type Fixtures, type HostJob, type RawJob } from './verify-support';

async function child(command: string, args: string[], input = '', timeout = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const owned = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; owned.kill(); }, timeout);
    owned.stdout.on('data', data => { stdout += String(data); }); owned.stderr.on('data', data => { stderr += String(data); });
    owned.once('error', error => { clearTimeout(timer); reject(error); });
    owned.once('exit', code => { clearTimeout(timer); if (code === 0 && !expired) resolve(stdout);
      else reject(new Error(`Owned evolution verifier child ${expired ? 'timed out' : `exited ${code}`}: ${stderr}`)); });
    owned.stdin.on('error', error => { if (!expired) reject(error); }); owned.stdin.end(input);
  });
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await child('.venv/Scripts/python.exe', ['tools/battle-evolution/fixtures/generate_fixtures.py', '--check']);
const fixtureBytes = await readFile('tools/battle-evolution/fixtures/source-cases.json'), fixtures = JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
const [core, rebuildBytes, progression, codecBytes] = await Promise.all([loadEvolutionCore(), readFile('.local/battle-evolution/rebuild/evolution.wasm'),
  loadProgressionCore(), readFile('.local/battle-evolution/primary/extracted/codec.json')]);
const rebuild = new EvolutionCore(new WebAssembly.Module(rebuildBytes), core.compatibility, progression, JSON.parse(codecBytes.toString('utf8')));
assert.equal(sha(rebuildBytes), core.compatibility.wasmSha256); assert.equal(fixtures.sourceFingerprint, core.compatibility.sourceFingerprint);
const retained = {
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json': '23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  'tools/battle-loss/fixtures/source-cases.json': 'dbfe309e1a8ce56fdf691710858785756f910c3502c926935112632c5d93cd1b',
  'tools/battle-capture/fixtures/source-cases.json': '47a4b1ebf06bfc055a25fd119834f76c4f4243afe6ceddb5ac49c968e37c8c3c',
  '.local/battle-spike/primary/probe.wasm': '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  '.local/battle-loss/primary/loss.wasm': 'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
  '.local/battle-capture/primary/capture.wasm': '1e6b16390cdaa4906c01b391c30984735a22e998f548e9ff7de44d890865a60b',
};
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readFile(path)), hash, `Retained ${path}`);
let eligible = 0, ineligible = 0;
for (const row of fixtures.eligibility) {
  const raw = instantiateRawEvolution(core.module), before = rawWords(raw), result = startRaw(raw, row.input);
  if (row.target) {
    assert.equal(result, 0, row.id); assert.equal(raw.evolution_get(1), row.target);
    assert.equal(core.createDiagnostic(diagnostic(row.input)).view().targetSpecies, row.target); eligible++;
  } else {
    assert.equal(result, 4, row.id); assert.deepEqual(rawWords(raw), before);
    assert.throws(() => core.createDiagnostic(diagnostic(row.input)), row.id); ineligible++;
  }
}
const hostJobs: HostJob[] = [], rawJobs: RawJob[] = [], observations = [];
let hostTransitions = 0, rawTransitions = 0, replayedHostTransitions = 0, replayedRawTransitions = 0;
for (const [caseIndex, fixture] of fixtures.cases.entries()) {
  const input = diagnostic(fixture.input), inputBefore = structuredClone(input), session = core.createDiagnostic(input);
  for (const [settledIndex, expected] of fixture.settled.entries()) {
    const label = `${fixture.id}:settled${settledIndex}`;
    if (settledIndex) { hostDecision(session, fixture, expected.sequence); hostTransitions++; }
    assertView(session.view(), fixture.input, expected, label);
    const checkpoint = session.snapshot(), recovered = rebuild.restore(checkpoint);
    assert.deepEqual(recovered.snapshot(), checkpoint);
    hostJobs.push({ caseIndex, settledIndex, checkpoint: structuredClone(checkpoint) });
    for (const next of fixture.settled.slice(settledIndex+1)) {
      hostDecision(recovered, fixture, next.sequence); replayedHostTransitions++;
      assertView(recovered.view(), fixture.input, next, `${label}:cross-build`);
    }
    const view = session.view(); view.creature.hp = 0xFFFFFFFF; view.nickname = 'changed';
    checkpoint.words[15] = 0; checkpoint.decisions.length = 0;
    assertView(session.view(), fixture.input, expected, `${label}:detached`);
    assert.throws(() => session.project('wild'));
    const project = session.project();
    for (const key of ['origin', 'admission', 'words', 'personality', 'otId', 'ivs', 'rng']) assert(!Object.hasOwn(project, key));
    for (const key of ['personality', 'otId', 'ivs', 'evs', 'calculatedEvs', 'abilityNum', 'ballItemId', 'metLocation']) assert(!Object.hasOwn(project.creature, key));
  }
  const settled = session.snapshot();
  assert.throws(() => session.decide({ expectedSequence: session.view().sequence, decisionId: '0'.repeat(64), kind: 'accept-evolution' }));
  assert.deepEqual(session.snapshot(), settled); assert.deepEqual(input, inputBefore);
  const raw = instantiateRawEvolution(core.module); assert.equal(startRaw(raw, fixture.input), 0);
  for (const [rawIndex, expected] of fixture.raw.entries()) {
    const label = `${fixture.id}:source${rawIndex}`;
    if (expected.operation) { operateRaw(raw, expected.operation); rawTransitions++; }
    assertRaw(raw, fixture.input, expected.expected, label);
    const words = rawWords(raw), recovered = instantiateRawEvolution(rebuild.module);
    assert.equal(importRaw(recovered, words), 0, `${label}:import`); assert.deepEqual(rawWords(recovered), words);
    rawJobs.push({ caseIndex, rawIndex, words });
    for (const next of fixture.raw.slice(rawIndex+1)) {
      assert(next.operation); operateRaw(recovered, next.operation); replayedRawTransitions++;
      assertRaw(recovered, fixture.input, next.expected, `${label}:cross-build`);
    }
  }
  const finalWords = rawWords(raw); assert.notEqual(raw.evolution_choose(1), 0); assert.notEqual(raw.evolution_next(), 0);
  assert.notEqual(raw.evolution_decide(0), 0); assert.deepEqual(rawWords(raw), finalWords);
  observations.push({ id: fixture.id, status: 'passed', result: session.view().result, speciesId: session.view().creature.speciesId,
    hostBoundaries: fixture.settled.length, rawBoundaries: fixture.raw.length });
}
const fixture = (id: string) => { const found = fixtures.cases.find(row => row.id === id); assert(found, id); return found; };
const baseline = fixture('edge-7-16-accept'), stable = core.createDiagnostic(diagnostic(baseline.input)), stableBefore = stable.snapshot();
const negatives: string[] = [];
function badInput(name: string, edit: (input: EvolutionDiagnostic) => void): void {
  const input = diagnostic(baseline.input); edit(input); assert.throws(() => core.createDiagnostic(input), name);
  assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`input:${name}`);
}
badInput('foreign species', x => Object.assign(x.creature, { speciesId: 1 }));
badInput('level zero', x => { x.creature.level = 0; }); badInput('above source cap', x => { x.creature.level = 101; });
badInput('XP level mismatch', x => { x.creature.experience = 1; });
badInput('wide HP', x => { x.creature.hp = 65536; }); badInput('above cached HP', x => { x.creature.hp = x.creature.stats.hp+1; });
badInput('wrong cached stat', x => { x.creature.stats.attack++; }); badInput('wide cached stat', x => { x.creature.stats.hp = 0xFFFFFFFF; });
badInput('wide IV', x => { x.creature.ivs.hp = 32; }); badInput('EV per-stat cap', x => { x.creature.evs.hp = 256; });
badInput('EV total cap', x => Object.assign(x.creature.evs, { hp: 255, attack: 255, speed: 1 }));
badInput('basis exceeds current EV', x => { x.creature.calculatedEvs.hp = 1; });
badInput('wrong ability identity', x => Object.assign(x.creature, { abilityId: 51 }));
badInput('unavailable ability slot', x => Object.assign(x.creature, { abilityNum: 1 }));
badInput('unsupported held item', x => Object.assign(x.creature, { heldItemId: 13 }));
badInput('wide source status', x => { x.creature.status = 0x100000000; });
badInput('unsupported acquisition ball', x => Object.assign(x.creature, { ballItemId: 1 }));
badInput('wide met location', x => { x.creature.metLocation = 256; });
badInput('future level-up move', x => { x.creature.moves[0]!.moveId = 56; });
badInput('foreign family move', x => { x.creature.moves[0]!.moveId = 98; });
badInput('unsupported HM', x => { x.creature.moves[0]!.moveId = 57; });
badInput('unsupported TM', x => { x.creature.moves[0]!.moveId = 58; });
badInput('duplicate move', x => { x.creature.moves[1] = structuredClone(x.creature.moves[0]!); });
badInput('PP above bonus maximum', x => { x.creature.moves[0]!.pp = 36; });
badInput('PP Ups outside2bits', x => { x.creature.moves[0]!.ppUps = 4; });
badInput('empty slot nonzero PP', x => { x.creature.moves[3] = { moveId: 0, pp: 1, ppUps: 0 }; });
badInput('empty slot nonzero bonus', x => { x.creature.moves[3] = { moveId: 0, pp: 0, ppUps: 1 }; });
badInput('foreign Japanese language', x => Object.assign(x.context, { language: 1 }));
badInput('foreign French language', x => Object.assign(x.context, { language: 3 }));
badInput('incoherent target dex', x => { x.context.targetDex.caught = true; });
badInput('source counter overflow', x => { x.context.evolutionStat = 0x1000000; });
badInput('caller target override', x => Object.assign(x.context, { targetSpecies: 9 }));
for (const name of ['', '          ', 'ABCDEFGHIJK', 'é', '🙂', '\u0000', '\n', '$'])
  badInput(`invalid nickname ${JSON.stringify(name)}`, x => { x.context.nickname = name; });
const pendingId = stable.view().pendingEvolution!.decisionId;
for (const command of [{ expectedSequence: 0, decisionId: '0'.repeat(64), kind: 'accept-evolution' },
  { expectedSequence: 1, decisionId: pendingId, kind: 'accept-evolution' },
  { expectedSequence: 0, decisionId: pendingId, kind: 'accept-evolution', targetSpecies: 9 },
  { expectedSequence: 0, decisionId: pendingId, kind: 'replace-move', slot: 0 },
  { expectedSequence: 0, decisionId: pendingId, kind: 'decline-move' }]) {
  assert.throws(() => stable.decide(command)); assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`choice:${JSON.stringify(command)}`);
}
const cannotCancel = core.createDiagnostic(diagnostic(fixture('cannot-cancel-accept-7').input)), cannotBefore = cannotCancel.snapshot();
assert.throws(() => cannotCancel.decide({ expectedSequence: 0, decisionId: cannotCancel.view().pendingEvolution!.decisionId, kind: 'cancel-evolution' }));
assert.deepEqual(cannotCancel.snapshot(), cannotBefore); negatives.push('source scene disallows cancellation');
hostDecision(stable, baseline, 1); const completeCheckpoint = stable.snapshot();
const moveFixture = fixture('target-move-7-19-choice0'), moving = core.createDiagnostic(diagnostic(moveFixture.input));
hostDecision(moving, moveFixture, 1); const moveCheckpoint = moving.snapshot(), moveId = moving.view().pendingMove!.decisionId;
for (const command of [{ expectedSequence: 0, decisionId: moveId, kind: 'replace-move', slot: 0 },
  { expectedSequence: 1, decisionId: moveId, kind: 'replace-move', slot: 4 },
  { expectedSequence: 1, decisionId: moveId, kind: 'replace-move', slot: -1 },
  { expectedSequence: 1, decisionId: moveId, kind: 'cancel-evolution' },
  { expectedSequence: 1, decisionId: moveId, kind: 'accept-evolution' }]) {
  assert.throws(() => moving.decide(command)); assert.deepEqual(moving.snapshot(), moveCheckpoint); negatives.push(`move:${JSON.stringify(command)}`);
}
hostDecision(moving, moveFixture, 2); const moved = moving.snapshot();
assert.throws(() => moving.decide({ expectedSequence: 1, decisionId: moveId, kind: 'decline-move' })); assert.deepEqual(moving.snapshot(), moved);
negatives.push('changed duplicate move decision');
function badCheckpoint(name: string, edit: (value: EvolutionCheckpoint) => void, resign = true): void {
  const checkpoint = structuredClone(completeCheckpoint); edit(checkpoint);
  if (resign) { const { digest: _digest, ...body } = checkpoint; checkpoint.digest = evolutionCheckpointDigest(body); }
  assert.throws(() => core.restore(checkpoint), name); assert.deepEqual(stable.snapshot(), completeCheckpoint); negatives.push(`checkpoint:${name}`);
}
badCheckpoint('digest', x => { x.digest = '0'.repeat(64); }, false);
for (const key of ['wasmSha256', 'hostSha256', 'sourceFingerprint', 'codecSha256', 'battleCompatibilitySha256', 'progressionCompatibilitySha256'] as const)
  badCheckpoint(key, x => { x.compatibility[key] = '0'.repeat(64); });
badCheckpoint('missing accepted decision', x => { x.decisions.length = 0; });
badCheckpoint('duplicated decision', x => { x.decisions.push(structuredClone(x.decisions[0]!)); });
badCheckpoint('changed accepted choice', x => { x.decisions[0] = { ...x.decisions[0]!, kind: 'cancel-evolution' }; });
badCheckpoint('wrong decision sequence', x => { x.decisions[0]!.expectedSequence = 1; });
badCheckpoint('wrong decision binding', x => { x.decisions[0]!.decisionId = '0'.repeat(64); });
badCheckpoint('changed immutable nickname', x => { assert(x.admission.kind === 'diagnostic'); x.admission.initial.context.nickname = 'Different'; });
for (const [name, index, value] of [['creature species', 48, 9], ['HP', 54, 1], ['PP', 77, 35], ['name', 32, 0xBB], ['counter', 15, 2],
  ['dex', 13, 0], ['learning cursor', 8, 0], ['future phase', 1, 2], ['reserved', 127, 1]] as const)
  badCheckpoint(name, x => { x.words[index] = value; });
badCheckpoint('truncated state', x => { x.words.pop(); });

const replay = core.replay.bind(core); let candidateFailures = 0;
try {
  for (const [row, targetDecision] of [[baseline, 1], [fixture('edge-7-16-cancel'), 1], [moveFixture, 2]] as const) {
    const session = core.createDiagnostic(diagnostic(row.input)); if (targetDecision === 2) hostDecision(session, row, 1);
    const before = session.snapshot();
    core.replay = (admission, decisions) => { const run = replay(admission, decisions); if (decisions.length === targetDecision) run.words[22] = 0; return run; };
    assert.throws(() => hostDecision(session, row, targetDecision)); assert.deepEqual(session.snapshot(), before);
    core.replay = replay; hostDecision(session, row, targetDecision);
    assertView(session.view(), row.input, row.settled[targetDecision]!, 'candidate retry after source replay failure'); candidateFailures++;
  }
} finally { core.replay = replay; }
const peerRows = [moveFixture, fixture('cancel-old-move-19-20-empty')], peers = peerRows.map(row => core.createDiagnostic(diagnostic(row.input)));
let interleavedTransitions = 0;
for (const index of [0, 1, 0]) {
  const session = peers[index]!, other = peers[index ^ 1]!.snapshot(), next = session.view().sequence+1;
  hostDecision(session, peerRows[index]!, next); assertView(session.view(), peerRows[index]!.input, peerRows[index]!.settled[next]!, 'interleaved');
  assert.deepEqual(peers[index ^ 1]!.snapshot(), other); interleavedTransitions++;
}

const raw = instantiateRawEvolution(core.module); assert.equal(importRaw(raw, stableBefore.words), 0);
const rawBefore = rawWords(raw), rawNegatives: string[] = [];
function badRaw(name: string, edit: (words: number[]) => void): void {
  const words = rawBefore.slice(); edit(words); assert.notEqual(importRaw(raw, words), 0, name);
  assert.deepEqual(rawWords(raw), rawBefore, `${name}: rejected raw import is atomic`); rawNegatives.push(name);
}
for (const [name, index, value] of [['version', 0, 2], ['phase', 1, 5], ['uninitialized', 2, 0], ['foreign prespecies', 3, 1],
  ['wrong target', 4, 9], ['invalid choice', 5, 3], ['invalid stopped boolean', 6, 2], ['invalid learn flag', 7, 2],
  ['cursor OOB', 8, 0xFFFFFFFF], ['unknown pending move', 9, 355], ['invalid seen', 10, 2], ['incoherent caught', 11, 1],
  ['counter overflow', 14, 0x1000000], ['invalid canCancel', 18, 2], ['foreign language', 22, 3], ['source basis above EV', 26, 1],
  ['invalid nickname byte', 32, 0xFC], ['reserved head', 43, 1], ['wide sourceHP', 54, 65536], ['invalid stats', 55, 65536],
  ['IV bounds', 61, 32], ['EV bounds', 67, 256], ['unsupported HM', 73, 57], ['PP bounds', 77, 255],
  ['unknown held effect', 85, 13], ['unsupported pokerus', 86, 1], ['illegal ability slot', 87, 1], ['reserved tail', 127, 1]] as const)
  badRaw(name, x => { x[index] = value; });
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  raw.evolution_import_begin(); rawBefore.slice(0, kind === 'incomplete' ? 127 : 128).forEach((word, i) => assert.equal(raw.evolution_import_set(i, word), 0));
  if (kind !== 'incomplete') assert.notEqual(raw.evolution_import_set(kind === 'duplicate' ? 0 : 128, 1), 0);
  assert.notEqual(raw.evolution_import_commit(), 0); assert.deepEqual(rawWords(raw), rawBefore); rawNegatives.push(`import staging:${kind}`);
}
for (const [name, index, value] of [['unknown species', 0, 1], ['wide HP', 6, 65536], ['wide maxHP', 7, 0xFFFFFFFF], ['unsupported HM', 25, 57],
  ['empty PPbonus', 33, 256], ['unknown held', 37, 13], ['basis too high', 40, 1], ['invalid nickname', 46, 0xFC],
  ['foreign language', 57, 1], ['incoherent dex', 59, 1], ['wide count', 60, 0x1000000], ['reserved input', 71, 1]] as const) {
  const candidate = instantiateRawEvolution(core.module), before = rawWords(candidate), words = inputWords(baseline.input); words[index] = value;
  candidate.evolution_input_begin(); words.forEach((word, i) => assert.equal(candidate.evolution_input_set(i, word), 0));
  assert.notEqual(candidate.evolution_start(), 0, name); assert.deepEqual(rawWords(candidate), before); rawNegatives.push(`input:${name}`);
}
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  const candidate = instantiateRawEvolution(core.module), before = rawWords(candidate), words = inputWords(baseline.input);
  candidate.evolution_input_begin(); words.slice(0, kind === 'incomplete' ? 71 : 72).forEach((word, i) => assert.equal(candidate.evolution_input_set(i, word), 0));
  if (kind !== 'incomplete') assert.notEqual(candidate.evolution_input_set(kind === 'duplicate' ? 0 : 72, 1), 0);
  assert.notEqual(candidate.evolution_start(), 0); assert.deepEqual(rawWords(candidate), before); rawNegatives.push(`input staging:${kind}`);
}
assert.notEqual(raw.evolution_choose(2), 0); assert.deepEqual(rawWords(raw), rawBefore); rawNegatives.push('invalid raw accept decision');
const rawPending = instantiateRawEvolution(core.module); assert.equal(importRaw(rawPending, moveCheckpoint.words), 0);
const pendingBefore = rawWords(rawPending); assert.notEqual(rawPending.evolution_decide(5), 0);
assert.deepEqual(rawWords(rawPending), pendingBefore); rawNegatives.push('invalid raw move slot');

// A newly learned/replaced move has source base PP and no PP Ups at this exact
// boundary. General legal depleted PP is insufficient here. Settled host states
// separately retain immutable replay protection after that immediate event ends.
const immediateLearningRejections = [];
for (const [id, eventKind] of [['target-move-7-19-empty', 3], ['target-move-7-19-choice0', 4],
  ['cancel-old-move-19-20-empty', 2]] as const) {
  const row = fixture(id), rawIndex = row.raw.findIndex(boundary => boundary.expected.event.kind === eventKind);
  assert(rawIndex > 0); const boundary = row.raw[rawIndex]!, expected = boundary.expected;
  const slot = expected.creature.moves.findIndex(move => move.moveId === expected.moveToLearn);
  assert(slot >= 0); const learned = expected.creature.moves[slot]!;
  assert(learned.pp > 0); assert.equal(learned.ppUps, 0);
  if (eventKind === 2) assert.equal(expected.lastReturn, learned.moveId, 'cancelled source call actually auto-learned');
  const accepted = expectedWords(row.input, expected), candidate = instantiateRawEvolution(core.module);
  assert.equal(importRaw(candidate, accepted), 0); assertRaw(candidate, row.input, expected, `${id}:valid immediate boundary`);
  const session = core.createDiagnostic(diagnostic(row.input));
  for (const settled of row.settled.slice(1)) hostDecision(session, row, settled.sequence);
  const checkpoint = session.snapshot();
  assert.equal(checkpoint.words[73+slot], learned.moveId);
  for (const corruption of ['depleted PP', 'nonzero PP Ups'] as const) {
    const edit = (words: number[]) => {
      if (corruption === 'depleted PP') { assert.equal(words[77+slot], learned.pp); words[77+slot] = words[77+slot]!-1; }
      else { assert.equal((words[81]! >> (2*slot)) & 3, 0); words[81] = words[81]! | 1 << (2*slot); }
    };
    const name = `immediate learning:${id}:${corruption}`, changed = accepted.slice(); edit(changed);
    assert.notEqual(importRaw(candidate, changed), 0, name);
    assert.deepEqual(rawWords(candidate), accepted, `${name}: rejected import retains every accepted word`);
    rawNegatives.push(name);
    const changedCheckpoint = structuredClone(checkpoint); edit(changedCheckpoint.words);
    const { digest: _digest, ...body } = changedCheckpoint; changedCheckpoint.digest = evolutionCheckpointDigest(body);
    assert.throws(() => core.restore(changedCheckpoint), /differs from its source replay/, `${name}: host immutable replay`);
    assert.deepEqual(session.snapshot(), checkpoint); negatives.push(`checkpoint:${name}`);
    immediateLearningRejections.push({ fixture: id, eventKind, slot, corruption, rawAtomicRejection: true, hostReplayRejection: true });
  }
  for (const next of row.raw.slice(rawIndex+1)) {
    assert(next.operation); operateRaw(candidate, next.operation);
    assertRaw(candidate, row.input, next.expected, `${id}: source continuation after rejected imports`);
  }
}

const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-evolution/recovery-worker.ts'],
  JSON.stringify({ parentPid: process.pid, host: hostJobs, raw: rawJobs }))) as { status: string; pid: number; hostBoundaries: number;
    rawBoundaries: number; hostTransitions: number; rawTransitions: number };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid);
assert.equal(worker.hostBoundaries, hostJobs.length); assert.equal(worker.rawBoundaries, rawJobs.length);
assert.equal(worker.hostTransitions, replayedHostTransitions); assert.equal(worker.rawTransitions, replayedRawTransitions);
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readFile(path)), hash);
const report = { checkedAt: new Date().toISOString(), status: 'passed', profile: core.compatibility.profile,
  sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: core.compatibility.wasmSha256, fixtureSha256: sha(fixtureBytes),
  independence: fixtures.independence, oracleReproduction: 'Python --check passed without writes',
  scope: 'Private one-event source evolution candidate only. No live reachability, durable ownership, active status/HM mechanics, frame timing or combat readmission.',
  sourceCases: fixtures.cases.length, eligibilityCases: fixtures.eligibility.length, eligible, ineligible,
  hostBoundaries: hostJobs.length, rawBoundaries: rawJobs.length, hostTransitions, rawTransitions, replayedHostTransitions, replayedRawTransitions,
  interleavedTransitions, candidateFailures, hostRejectionChecks: negatives.length, rawRejectionChecks: rawNegatives.length,
  settledDuplicateChecks: fixtures.cases.length, immediateLearningRejections, retained, negatives, rawNegatives, cases: observations };
await writeFile('reports/battle-evolution-verification.json', JSON.stringify(report, null, 2)+'\n');
await writeFile('reports/battle-evolution-recovery.json', JSON.stringify({ checkedAt: report.checkedAt, status: 'passed', profile: report.profile,
  wasmSha256: report.wasmSha256, crossBuildHostBoundaries: hostJobs.length, crossBuildRawBoundaries: rawJobs.length,
  replayedHostTransitions, replayedRawTransitions, freshProcess: { parentPid: process.pid, ...worker }, candidateFailures,
  scope: 'Immutable host replay proves its supplied admission history; raw import validates logical source state. Neither authenticates client data or deduplicates durable grants.' }, null, 2)+'\n');
console.log(`Evolution verification passed: ${fixtures.cases.length} cases, ${fixtures.eligibility.length} eligibility rows, ${hostJobs.length} host/${rawJobs.length} raw boundaries.`);
