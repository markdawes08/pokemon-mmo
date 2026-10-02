import { readFixtureBytes, readRetainedBytes } from '../fixtures/io';
/** Independent source literals and recovery; no live battle, account or database. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadDevelopmentProfile } from '../../apps/server/src/development-profile';
import { loadRoute1Engine } from '../battle-route1/engine';
import { loadProgressionCore, ProgressionCore, instantiateRawProgression, progressionCheckpointDigest,
  type ProgressionCheckpoint, type ProgressionDiagnostic, type RawProgressionExports } from './progression';
import { assertView, assertRaw, decide, inputWords, startRaw, importRaw, rawWords, rawEvent,
  type Fixtures, type RecoveryJob, type RawJob } from './verify-support';

async function child(command: string, args: string[], input = '', timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const owned = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; owned.kill(); }, timeout);
    owned.stdout.on('data', data => { stdout += String(data); }); owned.stderr.on('data', data => { stderr += String(data); });
    owned.once('error', error => { clearTimeout(timer); reject(error); });
    owned.once('exit', code => { clearTimeout(timer); if (code === 0 && !expired) resolve(stdout);
      else reject(new Error(`Owned progression child ${expired ? 'timed out' : `exited ${code}`}: ${stderr}`)); });
    owned.stdin.on('error', error => { if (!expired) reject(error); }); owned.stdin.end(input);
  });
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await child('.venv/Scripts/python.exe', ['tools/battle-progression/fixtures/generate_fixtures.py', '--check']);
const bytes = await readFixtureBytes('tools/battle-progression/fixtures/source-cases.json');
const fixtures = JSON.parse(bytes.toString('utf8')) as Fixtures;
const [core, rebuildBytes, battle, profile] = await Promise.all([loadProgressionCore(),
  readFile('.local/battle-progression/rebuild/progression.wasm'), loadRoute1Engine(), loadDevelopmentProfile()]);
const rebuild = new ProgressionCore(new WebAssembly.Module(rebuildBytes), core.compatibility, battle, profile);
assert.equal(sha(rebuildBytes), core.compatibility.wasmSha256);
assert.equal(fixtures.sourceFingerprint, profile.sourceFingerprint);
const retained = {
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
};
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readRetainedBytes(path)), hash, `${path}: retained bytes`);

const jobs: RecoveryJob[] = [], rawJobs: RawJob[] = [], observations = [];
let boundaries = 0, decisions = 0, replayedDecisions = 0;
function rawAdvance(raw: RawProgressionExports, action: 'next' | number, id: string): void {
  const before = rawWords(raw), copy = instantiateRawProgression(rebuild.module);
  assert.equal(importRaw(copy, before), 0, `${id}: raw cross-build import`);
  assert.deepEqual(rawWords(copy), before);
  assert.equal(action === 'next' ? raw.progression_next() : raw.progression_decide(action), 0, `${id}: source continuation`);
  assert.equal(action === 'next' ? copy.progression_next() : copy.progression_decide(action), 0);
  assert.deepEqual(rawWords(copy), rawWords(raw), `${id}: pointer-free cross-build continuation`);
  assert.deepEqual(rawEvent(copy), rawEvent(raw));
  rawJobs.push({ id, words: before, action, after: rawWords(raw), event: rawEvent(raw) });
}
for (const fixture of fixtures.cases) {
  const initial = structuredClone(fixture.initial), session = core.createDiagnostic(initial);
  const raw = instantiateRawProgression(core.module); startRaw(raw, initial);
  let rawSteps = 0;
  for (let index = 0; index < fixture.checkpoints.length; index++) {
    const expected = fixture.checkpoints[index]!, label = `${fixture.id}:${index}`;
    while (raw.progression_get(0) < 3) {
      assert(rawSteps++ < 4096, 'Bounded raw source continuation'); rawAdvance(raw, 'next', `${label}:raw:${rawSteps}`);
    }
    assertView(session.view(), expected, initial.creature.experience, label);
    assertRaw(raw, expected, initial.friendshipContext, label);
    const checkpoint = session.snapshot(), recovered = rebuild.restore(checkpoint);
    assert.deepEqual(recovered.snapshot(), checkpoint); boundaries++;
    jobs.push({ id: label, checkpoint: structuredClone(checkpoint), initialExperience: initial.creature.experience,
      expected: fixture.checkpoints.slice(index), remaining: fixture.decisions.slice(index) });
    for (const [offset, choice] of fixture.decisions.slice(index).entries()) {
      assertView(decide(recovered, choice), fixture.checkpoints[index + offset + 1]!, initial.creature.experience, `${label}:replayed:${offset}`);
      replayedDecisions++;
    }
    // Returned views/checkpoints are detached, including the mutable C words.
    const detached = session.view(); detached.creature.hp = 65535; detached.events.length = 0;
    checkpoint.words![24] = 999; checkpoint.decisions.length = 0;
    assertView(session.view(), expected, initial.creature.experience, `${label}:detached`);
    const choice = fixture.decisions[index];
    if (choice) { decide(session, choice); decisions++; rawAdvance(raw, choice.kind === 'replace-move' ? choice.slot : 4, `${label}:decision`); }
  }
  assert.deepEqual(initial, fixture.initial, 'Diagnostic admission input is never mutated');
  observations.push({ id: fixture.id, status: 'passed', boundaries: fixture.checkpoints.length,
    phase: session.view().phase, appliedExperience: session.view().creature.experience - initial.creature.experience });
}

const fixture = (id: string) => { const row = fixtures.cases.find(row => row.id === id); assert(row, id); return row; };
const baseline = fixture('natural-yield-16-2'), multi = fixture('multi-level-with-repeated-choice-and-remainder');
const stable = core.createDiagnostic(baseline.initial), stableBefore = stable.snapshot();
const negatives: string[] = [];
function badInput(name: string, edit: (value: ProgressionDiagnostic) => void): void {
  const input = structuredClone(baseline.initial); edit(input);
  assert.throws(() => core.createDiagnostic(input), name);
  assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`input:${name}`);
}
badInput('unknown field', x => Object.assign(x, { traded: true }));
badInput('level zero', x => { x.creature.level = 0; });
badInput('level above source cap', x => { x.creature.level = 101; });
badInput('XP inconsistent with level', x => { x.creature.experience = 179; });
badInput('incorrect cached stat', x => { x.creature.stats.defense++; });
badInput('HP above maximum', x => { x.creature.hp = x.creature.stats.hp + 1; });
badInput('wider-than-source HP', x => { x.creature.hp = x.creature.stats.hp = 0xFFFFFFFF; });
badInput('fixed IV changed', x => { Object.assign(x.creature.ivs, { hp: 16 }); });
badInput('EV per-stat cap', x => { x.creature.evs.speed = 256; });
badInput('EV total cap', x => { Object.assign(x.creature.evs, { hp: 255, attack: 255, speed: 1 }); });
badInput('basis exceeds accrued EVs', x => { x.creature.calculatedEvs.speed = 1; });
badInput('basis/stat mismatch', x => { x.creature.evs.speed = x.creature.calculatedEvs.speed = 76; });
badInput('unsupported species', x => { Object.assign(x.creature, { speciesId: 8 }); });
badInput('unsupported ability', x => { Object.assign(x.creature, { abilityId: 66 }); });
badInput('unsupported personality', x => { Object.assign(x.creature, { personality: 26 }); });
badInput('unsupported OT', x => { Object.assign(x.creature, { otId: 2 }); });
badInput('status modifier', x => { Object.assign(x.creature, { status: 8 }); });
badInput('held modifier', x => { Object.assign(x.creature, { heldItemId: 18 }); });
badInput('future move', x => { x.creature.moves[0]!.moveId = 145; });
badInput('hole between moves', x => { x.creature.moves[0] = { moveId: 0, pp: 0, ppUps: 0 }; });
badInput('duplicate move', x => { x.creature.moves[1] = structuredClone(x.creature.moves[0]!); });
badInput('PP above source base', x => { x.creature.moves[0]!.pp = 36; });
badInput('PP Ups unsupported', x => { Object.assign(x.creature.moves[0]!, { ppUps: 1 }); });
badInput('friendship cap', x => { x.creature.friendship = 256; });
badInput('foreign defeated species', x => { Object.assign(x.defeated, { speciesId: 7 }); });
badInput('foreign Route1 Rattata level', x => { x.defeated = { speciesId: 19, level: 5 }; });
badInput('zero XP override', x => { x.experienceOverride = 0; });
badInput('wide XP override', x => { x.experienceOverride = 32768; });
badInput('unsupported friendship ball', x => { Object.assign(x.friendshipContext, { ballItemId: 1 }); });
badInput('missing friendship context', x => { Reflect.deleteProperty(x, 'friendshipContext'); });

const pending = core.createDiagnostic(multi.initial), pendingBefore = pending.snapshot();
const pendingId = pending.view().pendingMove!.decisionId;
for (const [name, choice] of [
  ['foreign decision', { kind: 'decline-move', decisionId: '0'.repeat(64) }],
  ['replacement slot four', { kind: 'replace-move', decisionId: pendingId, slot: 4 }],
  ['replacement negative slot', { kind: 'replace-move', decisionId: pendingId, slot: -1 }],
  ['unknown decision', { kind: 'evolve', decisionId: pendingId }],
  ['extra decision field', { kind: 'decline-move', decisionId: pendingId, reward: 1 }],
] as const) {
  assert.throws(() => pending.decide(choice), name); assert.deepEqual(pending.snapshot(), pendingBefore); negatives.push(`decision:${name}`);
}
decide(pending, multi.decisions[0]!); const progressed = pending.snapshot();
assert.throws(() => pending.decide({ kind: 'decline-move', decisionId: pendingId }), /Stale/);
assert.deepEqual(pending.snapshot(), progressed); negatives.push('decision:already consumed identity');
assert.throws(() => stable.decide({ kind: 'decline-move', decisionId: pendingId }), /Stale/);
negatives.push('decision:after completion');
const evolution = core.createDiagnostic(fixture('level15-to16-pending-evolution').initial);
assert.throws(() => evolution.decide({ kind: 'decline-move', decisionId: pendingId }), /Stale/);
negatives.push('decision:pending evolution is not move choice');

function badCheckpoint(name: string, edit: (value: ProgressionCheckpoint) => void, resign = true): void {
  const value = structuredClone(progressed); edit(value);
  if (resign) { const { digest: _digest, ...body } = value; value.digest = progressionCheckpointDigest(body); }
  assert.throws(() => core.restore(value), name);
  assert.deepEqual(pending.snapshot(), progressed); negatives.push(`checkpoint:${name}`);
}
badCheckpoint('digest corruption', x => { x.digest = '0'.repeat(64); }, false);
badCheckpoint('source binding', x => { x.compatibility.sourceFingerprint = '0'.repeat(64); });
badCheckpoint('WASM binding', x => { x.compatibility.wasmSha256 = '0'.repeat(64); });
badCheckpoint('host binding', x => { x.compatibility.hostSha256 = '0'.repeat(64); });
badCheckpoint('battle binding', x => { x.compatibility.battleCompatibilitySha256 = '0'.repeat(64); });
badCheckpoint('policy binding', x => { Object.assign(x.compatibility, { policy: 'traded' }); });
badCheckpoint('missing source state', x => { x.words = null; });
badCheckpoint('truncated source state', x => { x.words!.pop(); });
badCheckpoint('changed remaining XP', x => { x.words![2]++; });
badCheckpoint('changed move cursor', x => { x.words![5]++; });
badCheckpoint('changed EV basis', x => { x.words![19]++; });
badCheckpoint('missing decision history', x => { x.decisions.length = 0; });
badCheckpoint('duplicate decision history', x => { x.decisions.push(structuredClone(x.decisions[0]!)); });
badCheckpoint('changed decision result', x => { x.decisions[0] = { kind: 'decline-move', decisionId: x.decisions[0]!.decisionId }; });
badCheckpoint('changed immutable admission', x => { assert.equal(x.admission.kind, 'diagnostic');
  if (x.admission.kind === 'diagnostic') x.admission.initial.creature.friendship++; });
// Integrity/replay are not signatures: a separately valid diagnostic admission
// remains accepted, while never claiming owned provenance or combat readmission.
assertView(core.restore(evolution.snapshot()).view(), fixture('level15-to16-pending-evolution').checkpoints[0]!,
  fixture('level15-to16-pending-evolution').initial.creature.experience, 'valid distinct diagnostic continuation');

const interleavedFixtures = [multi, fixture('water-gun-replace-3')], interleaved = interleavedFixtures.map(row => core.createDiagnostic(row.initial));
let interleavedDecisions = 0;
for (let step = 0; step < multi.decisions.length; step++) for (const [index, row] of interleavedFixtures.entries()) {
  const choice = row.decisions[step]; if (!choice) continue;
  const peer = interleaved[index ^ 1]!.snapshot();
  assertView(decide(interleaved[index]!, choice), row.checkpoints[step + 1]!, row.initial.creature.experience, `interleaved:${index}:${step}`);
  assert.deepEqual(interleaved[index ^ 1]!.snapshot(), peer); interleavedDecisions++;
}

const rawStable = instantiateRawProgression(core.module); assert.equal(importRaw(rawStable, pendingBefore.words!), 0);
const rawBefore = rawWords(rawStable), rawNegatives: string[] = [];
function badRaw(name: string, edit: (words: number[]) => void, source = rawBefore): void {
  const words = source.slice(); edit(words);
  assert.notEqual(importRaw(rawStable, words), 0, name);
  assert.deepEqual(rawWords(rawStable), rawBefore, `${name}: rejected import preserves active state`); rawNegatives.push(name);
}
badRaw('version', w => { w[0] = 2; }); badRaw('phase', w => { w[1] = 6; });
badRaw('remaining exceeds award', w => { w[2] = w[3]! + 1; });
badRaw('incorrect source award', w => { w[14]++; });
badRaw('defeated species', w => { w[9] = 7; }); badRaw('defeated level', w => { w[10] = 6; });
badRaw('mixed unknown friendship context', w => { w[58] = 0xFFFFFFFF; });
badRaw('reserved header', w => { w[22] = 1; }); badRaw('uninitialized', w => { w[23] = 0; });
badRaw('invalid EV', w => { w[43] = 256; }); badRaw('invalid IV', w => { w[37] = 16; });
badRaw('incorrect cached stats', w => { w[32]++; });
badRaw('wide HP and maximum', w => { w[30] = 0x7FFFFFFF; w[31] = 0xFFFFFFFF; });
badRaw('wide stat', w => { w[32] = 65536; });
badRaw('unknown move', w => { w[49] = 355; }); badRaw('wide PP', w => { w[53] = 255; });
badRaw('out-of-range cursor', w => { w[5] = 999; });
badRaw('pending choice empty move slot', w => { w[52] = w[56] = 0; });
badRaw('pending choice move already known', w => { w[49] = w[4]!; w[53] = 0; });
badRaw('pending learn requires level gain', w => { w[7] = 0; });
badRaw('first-move flag outside learn phase', w => { w[6] = 1; });
badRaw('level gain requires living recipient', w => { w[30] = 0; });
badRaw('level gain requires award', w => { w[2] = w[3] = 0; });
badRaw('level gain requires known context', w => { w[12] = 0; w[11] = w[58] = w[59] = 0xFFFFFFFF; });
badRaw('evolution cannot become silent completion', w => { w[1] = 5; w[8] = 0; }, evolution.snapshot().words!);
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  rawStable.progression_import_begin();
  const limit = kind === 'incomplete' ? 63 : 64;
  rawBefore.slice(0, limit).forEach((word, index) => assert.equal(rawStable.progression_import_set(index, word), 0));
  if (kind !== 'incomplete') assert.notEqual(rawStable.progression_import_set(kind === 'duplicate' ? 0 : 64, 1), 0);
  assert.notEqual(rawStable.progression_import_commit(), 0); assert.deepEqual(rawWords(rawStable), rawBefore);
  rawNegatives.push(`poisoned/incomplete import:${kind}`);
}
for (const kind of ['duplicate', 'out-of-range', 'incomplete', 'wide HP'] as const) {
  const raw = instantiateRawProgression(core.module), input = inputWords(baseline.initial);
  raw.progression_input_begin(); if (kind === 'wide HP') input[6] = input[7] = 0xFFFFFFFF;
  input.slice(0, kind === 'incomplete' ? 45 : 46).forEach((word, index) => assert.equal(raw.progression_input_set(index, word), 0));
  if (kind === 'duplicate' || kind === 'out-of-range') assert.notEqual(raw.progression_input_set(kind === 'duplicate' ? 0 : 46, 7), 0);
  assert.notEqual(raw.progression_start(16, 2, 101, 0, 0), 0); assert.notEqual(raw.progression_next(), 0);
  rawNegatives.push(`rejected input:${kind}`);
}
assert.notEqual(rawStable.progression_decide(5), 0); assert.deepEqual(rawWords(rawStable), rawBefore);
rawNegatives.push('invalid raw replacement preserves state');
// Unknown met/ball context permits a non-level award, but is rejected before a
// level chunk would need friendship. No invented metadata or partial XP grant.
for (const levels of [false, true]) {
  const raw = instantiateRawProgression(core.module), row = levels ? fixture('friendship-0-met0-luxury0') : baseline;
  const input = inputWords(row.initial); input[34] = input[35] = 0xFFFFFFFF;
  raw.progression_input_begin(); input.forEach((word, index) => assert.equal(raw.progression_input_set(index, word), 0));
  assert.equal(raw.progression_start(16, 2, 0xFFFFFFFF, levels ? 1 : 0, levels ? 1 : 0), 0);
  if (levels) { const before = rawWords(raw); assert.equal(raw.progression_next(), 4); assert.deepEqual(rawWords(raw), before);
    rawNegatives.push('required friendship context fails before XP chunk'); }
  else { assert.equal(raw.progression_next(), 0); assert.equal(raw.progression_mon_get(3), 150);
    assert.equal(raw.progression_next(), 0); assert.equal(raw.progression_get(0), 5); }
}

const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-progression/recovery-worker.ts'],
  JSON.stringify({ parentPid: process.pid, jobs, raw: rawJobs }))) as { status: string; pid: number; results: { id: string; decisions: number }[]; rawContinuations: number };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid);
assert.deepEqual(worker.results.map(row => row.id), jobs.map(row => row.id)); assert.equal(worker.rawContinuations, rawJobs.length);
assert.equal(worker.results.reduce((n, row) => n + row.decisions, 0), replayedDecisions);
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readRetainedBytes(path)), hash);
const report = { checkedAt: new Date().toISOString(), status: 'passed', profile: core.compatibility.profile,
  sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: core.compatibility.wasmSha256, fixtureSha256: sha(bytes),
  independence: fixtures.independence, oracleReproduction: 'Python --check passed without writes',
  comparisons: 'Independent source-derived literals; no original-game, emulator or ROM comparison claimed',
  scope: 'Private diagnostic progression; natural terminal bridge is independently checked by verify-integration.ts. No DB, owned rewards, evolution execution or combat readmission.',
  sourceCases: fixtures.cases.length, coveredLevels: 100, decisions, boundaries, replayedDecisions,
  rawContinuationBoundaries: rawJobs.length, interleavedDecisions, rejectionChecks: negatives.length,
  rawRejectionChecks: rawNegatives.length, retained, negatives, rawNegatives, cases: observations };
await writeFile('reports/battle-progression-verification.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('reports/battle-progression-recovery.json', JSON.stringify({ checkedAt: report.checkedAt, status: 'passed',
  profile: report.profile, wasmSha256: report.wasmSha256, sameBuildAndCrossBuildBoundaries: boundaries,
  crossBuildRawContinuations: rawJobs.length, freshProcess: { pid: worker.pid, parentPid: process.pid,
    hostBoundaries: jobs.length, replayedDecisions, rawContinuations: worker.rawContinuations },
  scope: 'Pointer-free logical C checkpoints and host admission/decision replay. Raw state validates bounds/phase; full lineage requires host replay. Digests are corruption checks, not authentication.' }, null, 2) + '\n');
console.log(`Progression source verification passed: ${fixtures.cases.length} cases, ${boundaries} boundaries, ${decisions} decisions, ${rawJobs.length} raw continuations, ${negatives.length + rawNegatives.length} rejections.`);
