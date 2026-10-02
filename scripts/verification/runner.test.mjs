import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { test } from 'node:test';
import { runVerification, selectStages, VerificationLockError } from './runner.mjs';

async function fixture(t, source = 'one') {
  const root = await mkdtemp(join(tmpdir(), 'pokewaterblue-runner-test-'));
  t.after(async () => {
    assert(basename(root).startsWith('pokewaterblue-runner-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'input.txt'), source);
  await writeFile(join(root, 'child.mjs'), `
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const count = existsSync('count.txt') ? Number(readFileSync('count.txt', 'utf8')) : 0;
writeFileSync('count.txt', String(count + 1));
const input = readFileSync('input.txt', 'utf8');
writeFileSync('artifact.txt', input);
writeFileSync('evidence.json', JSON.stringify({ input }));
console.log('child output');
`);
  const stage = { id: 'fixture', cacheable: true, inputs: ['input.txt', 'child.mjs'], outputs: ['artifact.txt'],
    evidence: ['evidence.json'], command: { file: process.execPath, args: ['child.mjs'] } };
  const run = (options = {}) => runVerification({ root, stages: [stage], ...options });
  const count = async () => Number(await readFile(join(root, 'count.txt'), 'utf8'));
  return { root, stage, run, count };
}

test('cache hits require exact inputs and outputs and keep immutable original evidence', async t => {
  const f = await fixture(t);
  const cold = await f.run();
  assert.equal(cold.status, 'passed'); assert.equal(cold.stages[0].status, 'passed');
  assert.equal(cold.stages[0].nativeExitCode, 0);
  assert(cold.stages[0].durationMs > 0); assert(cold.durationMs >= cold.stages[0].durationMs);
  const saved = await readFile(join(cold.runDir, 'run.json'), 'utf8');
  assert.equal((await readdir(join(f.root, '.local', 'verification', 'receipts'))).length, 1);
  assert.deepEqual(await readdir(join(f.root, 'reports', 'verification-runs')), [cold.runId]);
  const evidencePath = join(cold.runDir, cold.stages[0].evidence[0].path);
  const evidence = await readFile(evidencePath, 'utf8');
  const warm = await f.run();
  assert.notEqual(warm.runDir, cold.runDir); assert.equal(warm.stages[0].status, 'cached');
  assert.equal(warm.stages[0].reusedFrom.runId, cold.runId); assert.equal(await f.count(), 1);
  assert.deepEqual(await readdir(join(warm.runDir, 'logs')), []);
  await writeFile(join(f.root, 'input.txt'), 'two');
  const changed = await f.run(); assert.equal(changed.stages[0].status, 'passed'); assert.equal(await f.count(), 2);
  assert.equal(await readFile(evidencePath, 'utf8'), evidence);
  assert.equal(await readFile(join(cold.runDir, 'run.json'), 'utf8'), saved);
  await writeFile(join(f.root, 'artifact.txt'), 'tampered');
  assert.equal((await f.run()).stages[0].status, 'passed'); assert.equal(await f.count(), 3);
  assert.equal((await f.run()).stages[0].status, 'cached'); assert.equal(await f.count(), 3);
});

test('forced verification executes while mutable stages always execute', async t => {
  const f = await fixture(t);
  await f.run(); assert.equal((await f.run({ force: true })).stages[0].status, 'passed');
  const mutable = { ...f.stage, id: 'mutable', cacheable: false };
  for (let i = 0; i < 2; i++) assert.equal((await f.run({ stages: [mutable] })).stages[0].status, 'passed');
  assert.equal(await f.count(), 4);
});

test('dependency closure runs in order and warm proofs are independent of run identity', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'consumer.mjs'), `import {readFileSync,writeFileSync} from 'node:fs'; writeFileSync('consumer.txt',readFileSync('artifact.txt'));`);
  const consumer = { id: 'consumer', dependsOn: ['fixture'], cacheable: true, inputs: ['consumer.mjs'], outputs: ['consumer.txt'],
    command: { file: process.execPath, args: ['consumer.mjs'] } };
  const options = { stages: [consumer, f.stage], selected: ['consumer'] };
  const first = await f.run(options); assert.deepEqual(first.stages.map(s => s.id), ['fixture', 'consumer']);
  const second = await f.run(options); assert.deepEqual(second.stages.map(s => s.status), ['cached', 'cached']);
  assert.deepEqual(second.stages.map(s => s.proof), first.stages.map(s => s.proof));
  await writeFile(join(f.root, 'input.txt'), 'new');
  assert.deepEqual((await f.run(options)).stages.map(s => s.status), ['passed', 'passed']);
  assert.equal(await readFile(join(f.root, 'consumer.txt'), 'utf8'), 'new');
});

test('selection rejects unknown dependencies, duplicates and cycles before execution', () => {
  assert.throws(() => selectStages([{ id: 'a', dependsOn: ['unknown'] }]), /Unknown/);
  assert.throws(() => selectStages([{ id: 'a' }, { id: 'a' }]), /unique/);
  assert.throws(() => selectStages([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]), /cycle/);
  assert.throws(() => selectStages([{ id: '../escape' }]), /safe/);
});

test('native failure is archived accurately, blocks dependants and is never reused', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'fail.mjs'), `console.error('intentional fixture failure'); process.exit(23);`);
  const fail = { id: 'fail', dependsOn: ['fixture'], cacheable: true, inputs: ['fail.mjs'], command: { file: process.execPath, args: ['fail.mjs'] } };
  const blocked = { ...f.stage, id: 'blocked', dependsOn: ['fail'] };
  const options = { stages: [f.stage, fail, blocked] };
  const first = await f.run(options);
  assert.equal(first.exitCode, 23); assert.equal(first.status, 'failed');
  assert.equal(first.stages[1].nativeExitCode, 23); assert.equal(first.stages[2].status, 'blocked');
  assert.match(await readFile(join(first.runDir, first.stages[1].log), 'utf8'), /intentional fixture failure/);
  const resumed = await f.run(options);
  assert.deepEqual(resumed.stages.map(s => s.status), ['cached', 'failed', 'blocked']);
  assert.equal(await f.count(), 1);
});

test('failed forced execution invalidates an earlier identical successful receipt', async t => {
  const f = await fixture(t);
  // The intentionally undeclared transient fixture models a nondeterministic
  // failure; production mutable stages must never opt into caching.
  await writeFile(join(f.root, 'child.mjs'), `import {existsSync} from 'node:fs'; if(existsSync('fail-now'))process.exit(17);`);
  f.stage.outputs = []; f.stage.evidence = [];
  await f.run(); await writeFile(join(f.root, 'fail-now'), 'yes');
  assert.equal((await f.run({ force: true })).exitCode, 17);
  const next = await f.run(); assert.equal(next.stages[0].status, 'failed'); assert.equal(next.exitCode, 17);
});

test('input changes while a child runs cannot publish a reusable pass', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'child.mjs'), `import {readFileSync,writeFileSync} from 'node:fs'; writeFileSync('input.txt',readFileSync('input.txt','utf8')+'changed'); writeFileSync('artifact.txt','made');`);
  const result = await f.run();
  assert.equal(result.status, 'failed'); assert.equal(result.stages[0].nativeExitCode, 0);
  assert.equal(result.stages[0].failure, 'inputs-changed-during-stage');
  assert.equal((await f.run()).stages[0].status, 'failed');
});

test('environment, tool identity, command and directory membership invalidate receipts', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'sources')); await writeFile(join(f.root, 'sources', 'a.txt'), 'a');
  f.stage.inputs.push('sources');
  await f.run();
  assert.equal((await f.run({ env: { ...process.env, FIXTURE_SETTING: 'changed' } })).stages[0].status, 'passed');
  assert.equal((await f.run({ toolIdentity: { compiler: 'new' } })).stages[0].status, 'passed');
  const changed = { ...f.stage, command: { ...f.stage.command, args: ['child.mjs', 'extra'] } };
  assert.equal((await f.run({ stages: [changed] })).stages[0].status, 'passed');
  await writeFile(join(f.root, 'sources', 'b.txt'), 'b');
  assert.equal((await f.run()).stages[0].status, 'passed'); assert.equal(await f.count(), 5);
});

test('explicit external read-only inputs are hashed without being copied into reports', async t => {
  const f = await fixture(t), outside = await fixture(t, 'outside');
  f.stage.inputs.push(join(outside.root, 'input.txt'));
  await f.run(); assert.equal((await f.run()).stages[0].status, 'cached');
  await writeFile(join(outside.root, 'input.txt'), 'new outside');
  const result = await f.run(); assert.equal(result.stages[0].status, 'passed');
  assert.equal((await readFile(join(result.runDir, 'run.json'), 'utf8')).includes('new outside'), false);
});

test('cache reuse refuses missing or modified original evidence and outputs', async t => {
  const f = await fixture(t), initial = await f.run();
  await writeFile(join(initial.runDir, initial.stages[0].evidence[0].path), 'tampered original');
  assert.equal((await f.run()).stages[0].status, 'passed');
  await rm(join(f.root, 'artifact.txt'));
  assert.equal((await f.run()).stages[0].status, 'passed');
  assert.equal(await f.count(), 3);
});

test('reports contain only configuration hashes and redact supplied secrets from owned logs', async t => {
  const f = await fixture(t);
  const secret = 'fixture-only-private-value-012345';
  await writeFile(join(f.root, 'child.mjs'), `console.log(process.env.TEST_SECRET); console.error(process.env.TEST_SECRET);`);
  f.stage.outputs = []; f.stage.evidence = [];
  const result = await f.run({ env: { ...process.env, TEST_SECRET: secret } });
  assert.equal(result.status, 'passed');
  const report = await readFile(join(result.runDir, 'run.json'), 'utf8');
  const log = await readFile(join(result.runDir, result.stages[0].log), 'utf8');
  assert(!report.includes(secret)); assert(!report.includes('TEST_SECRET')); assert(!log.includes(secret)); assert.match(log, /REDACTED/);
});

test('concurrent invocation is rejected without stealing the live lock', async t => {
  const f = await fixture(t);
  let entered;
  const started = new Promise(done => { entered = done; });
  let release;
  const gate = new Promise(done => { release = done; });
  const first = f.run({ onStage: async event => { if (event.status === 'started') { entered(); await gate; } } });
  await started;
  try { await assert.rejects(f.run(), VerificationLockError); }
  finally { release(); }
  assert.equal((await first).status, 'passed');
  assert.equal((await f.run()).stages[0].status, 'cached');
});

test('missing executable or output fails closed and still produces a run archive', async t => {
  const f = await fixture(t);
  const missing = { ...f.stage, command: { file: 'does-not-exist.exe' } };
  const result = await f.run({ stages: [missing] });
  assert.equal(result.status, 'failed'); assert.equal(result.stages[0].nativeExitCode, null);
  assert.equal(JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8')).status, 'failed');
  f.stage.outputs = ['missing-output'];
  assert.equal((await f.run()).status, 'failed');
});

test('metadata guards permit irrelevant changes but bind paths and projected configuration', async t => {
  const f = await fixture(t);
  const metadata = join(f.root, 'metadata.json');
  const update = async value => {
    const bytes = JSON.stringify(value); await writeFile(metadata, bytes);
    return { path: 'metadata.json', sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  f.stage.config = { profile: 'retained' };
  f.stage.guards = [await update({ profile: 'retained', unrelated: [] })];
  const initial = await f.run();
  f.stage.guards = [await update({ profile: 'retained', unrelated: ['new-profile'] })];
  const warm = await f.run();
  assert.equal(warm.stages[0].status, 'cached'); assert.equal(await f.count(), 1);
  assert.equal(warm.stages[0].configurationHash, initial.stages[0].configurationHash);
  f.stage.config = { profile: 'changed' };
  f.stage.guards = [await update({ profile: 'changed', unrelated: ['new-profile'] })];
  assert.equal((await f.run()).stages[0].status, 'passed'); assert.equal(await f.count(), 2);
  await writeFile(join(f.root, 'other-metadata.json'), await readFile(metadata));
  f.stage.guards = [{ ...f.stage.guards[0], path: 'other-metadata.json' }];
  assert.equal((await f.run()).stages[0].status, 'passed'); assert.equal(await f.count(), 3);
});

test('stale or mid-execution metadata guards fail without a reusable receipt', async t => {
  const f = await fixture(t), bytes = 'initial metadata';
  await writeFile(join(f.root, 'metadata.txt'), bytes);
  f.stage.guards = [{ path: 'metadata.txt', sha256: createHash('sha256').update(bytes).digest('hex') }];
  await f.run();
  await writeFile(join(f.root, 'metadata.txt'), 'changed elsewhere');
  const stale = await f.run();
  assert.equal(stale.stages[0].failure, 'GUARD_MISMATCH'); assert.equal(stale.stages[0].nativeExitCode, null);
  assert.equal(await f.count(), 1);
  await writeFile(join(f.root, 'metadata.txt'), bytes);
  // The failed guard invalidates the earlier same-key index, even if bytes return.
  assert.equal((await f.run()).stages[0].status, 'passed'); assert.equal(await f.count(), 2);
  await writeFile(join(f.root, 'child.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync('metadata.txt','changed by child'); writeFileSync('artifact.txt','made');`);
  const changed = await f.run();
  assert.equal(changed.status, 'failed'); assert.equal(changed.stages[0].failure, 'GUARD_MISMATCH');
  assert.equal(changed.stages[0].nativeExitCode, 0); assert.equal(changed.exitCode, 1);
  await writeFile(join(f.root, 'metadata.txt'), bytes);
  assert.equal((await f.run()).stages[0].status, 'failed');
});
