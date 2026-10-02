import { readFixtureBytes, readRetainedBytes } from '../fixtures/io';
/** Independent source metadata/nickname/party/PC mechanics and recovery. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadProgressionCore } from '../battle-progression/progression';
import { CaptureCore, captureCheckpointDigest, instantiateRawCapture, loadCaptureCore, type CaptureCheckpoint, type CaptureDiagnostic } from './capture';
import { advanceBoth, assertRaw, assertView, diagnostic, encodedName, hostDecision, importRaw, inputWords, rawWords, startRaw,
  type Fixtures, type RecoveryJob } from './verify-support';

async function child(command: string, args: string[], input = '', timeout = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const owned = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; owned.kill(); }, timeout);
    owned.stdout.on('data', data => { stdout += String(data); }); owned.stderr.on('data', data => { stderr += String(data); });
    owned.once('error', error => { clearTimeout(timer); reject(error); });
    owned.once('exit', code => { clearTimeout(timer); if (code === 0 && !expired) resolve(stdout);
      else reject(new Error(`Owned capture verifier child ${expired ? 'timed out' : `exited ${code}`}: ${stderr}`)); });
    owned.stdin.on('error', error => { if (!expired) reject(error); }); owned.stdin.end(input);
  });
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await child('.venv/Scripts/python.exe', ['tools/battle-capture/fixtures/generate_fixtures.py', '--check']);
const fixtureBytes = await readFixtureBytes('tools/battle-capture/fixtures/source-cases.json'), fixtures = JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
const [core, rebuildBytes, progression, codecBytes] = await Promise.all([loadCaptureCore(), readFile('.local/battle-capture/rebuild/capture.wasm'),
  loadProgressionCore(), readFile('.local/battle-capture/primary/extracted/codec.json')]);
const rebuild = new CaptureCore(new WebAssembly.Module(rebuildBytes), core.compatibility, progression, JSON.parse(codecBytes.toString('utf8')));
assert.equal(sha(rebuildBytes), core.compatibility.wasmSha256); assert.equal(fixtures.sourceFingerprint, core.compatibility.sourceFingerprint);
const retained = {
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json': '23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  'tools/battle-loss/fixtures/source-cases.json': 'dbfe309e1a8ce56fdf691710858785756f910c3502c926935112632c5d93cd1b',
  '.local/battle-spike/primary/probe.wasm': '3f47b4f5fed993e75f15e67c567f58c35a6b51476d5c8f6f3233c935b5fb4724',
  '.local/encounter-core/primary/encounter.wasm': '8b46d731fdf20c16213a6cb7dc9e1e14dccbd3a65fe4c4ac45d3e70c8a885bd2',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
  '.local/battle-loss/primary/loss.wasm': 'b68d12c1d031defec0cc22b2aa07589cd2c0011dc749a9a59a7c41c3dbe6868a',
};
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readRetainedBytes(path)), hash, `Retained ${path}`);
const jobs: RecoveryJob[] = [], observations = [];
let boundaries = 0, transitions = 0, replayedTransitions = 0;
for (const fixture of fixtures.cases) {
  const input = diagnostic(fixture.input), inputBefore = structuredClone(input), session = core.createDiagnostic(input);
  const raw = instantiateRawCapture(core.module); startRaw(raw, fixture.input);
  for (const [index, expected] of fixture.stages.entries()) {
    const label = `${fixture.id}:${index}`;
    if (index) { advanceBoth(session, raw, index, fixture.decision); transitions++; }
    assertView(session.view(), fixture.input, expected, label); assertRaw(raw, fixture.input, expected, label);
    const checkpoint = session.snapshot(), recovered = rebuild.restore(checkpoint), rawCopy = instantiateRawCapture(rebuild.module);
    assert.equal(importRaw(rawCopy, checkpoint.words), 0); assert.deepEqual(rawWords(rawCopy), checkpoint.words);
    assert.deepEqual(recovered.snapshot(), checkpoint);
    jobs.push({ id: label, input: fixture.input, decision: fixture.decision, checkpoint: structuredClone(checkpoint), expected: fixture.stages.slice(index) }); boundaries++;
    for (const next of fixture.stages.slice(index+1)) {
      advanceBoth(recovered, rawCopy, next.sequence, fixture.decision); replayedTransitions++;
      assertView(recovered.view(), fixture.input, next, `${label}:cross-build:${next.sequence}`);
      assertRaw(rawCopy, fixture.input, next, `${label}:cross-build:${next.sequence}`);
    }
    const view = session.view(); view.metadata.nickname = 'mutated'; view.storage.boxMasks[0] = 0;
    checkpoint.words[9] = 0; checkpoint.sequence = 0;
    assertView(session.view(), fixture.input, expected, `${label}:detached returns`);
    assert.throws(() => session.project('wild'));
    const projection = session.project();
    for (const key of ['otId', 'trainerId', 'personality', 'ivs', 'boxMasks', 'words', 'metadata', 'admission'])
      assert(!Object.hasOwn(projection, key), `${label}: owner projection excludes implementation/private identity ${key}`);
  }
  const settled = session.snapshot(), rawSettled = rawWords(raw);
  assert.throws(() => session.advance({ expectedSequence: 2 }), /Stale/); assert.deepEqual(session.snapshot(), settled);
  assert.notEqual(raw.capture_advance(), 0); assert.deepEqual(rawWords(raw), rawSettled);
  assert.deepEqual(input, inputBefore);
  observations.push({ id: fixture.id, status: 'passed', destination: fixture.stages[3]!.placement });
}
const fixture = (id: string) => { const found = fixtures.cases.find(row => row.id === id); assert(found, id); return found; };
const baseline = fixture('canonical-party-keep'), stable = core.createDiagnostic(diagnostic(baseline.input)), stableBefore = stable.snapshot();
const negatives: string[] = [];
function badInput(name: string, edit: (input: CaptureDiagnostic) => void): void {
  const input = diagnostic(baseline.input); edit(input); assert.throws(() => core.createDiagnostic(input), name);
  assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`input:${name}`);
}
badInput('foreign species', x => Object.assign(x.creature, { speciesId: 7 }));
badInput('Route1 Pidgey level6', x => { x.creature.level = 6; });
badInput('Route1 Rattata level5', x => Object.assign(x.creature, { speciesId: 19 }));
badInput('zero HP', x => { x.creature.hp = 0; });
badInput('above cached max HP', x => { x.creature.hp = x.creature.stats.hp+1; });
badInput('wide source stat', x => { x.creature.stats.hp = 65536; });
badInput('wrong source stat', x => { x.creature.stats.attack++; });
badInput('wrong nature', x => { x.creature.nature = 24; });
badInput('wrong ability', x => Object.assign(x.creature, { abilityId: 50 }));
badInput('wrong ability number', x => Object.assign(x.creature, { abilityNum: 1 }));
badInput('wrong gender', x => Object.assign(x.creature, { gender: 0 }));
badInput('IV outside source bits', x => { x.creature.ivs.hp = 32; });
badInput('unsupported EV', x => Object.assign(x.creature.evs, { speed: 1 }));
badInput('wrong initial experience', x => { x.creature.experience++; });
badInput('unsupported friendship', x => Object.assign(x.creature, { friendship: 69 }));
badInput('unsupported status', x => Object.assign(x.creature, { status: 1 }));
badInput('unsupported held item', x => Object.assign(x.creature, { heldItemId: 13 }));
badInput('future move', x => { x.creature.moves[1]!.moveId = 98; });
badInput('PP above source maximum', x => { x.creature.moves[0]!.pp = 36; });
badInput('nonzero empty-slot PP', x => { x.creature.moves[3]!.pp = 1; });
badInput('unsupported PP bonus', x => Object.assign(x.creature.moves[0]!, { ppUps: 1 }));
badInput('OT context mismatch', x => { x.context.trainerId = 2; });
badInput('unsupported owner field', x => Object.assign(x.context, { accountId: 'untrusted' }));
badInput('caller supplied source met location', x => Object.assign(x.context, { metLocation: 0 }));
badInput('incoherent caught without seen', x => { x.context.dex.caught = true; });
badInput('capture counter too wide', x => { x.context.captureStat = 0x1000000; });
badInput('seven party bits', x => { x.context.partyMask = 64; });
badInput('box mask high bit', x => { x.context.boxMasks[0] = 0x40000000; });
badInput('missing box', x => { x.context.boxMasks.pop(); });
badInput('current box out of range', x => { x.context.currentBox = 14; });
badInput('history box out of range', x => { x.context.lastSentBox = 14; });
badInput('completely full party and boxes', x => { x.context.partyMask = 63; x.context.boxMasks.fill(0x3FFFFFFF); });
for (const name of ['', '       ', 'ABCDEFGH', 'é', '🙂', '\u0000', '\n', '$', 'A\u00ff'])
  badInput(`invalid trainer name ${JSON.stringify(name)}`, x => { x.context.trainerName = name; });
for (const command of [{ expectedSequence: 1 }, { expectedSequence: 2 }, { expectedSequence: -1 }, {}, { expectedSequence: 0, placement: 'party' }]) {
  assert.throws(() => stable.advance(command)); assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`advance:${JSON.stringify(command)}`);
}
assert.throws(() => stable.decideNickname({ expectedSequence: 1, decisionId: '0'.repeat(64), kind: 'keep-species-name' }));
stable.advance({ expectedSequence: 0 }); const nicknameCheckpoint = stable.snapshot(), decisionId = stable.view().pendingNickname!.decisionId;
assert.throws(() => stable.advance({ expectedSequence: 0 }), /Stale/); assert.deepEqual(stable.snapshot(), nicknameCheckpoint); negatives.push('duplicate dex/stat stage');
for (const command of [
  { expectedSequence: 1, decisionId: '0'.repeat(64), kind: 'keep-species-name' },
  { expectedSequence: 0, decisionId, kind: 'keep-species-name' },
  { expectedSequence: 1, decisionId, kind: 'release' },
  { expectedSequence: 1, decisionId, kind: 'keep-species-name', name: 'extra' },
  ...['ABCDEFGHIJK', 'é', '🙂', '\u0000', '\n', '$', '’'].map(name => ({ expectedSequence: 1, decisionId, kind: 'nickname', name })),
]) {
  assert.throws(() => stable.decideNickname(command)); assert.deepEqual(stable.snapshot(), nicknameCheckpoint); negatives.push(`decision:${JSON.stringify(command)}`);
}
hostDecision(stable, baseline.decision); const chosenCheckpoint = stable.snapshot();
assert.throws(() => stable.decideNickname({ expectedSequence: 1, decisionId, kind: 'nickname', name: 'Again' }));
assert.deepEqual(stable.snapshot(), chosenCheckpoint); negatives.push('duplicate or changed accepted nickname');
stable.advance({ expectedSequence: 2 }); const completeCheckpoint = stable.snapshot();
function badCheckpoint(name: string, edit: (value: CaptureCheckpoint) => void, resign = true): void {
  const checkpoint = structuredClone(completeCheckpoint); edit(checkpoint);
  if (resign) { const { digest: _digest, ...body } = checkpoint; checkpoint.digest = captureCheckpointDigest(body); }
  assert.throws(() => core.restore(checkpoint), name); assert.deepEqual(stable.snapshot(), completeCheckpoint); negatives.push(`checkpoint:${name}`);
}
badCheckpoint('corrupt digest', x => { x.digest = '0'.repeat(64); }, false);
for (const key of ['wasmSha256', 'hostSha256', 'sourceFingerprint', 'codecSha256', 'battleCompatibilitySha256', 'progressionCompatibilitySha256', 'routeMapSha256'] as const)
  badCheckpoint(key, x => { x.compatibility[key] = '0'.repeat(64); });
badCheckpoint('different policy', x => Object.assign(x.compatibility, { developmentPolicy: 'unknown' }));
badCheckpoint('sequence rewind', x => { x.sequence = 0; });
badCheckpoint('source stage mismatch', x => { x.words = nicknameCheckpoint.words; });
badCheckpoint('missing accepted choice', x => { x.nicknameDecision = null; });
badCheckpoint('stale accepted choice ID', x => { x.nicknameDecision!.decisionId = '0'.repeat(64); });
badCheckpoint('changed accepted nickname', x => { x.nicknameDecision = { expectedSequence: 1, decisionId, kind: 'nickname', name: 'Other' }; });
badCheckpoint('changed immutable context', x => { assert(x.admission.kind === 'diagnostic'); x.admission.initial.context.captureStat++; });
for (const [name, index, value] of [['counter', 9, 2], ['dex', 7, 0], ['party destination', 20, 5], ['pending ownership', 30, 0],
  ['nickname', 54, 0xBB], ['OT name', 46, 0xBB], ['metadata', 66, 3], ['PP', 109, 35], ['reserved', 159, 1]] as const)
  badCheckpoint(name, x => { x.words[index] = value; });
badCheckpoint('truncated words', x => { x.words.pop(); });

// Candidate failures occur after actual source replay, before host publication.
// This is in-memory atomicity evidence, not a database or authenticated-state claim.
const replay = core.replay.bind(core); let candidateFailures = 0;
try {
  for (const stage of [1, 2, 3] as const) {
    const session = core.createDiagnostic(diagnostic(baseline.input));
    if (stage >= 2) session.advance({ expectedSequence: 0 }); if (stage === 3) hostDecision(session, baseline.decision);
    const before = session.snapshot();
    core.replay = (admission, sequence, decision) => { const run = replay(admission, sequence, decision);
      if (sequence === stage) run.words[stage === 3 ? 19 : 66] = 0;
      return run; };
    assert.throws(() => stage === 2 ? hostDecision(session, baseline.decision) : session.advance({ expectedSequence: stage-1 }));
    assert.deepEqual(session.snapshot(), before); core.replay = replay;
    if (stage === 2) hostDecision(session, baseline.decision); else session.advance({ expectedSequence: stage-1 });
    assertView(session.view(), baseline.input, baseline.stages[stage]!, `candidate recovery:${stage}`); candidateFailures++;
  }
} finally { core.replay = replay; }
const peerRows = [baseline, fixture('canonical-box-rename')], peers = peerRows.map(row => core.createDiagnostic(diagnostic(row.input)));
let interleavedTransitions = 0;
for (const sequence of [1, 2, 3]) for (const [index, row] of peerRows.entries()) {
  const other = peers[index ^ 1]!.snapshot(), session = peers[index]!;
  if (sequence === 2) hostDecision(session, row.decision); else session.advance({ expectedSequence: sequence-1 });
  assertView(session.view(), row.input, row.stages[sequence]!, `interleaved:${index}:${sequence}`);
  assert.deepEqual(peers[index ^ 1]!.snapshot(), other); interleavedTransitions++;
}

const raw = instantiateRawCapture(core.module); assert.equal(importRaw(raw, nicknameCheckpoint.words), 0);
const rawBefore = rawWords(raw), rawNegatives: string[] = [];
function badRaw(name: string, edit: (words: number[]) => void, source = rawBefore): void {
  const words = source.slice(); edit(words); assert.notEqual(importRaw(raw, words), 0, name);
  assert.deepEqual(rawWords(raw), rawBefore, `${name}: raw rejected candidate cannot replace active state`); rawNegatives.push(name);
}
for (const [name, index, value] of [['version', 0, 2], ['stage', 1, 4], ['uninitialized', 2, 0], ['reserved header', 26, 1],
  ['reserved tail', 159, 1], ['wide capture count', 8, 0x1000000], ['party extra bit', 11, 64], ['current box', 14, 14],
  ['send box', 15, 14], ['box extra bit', 32, 0x40000000], ['incoherent seen mirror', 27, 0],
  ['wrong language', 67, 3], ['wrong met location', 115, 0], ['wrong met level', 65, 1], ['wrong ball', 114, 1],
  ['invalid OT byte', 46, 0xFC], ['invalid name byte', 54, 0xFC], ['wide HP', 86, 65536], ['wrong stats', 88, 99],
  ['unsupported EV', 99, 1], ['future move', 105, 98], ['empty PP', 112, 1], ['unsupported PPbonus', 113, 1],
  ['unsupported status', 116, 1], ['unsupported held', 117, 13]] as const) badRaw(name, x => { x[index] = value; });
for (const [name, index, value] of [['post-replay counter', 9, 2], ['post-replay nickname', 54, 0xBB],
  ['post-replay destination', 20, 5], ['post-replay capacity mask', 12, 1]] as const)
  badRaw(name, x => { x[index] = value; }, completeCheckpoint.words);
// Raw words establish source semantics, not the original battle lineage. A
// different, still legal party PP value can be a valid diagnostic preimage.
// The immutable host admission rejects exactly this edit above.
const semanticOnly = instantiateRawCapture(core.module), validDiagnosticWords = completeCheckpoint.words.slice();
validDiagnosticWords[109] = 35;
assert.equal(importRaw(semanticOnly, validDiagnosticWords), 0);
assert.deepEqual(rawWords(semanticOnly), validDiagnosticWords);
// A rejected import runs a source candidate; it must preserve a nickname that
// was fully staged before that attempt as well as the visible Runtime words.
const stagedName = instantiateRawCapture(core.module); assert.equal(importRaw(stagedName, nicknameCheckpoint.words), 0);
assert.equal(stagedName.capture_name_begin(), 0);
encodedName('Staged', 10).forEach((value, index) => assert.equal(stagedName.capture_name_set(index, value), 0));
const rejectedReplay = chosenCheckpoint.words.slice(); rejectedReplay[25] = 4;
assert.notEqual(importRaw(stagedName, rejectedReplay), 0);
assert.deepEqual(rawWords(stagedName), nicknameCheckpoint.words);
assert.equal(stagedName.capture_decide(1), 0);
assert.deepEqual(rawWords(stagedName).slice(54, 65), encodedName('Staged', 10));
rawNegatives.push('rejected replay preserves previously staged nickname');
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  raw.capture_import_begin(); rawBefore.slice(0, kind === 'incomplete' ? 159 : 160)
    .forEach((word, index) => assert.equal(raw.capture_import_set(index, word), 0));
  if (kind !== 'incomplete') assert.notEqual(raw.capture_import_set(kind === 'duplicate' ? 0 : 160, 1), 0);
  assert.notEqual(raw.capture_import_commit(), 0); assert.deepEqual(rawWords(raw), rawBefore); rawNegatives.push(`import staging:${kind}`);
}
for (const [name, index, value] of [['unsupported species', 0, 7], ['zero HP', 6, 0], ['wide stat', 7, 0xFFFFFFFF],
  ['unsupported status', 36, 1], ['foreign ball', 34, 1], ['foreign map', 35, 0], ['invalid trainer gender', 40, 2],
  ['invalid trainer byte', 41, 0xFC], ['incoherent caught', 50, 1], ['invalid current box', 53, 14],
  ['invalid history box', 54, 14], ['box high bit', 57, 0x40000000], ['reserved input', 79, 1]] as const) {
  const candidate = instantiateRawCapture(core.module), before = rawWords(candidate), words = inputWords(baseline.input); words[index] = value;
  candidate.capture_input_begin(); words.forEach((word, offset) => assert.equal(candidate.capture_input_set(offset, word), 0));
  assert.notEqual(candidate.capture_start(), 0, name); assert.deepEqual(rawWords(candidate), before); rawNegatives.push(`input:${name}`);
}
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  const candidate = instantiateRawCapture(core.module), before = rawWords(candidate), words = inputWords(baseline.input); candidate.capture_input_begin();
  words.slice(0, kind === 'incomplete' ? 79 : 80).forEach((word, index) => assert.equal(candidate.capture_input_set(index, word), 0));
  if (kind !== 'incomplete') assert.notEqual(candidate.capture_input_set(kind === 'duplicate' ? 0 : 80, 1), 0);
  assert.notEqual(candidate.capture_start(), 0); assert.deepEqual(rawWords(candidate), before); rawNegatives.push(`input staging:${kind}`);
}
const fullWords = inputWords(baseline.input); fullWords[52] = 63; fullWords.fill(0x3FFFFFFF, 57, 71);
const full = instantiateRawCapture(core.module), fullBefore = rawWords(full);
full.capture_input_begin(); fullWords.forEach((word, index) => assert.equal(full.capture_input_set(index, word), 0));
assert.equal(full.capture_capacity(), 1); assert.notEqual(full.capture_start(), 0); assert.deepEqual(rawWords(full), fullBefore);
assert.notEqual(full.capture_advance(), 0); assert.deepEqual(rawWords(full), fullBefore); rawNegatives.push('full before every source effect');
for (const kind of ['duplicate', 'out-of-range', 'incomplete', 'invalid-byte', 'missing-EOS', 'after-EOS'] as const) {
  assert.equal(importRaw(raw, nicknameCheckpoint.words), 0); raw.capture_name_begin(); const name = encodedName('Bird', 10);
  if (kind === 'invalid-byte') name[0] = 0xFC; if (kind === 'missing-EOS') name.fill(0xBB); if (kind === 'after-EOS') name[8] = 0xBB;
  name.slice(0, kind === 'incomplete' ? 10 : 11).forEach((value, index) => assert.equal(raw.capture_name_set(index, value), 0));
  if (kind === 'duplicate' || kind === 'out-of-range') assert.notEqual(raw.capture_name_set(kind === 'duplicate' ? 0 : 11, 1), 0);
  assert.notEqual(raw.capture_decide(1), 0); assert.deepEqual(rawWords(raw), rawBefore); rawNegatives.push(`name staging:${kind}`);
}
assert.notEqual(raw.capture_decide(2), 0); assert.deepEqual(rawWords(raw), rawBefore); rawNegatives.push('unsupported raw choice');
for (const [text, byte] of Object.entries(fixtures.keyboard)) {
  assert.deepEqual(core.encodeText(text, 10), [byte, ...Array<number>(10).fill(255)]);
  assert.equal(core.decodeText([byte, 255]), text);
}
assert.deepEqual(Array.from({ length: 6 }, (_, index) => raw.capture_constant(index)), [101, 2, 4, 4, 14, 30]);

const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-capture/recovery-worker.ts'],
  JSON.stringify({ parentPid: process.pid, jobs }))) as { status: string; pid: number; boundaries: number; transitions: number };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid);
assert.equal(worker.boundaries, boundaries); assert.equal(worker.transitions, replayedTransitions);
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readRetainedBytes(path)), hash);
const report = { checkedAt: new Date().toISOString(), status: 'passed', profile: core.compatibility.profile,
  sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: core.compatibility.wasmSha256, fixtureSha256: sha(fixtureBytes),
  independence: fixtures.independence, oracleReproduction: 'Python --check passed without writes',
  scope: 'Private pending ownership candidate only. No DB grant, persistent dex/stat/storage mutation, new item cost, RNG draw or combat readmission.',
  sourceCases: fixtures.cases.length, lastFreePCSlots: 420, keyboardGlyphs: Object.keys(fixtures.keyboard).length,
  boundaries, transitions, replayedTransitions, interleavedTransitions, candidateFailures,
  hostRejectionChecks: negatives.length, rawRejectionChecks: rawNegatives.length, settledDuplicateChecks: fixtures.cases.length,
  rawLineageLimit: 'A coherent alternative PP preimage is accepted by raw semantic import, but rejected by immutable host admission replay.',
  retained, negatives, rawNegatives, cases: observations };
await writeFile('reports/battle-capture-verification.json', JSON.stringify(report, null, 2)+'\n');
await writeFile('reports/battle-capture-recovery.json', JSON.stringify({ checkedAt: report.checkedAt, status: 'passed', profile: report.profile,
  wasmSha256: report.wasmSha256, crossBuildHostBoundaries: boundaries, crossBuildRawBoundaries: boundaries, replayedTransitions,
  freshProcess: { pid: worker.pid, parentPid: process.pid, hostBoundaries: worker.boundaries, rawBoundaries: worker.boundaries, transitions: worker.transitions },
  candidateFailures, scope: 'Sequence and decision fences prevent repeated local candidate effects. This is not durable grant deduplication or checkpoint authentication.' }, null, 2)+'\n');
console.log(`Capture verification passed: ${fixtures.cases.length} source cases, ${boundaries} boundaries, ${transitions} transitions, ${negatives.length + rawNegatives.length} rejections.`);
