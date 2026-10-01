/** Source-derived ordinary-wild loss mechanics and private recovery only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadProgressionCore } from '../battle-progression/progression';
import { instantiateRawLoss, loadLossCore, LossCore, lossCheckpointDigest, type LossCheckpoint, type LossDiagnostic } from './loss';
import { assertRaw, assertView, diagnostic, inputWords, startRaw, importRaw, rawWords,
  type Fixtures, type RecoveryJob } from './verify-support';

async function child(command: string, args: string[], input = '', timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const owned = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; owned.kill(); }, timeout);
    owned.stdout.on('data', data => { stdout += String(data); }); owned.stderr.on('data', data => { stderr += String(data); });
    owned.once('error', error => { clearTimeout(timer); reject(error); });
    owned.once('exit', code => { clearTimeout(timer); if (code === 0 && !expired) resolve(stdout);
      else reject(new Error(`Owned loss verifier child ${expired ? 'timed out' : `exited ${code}`}: ${stderr}`)); });
    owned.stdin.on('error', error => { if (!expired) reject(error); }); owned.stdin.end(input);
  });
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
await child('.venv/Scripts/python.exe', ['tools/battle-loss/fixtures/generate_fixtures.py', '--check']);
const fixtureBytes = await readFile('tools/battle-loss/fixtures/source-cases.json');
const fixtures = JSON.parse(fixtureBytes.toString('utf8')) as Fixtures;
const [core, rebuildBytes, progression] = await Promise.all([loadLossCore(),
  readFile('.local/battle-loss/rebuild/loss.wasm'), loadProgressionCore()]);
const rebuild = new LossCore(new WebAssembly.Module(rebuildBytes), core.compatibility, progression, 3000);
assert.equal(sha(rebuildBytes), core.compatibility.wasmSha256); assert.equal(fixtures.sourceFingerprint, core.compatibility.sourceFingerprint);
const retained = {
  'tools/battle-route1/fixtures/source-cases.json': '6e8127ab6bac381bb62266c0d6df1f3d0814cda5ba54a026ad01e40e920f48ac',
  'tools/battle-route1/fixtures/items-cases.json': '1d1e05e66692787c0cbefd4ebe389ab7bc691097578e73cfd486fb21e5aa91d1',
  'tools/battle-progression/fixtures/source-cases.json': '23101fd4be7533cea2e64c055d80fc15f3170be86d4ba52f418d8d7bacc7e27c',
  '.local/battle-route1/primary/route1.wasm': '6662666c9b9aa2fea422260123864905a5cda11ee69ee18528d46ec57e626f02',
  '.local/battle-progression/primary/progression.wasm': '33eb89df0a09206f78d6d693f04cf5d9dd3488d9efb4db22584070ef7980f539',
};
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readFile(path)), hash, `Retained ${path}`);
const jobs: RecoveryJob[] = [], observations = [];
let boundaries = 0, transitions = 0, replayedTransitions = 0;
for (const fixture of fixtures.cases) {
  const input = diagnostic(fixture.input), beforeInput = structuredClone(input), session = core.createDiagnostic(input);
  const raw = instantiateRawLoss(core.module); startRaw(raw, fixture.input);
  for (const [index, expected] of fixture.stages.entries()) {
    const label = `${fixture.id}:${index}`;
    if (index) { session.advance({ expectedSequence: index-1 }); assert.equal(raw.loss_advance(), 0); transitions++; }
    assertView(session.view(), fixture.input, expected, label); assertRaw(raw, fixture.input, expected, label);
    const checkpoint = session.snapshot(), recovered = rebuild.restore(checkpoint), rawCopy = instantiateRawLoss(rebuild.module);
    assert.equal(importRaw(rawCopy, checkpoint.words), 0); assert.deepEqual(rawWords(rawCopy), checkpoint.words);
    assert.deepEqual(recovered.snapshot(), checkpoint);
    jobs.push({ id: label, input: fixture.input, checkpoint: structuredClone(checkpoint), expected: fixture.stages.slice(index) }); boundaries++;
    for (const next of fixture.stages.slice(index+1)) {
      recovered.advance({ expectedSequence: next.sequence-1 }); assert.equal(rawCopy.loss_advance(), 0); replayedTransitions++;
      assertView(recovered.view(), fixture.input, next, `${label}:cross-build:${next.sequence}`);
      assertRaw(rawCopy, fixture.input, next, `${label}:cross-build:${next.sequence}`);
    }
    const view = session.view(); view.creature.friendship = 999; view.context.money = 0;
    checkpoint.words[3] = 0; checkpoint.sequence = 0;
    assertView(session.view(), fixture.input, expected, `${label}:detached returns`);
  }
  const settled = session.snapshot(), rawSettled = rawWords(raw);
  assert.throws(() => session.advance({ expectedSequence: 1 }), /Stale/); assert.deepEqual(session.snapshot(), settled);
  assert.notEqual(raw.loss_advance(), 0); assert.deepEqual(rawWords(raw), rawSettled);
  assert.deepEqual(input, beforeInput);
  observations.push({ id: fixture.id, status: 'passed', friendshipLoss: session.view().friendship.loss,
    moneyLoss: session.view().money.loss, healerLocalId: session.view().respawn!.healerLocalId });
}
const fixture = (id: string) => { const found = fixtures.cases.find(row => row.id === id); assert(found, id); return found; };
const baseline = fixture('canonical-lost'), stable = core.createDiagnostic(diagnostic(baseline.input)), stableBefore = stable.snapshot();
const negatives: string[] = [];
function badInput(name: string, edit: (input: LossDiagnostic) => void): void {
  const input = diagnostic(baseline.input); edit(input);
  assert.throws(() => core.createDiagnostic(input), name); assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`input:${name}`);
}
badInput('living sole participant', x => { x.creature.hp = 1; });
badInput('unknown reward option', x => Object.assign(x, { experience: 50 }));
badInput('level zero', x => { x.creature.level = 0; });
badInput('level beyond source cap', x => { x.creature.level = 101; });
badInput('XP level mismatch', x => { x.creature.experience = 179; });
badInput('friendship out of range', x => { x.creature.friendship = 256; });
badInput('cached stats changed', x => { x.creature.stats.hp++; });
badInput('source u16 maximum exceeded', x => { x.creature.stats.hp = 0xFFFFFFFF; });
badInput('noncanonical IV', x => Object.assign(x.creature.ivs, { hp: 16 }));
badInput('EV cap', x => { x.creature.evs.speed = 256; });
badInput('EV total cap', x => { Object.assign(x.creature.evs, { hp: 255, attack: 255, speed: 1 }); });
badInput('basis exceeds EV', x => { x.creature.calculatedEvs.speed = 1; });
badInput('future move', x => { x.creature.moves[0]!.moveId = 145; });
badInput('duplicate move', x => { x.creature.moves[1] = structuredClone(x.creature.moves[0]!); });
badInput('PP exceeds source maximum', x => { x.creature.moves[0]!.pp = 36; });
badInput('PP Ups exceeds packed slot', x => { x.creature.moves[0]!.ppUps = 4; });
badInput('unsupported held modifier', x => Object.assign(x.creature, { heldItemId: 18 }));
badInput('opponent zero', x => { x.opponentLevel = 0; });
badInput('opponent above level100', x => { x.opponentLevel = 101; });
badInput('foreign outcome', x => Object.assign(x, { outcome: 'won' }));
badInput('negative wallet', x => { x.context.money = -1; });
badInput('above source wallet', x => { x.context.money = 1000000; });
badInput('ninth badge', x => { x.context.badgeMask = 256; });
badInput('missing heal index', x => { x.context.lastHealId = 0; });
badInput('out-of-range heal index', x => { x.context.lastHealId = 21; });
badInput('unsupported Tower routing', x => Object.assign(x.context, { trainerTowerScene: 1 }));
badInput('unrecognized field flag bit', x => { x.context.fieldFlagMask = 64; });
badInput('out-of-range source variable', x => { x.context.route16Scene = 65536; });
badInput('out-of-range champion bit', x => { x.context.championTrainerMask = 64; });
badInput('out-of-range avatar byte', x => { x.context.avatarFlags = 256; });
badInput('invalid cardinal direction', x => { x.context.direction = 0; });
badInput('nonboolean direction flag', x => Object.assign(x.context, { hasDirection: 1 }));
for (const command of [{ expectedSequence: 1 }, { expectedSequence: 2 }, { expectedSequence: -1 }, {}, { expectedSequence: 0, money: 0 }]) {
  assert.throws(() => stable.advance(command)); assert.deepEqual(stable.snapshot(), stableBefore); negatives.push(`advance:${JSON.stringify(command)}`);
}
stable.advance({ expectedSequence: 0 }); const faintCheckpoint = stable.snapshot();
assert.throws(() => stable.advance({ expectedSequence: 0 }), /Stale/); assert.deepEqual(stable.snapshot(), faintCheckpoint);
negatives.push('advance:already applied faint');
stable.advance({ expectedSequence: 1 }); const completeCheckpoint = stable.snapshot();
assert.throws(() => stable.advance({ expectedSequence: 1 }), /Stale/); assert.deepEqual(stable.snapshot(), completeCheckpoint);
negatives.push('advance:already applied whiteout');

function badCheckpoint(name: string, edit: (value: LossCheckpoint) => void, resign = true): void {
  const checkpoint = structuredClone(completeCheckpoint); edit(checkpoint);
  if (resign) { const { digest: _digest, ...body } = checkpoint; checkpoint.digest = lossCheckpointDigest(body); }
  assert.throws(() => core.restore(checkpoint), name); assert.deepEqual(stable.snapshot(), completeCheckpoint); negatives.push(`checkpoint:${name}`);
}
badCheckpoint('corrupt digest', x => { x.digest = '0'.repeat(64); }, false);
for (const key of ['wasmSha256', 'hostSha256', 'sourceFingerprint', 'battleCompatibilitySha256', 'progressionCompatibilitySha256', 'houseMapSha256'] as const)
  badCheckpoint(key, x => { x.compatibility[key] = '0'.repeat(64); });
badCheckpoint('different policy', x => Object.assign(x.compatibility, { developmentPolicy: 'unknown' }));
badCheckpoint('sequence rewound with completed words', x => { x.sequence = 0; });
badCheckpoint('sequence advanced with faint words', x => { x.words = faintCheckpoint.words; });
badCheckpoint('changed money', x => { x.words[3]++; });
badCheckpoint('changed friendship', x => { x.words[53]++; });
badCheckpoint('changed healed PP', x => { x.words[77]--; });
badCheckpoint('changed respawn', x => { x.words[26]++; });
badCheckpoint('changed field changes', x => { x.words[9] = 1; });
badCheckpoint('truncated words', x => { x.words.pop(); });
badCheckpoint('changed immutable context', x => { assert(x.admission.kind === 'diagnostic'); x.admission.initial.context.money++; });

// Inject a failing candidate result after the source operation, using a local
// test method wrapper. This is publication isolation evidence, not DB failure.
const replay = core.replay.bind(core); let candidateFailures = 0;
try {
  for (const stage of [1, 2] as const) {
    const session = core.createDiagnostic(diagnostic(baseline.input)); if (stage === 2) session.advance({ expectedSequence: 0 });
    const before = session.snapshot();
    core.replay = (admission, sequence) => { const run = replay(admission, sequence);
      if (sequence === stage) run.words[stage === 1 ? 53 : 54] = 65536;
      return run; };
    assert.throws(() => session.advance({ expectedSequence: stage-1 })); assert.deepEqual(session.snapshot(), before);
    core.replay = replay; session.advance({ expectedSequence: stage-1 });
    assertView(session.view(), baseline.input, baseline.stages[stage]!, `candidate recovery:${stage}`); candidateFailures++;
  }
} finally { core.replay = replay; }
const peerRows = [fixture('canonical-draw'), fixture('last-heal-10-brock1')], peers = peerRows.map(row => core.createDiagnostic(diagnostic(row.input)));
let interleavedTransitions = 0;
for (const sequence of [0, 1]) for (const [index, row] of peerRows.entries()) {
  const other = peers[index ^ 1]!.snapshot(); peers[index]!.advance({ expectedSequence: sequence });
  assertView(peers[index]!.view(), row.input, row.stages[sequence+1]!, `interleaved:${index}:${sequence}`);
  assert.deepEqual(peers[index ^ 1]!.snapshot(), other); interleavedTransitions++;
}

const raw = instantiateRawLoss(core.module); assert.equal(importRaw(raw, faintCheckpoint.words), 0);
const rawBefore = rawWords(raw), rawNegatives: string[] = [];
function badRaw(name: string, edit: (words: number[]) => void, source = rawBefore): void {
  const words = source.slice(); edit(words); assert.notEqual(importRaw(raw, words), 0, name);
  assert.deepEqual(rawWords(raw), rawBefore, `${name}: raw rejected state cannot replace active state`); rawNegatives.push(name);
}
badRaw('version', x => { x[0] = 2; }); badRaw('stage', x => { x[1] = 3; });
badRaw('uninitialized', x => { x[35] = 0; }); badRaw('reserved header', x => { x[42] = 1; });
badRaw('reserved tail', x => { x[95] = 1; });
badRaw('invalid last heal index zero', x => { x[6] = 0; }); badRaw('invalid last heal index21', x => { x[6] = 21; });
badRaw('invalid badge bit', x => { x[5] = 256; }); badRaw('invalid opponent level', x => { x[7] = 101; });
badRaw('invalid outcome', x => { x[8] = 1; }); badRaw('unsupported Tower', x => { x[20] = 1; });
badRaw('invalid field variable', x => { x[10] = 65536; }); badRaw('invalid field bits', x => { x[9] = 64; });
badRaw('invalid direction', x => { x[17] = 5; }); badRaw('invalid boolean', x => { x[18] = 2; });
badRaw('wallet too wide', x => { x[2] = 1000000; });
badRaw('mon maximum exceeds u16', x => { x[55] = 0xFFFFFFFF; });
badRaw('bad stat cache', x => { x[56]++; }); badRaw('bad IV', x => { x[61] = 16; });
badRaw('EV per-stat cap', x => { x[67] = 256; }); badRaw('basis above EV', x => { x[36] = 1; });
badRaw('future move', x => { x[73] = 145; }); badRaw('PP maximum', x => { x[77] = 255; });
// These inputs pass source admission and execute replay before the comparison
// fails, so the active raw state must survive an actually mutated candidate.
badRaw('post-replay debit mismatch', x => { x[3]++; }, completeCheckpoint.words);
badRaw('post-replay destination mismatch', x => { x[26]++; }, completeCheckpoint.words);
badRaw('post-replay faint penalty mismatch', x => { x[34]++; });
badRaw('post-replay premature heal', x => { x[54] = 1; });
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  raw.loss_import_begin(); rawBefore.slice(0, kind === 'incomplete' ? 95 : 96)
    .forEach((word, index) => assert.equal(raw.loss_import_set(index, word), 0));
  if (kind !== 'incomplete') assert.notEqual(raw.loss_import_set(kind === 'duplicate' ? 0 : 96, 1), 0);
  assert.notEqual(raw.loss_import_commit(), 0); assert.deepEqual(rawWords(raw), rawBefore); rawNegatives.push(`import staging:${kind}`);
}
for (const [name, index, value] of [['zero heal', 48, 0], ['wide heal', 48, 21], ['living mon', 6, 1],
  ['wide stat', 7, 0xFFFFFFFF], ['Tower override', 62, 1], ['reserved input', 63, 1]] as const) {
  const candidate = instantiateRawLoss(core.module), words = inputWords(baseline.input); words[index] = value;
  candidate.loss_input_begin(); words.forEach((word, offset) => assert.equal(candidate.loss_input_set(offset, word), 0));
  assert.notEqual(candidate.loss_start(), 0, name); assert.notEqual(candidate.loss_advance(), 0); rawNegatives.push(`input:${name}`);
}
for (const kind of ['duplicate', 'out-of-range', 'incomplete'] as const) {
  const candidate = instantiateRawLoss(core.module), words = inputWords(baseline.input); candidate.loss_input_begin();
  words.slice(0, kind === 'incomplete' ? 63 : 64).forEach((word, index) => assert.equal(candidate.loss_input_set(index, word), 0));
  if (kind !== 'incomplete') assert.notEqual(candidate.loss_input_set(kind === 'duplicate' ? 0 : 64, 1), 0);
  assert.notEqual(candidate.loss_start(), 0); assert.notEqual(candidate.loss_advance(), 0); rawNegatives.push(`input staging:${kind}`);
}
// Source table values are literal independent records; invalid IDs must return
// zero without attempting the original game's out-of-bounds lookup; admission
// and import separately reject those IDs instead of treating zero as a map.
for (const row of fixtures.healLocations) assert.deepEqual(Array.from({ length: 5 }, (_, i) => raw.loss_heal_get(row.id, i) >>> 0),
  [row.lastHeal.mapGroup, row.lastHeal.mapNum, row.lastHeal.warpId >>> 0, row.lastHeal.x, row.lastHeal.y]);
for (const id of [0, 21, 0xFFFFFFFF]) assert.equal(raw.loss_heal_get(id, 0), 0);
assert.deepEqual(rawWords(raw), rawBefore);

const worker = JSON.parse(await child(process.execPath, ['--import', 'tsx', 'tools/battle-loss/recovery-worker.ts'],
  JSON.stringify({ parentPid: process.pid, jobs }))) as { status: string; pid: number; boundaries: number; transitions: number };
assert.equal(worker.status, 'passed'); assert.notEqual(worker.pid, process.pid);
assert.equal(worker.boundaries, boundaries); assert.equal(worker.transitions, replayedTransitions);
for (const [path, hash] of Object.entries(retained)) assert.equal(sha(await readFile(path)), hash);
const report = { checkedAt: new Date().toISOString(), status: 'passed', profile: core.compatibility.profile,
  sourceFingerprint: fixtures.sourceFingerprint, wasmSha256: core.compatibility.wasmSha256, fixtureSha256: sha(fixtureBytes),
  independence: fixtures.independence, oracleReproduction: 'Python --check passed without writes',
  scope: 'Private source mechanical plan only; pending world/arrival scripts. No DB, owned effects, world movement or combat readmission.',
  sourceCases: fixtures.cases.length, sourceHealLocations: fixtures.healLocations.length, badgeMasks: 256,
  boundaries, transitions, replayedTransitions, interleavedTransitions, candidateFailures,
  hostRejectionChecks: negatives.length, rawRejectionChecks: rawNegatives.length, settledDuplicateChecks: fixtures.cases.length,
  retained, negatives, rawNegatives, cases: observations };
await writeFile('reports/battle-loss-verification.json', JSON.stringify(report, null, 2)+'\n');
await writeFile('reports/battle-loss-recovery.json', JSON.stringify({ checkedAt: report.checkedAt, status: 'passed', profile: report.profile,
  wasmSha256: report.wasmSha256, crossBuildHostBoundaries: boundaries, crossBuildRawBoundaries: boundaries,
  replayedTransitions, freshProcess: { pid: worker.pid, parentPid: process.pid, hostBoundaries: worker.boundaries,
    rawBoundaries: worker.boundaries, transitions: worker.transitions }, candidateFailures,
  scope: 'Replay and expected sequence prevent repeated local stage effects; no permanent outcome deduplication or authenticated checkpoint claim.' }, null, 2)+'\n');
console.log(`Loss verification passed: ${fixtures.cases.length} source cases, ${boundaries} boundaries, ${transitions} transitions, ${negatives.length + rawNegatives.length} rejections.`);
