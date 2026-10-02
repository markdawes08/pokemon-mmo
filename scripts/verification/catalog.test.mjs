import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { battleChecks } from '../battle-checks.mjs';
import { selectStages, createCatalog, profiles } from './catalog.mjs';

test('one engine registry preserves all fourteen historical gates and special checks', () => {
  assert.equal(profiles.length, 14);
  assert.equal(new Set(battleChecks.map(row => row.stage)).size, 14);
  assert.deepEqual(battleChecks.find(row => row.profile === 'route1').checks, ['verify', 'verify-items', 'verify-integration', 'verify-items-integration']);
  assert(battleChecks.find(row => row.profile === 'spike').checks.includes('measure'));
});

test('selection rejects missing/cyclic dependencies and orders prerequisites once', () => {
  const stages = [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a', 'b'], milestone: true }];
  assert.deepEqual(selectStages(stages), ['a', 'b', 'c']);
  assert.throws(() => selectStages(stages, { mode: 'stage', requested: ['missing'] }));
  assert.throws(() => selectStages([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }], { mode: 'stage', requested: ['a'] }));
  assert.throws(() => selectStages(stages, { mode: 'focus', area: 'unknown' }));
});

test('real focus plans retain full current mechanics and mutable checks without unrelated browser suites', async () => {
  const stages = await createCatalog(process.cwd());
  const selected = selectStages(stages, { mode: 'focus', area: 'battle' });
  assert.equal(selected[0], 'fixtures:check');
  assert.equal(selectStages(stages, { mode: 'focus', area: 'app' })[0], 'fixtures:check');
  assert.equal(selectStages(stages, { mode: 'stage', requested: ['battle:mirror'] })[0], 'fixtures:check');
  for (const id of ['battle:mirror', 'practice:check', 'wild:check', 'test:ts', 'typecheck', 'build', 'test:boundaries', 'browser:practice']) assert(selected.includes(id));
  assert(!selected.includes('test:e2e')); assert(!selected.includes('test:content'));
  for (const id of ['doctor', 'practice:check', 'wild:check', 'test:integration', 'test:recovery', 'test:e2e', 'browser:practice', 'browser:app', 'test:boundaries'])
    assert.equal(stages.find(stage => stage.id === id).cacheable, false, id);
  const full = selectStages(stages);
  for (const check of battleChecks) assert(full.includes(check.stage));
  assert(full.includes('test:content')); assert(full.includes('test:e2e'));
  const tooling = selectStages(stages, { mode: 'focus', area: 'tooling' });
  assert(!tooling.includes('build')); assert(!tooling.includes('test:integration'));
  const lock = JSON.parse(await readFile('source-lock.json', 'utf8'));
  const mirror = stages.find(stage => stage.id === 'battle:mirror');
  const spike = stages.find(stage => stage.id === 'battle:spike');
  assert.deepEqual(spike.config.registry, battleChecks[0]);
  assert(!spike.config.package.scripts);
  assert.deepEqual(spike.config.fixtures.fixtures, []);
  for (const path of ['package.json', 'scripts/battle-checks.mjs', 'tools/fixtures/manifest.json']) {
    assert(!mirror.inputs.includes(path));
    assert(mirror.guards.some(guard => guard.path === path && /^[0-9a-f]{64}$/.test(guard.sha256)));
  }
  assert(!mirror.inputs.some(path => path.startsWith('scripts/verification/')));
  for (const path of ['pokefirered.gba', 'build/firered/src/battle_script_commands.o', 'src/data/heal_locations.json', 'src/heal_location.c'])
    assert(mirror.inputs.includes(resolve(lock.reference.localPath, path)), path);
  assert(stages.find(stage => stage.id === 'build').inputs.some(path => path.endsWith('.wav')));
  assert(stages.find(stage => stage.id === 'encounter:check').outputs.includes('reports/encounter-dependencies.json'));
  for (const id of ['content:check', 'test:content', 'sprites:check']) assert(stages.find(stage => stage.id === id).inputs.includes(lock.fingerprint.manifest));
  const spriteManifest = JSON.parse(await readFile('content/generated/manifests/practice-sprites-manifest.json', 'utf8'));
  const sprites = stages.find(stage => stage.id === 'sprites:check');
  for (const row of spriteManifest.inputs) assert(sprites.inputs.includes(resolve(lock.reference.localPath, row.path)));
  assert(!sprites.inputs.includes(resolve(lock.reference.localPath, 'graphics')), 'sprite reuse must not scan unrelated reference graphics');
  for (const stage of stages) for (const evidence of stage.evidence) assert(stage.outputs.includes(evidence), `${stage.id} must require ${evidence}`);
});
